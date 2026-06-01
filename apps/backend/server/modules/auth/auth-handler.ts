import type { H3Event } from "h3";
import type { AuthSessionRecord, NexusStore, UserRecord } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import { createSignedSession } from "../../utils/session-token";
import {
  createPasswordSalt,
  createVirtualStudentNo,
  ensureAccountNameAvailable,
  getAdminAuthState,
  hashPassword,
  isAdminRole,
  isValidAccountName,
  normalizeAccountName,
  type RuntimeConfigLike,
  verifyPassword,
} from "./auth-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord };
type RequireAdmin = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;
type GetBearerToken = (event: H3Event) => string;
type GetRuntimeConfig = (event: H3Event) => RuntimeConfigLike;
type ToUserPayload = (user: UserRecord) => Record<string, unknown>;

export interface AuthHandlerContext {
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
  getBearerToken: GetBearerToken;
  getRuntimeConfig: GetRuntimeConfig;
  toUserPayload: ToUserPayload;
}

const asString = (value: unknown) => String(value || "").trim();

const createSession = (event: H3Event, store: NexusStore, user: UserRecord, role: AuthSessionRecord["role"], ttlHours = 24 * 7) => {
  const session = createSignedSession(event, user, role, ttlHours);
  const now = Date.now();
  store.sessions = [
    session,
    ...store.sessions.filter((item) => item.token !== session.token && item.expiresAt > now),
  ]
    .sort((left, right) => right.expiresAt - left.expiresAt)
    .slice(0, 1000);
  return session;
};

const revokeSession = (store: NexusStore, token: string) => {
  const normalizedToken = asString(token);
  if (!normalizedToken) {
    return;
  }
  const nowIso = storeHelpers.nowIso();
  const existing = store.sessions.find((item) => item.token === normalizedToken) || null;
  if (existing) {
    existing.revokedAt = nowIso;
    return;
  }
  store.sessions.unshift({
    token: normalizedToken,
    userId: "",
    role: "user",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    createdAt: nowIso,
    revokedAt: nowIso,
  });
  if (store.sessions.length > 1000) {
    store.sessions.length = 1000;
  }
};

const toAuthUserPayload = (user: UserRecord, toUserPayload: ToUserPayload) => {
  const basePayload = toUserPayload(user);
  return {
    ...basePayload,
    openId: `wx_${user.userId}`,
    studentName: basePayload.name,
  };
};

const resolveAuthMode = (user: UserRecord) => {
  return user.authProvider || (user.passwordHash ? "account_password" : "legacy_student_no");
};

export const isCoreAuthPath = (path: string) => {
  return (
    path === "admin/bootstrap-status" ||
    path === "admin/login" ||
    path === "admin/logout" ||
    path === "admin/me" ||
    path === "admin/init-password" ||
    path === "auth/register" ||
    path === "auth/login" ||
    path === "auth/profile" ||
    path === "auth/logout" ||
    path === "auth/me" ||
    path === "me/profile"
  );
};

