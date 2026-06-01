import type { ScheduleSubscription } from "@touchx/shared";
import { storeHelpers, type NexusStore, type UserRecord } from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

export const isGhostUserRecord = (user: UserRecord, scheduleSubscriptions: ScheduleSubscription[]) => {
  if (user.adminRole !== "none") {
    return false;
  }
  if (Array.isArray(user.classIds) && user.classIds.length > 0) {
    return false;
  }
  if (scheduleSubscriptions.some((item) => item.subscriberUserId === user.userId)) {
    return false;
  }
  if (asString(user.classLabel)) {
    return false;
  }
  const studentNo = asString(user.studentNo);
  const name = asString(user.name);
  const nickname = asString(user.nickname);
  const isNamePlaceholder = !name || name === studentNo;
  const isNicknamePlaceholder = !nickname || nickname === studentNo || nickname === name;
  return isNamePlaceholder && isNicknamePlaceholder;
};

const isPlaceholderIdentityText = (user: UserRecord, value: unknown) => {
  const normalized = asString(value);
  if (!normalized) {
    return false;
  }
  if (normalized === asString(user.studentNo) || normalized === asString(user.studentId)) {
    return true;
  }
  return /^\d{6,32}$/.test(normalized);
};

const resolveMeaningfulUserName = (user: UserRecord) => {
  const name = asString(user.name);
  if (name && !isPlaceholderIdentityText(user, name)) {
    return name;
  }
  const nickname = asString(user.nickname);
  if (nickname && !isPlaceholderIdentityText(user, nickname)) {
    return nickname;
  }
  return "";
};

export const toAdminUserPayload = (store: NexusStore, user: UserRecord) => {
  return {
    userId: user.userId,
    accountName: user.accountName || "",
    studentNo: user.studentNo,
    studentId: user.studentId || "",
    name: resolveMeaningfulUserName(user),
    nickname: user.nickname,
    classLabel: user.classLabel || "",
    classIds: user.classIds,
    avatarUrl: user.avatarUrl,
    wallpaperUrl: user.wallpaperUrl,
    adminRole: user.adminRole,
    reminderEnabled: user.reminderEnabled,
    reminderWindowMinutes: user.reminderWindowMinutes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    classCount: user.classIds.length,
    subscriptionCount: store.scheduleSubscriptions.filter((sub) => sub.subscriberUserId === user.userId).length,
  };
};

export const listAdminUsers = (
  store: NexusStore,
  options: {
    limit: number;
    offset: number;
    includeGhost?: boolean;
  },
) => {
  const visibleUsers = options.includeGhost ? [...store.users] : store.users.filter((item) => !isGhostUserRecord(item, store.scheduleSubscriptions));
  const items = visibleUsers.slice(options.offset, options.offset + options.limit).map((item) => toAdminUserPayload(store, item));
  return {
    items,
    total: visibleUsers.length,
    limit: options.limit,
    offset: options.offset,
  };
};

export const updateAdminUser = (
  store: NexusStore,
  userId: string,
  input: {
    name?: unknown;
    nickname?: unknown;
    classLabel?: unknown;
    studentId?: unknown;
    adminRole?: unknown;
    reminderEnabled?: unknown;
    reminderWindowMinutes?: number[] | string;
  },
) => {
  const target = store.users.find((item) => item.userId === userId) || null;
  if (!target) {
    return null;
  }
  const name = asString(input.name);
  const nickname = asString(input.nickname);
  const classLabel = asString(input.classLabel);
  const studentId = asString(input.studentId);
  if (name) target.name = name;
  if (nickname) target.nickname = nickname;
  if (classLabel) target.classLabel = classLabel;
  if (studentId) target.studentId = studentId;
  if (input.adminRole === "none" || input.adminRole === "operator" || input.adminRole === "super_admin") {
    target.adminRole = input.adminRole;
  }
  if (typeof input.reminderEnabled === "boolean") {
    target.reminderEnabled = input.reminderEnabled;
  }
  if (Array.isArray(input.reminderWindowMinutes)) {
    const minutes = input.reminderWindowMinutes
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => Math.round(item));
    target.reminderWindowMinutes = Array.from(new Set(minutes)).sort((left, right) => left - right);
  } else if (typeof input.reminderWindowMinutes === "string") {
    const minutes = input.reminderWindowMinutes
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => Math.round(item));
    if (minutes.length > 0) {
      target.reminderWindowMinutes = Array.from(new Set(minutes)).sort((left, right) => left - right);
    }
  }
  target.updatedAt = storeHelpers.nowIso();
  return toAdminUserPayload(store, target);
};
