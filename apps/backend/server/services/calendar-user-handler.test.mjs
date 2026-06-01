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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-calendar-user-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadCalendarUserHandler = async () => {
  const sharedModule = `
    export const DEFAULT_SCHEDULE_TERM_META = { name: '2025-2026-2', week1Monday: '2026-03-02', maxWeek: 25, timezone: 'Asia/Shanghai' };
    export const DEFAULT_SCHEDULE_TERM_TIMEZONE = 'Asia/Shanghai';
    export const DEFAULT_SCHEDULE_TERM_HOLIDAYS = [];
    export const DEFAULT_SCHEDULE_TERM_MAKEUP_DAYS = [];
    export const DEFAULT_SCHEDULE_WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
    export const DEFAULT_SCHEDULE_SECTION_TIMES = [
      { section: 1, start: '08:30', end: '09:15', part: '上午' },
      { section: 2, start: '09:20', end: '10:05', part: '上午' },
      { section: 3, start: '10:25', end: '11:10', part: '上午' },
      { section: 4, start: '11:15', end: '12:00', part: '上午' },
    ];
  `;
  const sharedHref = `data:text/javascript,${encodeURIComponent(sharedModule)}`;
  const calendarCoreModule = `
    export const resolveEffectiveCalendarEvents = ({ sourceEvents = [], personalEvents = [] }) => [...sourceEvents, ...personalEvents];
    export const expandRecurringEvents = (events, options = {}) => events.map((item) => ({ ...item, weekday: item.weekday || item.day || 1, weekExpr: item.weekExpr || String(options.week || 1) }));
    export const detectCalendarConflicts = () => [];
    export const resolveReminderCandidates = () => [];
  `;
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const scheduleCalendarPath = transpileModuleToTemp(
    join(import.meta.dirname, "schedule-calendar.ts"),
    "schedule-calendar.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["from \"./domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const authServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/auth/auth-service.ts"),
    "auth-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const adapterPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/calendar-adapter.ts"),
    "calendar-adapter.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/schedule-calendar\"", JSON.stringify(pathToFileURL(scheduleCalendarPath).href)],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const sourceServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/calendar-source-service.ts"),
    "calendar-source-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"./calendar-adapter\"", JSON.stringify(pathToFileURL(adapterPath).href)],
    ],
  );
  const subscriptionServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/calendar-subscription-service.ts"),
    "calendar-subscription-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"./calendar-adapter\"", JSON.stringify(pathToFileURL(adapterPath).href)],
    ],
  );
  const personalEventServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/personal-event-service.ts"),
    "personal-event-service.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const effectiveServicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/effective-calendar-service.ts"),
    "effective-calendar-service.mjs",
    [
      ["from \"@touchx/calendar-core\";", `from ${JSON.stringify(`data:text/javascript,${encodeURIComponent(calendarCoreModule)}`)};`],
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-calendar\"", JSON.stringify(pathToFileURL(scheduleCalendarPath).href)],
      ["\"./calendar-adapter\"", JSON.stringify(pathToFileURL(adapterPath).href)],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/calendar-user-handler.ts"),
    "calendar-user-handler.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(sharedHref)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"./effective-calendar-service\"", JSON.stringify(pathToFileURL(effectiveServicePath).href)],
      ["\"./calendar-source-service\"", JSON.stringify(pathToFileURL(sourceServicePath).href)],
      ["\"./calendar-subscription-service\"", JSON.stringify(pathToFileURL(subscriptionServicePath).href)],
      ["\"./personal-event-service\"", JSON.stringify(pathToFileURL(personalEventServicePath).href)],
      ["\"./calendar-adapter\"", JSON.stringify(pathToFileURL(adapterPath).href)],
      ["\"../auth/auth-service\"", JSON.stringify(pathToFileURL(authServicePath).href)],
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

const createStore = () => {
  const owner = createUser();
  const other = createUser({ userId: "user-2", studentNo: "2300000002", accountName: "bob@example.test", nickname: "Bob同学" });
  return {
    users: [owner, other],
    classes: [],
    classMembers: [],
    schedules: [],
    scheduleVersions: [],
    scheduleSubscriptions: [],
    schedulePatches: [],
    scheduleConflicts: [],
    userScheduleEvents: [],
    reminderRules: [],
    auditLogs: [],
  };
};

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "calendar/sources",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireUser: () => ({ user, session: { role: "user", userId: user.userId } }),
    requireAdmin: () => ({ user, session: { role: "admin", userId: user.userId } }),
    resolveSessionWithUser: () => ({ user, session: { role: user.adminRole === "none" ? "user" : "admin", userId: user.userId } }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => store.auditLogs.push({ action, actorUserId, payload }),
    toUserPayload: (item) => ({ userId: item.userId, nickname: item.nickname, reminderEnabled: item.reminderEnabled, reminderWindowMinutes: item.reminderWindowMinutes }),
    normalizeReminderOffsets: (value, fallback = [30, 15]) => Array.from(new Set((Array.isArray(value) ? value : fallback).map((item) => Math.trunc(Number(item))).filter((item) => Number.isFinite(item) && item >= 0))).slice(0, 8),
  };
  return { context, store, user, handleCalendarUserApi: handler.handleCalendarUserApi };
};

