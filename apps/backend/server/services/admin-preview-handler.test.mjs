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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-admin-preview-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadAdminPreviewHandler = async () => {
  const authServiceStub = "data:text/javascript,export const isAdminRole = (user) => user.adminRole === 'super_admin' || user.adminRole === 'operator';";
  const domainStoreStub = "data:text/javascript,export const storeHelpers = { createId: (prefix) => prefix + '-1', nowIso: () => '2026-05-18T00:00:00.000Z' };";
  const scheduleServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/schedule/schedule-service.ts"),
    "schedule-service.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../auth/auth-service\"", JSON.stringify(authServiceStub)],
      ["\"../../services/domain-store\"", JSON.stringify(domainStoreStub)],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/admin/admin-preview-handler.ts"),
    "admin-preview-handler.mjs",
    [
      ["\"../auth/auth-service\"", JSON.stringify(authServiceStub)],
      ["\"../schedule/schedule-service\"", JSON.stringify(pathToFileURL(scheduleServicePath).href)],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-05-18T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  accountName: "alice@example.test",
  studentNo: "2300000001",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice",
  classLabel: "测试一班",
  classIds: ["class-1"],
  avatarUrl: "avatar.png",
  wallpaperUrl: "wallpaper.png",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser({ userId: "admin-1", studentNo: "999999", adminRole: "super_admin", classIds: [] }),
    createUser(),
  ],
  classes: [
    { id: "class-1", name: "测试一班" },
    { id: "class-stale", name: "旧班级" },
  ],
  classMembers: [{ classId: "class-1", userId: "user-1", classRole: "student" }],
  schedules: [
    {
      id: "schedule-active",
      classId: "class-1",
      title: "当前班级课表",
      createdByUserId: "teacher-1",
      publishedVersionNo: 1,
    },
    {
      id: "schedule-stale",
      classId: "class-stale",
      title: "旧班级课表",
      createdByUserId: "teacher-2",
      publishedVersionNo: 1,
    },
  ],
  scheduleSubscriptions: [
    {
      id: "sub-active",
      subscriberUserId: "user-1",
      sourceScheduleId: "schedule-active",
      baseVersionNo: 1,
      followMode: "following",
      createdAt: now,
    },
    {
      id: "sub-stale",
      subscriberUserId: "user-1",
      sourceScheduleId: "schedule-stale",
      baseVersionNo: 1,
      followMode: "patched",
      createdAt: now,
    },
  ],
  schedulePatches: [
    { id: "patch-active", subscriptionId: "sub-active", entryId: "entry-1", opType: "update", patchPayload: {}, createdAt: now },
    { id: "patch-stale", subscriptionId: "sub-stale", entryId: "entry-2", opType: "update", patchPayload: {}, createdAt: now },
  ],
  scheduleConflicts: [
    { id: "conflict-active", subscriptionId: "sub-active", entryId: "entry-1", resolutionStatus: "pending", createdAt: now },
    { id: "conflict-stale", subscriptionId: "sub-stale", entryId: "entry-2", resolutionStatus: "pending", createdAt: now },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "admin/preview/profile-card",
    query: overrides.query || { studentNo: "2300000001" },
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireAdmin: overrides.requireAdmin || (() => ({ user: store.users[0] })),
    resolveSessionWithUser: overrides.resolveSessionWithUser || (() => null),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
    toUserPayload: (user) => ({ userId: user.userId, name: user.name || user.nickname || "" }),
  };
  return { context, store, audits, handleAdminPreviewApi: handler.handleAdminPreviewApi };
};

test("builds profile-card preview with class memberships", async () => {
  const handler = await loadAdminPreviewHandler();
  const { context, handleAdminPreviewApi } = createContext(handler);

  const response = await handleAdminPreviewApi(context);

  assert.equal(response.data.studentNo, "2300000001");
  assert.equal(response.data.name, "Alice");
  assert.deepEqual(response.data.classes, [
    {
      classId: "class-1",
      classLabel: "测试一班",
      classRole: "student",
    },
  ]);
});

test("previews class-subscription repair without mutating by default", async () => {
  const handler = await loadAdminPreviewHandler();
  const { context, store, handleAdminPreviewApi } = createContext(handler, {
    path: "admin/preview/class-subscriptions",
  });

  const response = await handleAdminPreviewApi(context);

  assert.deepEqual(response.data.repairableSubscriptionIds, ["sub-stale"]);
  assert.equal(response.data.subscriptions.length, 2);
  assert.equal(store.scheduleSubscriptions.length, 2);
});

test("repairs stale class subscriptions and related patches/conflicts when requested", async () => {
  const handler = await loadAdminPreviewHandler();
  const { context, store, audits, handleAdminPreviewApi } = createContext(handler, {
    method: "POST",
    path: "admin/preview/class-subscriptions/repair",
    body: { studentNo: "2300000001", dryRun: false },
  });

  const response = await handleAdminPreviewApi(context);

  assert.deepEqual(response.data.removedSubscriptionIds, ["sub-stale"]);
  assert.equal(response.data.dryRun, false);
  assert.deepEqual(store.scheduleSubscriptions.map((item) => item.id), ["sub-active"]);
  assert.deepEqual(store.schedulePatches.map((item) => item.id), ["patch-active"]);
  assert.deepEqual(store.scheduleConflicts.map((item) => item.id), ["conflict-active"]);
  assert.deepEqual(audits, [
    {
      action: "admin_repair_class_subscriptions",
      actorUserId: "admin-1",
      payload: { studentNo: "2300000001", removedSubscriptionIds: ["sub-stale"] },
    },
  ]);
});

test("ignores unrelated preview paths", async () => {
  const handler = await loadAdminPreviewHandler();
  const { context, handleAdminPreviewApi } = createContext(handler, {
    path: "admin/preview/food-vote-state",
  });

  assert.equal(handler.isAdminPreviewPath("admin/preview/profile-card"), true);
  assert.equal(handler.isAdminPreviewPath("admin/preview/class-subscriptions/repair"), true);
  assert.equal(handler.isAdminPreviewPath("admin/preview/food-vote-state"), false);
  assert.equal(await handleAdminPreviewApi(context), null);
});
