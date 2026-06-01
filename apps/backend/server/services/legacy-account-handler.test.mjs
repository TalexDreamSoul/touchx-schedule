import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-account-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyAccountHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-account-handler.ts"),
    "legacy-account-handler.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          let seq = 0;
          export const storeHelpers = {
            createId: (prefix) => prefix + "_" + (++seq),
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      [
        "from \"../../services/schedule-calendar\";",
        `from ${JSON.stringify(dataModule(`
          export const SCHEDULE_SECTION_TIMES = [
            { section: 1, start: "08:00", end: "08:45" },
            { section: 2, start: "08:55", end: "09:40" },
            { section: 3, start: "10:00", end: "10:45" },
          ];
          export const SCHEDULE_TERM_HOLIDAYS = [];
          export const SCHEDULE_TERM_MAKEUP_DAYS = [];
          export const SCHEDULE_TERM_META = { termKey: "2026-spring", maxWeek: 18 };
          export const SCHEDULE_WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
          export const getUserReminderTimezone = () => "Asia/Shanghai";
          export const isScheduleEntryInWeek = () => true;
          export const getEffectiveScheduleEntriesForUser = (_store, user) => user.userId === "user-2"
            ? [{ id: "entry-2", day: 2, startSection: 1, endSection: 2, weekExpr: "1-18", parity: "all", courseName: "高等数学", classroom: "A101", teacher: "张老师" }]
            : [{ id: "entry-1", day: 1, startSection: 1, endSection: 2, weekExpr: "1-18", parity: "all", courseName: "数据结构", classroom: "B202", teacher: "李老师" }];
        `))};`,
      ],
      ["from \"../../services/social-collaboration-core\";", `from ${JSON.stringify(dataModule(""))};`],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2305200101",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "一班",
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
    createUser({
      userId: "user-2",
      studentNo: "2305200102",
      studentId: "student-2",
      name: "Bob",
      nickname: "Bob同学",
      classLabel: "二班",
      classIds: ["class-2"],
    }),
    createUser({
      userId: "admin-1",
      studentNo: "999999",
      studentId: "admin-student",
      name: "Admin",
      adminRole: "operator",
    }),
  ],
  schedules: [
    { id: "schedule-2", classId: "class-2", title: "二班课表", description: "", publishedVersionNo: 1, createdByUserId: "user-2", createdAt: now, updatedAt: now },
  ],
  scheduleSubscriptions: [
    { id: "sub-1", subscriberUserId: "user-3", sourceScheduleId: "schedule-2", baseVersionNo: 1, followMode: "following", createdAt: now },
  ],
  sessions: [],
});

const createState = (overrides = {}) => ({
  randomCodeByUserId: new Map([["user-1", "0101"], ["user-2", "0102"]]),
  notifyBoundUserIds: new Set(["user-1"]),
  practiceCourseKeysByUserId: new Map([["user-1", new Set(["old-course"])]]),
  subscriptionTargetsByUserId: new Map([["user-3", new Set(["user-2"])]]),
  bindingTargetUserIdByUserId: new Map([["user-1", "user-1"]]),
  ...overrides,
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const state = overrides.state || createState();
  const user = overrides.user || store.users[0];
  const uploadCalls = [];
  const context = {
    event: { body: overrides.body || {} },
    method: overrides.method || "GET",
    path: overrides.path || "auth/me",
    query: overrides.query || {},
    store,
    state,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ token: "token-1", session: { expiresAt: 1999999999999 }, user }),
    createSession: (_event, targetUser, role, ttlHours) => ({
      token: `session-${targetUser.userId}-${role}-${ttlHours}`,
      expiresAt: 1999999999999,
    }),
    registerSession: (_targetStore, session, targetUser) => {
      uploadCalls.push({ type: "register", token: session.token, userId: targetUser.userId });
    },
    revokeSession: (_targetStore, token) => {
      uploadCalls.push({ type: "revoke", token });
    },
    resolveBoundTargetUser: (targetStore, accountUser) => {
      const targetUserId = state.bindingTargetUserIdByUserId.get(accountUser.userId) || "";
      return targetStore.users.find((item) => item.userId === targetUserId) || null;
    },
    findUserByStudentId: (targetStore, studentId) => targetStore.users.find((item) => item.studentId === studentId) || null,
    findUserByStudentNo: (targetStore, studentNo) => targetStore.users.find((item) => item.studentNo === studentNo) || null,
    isAdminRole: (targetUser) => targetUser.adminRole === "super_admin" || targetUser.adminRole === "operator",
    resolveViewerVisibilityScope: () => overrides.visibilityScope || "detail",
    persistUserMediaUpload: async (_event, _targetStore, _targetUser, usage, maxBytes) => {
      uploadCalls.push({ type: "upload", usage, maxBytes });
      return `/media/${usage}-asset`;
    },
    avatarMaxBytes: 2 * 1024 * 1024,
    wallpaperMaxBytes: 5 * 1024 * 1024,
  };
  return { context, store, state, uploadCalls, handleLegacyAccountApi: handler.handleLegacyAccountApi };
};

