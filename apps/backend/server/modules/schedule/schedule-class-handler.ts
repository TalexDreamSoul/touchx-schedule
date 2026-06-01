import type { H3Event } from "h3";
import type { NexusStore, UserRecord, ClassRecord, ClassMemberRecord, ScheduleRecord, ScheduleVersionRecord } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import type { SchedulePatch } from "@touchx/shared";
import { onSchedulePublished } from "../calendar/calendar-source-service";
import {
  createSchedulePatch,
  createScheduleSubscription,
  ensureUniquePush,
  getClassMemberRole,
  getLatestScheduleVersion,
  getPublishedScheduleVersion,
  listUserScheduleConflicts,
  listUserSchedulePatches,
  listUserScheduleSubscriptions,
  normalizeScheduleEntries,
  relinkSchedulePatch,
  requireClassAccess,
  resolveScheduleConflict,
} from "./schedule-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { user: UserRecord };
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface ScheduleClassHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireUser: RequireUser;
  requireAdmin: RequireAdmin;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
}

const asString = (value: unknown) => String(value || "").trim();

const assertClassAccess = (context: ScheduleClassHandlerContext, user: UserRecord, classId: string, roles: Parameters<typeof requireClassAccess>[3]) => {
  const result = requireClassAccess(context.store, user, classId, roles);
  if (!result.ok) {
    return context.toApiError(result.statusCode, result.code, result.message);
  }
  return result;
};

export const isScheduleClassPath = (path: string) => {
  return (
    path === "classes" ||
    path.startsWith("classes/") ||
    path === "admin/classes" ||
    path.startsWith("admin/classes/") ||
    path === "admin/schedules" ||
    path.startsWith("schedules/") ||
    path === "me/schedule-subscriptions" ||
    path === "me/schedule-patches" ||
    path.startsWith("me/schedule-patches/") ||
    path === "me/schedule-conflicts" ||
    path.startsWith("me/schedule-conflicts/")
  );
};

