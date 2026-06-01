import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const transpileModuleToTemp = (sourcePath, fileName, replacements = []) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [needle, replacement] of replacements) {
    source = source.split(needle).join(replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-auth-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadAuthModules = async () => {
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/auth/auth-service.ts"),
    "auth-service.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const sessionTokenModule = `
    export const createSignedSession = (_event, user, role, ttlHours = 168) => ({
      token: 'session-' + role + '-' + user.userId,
      userId: user.userId,
      role,
      expiresAt: ttlHours,
      createdAt: '2026-05-18T00:00:00.000Z',
    });
  `;
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/auth/auth-handler.ts"),
    "auth-handler.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../utils/session-token\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(sessionTokenModule)}`)],
      ["\"./auth-service\"", JSON.stringify(pathToFileURL(servicePath).href)],
    ],
  );
  const [service, handler] = await Promise.all([
    import(pathToFileURL(servicePath).href),
    import(pathToFileURL(handlerPath).href),
  ]);
  return { service, handler };
};

const now = "2026-05-18T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2300000001",
  studentId: "student-1",
  accountName: "alice@example.test",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: [],
  avatarUrl: "",
  wallpaperUrl: "",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createStore = () => ({
  users: [],
  auditLogs: [],
  sessions: [],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const body = overrides.body || {};
  const currentUser = overrides.user || store.users[0] || createUser();
  const session = overrides.session || { token: "session-user-user-1", userId: currentUser.userId, role: "user", expiresAt: 1, createdAt: now };
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "auth/me",
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireUser: () => ({ user: currentUser, session }),
    requireAdmin: () => ({ user: currentUser, session: { ...session, role: "admin" } }),
    readJsonBody: async () => body,
    appendAudit: (action, actorUserId, payload) => store.auditLogs.push({ action, actorUserId, payload }),
    getBearerToken: () => "token-1",
    getRuntimeConfig: overrides.getRuntimeConfig || (() => ({ adminBootstrapStudentNo: "admin@schedule.com", adminLoginPassword: "123456" })),
    toUserPayload: (user) => ({
      userId: user.userId,
      accountName: user.accountName || "",
      studentNo: user.studentNo,
      name: user.name || "",
      nickname: user.nickname || "",
      adminRole: user.adminRole,
    }),
  };
  return { context, store, handleCoreAuthApi: handler.handleCoreAuthApi };
};

test("registers account-password users and rejects duplicate accounts", async () => {
  const { handler } = await loadAuthModules();
  const { context, store, handleCoreAuthApi } = createContext(handler, {
    method: "POST",
    path: "auth/register",
    body: { accountName: "new@example.test", password: "secret1", confirmPassword: "secret1", nickname: "New" },
  });

  const response = await handleCoreAuthApi(context);

  assert.equal(response.data.mode, "account_password");
  assert.equal(response.data.sessionToken, `session-user-${store.users[0].userId}`);
  assert.equal(response.data.user.openId, `wx_${store.users[0].userId}`);
  assert.equal(store.users[0].accountName, "new@example.test");
  assert.equal(store.users[0].authProvider, "account_password");
  assert.ok(store.users[0].passwordHash);
  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].token, response.data.sessionToken);
  assert.equal(store.sessions[0].userId, store.users[0].userId);
  assert.equal(store.auditLogs[0].action, "auth_register");

  await assert.rejects(() => handleCoreAuthApi(context), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, "ACCOUNT_NAME_EXISTS");
    return true;
  });
});

test("logs in password and legacy student-number users", async () => {
  const { service, handler } = await loadAuthModules();
  const salt = service.createPasswordSalt();
  const passwordUser = createUser({
    userId: "user-password",
    accountName: "alice@example.test",
    passwordSalt: salt,
    passwordHash: service.hashPassword("secret1", salt),
    authProvider: "account_password",
  });
  const legacyUser = createUser({
    userId: "user-legacy",
    studentNo: "2300000002",
    accountName: "",
    passwordHash: "",
    passwordSalt: "",
    authProvider: "legacy_student_no",
  });
  const store = { users: [passwordUser, legacyUser], auditLogs: [], sessions: [] };

  const passwordLogin = createContext(handler, {
    store,
    method: "POST",
    path: "auth/login",
    body: { accountName: "Alice@Example.Test", password: "secret1" },
    user: passwordUser,
  });
  const passwordResponse = await passwordLogin.handleCoreAuthApi(passwordLogin.context);
  assert.equal(passwordResponse.data.mode, "account_password");
  assert.equal(passwordResponse.data.sessionToken, "session-user-user-password");

  const legacyLogin = createContext(handler, {
    store,
    method: "POST",
    path: "auth/login",
    body: { studentNo: "2300000002" },
    user: legacyUser,
  });
  const legacyResponse = await legacyLogin.handleCoreAuthApi(legacyLogin.context);
  assert.equal(legacyResponse.data.mode, "legacy_student_no");
  assert.equal(legacyResponse.data.sessionToken, "session-user-user-legacy");

  const badLogin = createContext(handler, {
    store,
    method: "POST",
    path: "auth/login",
    body: { accountName: "alice@example.test", password: "bad-password" },
    user: passwordUser,
  });
  await assert.rejects(() => badLogin.handleCoreAuthApi(badLogin.context), (error) => {
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, "AUTH_LOGIN_FAILED");
    return true;
  });
});

