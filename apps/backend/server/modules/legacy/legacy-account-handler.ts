import type { H3Event } from "h3";
import {
  storeHelpers,
  type NexusStore,
  type ScheduleEntryRecord,
  type UserRecord,
} from "../../services/domain-store";
import {
  getEffectiveScheduleEntriesForUser,
  getUserReminderTimezone,
  isScheduleEntryInWeek,
  SCHEDULE_SECTION_TIMES,
  SCHEDULE_TERM_HOLIDAYS,
  SCHEDULE_TERM_MAKEUP_DAYS,
  SCHEDULE_TERM_META,
  SCHEDULE_WEEKDAY_LABELS,
} from "../../services/schedule-calendar";
import type { SocialVisibilityScope } from "../../services/social-collaboration-core";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { token: string; session?: { expiresAt: number }; user: UserRecord };
type CreateSession = (event: H3Event, user: UserRecord, role: "admin" | "user", ttlHours?: number) => { token: string; expiresAt: number };
type RegisterSession = (store: NexusStore, session: { token: string; expiresAt: number; role?: "admin" | "user" }, user: UserRecord) => void;
type RevokeSession = (store: NexusStore, token: string) => void;
type ResolveBoundTargetUser = (store: NexusStore, accountUser: UserRecord) => UserRecord | null;
type FindUserByStudentId = (store: NexusStore, studentId: string) => UserRecord | null;
type FindUserByStudentNo = (store: NexusStore, studentNo: string) => UserRecord | null;
type IsAdminRole = (user: UserRecord) => boolean;
type ResolveViewerVisibilityScope = (store: NexusStore, viewer: UserRecord, target: UserRecord) => SocialVisibilityScope;
type PersistUserMediaUpload = (
  event: H3Event,
  store: NexusStore,
  user: UserRecord,
  usage: "avatar" | "wallpaper",
  maxBytes: number,
) => Promise<string>;

export interface LegacyAccountState {
  randomCodeByUserId: Map<string, string>;
  notifyBoundUserIds: Set<string>;
  practiceCourseKeysByUserId: Map<string, Set<string>>;
  subscriptionTargetsByUserId: Map<string, Set<string>>;
  bindingTargetUserIdByUserId: Map<string, string>;
}

export interface LegacyAccountHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  state: LegacyAccountState;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  createSession: CreateSession;
  registerSession: RegisterSession;
  revokeSession: RevokeSession;
  resolveBoundTargetUser: ResolveBoundTargetUser;
  findUserByStudentId: FindUserByStudentId;
  findUserByStudentNo: FindUserByStudentNo;
  isAdminRole: IsAdminRole;
  resolveViewerVisibilityScope: ResolveViewerVisibilityScope;
  persistUserMediaUpload: PersistUserMediaUpload;
  avatarMaxBytes: number;
  wallpaperMaxBytes: number;
}

const asString = (value: unknown) => String(value || "").trim();

