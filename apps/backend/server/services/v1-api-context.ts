import {
  getNexusStore,
  storeHelpers,
  type AuditLogRecord,
  type UserRecord,
} from "./domain-store";

const asString = (value: unknown) => String(value || "").trim();

export const normalizeReminderOffsets = (value: unknown, fallback: number[] = [30, 15]) => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const items = value
    .map((item) => Math.trunc(Number(item)))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 14 * 24 * 60);
  return Array.from(new Set(items)).slice(0, 8);
};

export const appendV1Audit = (action: string, actorUserId: string, payload: Record<string, unknown>) => {
  const store = getNexusStore();
  const record: AuditLogRecord = {
    id: storeHelpers.createId("audit"),
    action,
    actorUserId,
    payload,
    createdAt: storeHelpers.nowIso(),
  };
  store.auditLogs.unshift(record);
  if (store.auditLogs.length > 2000) {
    store.auditLogs.length = 2000;
  }
};

export const toV1UserPayload = (user: UserRecord) => {
  const isPlaceholderIdentityText = (value: unknown) => {
    const normalized = asString(value);
    if (!normalized) {
      return false;
    }
    if (normalized === asString(user.studentNo) || normalized === asString(user.studentId)) {
      return true;
    }
    return /^\d{6,32}$/.test(normalized);
  };
  const resolveMeaningfulUserName = () => {
    const name = asString(user.name);
    if (name && !isPlaceholderIdentityText(name)) {
      return name;
    }
    const nickname = asString(user.nickname);
    if (nickname && !isPlaceholderIdentityText(nickname)) {
      return nickname;
    }
    return "";
  };
  return {
    userId: user.userId,
    accountName: user.accountName || "",
    studentNo: user.studentNo,
    studentId: user.studentId || "",
    name: resolveMeaningfulUserName(),
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
  };
};
