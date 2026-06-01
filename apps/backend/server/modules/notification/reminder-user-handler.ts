import type { H3Event } from "h3";
import type { ReminderChannelStrategy, ReminderTargetType } from "@touchx/shared";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import { enqueueReminderCandidatesForUser, listReminderCandidatesForUser } from "./reminder-candidate-service";
import { deleteReminderRule, upsertReminderRule } from "./reminder-rule-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface ReminderUserHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireUser: RequireUser;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
}

const asString = (value: unknown) => String(value || "").trim();

const listUserReminderRules = (store: NexusStore, user: UserRecord) => {
  const subscriptionIds = new Set(store.scheduleSubscriptions.filter((item) => item.subscriberUserId === user.userId).map((item) => item.id));
  const items = store.reminderRules
    .filter((rule) => {
      if (rule.targetType === "global") return rule.targetId === `user:${user.userId}` || rule.targetId === "global";
      if (rule.targetType === "subscription") return subscriptionIds.has(rule.targetId);
      if (rule.targetType === "personal_event") return store.userScheduleEvents.some((item) => item.id === rule.targetId && item.userId === user.userId);
      return false;
    })
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return { items, total: items.length };
};

const canUserEditReminderRule = (store: NexusStore, user: UserRecord, ruleId: string) => {
  const rule = store.reminderRules.find((item) => item.id === ruleId) || null;
  if (!rule) {
    return false;
  }
  return (
    (rule.targetType === "global" && (rule.targetId === `user:${user.userId}` || rule.targetId === "global")) ||
    (rule.targetType === "subscription" && store.scheduleSubscriptions.some((item) => item.id === rule.targetId && item.subscriberUserId === user.userId)) ||
    (rule.targetType === "personal_event" && store.userScheduleEvents.some((item) => item.id === rule.targetId && item.userId === user.userId))
  );
};

export const handleReminderUserApi = async (context: ReminderUserHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireUser, readJsonBody, appendAudit } = context;

  if (method === "GET" && path === "calendar/me/reminder-rules") {
    const { user } = requireUser(event);
    return ok(listUserReminderRules(store, user));
  }

  if (method === "POST" && path === "calendar/me/reminder-rules") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      id?: string;
      targetType?: ReminderTargetType;
      targetId?: string;
      enabled?: boolean;
      offsetMinutes?: number;
      templateKey?: string;
      channelStrategy?: ReminderChannelStrategy;
      quietHoursRespect?: boolean;
    }>(event);
    const targetType = body.targetType || "global";
    const targetId = targetType === "global" ? (asString(body.targetId) || `user:${user.userId}`) : asString(body.targetId);
    if (targetType === "subscription" && !store.scheduleSubscriptions.some((item) => item.id === targetId && item.subscriberUserId === user.userId)) {
      return toApiError(403, "REMINDER_RULE_TARGET_FORBIDDEN", "不能编辑非本人订阅的提醒规则");
    }
    if (targetType === "personal_event" && !store.userScheduleEvents.some((item) => item.id === targetId && item.userId === user.userId)) {
      return toApiError(403, "REMINDER_RULE_TARGET_FORBIDDEN", "不能编辑非本人事项的提醒规则");
    }
    const existingId = asString(body.id);
    if (existingId && !canUserEditReminderRule(store, user, existingId)) {
      return toApiError(403, "REMINDER_RULE_FORBIDDEN", "不能编辑非本人提醒规则");
    }
    const rule = upsertReminderRule(store, {
      ...body,
      targetType,
      targetId,
      templateKey: asString(body.templateKey) || "calendar.event.reminder",
    });
    appendAudit("user_reminder_rule_upsert", user.userId, { ruleId: rule.id, targetType: rule.targetType, targetId: rule.targetId });
    return ok({ item: rule });
  }

  const myReminderRuleDeleteMatch = path.match(/^calendar\/me\/reminder-rules\/([^/]+)\/delete$/);
  if (method === "POST" && myReminderRuleDeleteMatch) {
    const { user } = requireUser(event);
    const ruleId = decodeURIComponent(myReminderRuleDeleteMatch[1]);
    if (!canUserEditReminderRule(store, user, ruleId)) {
      return toApiError(404, "REMINDER_RULE_NOT_FOUND", "提醒规则不存在");
    }
    const removed = deleteReminderRule(store, ruleId);
    appendAudit("user_reminder_rule_delete", user.userId, { ruleId });
    return ok({ item: removed });
  }

  if (method === "GET" && path === "calendar/me/reminder-candidates") {
    const { user } = requireUser(event);
    const result = listReminderCandidatesForUser(store, user, {
      week: Number(query.week || 0) || undefined,
      date: asString(query.date),
    });
    return ok(result);
  }

  if (method === "POST" && path === "calendar/me/reminder-candidates/enqueue") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ week?: number; date?: string; limit?: number }>(event);
    const result = enqueueReminderCandidatesForUser(store, user, {
      week: body.week,
      date: asString(body.date),
      limit: body.limit,
    });
    appendAudit("reminder_candidates_enqueue", user.userId, { count: result.total, candidateTotal: result.candidateTotal });
    return ok(result);
  }

  return null;
};
