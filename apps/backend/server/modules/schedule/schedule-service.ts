import type { ClassRole, SchedulePatch, ScheduleSubscription } from "@touchx/shared";
import { isAdminRole } from "../auth/auth-service";
import { storeHelpers, type ClassMemberRecord, type NexusStore, type ScheduleEntryRecord, type ScheduleRecord, type UserRecord } from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

export const ensureUniquePush = <T>(array: T[], value: T) => {
  if (!array.includes(value)) {
    array.push(value);
  }
};

export const isPublishedScheduleVisibleToUser = (store: NexusStore, schedule: ScheduleRecord, viewer?: UserRecord | null) => {
  if (schedule.publishedVersionNo <= 0) {
    return false;
  }
  const visibility = schedule.visibility || (schedule.classId === `user:${schedule.createdByUserId}` ? "private" : "class_only");
  if (visibility === "public") {
    return true;
  }
  if (!viewer) {
    return false;
  }
  if (schedule.createdByUserId === viewer.userId || isAdminRole(viewer)) {
    return true;
  }
  if (visibility === "private") {
    return false;
  }
  if (visibility === "class_only") {
    return store.classMembers.some((item) => item.classId === schedule.classId && item.userId === viewer.userId);
  }
  return true;
};

export const getClassMemberRole = (store: NexusStore, userId: string, classId: string) => {
  return store.classMembers.find((item) => item.classId === classId && item.userId === userId)?.classRole || null;
};

export const requireClassAccess = (store: NexusStore, user: UserRecord, classId: string, roles: ClassRole[]) => {
  const classItem = store.classes.find((item) => item.id === classId) || null;
  if (isAdminRole(user)) {
    return { ok: true as const, classItem, member: null as ClassMemberRecord | null };
  }
  const member = store.classMembers.find((item) => item.classId === classId && item.userId === user.userId) || null;
  if (!member) {
    return { ok: false as const, statusCode: 403, code: "CLASS_FORBIDDEN", message: "当前用户不在该班级中" };
  }
  if (!roles.includes(member.classRole)) {
    return { ok: false as const, statusCode: 403, code: "CLASS_PERMISSION_DENIED", message: "当前用户无该班级操作权限" };
  }
  if (!classItem) {
    return { ok: false as const, statusCode: 404, code: "CLASS_NOT_FOUND", message: "班级不存在" };
  }
  return { ok: true as const, classItem, member };
};

export const normalizeScheduleEntries = (raw: unknown): ScheduleEntryRecord[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: ScheduleEntryRecord[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const data = item as Partial<ScheduleEntryRecord>;
    const day = Number(data.day || 0);
    const startSection = Number(data.startSection || 0);
    const endSection = Number(data.endSection || 0);
    const courseName = asString(data.courseName);
    if (!day || !startSection || !endSection || !courseName) {
      return;
    }
    items.push({
      id: storeHelpers.createId("entry"),
      day,
      startSection,
      endSection,
      weekExpr: asString(data.weekExpr) || "1-20",
      parity: data.parity === "odd" || data.parity === "even" ? data.parity : "all",
      courseName,
      classroom: asString(data.classroom),
      teacher: asString(data.teacher),
    });
  });
  return items;
};

export const getScheduleVersions = (store: NexusStore, scheduleId: string) => {
  return store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId)
    .sort((left, right) => left.versionNo - right.versionNo);
};

export const getLatestScheduleVersion = (store: NexusStore, scheduleId: string) => {
  const versions = getScheduleVersions(store, scheduleId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
};

export const getPublishedScheduleVersion = (store: NexusStore, scheduleId: string, versionNo = 0) => {
  if (versionNo > 0) {
    return store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo && item.status === "published") || null;
  }
  const versions = store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId && item.status === "published")
    .sort((left, right) => right.versionNo - left.versionNo);
  return versions[0] || null;
};