export const handleScheduleClassApi = async (context: ScheduleClassHandlerContext) => {
  const { event, method, path, store, ok, toApiError, requireUser, requireAdmin, readJsonBody, appendAudit } = context;

  if (method === "GET" && path === "classes") {
    const { user } = requireUser(event);
    const items = store.classes.map((classItem) => {
      const memberRole = getClassMemberRole(store, user.userId, classItem.id);
      return {
        classId: classItem.id,
        className: classItem.name,
        timezone: classItem.timezone,
        status: classItem.status,
        role: memberRole || "",
        joined: Boolean(memberRole),
        ownerUserId: classItem.ownerUserId,
      };
    });
    return ok({ items });
  }

  if (method === "POST" && path === "classes") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ className?: string; timezone?: string }>(event);
    const className = asString(body.className);
    if (!className) {
      return toApiError(400, "CLASS_NAME_REQUIRED", "班级名称不能为空");
    }
    const classId = storeHelpers.createId("class");
    const classItem: ClassRecord = {
      id: classId,
      name: className,
      ownerUserId: user.userId,
      timezone: asString(body.timezone) || "Asia/Shanghai",
      status: "active",
      activeJoinCode: storeHelpers.generateJoinCode(),
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.classes.push(classItem);
    store.classMembers.push({
      id: storeHelpers.createId("class_member"),
      classId,
      userId: user.userId,
      classRole: "class_owner",
      joinedAt: storeHelpers.nowIso(),
    });
    ensureUniquePush(user.classIds, classId);
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("class_create", user.userId, { classId, className });
    return ok({ classId, className, joinCode: classItem.activeJoinCode, timezone: classItem.timezone });
  }

  const classJoinMatch = path.match(/^classes\/([^/]+)\/join$/);
  if (method === "POST" && classJoinMatch) {
    const classId = decodeURIComponent(classJoinMatch[1]);
    const { user } = requireUser(event);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem || classItem.status !== "active") {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在或已停用");
    }
    const body = await readJsonBody<{ joinCode?: string }>(event);
    const joinCode = asString(body.joinCode).toUpperCase();
    if (!joinCode || joinCode !== classItem.activeJoinCode) {
      return toApiError(400, "JOIN_CODE_INVALID", "班级加入码无效");
    }
    const existing = store.classMembers.find((item) => item.classId === classId && item.userId === user.userId);
    if (existing) {
      return ok({ joined: true, classId, className: classItem.name, classRole: existing.classRole });
    }
    const member: ClassMemberRecord = {
      id: storeHelpers.createId("class_member"),
      classId,
      userId: user.userId,
      classRole: "class_viewer",
      joinedAt: storeHelpers.nowIso(),
    };
    store.classMembers.push(member);
    ensureUniquePush(user.classIds, classId);
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("class_join", user.userId, { classId, className: classItem.name });
    return ok({ joined: true, classId, className: classItem.name, classRole: member.classRole });
  }

  const classRotateMatch = path.match(/^classes\/([^/]+)\/join-code\/rotate$/);
  if (method === "POST" && classRotateMatch) {
    const classId = decodeURIComponent(classRotateMatch[1]);
    const { user } = requireUser(event);
    assertClassAccess(context, user, classId, ["class_owner", "class_admin"]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    classItem.activeJoinCode = storeHelpers.generateJoinCode();
    classItem.updatedAt = storeHelpers.nowIso();
    appendAudit("class_rotate_join_code", user.userId, { classId });
    return ok({ classId, joinCode: classItem.activeJoinCode, updatedAt: classItem.updatedAt });
  }

  const classSchedulesMatch = path.match(/^classes\/([^/]+)\/schedules$/);
  if (method === "POST" && classSchedulesMatch) {
    const classId = decodeURIComponent(classSchedulesMatch[1]);
    const { user } = requireUser(event);
    assertClassAccess(context, user, classId, ["class_owner", "class_admin", "class_editor"]);
    const body = await readJsonBody<{ title?: string; description?: string; entries?: unknown[]; publishNow?: boolean }>(event);
    const title = asString(body.title) || `课表-${new Date().toISOString().slice(0, 10)}`;
    const description = asString(body.description);
    const entries = normalizeScheduleEntries(body.entries);
    const scheduleId = storeHelpers.createId("schedule");
    const schedule: ScheduleRecord = {
      id: scheduleId,
      classId,
      title,
      description,
      publishedVersionNo: body.publishNow ? 1 : 0,
      createdByUserId: user.userId,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    const version: ScheduleVersionRecord = {
      id: storeHelpers.createId("schedule_version"),
      scheduleId,
      versionNo: 1,
      status: body.publishNow ? "published" : "draft",
      entries,
      createdByUserId: user.userId,
      createdAt: storeHelpers.nowIso(),
    };
    store.schedules.push(schedule);
    store.scheduleVersions.push(version);
    if (body.publishNow) {
      onSchedulePublished(store, schedule, 1);
    }
    appendAudit("schedule_create", user.userId, { classId, scheduleId, title, publishNow: Boolean(body.publishNow) });
    return ok({ scheduleId, classId, title, publishedVersionNo: schedule.publishedVersionNo, versionNo: version.versionNo, status: version.status, entryCount: version.entries.length });
  }

  if (method === "GET" && path === "admin/schedules") {
    requireAdmin(event);
    const items = store.schedules.map((schedule) => {
      const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
      const versions = store.scheduleVersions.filter((item) => item.scheduleId === schedule.id).sort((left, right) => right.versionNo - left.versionNo);
      const publishedVersion = versions.find((item) => item.versionNo === schedule.publishedVersionNo && item.status === "published") || null;
      const latestVersion = versions[0] || null;
      return {
        scheduleId: schedule.id,
        classId: schedule.classId,
        classLabel: classItem?.name || "",
        title: schedule.title,
        description: schedule.description,
        publishedVersionNo: schedule.publishedVersionNo,
        latestVersionNo: latestVersion?.versionNo || 0,
        latestStatus: latestVersion?.status || "draft",
        latestEntryCount: latestVersion?.entries.length || 0,
        publishedEntryCount: publishedVersion?.entries.length || 0,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
      };
    });
    return ok({ items });
  }

  const schedulePublishMatch = path.match(/^schedules\/([^/]+)\/publish$/);
  if (method === "POST" && schedulePublishMatch) {
    const scheduleId = decodeURIComponent(schedulePublishMatch[1]);
    const { user } = requireUser(event);
    const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
    if (!schedule) {
      return toApiError(404, "SCHEDULE_NOT_FOUND", "课表不存在");
    }
    assertClassAccess(context, user, schedule.classId, ["class_owner", "class_admin", "class_editor"]);
    const body = await readJsonBody<{ entries?: unknown[] }>(event);
    const latestVersion = getLatestScheduleVersion(store, scheduleId);
    const nextVersionNo = (latestVersion?.versionNo || 0) + 1;
    const entries = Array.isArray(body.entries)
      ? normalizeScheduleEntries(body.entries)
      : [...(latestVersion?.entries || [])].map((entry) => ({ ...entry, id: storeHelpers.createId("entry") }));
    const version: ScheduleVersionRecord = {
      id: storeHelpers.createId("schedule_version"),
      scheduleId,
      versionNo: nextVersionNo,
      status: "published",
      entries,
      createdByUserId: user.userId,
      createdAt: storeHelpers.nowIso(),
    };
    store.scheduleVersions.push(version);
    schedule.publishedVersionNo = nextVersionNo;
    schedule.updatedAt = storeHelpers.nowIso();
    onSchedulePublished(store, schedule, nextVersionNo);
    appendAudit("schedule_publish", user.userId, { scheduleId, versionNo: nextVersionNo });
    return ok({ scheduleId, versionNo: nextVersionNo, entryCount: entries.length, publishedVersionNo: schedule.publishedVersionNo });
  }

  const scheduleSubscribeMatch = path.match(/^schedules\/([^/]+)\/subscribe$/);
  if (method === "POST" && scheduleSubscribeMatch) {
    const scheduleId = decodeURIComponent(scheduleSubscribeMatch[1]);
    const { user } = requireUser(event);
    const result = createScheduleSubscription(store, user, scheduleId);
    if (!result.ok && result.reason === "not_found") {
      return toApiError(404, "SCHEDULE_NOT_FOUND", "课表不存在");
    }
    if (!result.ok) {
      return toApiError(400, "SCHEDULE_NOT_PUBLISHED", "该课表尚未发布，暂不可订阅");
    }
    if (result.duplicated) {
      return ok({ subscription: result.subscription, duplicated: true });
    }
    appendAudit("schedule_subscribe", user.userId, { scheduleId, subscriptionId: result.subscription.id });
    return ok({ subscription: result.subscription });
  }

  if (method === "GET" && path === "me/schedule-subscriptions") {
    const { user } = requireUser(event);
    return ok(listUserScheduleSubscriptions(store, user));
  }

  if (method === "POST" && path === "me/schedule-patches") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ subscriptionId?: string; entryId?: string; opType?: SchedulePatch["opType"]; patchPayload?: Record<string, unknown> }>(event);
    const result = createSchedulePatch(store, {
      user,
      subscriptionId: asString(body.subscriptionId),
      entryId: asString(body.entryId),
      opType: body.opType,
      patchPayload: body.patchPayload,
    });
    if (!result.ok && result.reason === "param_invalid") {
      return toApiError(400, "PATCH_PARAM_INVALID", "subscriptionId 与 entryId 均不能为空");
    }
    if (!result.ok) {
      return toApiError(403, "PATCH_FORBIDDEN", "不能修改非本人订阅的课表补丁");
    }
    appendAudit("schedule_patch_create", user.userId, { subscriptionId: result.patch.subscriptionId, patchId: result.patch.id, entryId: result.patch.entryId });
    return ok({ patch: result.patch, followMode: result.subscription.followMode });
  }

  if (method === "GET" && path === "me/schedule-conflicts") {
    const { user } = requireUser(event);
    return ok(listUserScheduleConflicts(store, user));
  }

  if (method === "GET" && path === "me/schedule-patches") {
    const { user } = requireUser(event);
    return ok(listUserSchedulePatches(store, user));
  }

  const conflictResolveMatch = path.match(/^me\/schedule-conflicts\/([^/]+)\/resolve$/);
  if (method === "POST" && conflictResolveMatch) {
    const conflictId = decodeURIComponent(conflictResolveMatch[1]);
    const { user } = requireUser(event);
    const body = await readJsonBody<{ action?: "keep_patch" | "relink" }>(event);
    const result = resolveScheduleConflict(store, user, conflictId, body.action);
    if (!result.ok && result.reason === "not_found") {
      return toApiError(404, "CONFLICT_NOT_FOUND", "冲突记录不存在");
    }
    if (!result.ok) {
      return toApiError(403, "CONFLICT_FORBIDDEN", "不能操作其他人的冲突记录");
    }
    appendAudit("schedule_conflict_resolve", user.userId, { conflictId, action: result.action, subscriptionId: result.subscription.id });
    return ok({ conflict: result.conflict, subscription: result.subscription });
  }

  const patchRelinkMatch = path.match(/^me\/schedule-patches\/([^/]+)\/relink$/);
  if (method === "POST" && patchRelinkMatch) {
    const patchId = decodeURIComponent(patchRelinkMatch[1]);
    const { user } = requireUser(event);
    const result = relinkSchedulePatch(store, user, patchId);
    if (!result.ok && result.reason === "not_found") {
      return toApiError(404, "PATCH_NOT_FOUND", "课表补丁不存在");
    }
    if (!result.ok) {
      return toApiError(403, "PATCH_FORBIDDEN", "不能操作其他人的补丁");
    }
    appendAudit("schedule_patch_relink", user.userId, { patchId, subscriptionId: result.subscription.id });
    return ok({ relinked: true, subscription: result.subscription });
  }

  if (method === "GET" && path === "admin/classes") {
    requireAdmin(event);
    const items = store.classes.map((classItem) => {
      const members = store.classMembers.filter((member) => member.classId === classItem.id);
      return {
        classId: classItem.id,
        classLabel: classItem.name,
        currentCode: classItem.activeJoinCode,
        active: classItem.status === "active",
        memberCount: members.length,
        subscriberCount: store.scheduleSubscriptions.filter((subscription) => {
          const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === subscription.sourceScheduleId) || null;
          return schedule?.classId === classItem.id;
        }).length,
      };
    });
    return ok({ items });
  }

  if (method === "POST" && path === "admin/classes") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ classLabel?: string; active?: boolean; ownerStudentNo?: string }>(event);
    const classLabel = asString(body.classLabel);
    if (!classLabel) {
      return toApiError(400, "CLASS_LABEL_REQUIRED", "classLabel 不能为空");
    }
    const ownerStudentNo = asString(body.ownerStudentNo);
    const owner = ownerStudentNo ? store.users.find((item) => item.studentNo === ownerStudentNo) || null : user;
    if (!owner) {
      return toApiError(400, "CLASS_OWNER_NOT_FOUND", "班级负责人不存在");
    }
    const classId = storeHelpers.createId("class");
    const classItem: ClassRecord = {
      id: classId,
      name: classLabel,
      ownerUserId: owner.userId,
      timezone: "Asia/Shanghai",
      status: body.active === false ? "inactive" : "active",
      activeJoinCode: storeHelpers.generateJoinCode(),
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.classes.push(classItem);
    store.classMembers.push({ id: storeHelpers.createId("class_member"), classId, userId: owner.userId, classRole: "class_owner", joinedAt: storeHelpers.nowIso() });
    ensureUniquePush(owner.classIds, classId);
    appendAudit("admin_class_create", user.userId, { classId, classLabel, ownerUserId: owner.userId });
    return ok({ classId, classLabel, currentCode: classItem.activeJoinCode, active: classItem.status === "active" });
  }

  const adminClassUpdateMatch = path.match(/^admin\/classes\/([^/]+)\/update$/);
  if (method === "POST" && adminClassUpdateMatch) {
    const { user } = requireAdmin(event);
    const classId = decodeURIComponent(adminClassUpdateMatch[1]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    const body = await readJsonBody<{ classLabel?: string; timezone?: string; active?: boolean; ownerStudentNo?: string }>(event);
    const classLabel = asString(body.classLabel);
    const timezone = asString(body.timezone);
    const ownerStudentNo = asString(body.ownerStudentNo);
    if (classLabel) classItem.name = classLabel;
    if (timezone) classItem.timezone = timezone;
    if (typeof body.active === "boolean") classItem.status = body.active ? "active" : "inactive";
    if (ownerStudentNo) {
      const owner = store.users.find((item) => item.studentNo === ownerStudentNo) || null;
      if (!owner) {
        return toApiError(400, "CLASS_OWNER_NOT_FOUND", "班级负责人不存在");
      }
      classItem.ownerUserId = owner.userId;
      const ownerMembership = store.classMembers.find((item) => item.classId === classId && item.userId === owner.userId);
      if (!ownerMembership) {
        store.classMembers.push({ id: storeHelpers.createId("class_member"), classId, userId: owner.userId, classRole: "class_owner", joinedAt: storeHelpers.nowIso() });
      } else {
        ownerMembership.classRole = "class_owner";
      }
      ensureUniquePush(owner.classIds, classId);
      owner.updatedAt = storeHelpers.nowIso();
    }
    classItem.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_class_update", user.userId, { classId });
    return ok({ classId: classItem.id, classLabel: classItem.name, timezone: classItem.timezone, active: classItem.status === "active", ownerUserId: classItem.ownerUserId, currentCode: classItem.activeJoinCode, updatedAt: classItem.updatedAt });
  }

  const adminClassRotateMatch = path.match(/^admin\/classes\/([^/]+)\/rotate-code$/);
  if (method === "POST" && adminClassRotateMatch) {
    const { user } = requireAdmin(event);
    const classId = decodeURIComponent(adminClassRotateMatch[1]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    classItem.activeJoinCode = storeHelpers.generateJoinCode();
    classItem.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_class_rotate_code", user.userId, { classId });
    return ok({ classId, currentCode: classItem.activeJoinCode, updatedAt: classItem.updatedAt });
  }

  const adminClassMembersMatch = path.match(/^admin\/classes\/([^/]+)\/members$/);
  if (method === "GET" && adminClassMembersMatch) {
    requireAdmin(event);
    const classId = decodeURIComponent(adminClassMembersMatch[1]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    const members = store.classMembers.filter((item) => item.classId === classId).map((item) => {
      const user = store.users.find((userItem) => userItem.userId === item.userId) || null;
      return {
        memberId: item.id,
        classRole: item.classRole,
        joinedAt: item.joinedAt,
        studentId: user?.studentId || "",
        studentNo: user?.studentNo || "",
        name: user?.name || user?.nickname || item.userId,
        classLabel: user?.classLabel || classItem.name,
        userId: item.userId,
      };
    });
    const scheduleIds = store.schedules.filter((item) => item.classId === classId).map((item) => item.id);
    const subscribers = store.scheduleSubscriptions
      .filter((item) => scheduleIds.includes(item.sourceScheduleId))
      .map((item) => store.users.find((userItem) => userItem.userId === item.subscriberUserId) || null)
      .filter((item): item is UserRecord => Boolean(item))
      .map((item) => ({ userId: item.userId, studentId: item.studentId || "", studentNo: item.studentNo, name: item.name || item.nickname, classLabel: item.classLabel || "" }));
    return ok({
      item: {
        classId: classItem.id,
        classLabel: classItem.name,
        currentCode: classItem.activeJoinCode,
        active: classItem.status === "active",
        memberCount: members.length,
        subscriberCount: subscribers.length,
        members,
      },
      subscribers,
    });
  }

  return null;
};