test("creates calendar source and returns source details", async () => {
  const handler = await loadCalendarUserHandler();
  const { context, store, handleCalendarUserApi } = createContext(handler, {
    method: "POST",
    path: "calendar/sources",
    body: {
      title: "自定义日程",
      visibility: "public",
      events: [{ title: "软件工程", weekday: 1, startSection: 1, endSection: 2, location: "A101" }],
    },
  });

  const created = await handleCalendarUserApi(context);

  assert.equal(created.data.item.title, "自定义日程");
  assert.equal(created.data.item.currentVersionNo, 1);
  assert.equal(store.schedules.length, 1);
  assert.equal(store.scheduleVersions.length, 1);
  assert.equal(store.scheduleSubscriptions.length, 1);
  assert.equal(store.auditLogs[0].action, "calendar_source_upsert");

  context.method = "GET";
  context.path = `calendar/sources/schedule:${store.schedules[0].id}`;
  const detail = await handleCalendarUserApi(context);
  assert.equal(detail.data.eventCount, 1);
  assert.equal(detail.data.events[0].title, "软件工程");
});

test("subscribes and cancels published calendar source", async () => {
  const handler = await loadCalendarUserHandler();
  const store = createStore();
  const ownerContext = createContext(handler, {
    store,
    method: "POST",
    path: "calendar/sources",
    body: { title: "公共日程", visibility: "public", events: [{ title: "讲座", weekday: 2, startSection: 3 }] },
  });
  await ownerContext.handleCalendarUserApi(ownerContext.context);

  const other = store.users[1];
  const subscribeContext = createContext(handler, {
    store,
    user: other,
    method: "POST",
    path: `calendar/sources/schedule:${store.schedules[0].id}/subscribe`,
  });
  const subscribed = await subscribeContext.handleCalendarUserApi(subscribeContext.context);
  assert.equal(subscribed.data.duplicated, false);
  assert.equal(subscribed.data.subscription.userId, "user-2");

  subscribeContext.context.method = "GET";
  subscribeContext.context.path = "calendar/me/subscriptions";
  const listed = await subscribeContext.handleCalendarUserApi(subscribeContext.context);
  assert.equal(listed.data.total, 1);

  subscribeContext.context.method = "POST";
  subscribeContext.context.path = `calendar/me/subscriptions/${subscribed.data.subscription.id}/cancel`;
  const cancelled = await subscribeContext.handleCalendarUserApi(subscribeContext.context);
  assert.equal(cancelled.data.cancelled, true);
  assert.equal(store.scheduleSubscriptions.some((item) => item.id === subscribed.data.subscription.id), false);
});

test("protects private calendar source details", async () => {
  const handler = await loadCalendarUserHandler();
  const store = createStore();
  const ownerContext = createContext(handler, {
    store,
    method: "POST",
    path: "calendar/sources",
    body: { title: "私人日程", visibility: "private", events: [{ title: "私有课", weekday: 1, startSection: 1 }] },
  });
  await ownerContext.handleCalendarUserApi(ownerContext.context);
  const sourcePath = `calendar/sources/schedule:${store.schedules[0].id}`;

  const anonymousContext = createContext(handler, {
    store,
    method: "GET",
    path: sourcePath,
  });
  anonymousContext.context.resolveSessionWithUser = () => null;
  await assert.rejects(
    () => anonymousContext.handleCalendarUserApi(anonymousContext.context),
    (error) => error.statusCode === 403 && error.code === "CALENDAR_SOURCE_FORBIDDEN",
  );

  const otherContext = createContext(handler, {
    store,
    user: store.users[1],
    method: "GET",
    path: sourcePath,
  });
  await assert.rejects(
    () => otherContext.handleCalendarUserApi(otherContext.context),
    (error) => error.statusCode === 403 && error.code === "CALENDAR_SOURCE_FORBIDDEN",
  );

  ownerContext.context.method = "GET";
  ownerContext.context.path = sourcePath;
  const ownerDetail = await ownerContext.handleCalendarUserApi(ownerContext.context);
  assert.equal(ownerDetail.data.item.title, "私人日程");

  const admin = createUser({ userId: "admin-1", studentNo: "999999", accountName: "admin@example.test", adminRole: "operator" });
  store.users.push(admin);
  const adminContext = createContext(handler, {
    store,
    user: admin,
    method: "GET",
    path: sourcePath,
  });
  const adminDetail = await adminContext.handleCalendarUserApi(adminContext.context);
  assert.equal(adminDetail.data.item.title, "私人日程");
});