export const summarizeClassSubscriptionsForUser = (store: NexusStore, user: UserRecord) => {
  const memberships = store.classMembers
    .filter((item) => item.userId === user.userId)
    .map((item) => {
      const classItem = store.classes.find((classRow) => classRow.id === item.classId) || null;
      return {
        classId: item.classId,
        classLabel: classItem?.name || "",
        role: item.classRole,
      };
    });
  const subscriptions = store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .map((item) => {
      const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
      const classItem = schedule ? store.classes.find((classRow) => classRow.id === schedule.classId) || null : null;
      return {
        subscriptionId: item.id,
        followMode: item.followMode,
        baseVersionNo: item.baseVersionNo,
        scheduleId: item.sourceScheduleId,
        scheduleTitle: schedule?.title || "",
        classId: classItem?.id || "",
        classLabel: classItem?.name || "",
        createdByUserId: schedule?.createdByUserId || "",
        patchCount: store.schedulePatches.filter((patch) => patch.subscriptionId === item.id).length,
        pendingConflictCount: store.scheduleConflicts.filter(
          (conflict) => conflict.subscriptionId === item.id && conflict.resolutionStatus === "pending",
        ).length,
      };
    });
  return { memberships, subscriptions };
};

export const findStaleOwnScheduleSubscriptionIds = (store: NexusStore, user: UserRecord) => {
  const activeClassIds = new Set(user.classIds);
  return store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .filter((item) => {
      const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
      if (!schedule) {
        return true;
      }
      if (activeClassIds.has(schedule.classId)) {
        return false;
      }
      return true;
    })
    .map((item) => item.id);
};

export const listUserScheduleSubscriptions = (store: NexusStore, user: UserRecord) => {
  const items = store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .map((item) => {
      const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
      const classItem = schedule ? store.classes.find((classRow) => classRow.id === schedule.classId) || null : null;
      return {
        ...item,
        scheduleTitle: schedule?.title || "",
        classId: classItem?.id || "",
        className: classItem?.name || "",
        patchCount: store.schedulePatches.filter((patch) => patch.subscriptionId === item.id).length,
        pendingConflictCount: store.scheduleConflicts.filter(
          (conflict) => conflict.subscriptionId === item.id && conflict.resolutionStatus === "pending",
        ).length,
      };
    });
  return { items };
};

export const createSchedulePatch = (
  store: NexusStore,
  input: {
    user: UserRecord;
    subscriptionId: string;
    entryId: string;
    opType?: SchedulePatch["opType"];
    patchPayload?: Record<string, unknown>;
  },
) => {
  if (!input.subscriptionId || !input.entryId) {
    return { ok: false as const, reason: "param_invalid" };
  }
  const subscription = store.scheduleSubscriptions.find((item) => item.id === input.subscriptionId) || null;
  if (!subscription || subscription.subscriberUserId !== input.user.userId) {
    return { ok: false as const, reason: "forbidden" };
  }
  const patch: SchedulePatch = {
    id: storeHelpers.createId("schedule_patch"),
    subscriptionId: input.subscriptionId,
    entryId: input.entryId,
    opType: input.opType === "add" || input.opType === "remove" ? input.opType : "update",
    patchPayload: input.patchPayload && typeof input.patchPayload === "object" ? input.patchPayload : {},
    createdAt: storeHelpers.nowIso(),
  };
  store.schedulePatches.push(patch);
  subscription.followMode = "patched";
  return { ok: true as const, patch, subscription };
};

export const listUserScheduleConflicts = (store: NexusStore, user: UserRecord) => {
  const subscriptionIdSet = new Set(store.scheduleSubscriptions.filter((item) => item.subscriberUserId === user.userId).map((item) => item.id));
  const items = store.scheduleConflicts
    .filter((item) => subscriptionIdSet.has(item.subscriptionId))
    .map((item) => {
      const subscription = store.scheduleSubscriptions.find((sub) => sub.id === item.subscriptionId) || null;
      const schedule = subscription ? store.schedules.find((scheduleItem) => scheduleItem.id === subscription.sourceScheduleId) || null : null;
      return {
        ...item,
        scheduleId: subscription?.sourceScheduleId || "",
        scheduleTitle: schedule?.title || "",
      };
    });
  return { items };
};