export const handleCoreAuthApi = async (context: AuthHandlerContext) => {
  const {
    event,
    method,
    path,
    store,
    ok,
    toApiError,
    requireUser,
    requireAdmin,
    readJsonBody,
    appendAudit,
    getBearerToken,
    getRuntimeConfig,
    toUserPayload,
  } = context;

  if (method === "GET" && path === "admin/bootstrap-status") {
    const authState = getAdminAuthState(store, getRuntimeConfig(event));
    return ok({
      bootstrapStudentNo: authState.bootstrapStudentNo,
      bootstrapAccountName: authState.bootstrapStudentNo,
      passwordInitialized: authState.initialized,
      requirePassword: authState.initialized,
    });
  }

  if (method === "POST" && path === "admin/login") {
    const body = await readJsonBody<{ password?: string; studentNo?: string; accountName?: string; username?: string }>(event);
    const studentNo = asString(body.studentNo || body.accountName || body.username);
    const password = asString(body.password);
    const authState = getAdminAuthState(store, getRuntimeConfig(event));
    if (!studentNo) {
      return toApiError(400, "ADMIN_ACCOUNT_REQUIRED", "请输入管理员账号");
    }
    if (authState.initialized && !password) {
      return toApiError(400, "ADMIN_PASSWORD_REQUIRED", "请输入登录密码");
    }
    const loginName = normalizeAccountName(studentNo);
    const targetAdmin = store.users.find((item) => item.studentNo === studentNo || normalizeAccountName(item.accountName) === loginName) || null;
    if (!targetAdmin || !isAdminRole(targetAdmin)) {
      return toApiError(401, "ADMIN_LOGIN_FAILED", "管理员账号不存在或无权限");
    }
    if (authState.initialized) {
      if (password !== authState.password) {
        return toApiError(401, "ADMIN_LOGIN_FAILED", "登录密码错误");
      }
    } else if (studentNo !== authState.bootstrapStudentNo && loginName !== normalizeAccountName(authState.bootstrapStudentNo)) {
      return toApiError(401, "ADMIN_BOOTSTRAP_ONLY", "首次初始化仅允许默认管理员账号登录");
    }
    const session = createSession(event, store, targetAdmin, "admin", 24);
    appendAudit("admin_login", targetAdmin.userId, { studentNo: targetAdmin.studentNo });
    return ok({
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      user: toUserPayload(targetAdmin),
      needInit: !authState.initialized,
      bootstrapStudentNo: authState.bootstrapStudentNo,
      bootstrapAccountName: authState.bootstrapStudentNo,
    });
  }

  if (method === "POST" && path === "admin/logout") {
    const { user } = requireAdmin(event);
    revokeSession(store, getBearerToken(event));
    appendAudit("admin_logout", user.userId, {});
    return ok({ loggedOut: true });
  }

  if (method === "GET" && path === "admin/me") {
    const { user, session } = requireAdmin(event);
    const authState = getAdminAuthState(store, getRuntimeConfig(event));
    return ok({
      user: toUserPayload(user),
      role: session.role,
      expiresAt: session.expiresAt,
      needInit: !authState.initialized,
      bootstrapStudentNo: authState.bootstrapStudentNo,
      bootstrapAccountName: authState.bootstrapStudentNo,
    });
  }

  if (method === "POST" && path === "admin/init-password") {
    const { user } = requireAdmin(event);
    const authState = getAdminAuthState(store, getRuntimeConfig(event));
    const body = await readJsonBody<{
      password?: string;
      confirmPassword?: string;
    }>(event);
    if (authState.initialized) {
      return toApiError(400, "ADMIN_PASSWORD_ALREADY_INITIALIZED", "管理员密码已初始化");
    }
    if (user.studentNo !== authState.bootstrapStudentNo && normalizeAccountName(user.accountName) !== normalizeAccountName(authState.bootstrapStudentNo)) {
      return toApiError(403, "ADMIN_INIT_FORBIDDEN", "仅默认管理员可完成首次初始化");
    }
    const password = asString(body.password);
    const confirmPassword = asString(body.confirmPassword);
    if (!password) {
      return toApiError(400, "ADMIN_PASSWORD_REQUIRED", "请设置登录密码");
    }
    if (password.length < 6) {
      return toApiError(400, "ADMIN_PASSWORD_TOO_SHORT", "登录密码至少 6 位");
    }
    if (!confirmPassword) {
      return toApiError(400, "ADMIN_PASSWORD_CONFIRM_REQUIRED", "请确认登录密码");
    }
    if (password !== confirmPassword) {
      return toApiError(400, "ADMIN_PASSWORD_CONFIRM_MISMATCH", "两次输入密码不一致");
    }
    authState.password = password;
    authState.initialized = true;
    authState.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_init_password", user.userId, { studentNo: user.studentNo });
    return ok({ initialized: true });
  }

  if (method === "POST" && path === "auth/register") {
    const body = await readJsonBody<{ accountName?: string; username?: string; password?: string; confirmPassword?: string; nickname?: string; name?: string }>(event);
    const accountName = normalizeAccountName(body.accountName || body.username);
    const password = asString(body.password);
    const confirmPassword = asString(body.confirmPassword || body.password);
    if (!isValidAccountName(accountName)) {
      return toApiError(400, "ACCOUNT_NAME_INVALID", "账号需为 3-48 位字母/数字/下划线/邮箱");
    }
    if (password.length < 6) {
      return toApiError(400, "PASSWORD_TOO_SHORT", "密码至少 6 位");
    }
    if (password !== confirmPassword) {
      return toApiError(400, "PASSWORD_CONFIRM_MISMATCH", "两次输入密码不一致");
    }
    if (!ensureAccountNameAvailable(store, accountName)) {
      return toApiError(409, "ACCOUNT_NAME_EXISTS", "账号已被注册");
    }
    const now = storeHelpers.nowIso();
    const salt = createPasswordSalt();
    const user: UserRecord = {
      userId: storeHelpers.createId("user"),
      studentNo: createVirtualStudentNo(accountName),
      studentId: "",
      name: asString(body.name),
      classLabel: "",
      nickname: asString(body.nickname || body.name) || accountName,
      avatarUrl: "",
      wallpaperUrl: "",
      classIds: [],
      adminRole: "none",
      accountName,
      passwordSalt: salt,
      passwordHash: hashPassword(password, salt),
      authProvider: "account_password",
      reminderEnabled: true,
      reminderWindowMinutes: [30, 15],
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
    const session = createSession(event, store, user, "user", 24 * 14);
    appendAudit("auth_register", user.userId, { accountName });
    return ok({ sessionToken: session.token, expiresAt: session.expiresAt, mode: "account_password", user: toAuthUserPayload(user, toUserPayload) });
  }

  if (method === "POST" && path === "auth/login") {
    const body = await readJsonBody<{ accountName?: string; username?: string; password?: string; studentNo?: string; name?: string; nickname?: string; classLabel?: string }>(event);
    const accountName = normalizeAccountName(body.accountName || body.username || body.studentNo);
    const password = asString(body.password);
    if (!accountName) {
      return toApiError(400, "ACCOUNT_NAME_REQUIRED", "请输入账号");
    }
    let user = store.users.find((item) => normalizeAccountName(item.accountName || item.studentNo) === accountName) || null;
    if (user?.passwordHash) {
      if (!password) {
        return toApiError(400, "PASSWORD_REQUIRED", "请输入密码");
      }
      if (!verifyPassword(password, asString(user.passwordSalt), asString(user.passwordHash))) {
        return toApiError(401, "AUTH_LOGIN_FAILED", "账号或密码错误");
      }
    } else {
      const legacyStudentNo = asString(body.studentNo || body.accountName || body.username);
      if (/^\d{6,32}$/.test(legacyStudentNo)) {
        user = store.users.find((item) => item.studentNo === legacyStudentNo) || null;
        if (user && password && user.passwordHash && !verifyPassword(password, asString(user.passwordSalt), asString(user.passwordHash))) {
          return toApiError(401, "AUTH_LOGIN_FAILED", "账号或密码错误");
        }
      }
      if (!user) {
        return toApiError(401, "AUTH_LOGIN_FAILED", "账号不存在，请先注册");
      }
    }
    if (asString(body.name)) user.name = asString(body.name);
    if (asString(body.nickname)) user.nickname = asString(body.nickname);
    if (asString(body.classLabel)) user.classLabel = asString(body.classLabel);
    user.updatedAt = storeHelpers.nowIso();
    const session = createSession(event, store, user, "user", 24 * 14);
    appendAudit("auth_login", user.userId, { accountName });
    return ok({
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      mode: resolveAuthMode(user),
      user: toAuthUserPayload(user, toUserPayload),
    });
  }

  if (method === "POST" && path === "auth/profile") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ nickname?: string; name?: string; avatarUrl?: string; wallpaperUrl?: string; password?: string; oldPassword?: string }>(event);
    if (Object.prototype.hasOwnProperty.call(body, "nickname")) {
      const nickname = asString(body.nickname);
      if (!nickname) return toApiError(400, "NICKNAME_REQUIRED", "昵称不能为空");
      user.nickname = nickname;
    }
    if (Object.prototype.hasOwnProperty.call(body, "name")) user.name = asString(body.name);
    if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) user.avatarUrl = asString(body.avatarUrl);
    if (Object.prototype.hasOwnProperty.call(body, "wallpaperUrl")) user.wallpaperUrl = asString(body.wallpaperUrl);
    if (asString(body.password)) {
      if (user.passwordHash && !verifyPassword(asString(body.oldPassword), asString(user.passwordSalt), asString(user.passwordHash))) {
        return toApiError(401, "OLD_PASSWORD_INVALID", "旧密码不正确");
      }
      if (asString(body.password).length < 6) return toApiError(400, "PASSWORD_TOO_SHORT", "密码至少 6 位");
      const salt = createPasswordSalt();
      user.passwordSalt = salt;
      user.passwordHash = hashPassword(asString(body.password), salt);
      user.authProvider = "account_password";
    }
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("auth_profile_update", user.userId, {});
    return ok({ user: toAuthUserPayload(user, toUserPayload) });
  }

  if (method === "POST" && path === "auth/logout") {
    const context = requireUser(event);
    revokeSession(store, getBearerToken(event));
    appendAudit("auth_logout", context.user.userId, {});
    return ok({ loggedOut: true });
  }

  if (method === "GET" && path === "auth/me") {
    const { user, session } = requireUser(event);
    return ok({
      mode: resolveAuthMode(user),
      user: toAuthUserPayload(user, toUserPayload),
      role: session.role,
      expiresAt: session.expiresAt,
    });
  }

  if (method === "GET" && path === "me/profile") {
    const { user } = requireUser(event);
    return ok({
      user: toUserPayload(user),
    });
  }

  return null;
};