test("updates settings and builds effective calendar", async () => {
  const handler = await loadCalendarUserHandler();
  const { context, store, user, handleCalendarUserApi } = createContext(handler, {
    method: "POST",
    path: "calendar/sources",
    body: { title: "有效日程", visibility: "public", events: [{ title: "课程一", weekday: 1, startSection: 1, endSection: 1, weekExpr: "1-25" }] },
  });
  await handleCalendarUserApi(context);

  context.method = "POST";
  context.path = "calendar/me/settings";
  context.readJsonBody = async () => ({ reminderEnabled: false, reminderWindowMinutes: [10, 10, 5], nickname: "Alice New" });
  const settings = await handleCalendarUserApi(context);
  assert.equal(settings.data.user.nickname, "Alice New");
  assert.equal(user.reminderEnabled, false);
  assert.deepEqual(user.reminderWindowMinutes, [10, 5]);

  context.method = "GET";
  context.path = "calendar/me/effective";
  context.query = { week: "1" };
  const effective = await handleCalendarUserApi(context);
  assert.equal(effective.data.week, 1);
  assert.ok(effective.data.items.some((item) => item.title === "课程一"));
});

test("publishes calendar source version and creates conflicts for patched subscribers", async () => {
  const handler = await loadCalendarUserHandler();
  const store = createStore();
  const ownerContext = createContext(handler, {
    store,
    method: "POST",
    path: "calendar/sources",
    body: { title: "版本日程", visibility: "public", publish: false, events: [{ title: "旧课", weekday: 1, startSection: 1 }] },
  });
  await ownerContext.handleCalendarUserApi(ownerContext.context);
  const schedule = store.schedules[0];
  store.scheduleVersions.push({
    id: "version-2",
    scheduleId: schedule.id,
    versionNo: 2,
    status: "draft",
    entries: [{ id: "entry-2", day: 1, startSection: 2, endSection: 2, weekExpr: "1-25", parity: "all", courseName: "新课", classroom: "", teacher: "" }],
    createdByUserId: "user-1",
    createdAt: now,
  });
  store.scheduleSubscriptions.push({
    id: "sub-2",
    subscriberUserId: "user-2",
    sourceScheduleId: schedule.id,
    baseVersionNo: 1,
    followMode: "patched",
    createdAt: now,
  });
  store.schedulePatches.push({
    id: "patch-1",
    subscriptionId: "sub-2",
    entryId: "entry-2",
    opType: "update",
    patchPayload: { classroom: "B202" },
    createdAt: now,
  });

  const publishContext = createContext(handler, {
    store,
    method: "POST",
    path: `admin/calendar/sources/schedule:${schedule.id}/versions/2/publish`,
  });
  const response = await publishContext.handleCalendarUserApi(publishContext.context);

  assert.equal(response.data.version.versionNo, 2);
  assert.equal(schedule.publishedVersionNo, 2);
  assert.equal(store.scheduleSubscriptions.find((item) => item.id === "sub-2").followMode, "patched");
  assert.equal(store.scheduleConflicts.length, 1);
  assert.equal(store.scheduleConflicts[0].conflictType, "source_changed_after_patch");
});