export const listUserSchedulePatches = (store: NexusStore, user: UserRecord) => {
  const subscriptionMap = new Map(
    store.scheduleSubscriptions.filter((item) => item.subscriberUserId === user.userId).map((item) => [item.id, item] as const),
  );
  const items = store.schedulePatches
    .filter((item) => subscriptionMap.has(item.subscriptionId))
    .map((item) => {
      const subscription = subscriptionMap.get(item.subscriptionId) || null;
      const schedule = subscription ? store.schedules.find((scheduleItem) => scheduleItem.id === subscription.sourceScheduleId) || null : null;
      return {
        ...item,
        scheduleId: subscription?.sourceScheduleId || "",
        scheduleTitle: schedule?.title || "",
      };
    });
  return { items };
};

export const resolveScheduleConflict = (store: NexusStore, user: UserRecord, conflictId: string, actionInput?: "keep_patch" | "relink") => {
  const conflict = store.scheduleConflicts.find((item) => item.id === conflictId) || null;
  if (!conflict) {
    return { ok: false as const, reason: "not_found" };
  }
  const subscription = store.scheduleSubscriptions.find((item) => item.id === conflict.subscriptionId) || null;
  if (!subscription || subscription.subscriberUserId !== user.userId) {
    return { ok: false as const, reason: "forbidden" };
  }
  const action = actionInput === "relink" ? "relink" : "keep_patch";
  if (action === "relink") {
    conflict.resolutionStatus = "relinked";
    store.schedulePatches = store.schedulePatches.filter((patch) => !(patch.subscriptionId === subscription.id && patch.entryId === conflict.entryId));
    const pendingPatchCount = store.schedulePatches.filter((patch) => patch.subscriptionId === subscription.id).length;
    if (pendingPatchCount === 0) {
      subscription.followMode = "following";
    }
  } else {
    conflict.resolutionStatus = "kept_patch";
    subscription.followMode = "patched";
  }
  return { ok: true as const, conflict, subscription, action };
};

export const relinkSchedulePatch = (store: NexusStore, user: UserRecord, patchId: string) => {
  const patch = store.schedulePatches.find((item) => item.id === patchId) || null;
  if (!patch) {
    return { ok: false as const, reason: "not_found" };
  }
  const subscription = store.scheduleSubscriptions.find((item) => item.id === patch.subscriptionId) || null;
  if (!subscription || subscription.subscriberUserId !== user.userId) {
    return { ok: false as const, reason: "forbidden" };
  }
  store.schedulePatches = store.schedulePatches.filter((item) => item.id !== patchId);
  store.scheduleConflicts.forEach((conflict) => {
    if (conflict.subscriptionId === subscription.id && conflict.entryId === patch.entryId && conflict.resolutionStatus === "pending") {
      conflict.resolutionStatus = "relinked";
    }
  });
  if (!store.schedulePatches.some((item) => item.subscriptionId === subscription.id)) {
    subscription.followMode = "following";
    const schedule = store.schedules.find((item) => item.id === subscription.sourceScheduleId) || null;
    if (schedule?.publishedVersionNo) {
      subscription.baseVersionNo = schedule.publishedVersionNo;
    }
  }
  return { ok: true as const, subscription };
};

export const createScheduleSubscription = (store: NexusStore, user: UserRecord, scheduleId: string): { ok: true; subscription: ScheduleSubscription; duplicated?: boolean } | { ok: false; reason: "not_found" | "not_published" } => {
  const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
  if (!schedule) {
    return { ok: false, reason: "not_found" };
  }
  const publishedVersion = getPublishedScheduleVersion(store, scheduleId, schedule.publishedVersionNo);
  if (!publishedVersion) {
    return { ok: false, reason: "not_published" };
  }
  const existing = store.scheduleSubscriptions.find((item) => item.subscriberUserId === user.userId && item.sourceScheduleId === scheduleId);
  if (existing) {
    return { ok: true, subscription: existing, duplicated: true };
  }
  const subscription: ScheduleSubscription = {
    id: storeHelpers.createId("schedule_subscription"),
    subscriberUserId: user.userId,
    sourceScheduleId: scheduleId,
    baseVersionNo: publishedVersion.versionNo,
    followMode: "following",
    createdAt: storeHelpers.nowIso(),
  };
  store.scheduleSubscriptions.push(subscription);
  return { ok: true, subscription };
};
