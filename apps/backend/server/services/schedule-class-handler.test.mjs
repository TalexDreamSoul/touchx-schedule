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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-schedule-class-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadScheduleClassHandler = async () => {
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
  const authServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/auth/auth-service.ts"),
    "auth-service.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const scheduleServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/schedule/schedule-service.ts"),
    "schedule-service.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../auth/auth-service\"", JSON.stringify(pathToFileURL(authServicePath).href)],
    ],
  );
  const calendarSourceService = `
    export const onSchedulePublished = (store, schedule, versionNo) => {
      store.scheduleSubscriptions.filter((item) => item.sourceScheduleId === schedule.id).forEach((item) => {
        if (item.followMode !== 'patched') item.baseVersionNo = versionNo;
      });
    };
  `;
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/schedule/schedule-class-handler.ts"),
    "schedule-class-handler.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../calendar/calendar-source-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(calendarSourceService)}`)],
      ["\"./schedule-service\"", JSON.stringify(pathToFileURL(scheduleServicePath).href)],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
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
    createUser(),
    createUser({ userId: "user-2", studentNo: "2300000002", accountName: "bob@example.test", nickname: "Bob同学", classIds: [] }),
    createUser({ userId: "admin-1", studentNo: "999999", accountName: "admin@example.test", nickname: "Admin", adminRole: "super_admin", classIds: [] }),
  ],
  classes: [
    {
      id: "class-1",
      name: "测试一班",
      ownerUserId: "user-1",
      timezone: "Asia/Shanghai",
      status: "active",
      activeJoinCode: "JOIN123",
      createdAt: now,
      updatedAt: now,
    },
  ],
  classMembers: [
    { id: "member-1", classId: "class-1", userId: "user-1", classRole: "class_owner", joinedAt: now },
  ],
  schedules: [
    {
      id: "schedule-1",
      classId: "class-1",
      title: "主课表",
      description: "",
      publishedVersionNo: 1,
      createdByUserId: "user-1",
      createdAt: now,
      updatedAt: now,
    },
  ],
  scheduleVersions: [
    {
      id: "version-1",
      scheduleId: "schedule-1",
      versionNo: 1,
      status: "published",
      entries: [{ id: "entry-1", day: 1, startSection: 1, endSection: 2, weekExpr: "1-20", parity: "all", courseName: "软件工程", classroom: "A101", teacher: "张老师" }],
      createdByUserId: "user-1",
      createdAt: now,
    },
  ],
  scheduleSubscriptions: [
    { id: "sub-1", subscriberUserId: "user-2", sourceScheduleId: "schedule-1", baseVersionNo: 1, followMode: "following", createdAt: now },
  ],
  schedulePatches: [
    { id: "patch-1", subscriptionId: "sub-1", entryId: "entry-1", opType: "update", patchPayload: { classroom: "B202" }, createdAt: now },
  ],
  scheduleConflicts: [
    { id: "conflict-1", subscriptionId: "sub-1", entryId: "entry-1", sourceVersionNo: 2, conflictType: "source_changed_after_patch", resolutionStatus: "pending", createdAt: now },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "classes",
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireUser: () => ({ user }),
    requireAdmin: () => ({ user: overrides.adminUser || store.users[2] }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
  };
  return { context, store, user, audits, handleScheduleClassApi: handler.handleScheduleClassApi };
};

test("creates, lists, joins, and rotates classes", async () => {
  const handler = await loadScheduleClassHandler();
  const { context, store, audits, handleScheduleClassApi } = createContext(handler, {
    method: "POST",
    path: "classes",
    body: { className: "新班级", timezone: "Asia/Shanghai" },
  });

  const created = await handleScheduleClassApi(context);
  assert.equal(created.data.className, "新班级");
  assert.equal(store.classMembers.some((item) => item.classId === created.data.classId && item.classRole === "class_owner"), true);
  assert.equal(audits[0].action, "class_create");

  context.method = "GET";
  context.path = "classes";
  const listed = await handleScheduleClassApi(context);
  assert.equal(listed.data.items.some((item) => item.classId === created.data.classId && item.joined), true);

  const other = store.users[1];
  context.method = "POST";
  context.path = `classes/${created.data.classId}/join`;
  context.requireUser = () => ({ user: other });
  context.readJsonBody = async () => ({ joinCode: created.data.joinCode });
  const joined = await handleScheduleClassApi(context);
  assert.equal(joined.data.joined, true);
  assert.equal(joined.data.classRole, "class_viewer");
  assert.ok(other.classIds.includes(created.data.classId));

  context.requireUser = () => ({ user: store.users[0] });
  context.path = `classes/${created.data.classId}/join-code/rotate`;
  const rotated = await handleScheduleClassApi(context);
  assert.equal(rotated.data.classId, created.data.classId);
  assert.notEqual(rotated.data.joinCode, created.data.joinCode);
});