test("updates profile and requires old password before changing an existing password", async () => {
  const { service, handler } = await loadAuthModules();
  const salt = service.createPasswordSalt();
  const user = createUser({
    passwordSalt: salt,
    passwordHash: service.hashPassword("old-secret", salt),
    authProvider: "account_password",
  });
  const store = { users: [user], auditLogs: [], sessions: [] };

  const badContext = createContext(handler, {
    store,
    user,
    method: "POST",
    path: "auth/profile",
    body: { nickname: "Alice New", password: "new-secret", oldPassword: "wrong" },
  });
  await assert.rejects(() => badContext.handleCoreAuthApi(badContext.context), (error) => {
    assert.equal(error.statusCode, 401);
    assert.equal(error.code, "OLD_PASSWORD_INVALID");
    return true;
  });

  const goodContext = createContext(handler, {
    store,
    user,
    method: "POST",
    path: "auth/profile",
    body: { nickname: "Alice New", password: "new-secret", oldPassword: "old-secret" },
  });
  const response = await goodContext.handleCoreAuthApi(goodContext.context);
  assert.equal(response.data.user.nickname, "Alice New");
  assert.equal(user.authProvider, "account_password");
  assert.equal(service.verifyPassword("new-secret", user.passwordSalt, user.passwordHash), true);
  assert.equal(store.auditLogs[0].action, "auth_profile_update");
});

test("returns legacy me/profile payload without auth mode envelope", async () => {
  const { handler } = await loadAuthModules();
  const user = createUser({ name: "Alice", nickname: "Alice同学" });
  const store = { users: [user], auditLogs: [], sessions: [] };
  const { context, handleCoreAuthApi } = createContext(handler, {
    store,
    user,
    method: "GET",
    path: "me/profile",
  });

  const response = await handleCoreAuthApi(context);

  assert.deepEqual(response.data, {
    user: {
      userId: "user-1",
      accountName: "alice@example.test",
      studentNo: "2300000001",
      name: "Alice",
      nickname: "Alice同学",
      adminRole: "none",
    },
  });
});

test("handles admin bootstrap status, login, and initialized-password rules", async () => {
  const { service, handler } = await loadAuthModules();
  const admin = createUser({
    userId: "admin-1",
    studentNo: "admin@schedule.com",
    accountName: "admin@schedule.com",
    adminRole: "super_admin",
  });
  const store = { users: [admin], auditLogs: [], sessions: [] };
  service.hydrateAdminAuthState(store, {
    bootstrapStudentNo: "admin@schedule.com",
    password: "",
    initialized: false,
    updatedAt: now,
  });

  const statusContext = createContext(handler, {
    store,
    method: "GET",
    path: "admin/bootstrap-status",
    user: admin,
  });
  const statusResponse = await statusContext.handleCoreAuthApi(statusContext.context);
  assert.equal(statusResponse.data.passwordInitialized, true);
  assert.equal(statusResponse.data.requirePassword, true);

  const missingPasswordContext = createContext(handler, {
    store,
    method: "POST",
    path: "admin/login",
    body: { accountName: "admin@schedule.com" },
    user: admin,
  });
  await assert.rejects(() => missingPasswordContext.handleCoreAuthApi(missingPasswordContext.context), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "ADMIN_PASSWORD_REQUIRED");
    return true;
  });

  const loginContext = createContext(handler, {
    store,
    method: "POST",
    path: "admin/login",
    body: { accountName: "admin@schedule.com", password: "123456" },
    user: admin,
  });
  const loginResponse = await loginContext.handleCoreAuthApi(loginContext.context);
  assert.equal(loginResponse.data.sessionToken, "session-admin-admin-1");
  assert.equal(loginResponse.data.needInit, false);
  assert.equal(store.sessions.some((item) => item.token === "session-admin-admin-1"), true);

  const initContext = createContext(handler, {
    store,
    method: "POST",
    path: "admin/init-password",
    body: { password: "secret1", confirmPassword: "secret1" },
    user: admin,
  });
  await assert.rejects(() => initContext.handleCoreAuthApi(initContext.context), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, "ADMIN_PASSWORD_ALREADY_INITIALIZED");
    return true;
  });
});

test("marks current sessions revoked on logout", async () => {
  const { handler } = await loadAuthModules();
  const user = createUser();
  const store = {
    users: [user],
    auditLogs: [],
    sessions: [{ token: "token-1", userId: user.userId, role: "user", expiresAt: 1999999999999, createdAt: now }],
  };
  const { context, handleCoreAuthApi } = createContext(handler, {
    store,
    user,
    method: "POST",
    path: "auth/logout",
  });

  const response = await handleCoreAuthApi(context);

  assert.equal(response.data.loggedOut, true);
  assert.ok(store.sessions[0].revokedAt);
  assert.equal(store.auditLogs[0].action, "auth_logout");
});

test("returns null for non-core auth routes", async () => {
  const { handler } = await loadAuthModules();
  const { context, handleCoreAuthApi } = createContext(handler, { path: "calendar/me" });

  assert.equal(handler.isCoreAuthPath("auth/login"), true);
  assert.equal(handler.isCoreAuthPath("calendar/me"), false);
  assert.equal(await handleCoreAuthApi(context), null);
});