test("logs in with wechat payload and creates missing account users", async () => {
  const handler = await loadLegacyAccountHandler();
  const store = createStore();
  const state = createState();
  const { context, uploadCalls, handleLegacyAccountApi } = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "auth/wechat-login",
    body: {
      code: "wx-code",
      studentNo: "2305200199",
      nickname: "新同学",
      avatarUrl: "http://thirdwx.qlogo.cn/avatar",
    },
  });

  const response = await handleLegacyAccountApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.mode, "mock");
  assert.match(response.token, /^session-user_1-user-336$/);
  assert.equal(response.user.studentNo, "2305200199");
  assert.equal(response.user.avatarUrl.startsWith("https://thirdwx.qlogo.cn/"), true);
  assert.equal(store.users.length, 4);
  assert.equal(state.bindingTargetUserIdByUserId.get("user_1"), "user_1");
  assert.deepEqual(uploadCalls.at(-1), { type: "register", token: response.token, userId: "user_1" });
});

test("returns auth me and revokes logout or unbind sessions", async () => {
  const handler = await loadLegacyAccountHandler();
  const { context, uploadCalls, handleLegacyAccountApi } = createContext(handler);

  const meResponse = await handleLegacyAccountApi(context);
  assert.equal(meResponse.ok, true);
  assert.equal(meResponse.user.studentId, "student-1");
  assert.equal(meResponse.expiresAt, 1999999999999);

  context.method = "POST";
  context.path = "auth/logout";
  const logoutResponse = await handleLegacyAccountApi(context);
  assert.equal(logoutResponse.ok, true);
  assert.deepEqual(uploadCalls.at(-1), { type: "revoke", token: "token-1" });

  context.path = "auth/unbind";
  const unbindResponse = await handleLegacyAccountApi(context);
  assert.equal(unbindResponse.unbound, true);
});

test("updates social profile and validates student number conflicts", async () => {
  const handler = await loadLegacyAccountHandler();
  const conflict = createContext(handler, {
    method: "POST",
    path: "social/profile",
    body: { studentNo: "2305200102" },
  });
  await assert.rejects(() => conflict.handleLegacyAccountApi(conflict.context), {
    code: "STUDENT_NO_CONFLICT",
  });

  const update = createContext(handler, {
    method: "POST",
    path: "social/profile",
    body: {
      studentNo: "2305200198",
      nickname: "Alice New",
      classLabel: "新班级",
      avatarUrl: "https://example.test/avatar.png",
      wallpaperUrl: "/wallpaper.png",
    },
  });
  const response = await update.handleLegacyAccountApi(update.context);

  assert.equal(response.ok, true);
  assert.equal(response.me.studentNo, "2305200198");
  assert.equal(response.me.name, "Alice");
  assert.equal(response.me.avatarUrl, "https://example.test/avatar.png");
  assert.equal(update.state.randomCodeByUserId.get("user-1"), "0198");
});