test("creates, publishes, subscribes, patches, and resolves schedules", async () => {
  const handler = await loadScheduleClassHandler();
  const { context, store, audits, handleScheduleClassApi } = createContext(handler, {
    method: "POST",
    path: "classes/class-1/schedules",
    body: {
      title: "新课表",
      publishNow: true,
      entries: [{ day: 2, startSection: 3, endSection: 4, courseName: "数据库", classroom: "C303" }],
    },
  });

  const created = await handleScheduleClassApi(context);
  assert.equal(created.data.status, "published");
  assert.equal(created.data.entryCount, 1);
  assert.equal(audits[0].action, "schedule_create");

  context.path = `schedules/${created.data.scheduleId}/publish`;
  context.readJsonBody = async () => ({ entries: [{ day: 3, startSection: 1, endSection: 1, courseName: "算法" }] });
  const published = await handleScheduleClassApi(context);
  assert.equal(published.data.versionNo, 2);
  assert.equal(store.schedules.find((item) => item.id === created.data.scheduleId).publishedVersionNo, 2);

  context.requireUser = () => ({ user: store.users[1] });
  context.path = `schedules/${created.data.scheduleId}/subscribe`;
  context.readJsonBody = async () => ({});
  const subscribed = await handleScheduleClassApi(context);
  assert.equal(subscribed.data.subscription.subscriberUserId, "user-2");

  context.path = "me/schedule-patches";
  context.readJsonBody = async () => ({ subscriptionId: subscribed.data.subscription.id, entryId: "entry-x", patchPayload: { classroom: "D404" } });
  const patched = await handleScheduleClassApi(context);
  assert.equal(patched.data.followMode, "patched");

  context.method = "GET";
  const patches = await handleScheduleClassApi(context);
  assert.equal(patches.data.items.some((item) => item.id === patched.data.patch.id), true);

  context.path = "me/schedule-conflicts/conflict-1/resolve";
  context.method = "POST";
  context.readJsonBody = async () => ({ action: "relink" });
  const resolved = await handleScheduleClassApi(context);
  assert.equal(resolved.data.conflict.resolutionStatus, "relinked");

  context.path = `me/schedule-patches/${patched.data.patch.id}/relink`;
  const relinked = await handleScheduleClassApi(context);
  assert.equal(relinked.data.relinked, true);
});

test("handles admin class and schedule management", async () => {
  const handler = await loadScheduleClassHandler();
  const { context, store, audits, handleScheduleClassApi } = createContext(handler, {
    method: "POST",
    path: "admin/classes",
    body: { classLabel: "后台班级", ownerStudentNo: "2300000002" },
  });

  const created = await handleScheduleClassApi(context);
  assert.equal(created.data.classLabel, "后台班级");
  assert.equal(audits[0].action, "admin_class_create");

  context.method = "GET";
  context.path = "admin/classes";
  const listed = await handleScheduleClassApi(context);
  assert.equal(listed.data.items.some((item) => item.classId === created.data.classId), true);

  context.method = "POST";
  context.path = `admin/classes/${created.data.classId}/update`;
  context.readJsonBody = async () => ({ classLabel: "后台班级改名", active: false });
  const updated = await handleScheduleClassApi(context);
  assert.equal(updated.data.classLabel, "后台班级改名");
  assert.equal(updated.data.active, false);

  context.path = `admin/classes/${created.data.classId}/rotate-code`;
  context.readJsonBody = async () => ({});
  const rotated = await handleScheduleClassApi(context);
  assert.notEqual(rotated.data.currentCode, created.data.currentCode);

  context.method = "GET";
  context.path = `admin/classes/${created.data.classId}/members`;
  const members = await handleScheduleClassApi(context);
  assert.equal(members.data.item.memberCount, 1);

  context.path = "admin/schedules";
  const schedules = await handleScheduleClassApi(context);
  assert.equal(schedules.data.items[0].scheduleId, "schedule-1");
});

test("ignores unrelated paths", async () => {
  const handler = await loadScheduleClassHandler();
  const { context, handleScheduleClassApi } = createContext(handler, { path: "calendar/me/effective" });

  assert.equal(handler.isScheduleClassPath("classes"), true);
  assert.equal(handler.isScheduleClassPath("admin/classes/class-1/members"), true);
  assert.equal(handler.isScheduleClassPath("calendar/me/effective"), false);
  assert.equal(await handleScheduleClassApi(context), null);
});