test("manages personal calendar events lifecycle", async () => {
  const handler = await loadCalendarUserHandler();
  const { context, store, handleCalendarUserApi } = createContext(handler, {
    method: "POST",
    path: "calendar/me/personal-events",
    body: {
      title: "复习数据结构",
      description: "整理错题",
      eventType: "activity",
      date: "2026-06-01",
      weekday: 3,
      startSection: 2,
      endSection: 4,
      tags: ["考试"],
      priority: "high",
    },
  });

  const created = await handleCalendarUserApi(context);
  const eventId = created.data.item.id;

  assert.equal(created.data.item.title, "复习数据结构");
  assert.equal(created.data.item.source, "activity");
  assert.equal(created.data.item.day, 3);
  assert.equal(created.data.item.startSection, 2);
  assert.equal(created.data.item.endSection, 4);
  assert.equal(created.data.item.examDate, "2026-06-01");
  assert.equal(created.data.item.priorityLabel, "high");
  assert.deepEqual(created.data.item.tags, ["考试"]);
  assert.equal(store.userScheduleEvents.length, 1);
  assert.equal(store.auditLogs[0].action, "personal_event_create");

  context.method = "GET";
  context.path = "calendar/me/personal-events";
  context.query = {};
  const listed = await handleCalendarUserApi(context);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.items[0].id, eventId);

  context.method = "PATCH";
  context.path = `calendar/me/personal-events/${eventId}`;
  context.readJsonBody = async () => ({
    title: "复习算法",
    eventType: "exam",
    date: "2026-06-02",
    weekday: 5,
    startSection: 6,
    endSection: 5,
    tags: ["重点", "期末"],
    priority: "low",
  });
  const updated = await handleCalendarUserApi(context);
  assert.equal(updated.data.item.title, "复习算法");
  assert.equal(updated.data.item.source, "exam");
  assert.equal(updated.data.item.examDate, "2026-06-02");
  assert.equal(updated.data.item.day, 5);
  assert.equal(updated.data.item.endSection, 6);
  assert.equal(updated.data.item.priorityLabel, "low");
  assert.deepEqual(updated.data.item.tags, ["重点", "期末"]);
  assert.equal(store.auditLogs.at(-1).action, "personal_event_update");

  context.path = `calendar/me/personal-events/${eventId}/done`;
  context.method = "POST";
  const done = await handleCalendarUserApi(context);
  assert.ok(done.data.item.tags.includes("done"));
  assert.equal(store.auditLogs.at(-1).action, "personal_event_done");

  context.path = `calendar/me/personal-events/${eventId}/delete`;
  const archived = await handleCalendarUserApi(context);
  assert.ok(archived.data.item.tags.includes("archived"));
  assert.equal(archived.data.item.tags.includes("done"), false);
  assert.equal(store.auditLogs.at(-1).action, "personal_event_archive");

  context.method = "GET";
  context.path = "calendar/me/personal-events";
  context.query = {};
  const visible = await handleCalendarUserApi(context);
  assert.equal(visible.data.total, 0);

  context.query = { includeArchived: "true" };
  const withArchived = await handleCalendarUserApi(context);
  assert.equal(withArchived.data.total, 1);
  assert.equal(withArchived.data.items[0].id, eventId);
});

test("rejects invalid or foreign personal calendar events", async () => {
  const handler = await loadCalendarUserHandler();
  const store = createStore();
  const ownerContext = createContext(handler, {
    store,
    method: "POST",
    path: "calendar/me/personal-events",
    body: { title: "个人事项" },
  });
  const created = await ownerContext.handleCalendarUserApi(ownerContext.context);
  const eventId = created.data.item.id;

  ownerContext.context.method = "PATCH";
  ownerContext.context.path = `calendar/me/personal-events/${eventId}`;
  ownerContext.context.readJsonBody = async () => ({ title: "   " });
  await assert.rejects(
    () => ownerContext.handleCalendarUserApi(ownerContext.context),
    (error) => error.statusCode === 400 && error.code === "PERSONAL_EVENT_TITLE_REQUIRED",
  );

  const otherContext = createContext(handler, {
    store,
    user: store.users[1],
    method: "POST",
    path: `calendar/me/personal-events/${eventId}/done`,
  });
  await assert.rejects(
    () => otherContext.handleCalendarUserApi(otherContext.context),
    (error) => error.statusCode === 404 && error.code === "PERSONAL_EVENT_NOT_FOUND",
  );

  otherContext.context.path = "calendar/me/personal-events/missing/delete";
  await assert.rejects(
    () => otherContext.handleCalendarUserApi(otherContext.context),
    (error) => error.statusCode === 404 && error.code === "PERSONAL_EVENT_NOT_FOUND",
  );
});

test("ignores unrelated routes", async () => {
  const handler = await loadCalendarUserHandler();
  const { context, handleCalendarUserApi } = createContext(handler, { path: "calendar/me/notification-bindings" });

  assert.equal(handler.isCalendarUserPath("calendar/sources"), true);
  assert.equal(handler.isCalendarUserPath("calendar/me/personal-events"), true);
  assert.equal(handler.isCalendarUserPath("calendar/me/notification-bindings"), false);
  assert.equal(await handleCalendarUserApi(context), null);
});
