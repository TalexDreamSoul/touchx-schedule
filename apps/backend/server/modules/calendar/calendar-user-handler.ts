import type { H3Event } from "h3";
import type {
  CalendarSourceType,
  CalendarSourceVisibility,
} from "@touchx/shared";
import { storeHelpers, type AuthSessionRecord, type NexusStore, type UserRecord } from "../../services/domain-store";
import {
  buildEffectiveCalendarForUser,
} from "./effective-calendar-service";
import {
  createOrUpdateCustomCalendarSource,
  getCalendarSourceDetail,
  listCalendarSources,
  publishCalendarSourceVersion,
} from "./calendar-source-service";
import {
  cancelCalendarSubscription,
  listUserCalendarSubscriptions,
  subscribeCalendarSource,
} from "./calendar-subscription-service";
import {
  archivePersonalEvent,
  createPersonalEvent,
  listPersonalEvents,
  markPersonalEventDone,
  updatePersonalEvent,
  type PersonalEventInput,
} from "./personal-event-service";
import { toAdminCalendarSourcePayload, toCalendarSourceVersion } from "./calendar-adapter";
import { isAdminRole } from "../auth/auth-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord };
type RequireAdmin = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord };
type ResolveSessionWithUser = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord } | null;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;
type ToUserPayload = (user: UserRecord) => Record<string, unknown>;

export interface CalendarUserHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireUser: RequireUser;
  requireAdmin: RequireAdmin;
  resolveSessionWithUser: ResolveSessionWithUser;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
  toUserPayload: ToUserPayload;
  normalizeReminderOffsets: (value: unknown, fallback?: number[]) => number[];
}

const asString = (value: unknown) => String(value || "").trim();

export const isCalendarUserPath = (path: string) => {
  return (
    path === "calendar/sources" ||
    path.startsWith("calendar/sources/") ||
    path === "calendar/me/subscriptions" ||
    path.startsWith("calendar/me/subscriptions/") ||
    path === "calendar/me/settings" ||
    path === "calendar/me/effective" ||
    path === "calendar/me/personal-events" ||
    path.startsWith("calendar/me/personal-events/") ||
    path.startsWith("admin/calendar/sources/")
  );
};