const normalizeProfileAvatarUrl = (value: unknown) => {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  if (!/^https?:\/\//i.test(raw)) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const hostname = parsed.hostname.toLowerCase();
    const isWechatAvatarHost = hostname === "thirdwx.qlogo.cn" || hostname === "wx.qlogo.cn" || hostname.endsWith(".qlogo.cn");
    if (parsed.protocol === "http:" && isWechatAvatarHost) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch (error) {
    return "";
  }
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

const resolveMeaningfulUserName = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
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

const resolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  return resolveMeaningfulUserName(user) || asString(user.studentNo) || asString(user.studentId) || "未命名用户";
};

const randomCodeByStudentNo = (studentNo: string) => {
  const digits = studentNo.replace(/\D+/g, "");
  if (digits.length > 0) {
    return digits.slice(-4).padStart(4, "0").slice(0, 4);
  }
  return `${Math.floor(Math.random() * 9000 + 1000)}`;
};

const ensureSet = <K, V>(map: Map<K, Set<V>>, key: K) => {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created = new Set<V>();
  map.set(key, created);
  return created;
};

const toLegacyAuthUser = (
  accountUser: UserRecord,
  boundTarget: UserRecord | null,
  state: LegacyAccountState,
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

const toLegacySocialUser = (
  user: UserRecord,
  state: LegacyAccountState,
  options?: { accountUser?: UserRecord; randomCodeOwnerUserId?: string },
) => {
  const accountUser = options?.accountUser || user;
  const randomCodeOwnerUserId = options?.randomCodeOwnerUserId || user.userId;
  const practiceCourseKeys = Array.from(state.practiceCourseKeysByUserId.get(accountUser.userId) || []);
  return {
    studentId: user.studentId || "",
    studentNo: user.studentNo || "",
    name: resolveUserDisplayLabel(user),
    classLabel: user.classLabel || "",
    avatarUrl: accountUser.avatarUrl || user.avatarUrl || "",
    wallpaperUrl: accountUser.wallpaperUrl || user.wallpaperUrl || "",
    randomCode: state.randomCodeByUserId.get(randomCodeOwnerUserId) || "",
    isAdmin: accountUser.adminRole === "super_admin" || accountUser.adminRole === "operator",
    notifyBound: state.notifyBoundUserIds.has(accountUser.userId),
    practiceCourseKeys,
  };
};

const resolvePublishedEntriesByUser = (store: NexusStore, user: UserRecord) => {
  const versionEntries = getEffectiveScheduleEntriesForUser(store, user);
  const dedup = new Map<string, ScheduleEntryRecord>();
  versionEntries.forEach((entry) => {
    const key = `${entry.day}_${entry.startSection}_${entry.endSection}_${entry.courseName}_${entry.weekExpr}_${entry.parity}`;
    if (dedup.has(key)) {
      return;
    }
    dedup.set(key, {
      ...entry,
      id: entry.id || storeHelpers.createId("entry"),
    });
  });
  return Array.from(dedup.values()).sort((left, right) => {
    if (left.day !== right.day) {
      return left.day - right.day;
    }
    return left.startSection - right.startSection;
  });
};

const toLegacyScheduleStudentPayload = (
  store: NexusStore,
  targetUser: UserRecord,
  accountUser: UserRecord,
) => {
  const entries = resolvePublishedEntriesByUser(store, targetUser);
  return {
    id: targetUser.studentId || targetUser.userId,
    name: resolveUserDisplayLabel(targetUser),
    studentNo: targetUser.studentNo,
    classLabel: targetUser.classLabel,
    courses: entries.map((entry) => ({
      id: entry.id,
      name: entry.courseName,
      day: entry.day,
      startSection: entry.startSection,
      endSection: entry.endSection,
      weekExpr: entry.weekExpr,
      parity: entry.parity,
      classroom: entry.classroom || null,
      teacher: entry.teacher || null,
      teachingClasses: targetUser.classLabel || null,
      practiceCourseKey: `${targetUser.studentId || targetUser.userId}:${entry.day}:${entry.startSection}:${entry.endSection}:${entry.courseName}`,
    })),
    avatarUrl: accountUser.avatarUrl,
    wallpaperUrl: accountUser.wallpaperUrl,
  };
};

const maskScheduleStudentPayloadByVisibility = <T extends { courses?: Array<Record<string, unknown>> }>(
  payload: T,
  visibilityScope: SocialVisibilityScope,
) => {
  if (visibilityScope === "detail") {
    return payload;
  }
  return {
    ...payload,
    courses: (payload.courses || []).map((course) => ({
      ...course,
      name: "忙碌",
      classroom: null,
      teacher: null,
      teachingClasses: null,
      practiceCourseKey: null,
    })),
  };
};

const ensureTargetRandomCode = (
  state: LegacyAccountState,
  targetUserId: string,
  providedCode: string,
  toApiError: ApiError,
) => {
  const expectedCode = state.randomCodeByUserId.get(targetUserId) || "";
  if (!expectedCode) {
    return;
  }
  if (!providedCode || providedCode !== expectedCode) {
    return toApiError(400, "RANDOM_CODE_REQUIRED", "订阅或绑定他人课表需要验证码");
  }
};

const removeScheduleSubscriptionsByTarget = (
  store: NexusStore,
  subscriberUserId: string,
  targetUser: UserRecord,
) => {
  const targetClassIds = new Set(targetUser.classIds);
  const targetScheduleIds = store.schedules.filter((item) => targetClassIds.has(item.classId)).map((item) => item.id);
  if (targetScheduleIds.length === 0) {
    return;
  }
  store.scheduleSubscriptions = store.scheduleSubscriptions.filter((item) => {
    if (item.subscriberUserId !== subscriberUserId) {
      return true;
    }
    return !targetScheduleIds.includes(item.sourceScheduleId);
  });
};

export const isLegacyAccountPath = (path: string) => {
  return (
    path === "auth/wechat-login" ||
    path === "auth/me" ||
    path === "auth/logout" ||
    path === "auth/unbind" ||
    path === "social/profile" ||
    path === "social/bind-student" ||
    path === "social/random-code" ||
    path === "social/notify/unbind" ||
    path === "social/practice-course" ||
    path === "social/upload/avatar" ||
    path === "social/upload/wallpaper" ||
    path === "schedules/student"
  );
};

export const handleLegacyAccountApi = async (context: LegacyAccountHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    state,
    toApiError,
    readJsonBody,
    requireLegacyAuth,
    createSession,
    registerSession,
    revokeSession,
    resolveBoundTargetUser,
    findUserByStudentId,
    findUserByStudentNo,
    isAdminRole,
    resolveViewerVisibilityScope,
    persistUserMediaUpload,
    avatarMaxBytes,
    wallpaperMaxBytes,
  } = context;

  if (path === "auth/wechat-login" && method !== "POST") {
    return toApiError(405, "AUTH_WECHAT_LOGIN_METHOD_NOT_ALLOWED", "auth/wechat-login 仅支持 POST");
  }

  if (method === "POST" && path === "auth/wechat-login") {
    const body = await readJsonBody<{
      code?: string;
      studentId?: string;
      student_id?: string;
      studentNo?: string;
      student_no?: string;
      nickname?: string;
      avatarUrl?: string;
      avatar_url?: string;
      clientPlatform?: string;
      client_platform?: string;
      mode?: "wechat" | "mock";
    }>(event);
    const code = asString(body.code);
    const studentId = asString(body.studentId || body.student_id);
    const studentNo = asString(body.studentNo || body.student_no);
    const nickname = asString(body.nickname);
    const avatarUrl = normalizeProfileAvatarUrl(body.avatarUrl || body.avatar_url);
    if (!code) {
      return toApiError(400, "WECHAT_CODE_REQUIRED", "请先完成微信授权");
    }
    if (!studentNo) {
      return toApiError(400, "STUDENT_NO_REQUIRED", "请先填写学号");
    }
    if (!/^\d{6,32}$/.test(studentNo)) {
      return toApiError(400, "STUDENT_NO_INVALID", "学号格式不正确，请检查后重试");
    }

    let accountUser =
      findUserByStudentNo(store, studentNo) ||
      findUserByStudentId(store, studentId) ||
      null;
    if (!accountUser) {
      accountUser = {
        userId: storeHelpers.createId("user"),
        studentNo: studentNo || `${Date.now()}`.slice(-8),
        studentId: "",
        name: "",
        classLabel: "",
        nickname: nickname || "",
        avatarUrl: avatarUrl || "",
        wallpaperUrl: "",
        classIds: [],
        adminRole: "none",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      };
      store.users.push(accountUser);
      state.randomCodeByUserId.set(accountUser.userId, randomCodeByStudentNo(accountUser.studentNo));
      state.notifyBoundUserIds.delete(accountUser.userId);
      state.practiceCourseKeysByUserId.set(accountUser.userId, new Set<string>());
      state.subscriptionTargetsByUserId.set(accountUser.userId, new Set<string>());
      state.bindingTargetUserIdByUserId.set(accountUser.userId, accountUser.userId);
    }

    if (nickname) {
      accountUser.nickname = nickname;
    }
    if (avatarUrl) {
      accountUser.avatarUrl = avatarUrl;
    }
    accountUser.updatedAt = storeHelpers.nowIso();

    const bindTarget = findUserByStudentId(store, studentId) || findUserByStudentNo(store, studentNo) || accountUser;
    if (avatarUrl && bindTarget.userId !== accountUser.userId) {
      bindTarget.avatarUrl = avatarUrl;
      bindTarget.updatedAt = storeHelpers.nowIso();
    }
    state.bindingTargetUserIdByUserId.set(accountUser.userId, bindTarget.userId);
    if (bindTarget.studentId) {
      state.notifyBoundUserIds.add(accountUser.userId);
    }
    const session = createSession(event, accountUser, "user", 24 * 14);
    registerSession(store, { ...session, role: "user" }, accountUser);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      mode: "mock",
      user: toLegacyAuthUser(accountUser, bindTarget, state),
    };
  }

  if (method === "GET" && path === "auth/me") {
    const { session, user } = requireLegacyAuth(event);
    const bindTarget = resolveBoundTargetUser(store, user) || user;
    return {
      ok: true,
      mode: "mock",
      expiresAt: session?.expiresAt,
      user: toLegacyAuthUser(user, bindTarget, state),
    };
  }

  if (method === "POST" && path === "auth/logout") {
    const { token } = requireLegacyAuth(event);
    revokeSession(store, token);
    return { ok: true };
  }

  if (method === "POST" && path === "auth/unbind") {
    const { token, user } = requireLegacyAuth(event);
    state.bindingTargetUserIdByUserId.set(user.userId, user.userId);
    state.notifyBoundUserIds.delete(user.userId);
    revokeSession(store, token);
    return { ok: true, unbound: true };
  }

  if (method === "POST" && path === "social/profile") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{
      studentNo?: string;
      student_no?: string;
      nickname?: string;
      name?: string;
      classLabel?: string;
      class_label?: string;
      wallpaperUrl?: string;
      wallpaper_url?: string;
      avatarUrl?: string;
      avatar_url?: string;
    }>(event);
    const hasStudentNoField =
      Object.prototype.hasOwnProperty.call(body, "studentNo") || Object.prototype.hasOwnProperty.call(body, "student_no");
    const studentNo = asString(body.studentNo || body.student_no);
    if (hasStudentNoField) {
      if (!studentNo) {
        return toApiError(400, "STUDENT_NO_REQUIRED", "学号不能为空");
      }
      if (!/^\d{6,32}$/.test(studentNo)) {
        return toApiError(400, "STUDENT_NO_INVALID", "学号格式不正确，请检查后重试");
      }
      const duplicated = store.users.find((item) => item.studentNo === studentNo && item.userId !== user.userId) || null;
      if (duplicated) {
        return toApiError(409, "STUDENT_NO_CONFLICT", "学号已被其他账号占用");
      }
      user.studentNo = studentNo;
      state.randomCodeByUserId.set(user.userId, randomCodeByStudentNo(studentNo));
    }
    const nickname = asString(body.nickname);
    const name = asString(body.name);
    const classLabel = asString(body.classLabel || body.class_label);
    if (nickname) {
      user.nickname = nickname;
    }
    if (name) {
      user.name = name;
    }
    if (classLabel) {
      user.classLabel = classLabel;
    }
    if (Object.prototype.hasOwnProperty.call(body, "wallpaperUrl") || Object.prototype.hasOwnProperty.call(body, "wallpaper_url")) {
      user.wallpaperUrl = asString(body.wallpaperUrl ?? body.wallpaper_url);
    }
    if (Object.prototype.hasOwnProperty.call(body, "avatarUrl") || Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
      const nextAvatarUrl = normalizeProfileAvatarUrl(body.avatarUrl ?? body.avatar_url);
      user.avatarUrl = nextAvatarUrl;
      const boundTarget = resolveBoundTargetUser(store, user) || user;
      if (nextAvatarUrl && boundTarget.userId !== user.userId) {
        boundTarget.avatarUrl = nextAvatarUrl;
        boundTarget.updatedAt = storeHelpers.nowIso();
      }
    }
    user.updatedAt = storeHelpers.nowIso();
    const bindTarget = resolveBoundTargetUser(store, user) || user;
    return {
      ok: true,
      me: toLegacySocialUser(bindTarget, state, {
        accountUser: user,
        randomCodeOwnerUserId: bindTarget.userId,
      }),
    };
  }

  if (method === "POST" && path === "social/bind-student") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string; targetRandomCode?: string; target_random_code?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      return toApiError(400, "BIND_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = findUserByStudentId(store, targetStudentId);
    if (!targetUser) {
      return toApiError(404, "BIND_TARGET_NOT_FOUND", "目标课表不存在");
    }
    if (!isAdminRole(user) && targetUser.userId !== user.userId) {
      ensureTargetRandomCode(state, targetUser.userId, asString(body.targetRandomCode || body.target_random_code), toApiError);
    }
    state.bindingTargetUserIdByUserId.set(user.userId, targetUser.userId);
    state.notifyBoundUserIds.add(user.userId);
    return {
      ok: true,
      me: toLegacySocialUser(targetUser, state, {
        accountUser: user,
        randomCodeOwnerUserId: targetUser.userId,
      }),
    };
  }

  if (method === "POST" && path === "social/random-code") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{ randomCode?: string; random_code?: string }>(event);
    const nextCode = asString(body.randomCode || body.random_code).replace(/\D+/g, "").slice(0, 4);
    if (nextCode.length !== 4) {
      return toApiError(400, "RANDOM_CODE_INVALID", "验证码必须是 4 位数字");
    }
    const bindTarget = resolveBoundTargetUser(store, user) || user;
    state.randomCodeByUserId.set(bindTarget.userId, nextCode);
    let removed = 0;
    state.subscriptionTargetsByUserId.forEach((targets, subscriberUserId) => {
      if (!targets.has(bindTarget.userId)) {
        return;
      }
      const subscriber = store.users.find((item) => item.userId === subscriberUserId) || null;
      if (!subscriber || isAdminRole(subscriber)) {
        return;
      }
      targets.delete(bindTarget.userId);
      removeScheduleSubscriptionsByTarget(store, subscriber.userId, bindTarget);
      removed += 1;
    });
    return { ok: true, removedSubscriberCount: removed };
  }

  if (method === "POST" && path === "social/notify/unbind") {
    const { user } = requireLegacyAuth(event);
    state.notifyBoundUserIds.delete(user.userId);
    return { ok: true, notifyBound: false };
  }

  if (method === "POST" && path === "social/practice-course") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{ courseKey?: string; course_key?: string; enabled?: boolean }>(event);
    const courseKey = asString(body.courseKey || body.course_key);
    if (!courseKey) {
      return toApiError(400, "COURSE_KEY_REQUIRED", "courseKey 不能为空");
    }
    const enabled = body.enabled !== false;
    const set = ensureSet(state.practiceCourseKeysByUserId, user.userId);
    if (enabled) {
      set.add(courseKey);
    } else {
      set.delete(courseKey);
    }
    return {
      ok: true,
      courseKey,
      enabled,
      practiceCourseKeys: Array.from(set.values()),
    };
  }

  if (method === "POST" && path === "social/upload/avatar") {
    const { user } = requireLegacyAuth(event);
    user.avatarUrl = await persistUserMediaUpload(event, store, user, "avatar", avatarMaxBytes);
    user.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      avatarUrl: user.avatarUrl,
      me: {
        avatarUrl: user.avatarUrl,
      },
    };
  }

  if (method === "POST" && path === "social/upload/wallpaper") {
    const { user } = requireLegacyAuth(event);
    user.wallpaperUrl = await persistUserMediaUpload(event, store, user, "wallpaper", wallpaperMaxBytes);
    user.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      wallpaperUrl: user.wallpaperUrl,
      me: {
        wallpaperUrl: user.wallpaperUrl,
      },
    };
  }

  if (method === "GET" && path === "schedules/student") {
    const { user } = requireLegacyAuth(event);
    const hasRequestedStudentId =
      Object.prototype.hasOwnProperty.call(query, "studentId") ||
      Object.prototype.hasOwnProperty.call(query, "student_id");
    const requestedStudentId = asString(query.studentId || query.student_id);
    const bindTarget = resolveBoundTargetUser(store, user) || user;
    if (hasRequestedStudentId && !requestedStudentId) {
      return toApiError(400, "SCHEDULE_TARGET_REQUIRED", "studentId 不能为空");
    }
    const resolvedTargetUser = hasRequestedStudentId
      ? findUserByStudentId(store, requestedStudentId)
      : bindTarget;
    if (!resolvedTargetUser) {
      return toApiError(404, "SCHEDULE_TARGET_NOT_FOUND", "目标课表不存在");
    }
    const targetUser = resolvedTargetUser;
    if (!(targetUser.studentId || targetUser.userId)) {
      return toApiError(404, "SCHEDULE_TARGET_NOT_FOUND", "目标课表不存在");
    }
    const visibilityScope = hasRequestedStudentId ? resolveViewerVisibilityScope(store, user, targetUser) : "detail";
    if (visibilityScope === "hidden" || visibilityScope === "blocked") {
      return toApiError(403, "SCHEDULE_VISIBILITY_FORBIDDEN", "对方尚未授权你查看日程");
    }
    const serverNow = new Date();
    const serverTimezone = getUserReminderTimezone(store, targetUser);
    const studentPayload = maskScheduleStudentPayloadByVisibility(
      toLegacyScheduleStudentPayload(store, targetUser, user),
      visibilityScope,
    );
    return {
      ok: true,
      term: SCHEDULE_TERM_META,
      termMeta: SCHEDULE_TERM_META,
      sectionTimes: SCHEDULE_SECTION_TIMES,
      weekdayLabels: SCHEDULE_WEEKDAY_LABELS,
      holidays: SCHEDULE_TERM_HOLIDAYS,
      makeupDays: SCHEDULE_TERM_MAKEUP_DAYS,
      visibilityScope,
      student: studentPayload,
      serverNowIso: serverNow.toISOString(),
      serverTimezone,
      generatedAt: Date.now(),
    };
  }

  return null;
};
