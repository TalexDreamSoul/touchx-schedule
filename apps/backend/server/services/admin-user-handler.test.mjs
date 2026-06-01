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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-admin-user-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadAdminUserHandler = async () => {
  const domainStoreStub = "data:text/javascript,export const storeHelpers = { nowIso: () => '2026-05-18T00:00:00.000Z' };";
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/admin/admin-user-service.ts"),
    "admin-user-service.mjs",
    [["\"../../services/domain-store\"", JSON.stringify(domainStoreStub)]],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/admin/admin-user-handler.ts"),
    "admin-user-handler.mjs",
    [["\"./admin-user-service\"", JSON.stringify(pathToFileURL(servicePath).href)]],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-05-01T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  accountName: "alice@example.test",
  studentNo: "2300000001",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: ["class-1"],
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
  users: [
    createUser({
      userId: "admin-1",
      accountName: "admin@example.test",
      studentNo: "999999",
      studentId: "admin-student",
      name: "Admin",
      nickname: "Admin",
      classLabel: "",
      classIds: [],
      adminRole: "super_admin",
    }),
    createUser(),
    createUser({
      userId: "ghost-1",
      accountName: "ghost@example.test",
      studentNo: "2300000002",
      studentId: "student-ghost",
      name: "2300000002",
      nickname: "2300000002",
      classLabel: "",
      classIds: [],
    }),
    createUser({
      userId: "subscribed-1",
      accountName: "subscribed@example.test",
      studentNo: "2300000003",
      studentId: "student-subscribed",
      name: "2300000003",
      nickname: "2300000003",
      classLabel: "",
      classIds: [],
    }),
  ],
  scheduleSubscriptions: [
    {
      id: "sub-1",
      subscriberUserId: "subscribed-1",
      sourceScheduleId: "schedule-1",
      baseVersionNo: 1,
      followMode: "following",
      createdAt: now,
    },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "admin/users",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireAdmin: () => ({ user: overrides.adminUser || store.users[0] }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
  };
  return { context, store, audits, handleAdminUserApi: handler.handleAdminUserApi };
};

test("lists admin users and filters ghost records by default", async () => {
  const handler = await loadAdminUserHandler();
  const { context, handleAdminUserApi } = createContext(handler);

  const listed = await handleAdminUserApi(context);

  assert.equal(listed.data.total, 3);
  assert.deepEqual(
    listed.data.items.map((item) => item.userId),
    ["admin-1", "user-1", "subscribed-1"],
  );
  assert.equal(listed.data.items.some((item) => item.userId === "ghost-1"), false);
  assert.equal(listed.data.items.find((item) => item.userId === "subscribed-1").subscriptionCount, 1);
});

test("includes ghost users when requested and applies pagination", async () => {
  const handler = await loadAdminUserHandler();
  const { context, handleAdminUserApi } = createContext(handler, {
    query: { includeGhost: "true", limit: "2", offset: "1" },
  });

  const listed = await handleAdminUserApi(context);

  assert.equal(listed.data.total, 4);
  assert.equal(listed.data.limit, 2);
  assert.equal(listed.data.offset, 1);
  assert.deepEqual(
    listed.data.items.map((item) => item.userId),
    ["user-1", "ghost-1"],
  );
});

test("updates admin users and records audit metadata", async () => {
  const handler = await loadAdminUserHandler();
  const { context, store, audits, handleAdminUserApi } = createContext(handler, {
    method: "POST",
    path: "admin/users/user-1/update",
    body: {
      name: "Alice Updated",
      nickname: "AU",
      classLabel: "测试二班",
      studentId: "student-updated",
      adminRole: "operator",
      reminderEnabled: false,
      reminderWindowMinutes: "45, 15, 45, bad, 0",
    },
  });

  const updated = await handleAdminUserApi(context);

  assert.equal(updated.data.user.name, "Alice Updated");
  assert.equal(updated.data.user.nickname, "AU");
  assert.equal(updated.data.user.classLabel, "测试二班");
  assert.equal(updated.data.user.studentId, "student-updated");
  assert.equal(updated.data.user.adminRole, "operator");
  assert.equal(updated.data.user.reminderEnabled, false);
  assert.deepEqual(updated.data.user.reminderWindowMinutes, [15, 45]);
  assert.equal(store.users.find((item) => item.userId === "user-1").updatedAt, "2026-05-18T00:00:00.000Z");
  assert.deepEqual(audits, [
    {
      action: "admin_user_update",
      actorUserId: "admin-1",
      payload: { targetUserId: "user-1", targetStudentNo: "2300000001" },
    },
  ]);
});

test("returns a typed error when updating a missing user", async () => {
  const handler = await loadAdminUserHandler();
  const { context, handleAdminUserApi } = createContext(handler, {
    method: "POST",
    path: "admin/users/missing/update",
  });

  await assert.rejects(() => handleAdminUserApi(context), {
    statusCode: 404,
    code: "ADMIN_USER_NOT_FOUND",
  });
});

test("ignores unrelated paths", async () => {
  const handler = await loadAdminUserHandler();
  const { context, handleAdminUserApi } = createContext(handler, { path: "admin/classes" });

  assert.equal(handler.isAdminUserPath("admin/users"), true);
  assert.equal(handler.isAdminUserPath("admin/users/user-1/update"), true);
  assert.equal(handler.isAdminUserPath("admin/userstats"), false);
  assert.equal(await handleAdminUserApi(context), null);
});