export const handleCalendarUserApi = async (context: CalendarUserHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    ok,
    toApiError,
    requireUser,
    requireAdmin,
    resolveSessionWithUser,
    readJsonBody,
    appendAudit,
    toUserPayload,
    normalizeReminderOffsets,
  } = context;

  if (method === "GET" && path === "calendar/sources") {
    const viewer = resolveSessionWithUser(event);
    const includePrivate = asString(query.includePrivate).toLowerCase() === "true" || asString(query.include_private) === "1";
    const items = listCalendarSources(store, {
      viewerUserId: viewer?.user.userId,
      includePrivate: includePrivate && viewer ? isAdminRole(viewer.user) : false,
    });
    return ok(items);
  }

  if (method === "POST" && path === "calendar/sources") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      sourceId?: string;
      title?: string;
      description?: string;
      type?: CalendarSourceType;
      visibility?: CalendarSourceVisibility;
      publish?: boolean;
      events?: unknown[];
    }>(event);
    const source = createOrUpdateCustomCalendarSource(store, user, {
      sourceId: body.sourceId,
      title: body.title,
      description: body.description,
      type: body.type,
      visibility: body.visibility,
      publish: body.publish,
      events: body.events,
    });
    if (!source) {
      return toApiError(400, "CALENDAR_SOURCE_TITLE_REQUIRED", "日程源标题不能为空");
    }
    appendAudit("calendar_source_upsert", user.userId, { sourceId: `schedule:${source.id}`, title: source.title });
    return ok({ item: toAdminCalendarSourcePayload(store, source) });
  }

  const calendarSourcePublishVersionMatch = path.match(/^admin\/calendar\/sources\/([^/]+)\/versions\/(\d+)\/publish$/);
  if (method === "POST" && calendarSourcePublishVersionMatch) {
    const { user } = requireAdmin(event);
    const sourceId = decodeURIComponent(calendarSourcePublishVersionMatch[1]);
    const versionNo = Number(calendarSourcePublishVersionMatch[2]);
    const result = publishCalendarSourceVersion(store, sourceId, versionNo);
    if (!result.ok && result.reason === "source_not_found") {
      return toApiError(404, "CALENDAR_SOURCE_NOT_FOUND", "日程源不存在");
    }
    if (!result.ok) {
      return toApiError(404, "CALENDAR_SOURCE_VERSION_NOT_FOUND", "日程源版本不存在");
    }
    appendAudit("calendar_source_version_publish", user.userId, { sourceId, scheduleId: result.schedule.id, versionNo });
    return ok({ item: toAdminCalendarSourcePayload(store, result.schedule), version: toCalendarSourceVersion(result.version) });
  }

  const calendarSourceDetailMatch = path.match(/^calendar\/sources\/([^/]+)$/);
  if (method === "GET" && calendarSourceDetailMatch) {
    const viewer = resolveSessionWithUser(event);
    const sourceId = decodeURIComponent(calendarSourceDetailMatch[1]);
    const detail = getCalendarSourceDetail(store, sourceId, viewer?.user || null);
    if (!detail) {
      return toApiError(404, "CALENDAR_SOURCE_NOT_FOUND", "日程源不存在");
    }
    if (detail === "forbidden") {
      return toApiError(403, "CALENDAR_SOURCE_FORBIDDEN", "当前用户无权查看该日程源");
    }
    return ok(detail);
  }

  const calendarSourceSubscribeMatch = path.match(/^calendar\/sources\/([^/]+)\/subscribe$/);
  if (method === "POST" && calendarSourceSubscribeMatch) {
    const { user } = requireUser(event);
    const sourceId = decodeURIComponent(calendarSourceSubscribeMatch[1]);
    const result = subscribeCalendarSource(store, user, sourceId);
    if (!result) {
      return toApiError(404, "CALENDAR_SOURCE_NOT_FOUND", "日程源不存在");
    }
    if (result === "not_published") {
      return toApiError(400, "CALENDAR_SOURCE_NOT_PUBLISHED", "日程源尚未发布，暂不可订阅");
    }
    if (result === "forbidden") {
      return toApiError(403, "CALENDAR_SOURCE_FORBIDDEN", "当前用户无权订阅该日程源");
    }
    appendAudit("calendar_source_subscribe", user.userId, { sourceId, subscriptionId: result.subscription.id });
    return ok(result);
  }

  if (method === "GET" && path === "calendar/me/subscriptions") {
    const { user } = requireUser(event);
    return ok(listUserCalendarSubscriptions(store, user));
  }

  const calendarSubscriptionCancelMatch = path.match(/^calendar\/me\/subscriptions\/([^/]+)\/(?:cancel|delete)$/);
  if (method === "POST" && calendarSubscriptionCancelMatch) {
    const { user } = requireUser(event);
    const subscriptionId = decodeURIComponent(calendarSubscriptionCancelMatch[1]);
    const removed = cancelCalendarSubscription(store, user, subscriptionId);
    if (!removed) {
      return toApiError(404, "CALENDAR_SUBSCRIPTION_NOT_FOUND", "订阅不存在或不属于当前用户");
    }
    appendAudit("calendar_source_unsubscribe", user.userId, { subscriptionId, sourceScheduleId: removed.sourceScheduleId });
    return ok({ cancelled: true, subscriptionId });
  }

  if (method === "GET" && path === "calendar/me/settings") {
    const { user } = requireUser(event);
    return ok({
      reminderEnabled: user.reminderEnabled,
      reminderWindowMinutes: user.reminderWindowMinutes,
      defaultViewMode: "timeline",
      showWeekends: true,
      syncToSystemCalendar: true,
    });
  }

  if (method === "POST" && path === "calendar/me/settings") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ reminderEnabled?: boolean; reminderWindowMinutes?: unknown[]; nickname?: string }>(event);
    if (typeof body.reminderEnabled === "boolean") {
      user.reminderEnabled = body.reminderEnabled;
    }
    if (Array.isArray(body.reminderWindowMinutes)) {
      user.reminderWindowMinutes = normalizeReminderOffsets(body.reminderWindowMinutes, user.reminderWindowMinutes);
    }
    if (Object.prototype.hasOwnProperty.call(body, "nickname")) {
      const nickname = asString(body.nickname);
      if (nickname) user.nickname = nickname;
    }
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("calendar_settings_update", user.userId, { reminderEnabled: user.reminderEnabled, offsets: user.reminderWindowMinutes });
    return ok({ user: toUserPayload(user) });
  }

  if (method === "GET" && path === "calendar/me/effective") {
    const { user } = requireUser(event);
    const result = buildEffectiveCalendarForUser(store, user, {
      week: Number(query.week || 0) || undefined,
      date: asString(query.date),
      includeHidden: asString(query.includeHidden).toLowerCase() === "true" || asString(query.include_hidden) === "1",
    });
    return ok(result);
  }

  if (method === "GET" && path === "calendar/me/personal-events") {
    const { user } = requireUser(event);
    const includeArchived = asString(query.includeArchived).toLowerCase() === "true" || asString(query.include_archived) === "1";
    return ok(listPersonalEvents(store, user, { includeArchived }));
  }

  if (method === "POST" && path === "calendar/me/personal-events") {
    const { user } = requireUser(event);
    const body = await readJsonBody<PersonalEventInput>(event);
    const item = createPersonalEvent(store, user, body);
    if (!item) {
      return toApiError(400, "PERSONAL_EVENT_TITLE_REQUIRED", "个人事项标题不能为空");
    }
    appendAudit("personal_event_create", user.userId, { eventId: item.id, title: item.title });
    return ok({ item });
  }

  const personalEventUpdateMatch = path.match(/^calendar\/me\/personal-events\/([^/]+)$/);
  if ((method === "POST" || method === "PATCH") && personalEventUpdateMatch) {
    const { user } = requireUser(event);
    const eventId = decodeURIComponent(personalEventUpdateMatch[1]);
    const body = await readJsonBody<PersonalEventInput>(event);
    const item = updatePersonalEvent(store, user, eventId, body);
    if (!item) {
      return toApiError(404, "PERSONAL_EVENT_NOT_FOUND", "个人事项不存在");
    }
    if (item === "title_required") {
      return toApiError(400, "PERSONAL_EVENT_TITLE_REQUIRED", "个人事项标题不能为空");
    }
    appendAudit("personal_event_update", user.userId, { eventId });
    return ok({ item });
  }

  const personalEventDeleteMatch = path.match(/^calendar\/me\/personal-events\/([^/]+)\/delete$/);
  if (method === "POST" && personalEventDeleteMatch) {
    const { user } = requireUser(event);
    const eventId = decodeURIComponent(personalEventDeleteMatch[1]);
    const item = archivePersonalEvent(store, user, eventId);
    if (!item) {
      return toApiError(404, "PERSONAL_EVENT_NOT_FOUND", "个人事项不存在");
    }
    appendAudit("personal_event_archive", user.userId, { eventId });
    return ok({ item });
  }

  const personalEventDoneMatch = path.match(/^calendar\/me\/personal-events\/([^/]+)\/done$/);
  if (method === "POST" && personalEventDoneMatch) {
    const { user } = requireUser(event);
    const eventId = decodeURIComponent(personalEventDoneMatch[1]);
    const item = markPersonalEventDone(store, user, eventId);
    if (!item) {
      return toApiError(404, "PERSONAL_EVENT_NOT_FOUND", "个人事项不存在");
    }
    appendAudit("personal_event_done", user.userId, { eventId });
    return ok({ item });
  }

  return null;
};
