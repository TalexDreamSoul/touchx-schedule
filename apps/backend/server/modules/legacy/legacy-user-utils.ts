import { storeHelpers, type NexusStore, type UserRecord } from "../../services/domain-store";
import { randomCodeByStudentNo, type LegacyCompatState } from "./legacy-state";

const asString = (value: unknown) => String(value || "").trim();

export interface LegacyClawDBotUserIdentity {
  studentNo?: string;
  studentId?: string;
  userId?: string;
  openId?: string;
  unionId?: string;
  externalUserId?: string;
}

export const isAdminRole = (user: UserRecord) => {
  return user.adminRole === "super_admin" || user.adminRole === "operator";
};

export const resolveBoundTargetUser = (
  store: NexusStore,
  state: LegacyCompatState,
  accountUser: UserRecord,
) => {
  const targetUserId = state.bindingTargetUserIdByUserId.get(accountUser.userId) || "";
  if (!targetUserId) {
    return null;
  }
  return store.users.find((item) => item.userId === targetUserId) || null;
};

export const resolveSocialActorUser = (store: NexusStore, state: LegacyCompatState, accountUser: UserRecord) => {
  return resolveBoundTargetUser(store, state, accountUser) || accountUser;
};

export const resolveNotificationRecipientUserIds = (
  store: NexusStore,
  state: LegacyCompatState,
  accountUser: UserRecord,
) => {
  const actor = resolveSocialActorUser(store, state, accountUser);
  return Array.from(new Set([accountUser.userId, actor.userId].filter((item) => item)));
};

export const findUserByStudentId = (store: NexusStore, studentId: string) => {
  const normalized = asString(studentId);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.studentId === normalized) || null;
};

export const findUserByStudentNo = (store: NexusStore, studentNo: string) => {
  const normalized = asString(studentNo);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.studentNo === normalized) || null;
};

export const findUserByUserId = (store: NexusStore, userId: string) => {
  const normalized = asString(userId);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.userId === normalized) || null;
};

export const findClawDBotUser = (store: NexusStore, input: LegacyClawDBotUserIdentity) => {
  const userId = asString(input.userId);
  if (userId) {
    const user = store.users.find((item) => item.userId === userId) || null;
    if (user) return user;
  }
  const studentNo = asString(input.studentNo);
  if (studentNo) {
    const user = findUserByStudentNo(store, studentNo);
    if (user) return user;
  }
  const studentId = asString(input.studentId);
  if (studentId) {
    const user = findUserByStudentId(store, studentId);
    if (user) return user;
  }
  const externalValues = [input.openId, input.unionId, input.externalUserId]
    .map((item) => asString(item))
    .filter((item) => item);
  if (externalValues.length > 0) {
    const binding =
      store.userNotificationBindings.find(
        (item) =>
          item.channelType === "wechat_clawdbot" &&
          item.status === "active" &&
          externalValues.some(
            (value) => item.externalUserId === value || item.externalOpenId === value || item.externalUnionId === value,
          ),
      ) || null;
    if (binding) {
      return store.users.find((item) => item.userId === binding.userId) || null;
    }
  }
  return null;
};

const isPlaceholderIdentityText = (user: Pick<UserRecord, "studentNo" | "studentId">, value: unknown) => {
  const normalized = asString(value);
  if (!normalized) {
    return false;
  }
  if (normalized === asString(user.studentNo) || normalized === asString(user.studentId)) {
    return true;
  }
  return /^\d{6,32}$/.test(normalized);
};

export const resolveMeaningfulUserName = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
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

export const resolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  return resolveMeaningfulUserName(user) || asString(user.studentNo) || asString(user.studentId) || "未命名用户";
};

export const toLegacyAuthUser = (
  accountUser: UserRecord,
  boundTarget: UserRecord | null,
  state: LegacyCompatState,
) => {
  const source = boundTarget || accountUser;
  return {
    openId: `wx_${accountUser.userId}`,
    studentId: source.studentId || "",
    studentNo: source.studentNo || "",
    studentName: resolveMeaningfulUserName(source),
    classLabel: source.classLabel || "",
    nickname: resolveMeaningfulUserName(accountUser) || resolveUserDisplayLabel(accountUser),
    avatarUrl: accountUser.avatarUrl || source.avatarUrl || "",
    randomCode: state.randomCodeByUserId.get(source.userId) || "",
  };
};

export const createClawDBotUser = (
  store: NexusStore,
  state: LegacyCompatState,
  studentNo: string,
  nickname = "",
) => {
  const now = storeHelpers.nowIso();
  const user: UserRecord = {
    userId: storeHelpers.createId("user"),
    studentNo,
    studentId: "",
    name: "",
    classLabel: "",
    nickname: nickname || `ClawDBot ${studentNo}`,
    avatarUrl: "",
    wallpaperUrl: "",
    classIds: [],
    adminRole: "none",
    reminderEnabled: true,
    reminderWindowMinutes: [30, 15],
    createdAt: now,
    updatedAt: now,
  };
  store.users.push(user);
  state.randomCodeByUserId.set(user.userId, randomCodeByStudentNo(user.studentNo));
  state.bindingTargetUserIdByUserId.set(user.userId, user.userId);
  return user;
};