test("binds target student with random code and rejects missing or invalid codes", async () => {
  const handler = await loadLegacyAccountHandler();
  const missingTarget = createContext(handler, {
    method: "POST",
    path: "social/bind-student",
    body: {},
  });
  await assert.rejects(() => missingTarget.handleLegacyAccountApi(missingTarget.context), {
    code: "BIND_TARGET_REQUIRED",
  });

  const badCode = createContext(handler, {
    method: "POST",
    path: "social/bind-student",
    body: { targetStudentId: "student-2", targetRandomCode: "0000" },
  });
  await assert.rejects(() => badCode.handleLegacyAccountApi(badCode.context), {
    code: "RANDOM_CODE_REQUIRED",
  });

  const valid = createContext(handler, {
    method: "POST",
    path: "social/bind-student",
    body: { targetStudentId: "student-2", targetRandomCode: "0102" },
  });
  const response = await valid.handleLegacyAccountApi(valid.context);

  assert.equal(response.ok, true);
  assert.equal(response.me.studentId, "student-2");
  assert.equal(valid.state.bindingTargetUserIdByUserId.get("user-1"), "user-2");
  assert.equal(valid.state.notifyBoundUserIds.has("user-1"), true);
});

test("updates random code, unbinds notifications, and toggles practice courses", async () => {
  const handler = await loadLegacyAccountHandler();
  const store = createStore();
  store.users.push(createUser({ userId: "user-3", studentNo: "2305200103", studentId: "student-3", adminRole: "none" }));
  const state = createState();
  const randomContext = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/random-code",
    user: store.users[1],
    body: { randomCode: "7788" },
  });
  const randomResponse = await randomContext.handleLegacyAccountApi(randomContext.context);

  assert.equal(randomResponse.removedSubscriberCount, 1);
  assert.equal(state.randomCodeByUserId.get("user-2"), "7788");
  assert.equal(state.subscriptionTargetsByUserId.get("user-3").has("user-2"), false);
  assert.equal(store.scheduleSubscriptions.length, 0);

  const notifyContext = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/notify/unbind",
  });
  const notifyResponse = await notifyContext.handleLegacyAccountApi(notifyContext.context);
  assert.equal(notifyResponse.notifyBound, false);
  assert.equal(state.notifyBoundUserIds.has("user-1"), false);

  const practiceContext = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/practice-course",
    body: { courseKey: "course-2", enabled: true },
  });
  const practiceResponse = await practiceContext.handleLegacyAccountApi(practiceContext.context);
  assert.deepEqual(practiceResponse.practiceCourseKeys.sort(), ["course-2", "old-course"]);
});

test("uploads avatar and wallpaper through injected media upload boundary", async () => {
  const handler = await loadLegacyAccountHandler();
  const { context, uploadCalls, handleLegacyAccountApi } = createContext(handler, {
    method: "POST",
    path: "social/upload/avatar",
  });

  const avatarResponse = await handleLegacyAccountApi(context);
  assert.equal(avatarResponse.avatarUrl, "/media/avatar-asset");
  assert.equal(uploadCalls.at(-1).usage, "avatar");

  context.path = "social/upload/wallpaper";
  const wallpaperResponse = await handleLegacyAccountApi(context);
  assert.equal(wallpaperResponse.wallpaperUrl, "/media/wallpaper-asset");
  assert.equal(uploadCalls.at(-1).usage, "wallpaper");
});

test("returns schedule student payload and masks details for busy-free visibility", async () => {
  const handler = await loadLegacyAccountHandler();
  const { context, handleLegacyAccountApi } = createContext(handler, {
    path: "schedules/student",
    query: { studentId: "student-2" },
    visibilityScope: "busy_free",
  });

  const response = await handleLegacyAccountApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.visibilityScope, "busy_free");
  assert.equal(response.student.id, "student-2");
  assert.equal(response.student.courses[0].name, "忙碌");
  assert.equal(response.student.courses[0].teacher, null);
});

test("ignores unrelated account paths", async () => {
  const handler = await loadLegacyAccountHandler();
  const { context, handleLegacyAccountApi } = createContext(handler, { path: "social/me" });

  assert.equal(handler.isLegacyAccountPath("auth/wechat-login"), true);
  assert.equal(handler.isLegacyAccountPath("social/profile"), true);
  assert.equal(handler.isLegacyAccountPath("schedules/student"), true);
  assert.equal(handler.isLegacyAccountPath("social/me"), false);
  assert.equal(await handleLegacyAccountApi(context), null);
});
