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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-calendar-ics-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadCalendarIcsHandler = async () => {
  const h3Stub = [
    "export const setHeader = (event, name, value) => {",
    "  event.headers = { ...(event.headers || {}), [name]: value };",
    "};",
  ].join("\n");
  const scheduleCalendarStub = [
    "export const SCHEDULE_TERM_META = { week1Monday: '2026-03-02', maxWeek: 20 };",
    "export const addDaysToDateKey = (dateKey, days) => {",
    "  const date = new Date(`${dateKey}T00:00:00.000Z`);",
    "  date.setUTCDate(date.getUTCDate() + days);",
    "  return date.toISOString().slice(0, 10);",
    "};",
    "export const getSectionTimeBySection = (section) => ({ start: section === 1 ? '08:00' : '10:00', end: section === 1 ? '08:45' : '10:45' });",
    "export const zonedDateTimeToUtc = (dateKey, time) => new Date(`${dateKey}T${time}:00.000Z`);",
  ].join("\n");
  const scheduleServiceStub = [
    "export const getPublishedScheduleVersion = (store, scheduleId, versionNo) =>",
    "  store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo) || null;",
    "export const isPublishedScheduleVisibleToUser = (store, schedule, user) =>",
    "  schedule.visibility === 'public' || schedule.createdByUserId === user.userId || user.adminRole !== 'none';",
  ].join("\n");
  const effectiveCalendarStub = [
    "export const buildEffectiveCalendarForUser = (store, user, options) => ({",
    "  week: options.week || 1,",
    "  items: store.userScheduleEvents.map((item) => ({",
    "    id: item.id,",
    "    weekday: item.weekday,",
    "    startSection: item.startSection,",
    "    endSection: item.endSection,",
    "    weekExpr: item.weekExpr,",
    "    parity: item.parity,",
    "    title: item.title,",
    "    location: item.location,",
    "    metadata: item.metadata || {},",
    "  })),",
    "});",
  ].join("\n");
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/calendar-ics-service.ts"),
    "calendar-ics-service.mjs",
    [
      ["\"../../services/schedule-calendar\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(scheduleCalendarStub)}`)],
      ["\"../schedule/schedule-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(scheduleServiceStub)}`)],
      ["\"./effective-calendar-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(effectiveCalendarStub)}`)],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/calendar/calendar-ics-handler.ts"),
    "calendar-ics-handler.mjs",
    [
      ["from \"h3\";", `from ${JSON.stringify(`data:text/javascript,${encodeURIComponent(h3Stub)}`)};`],
      ["\"./calendar-ics-service\"", JSON.stringify(pathToFileURL(servicePath).href)],
    ],
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
  users: [createUser(), createUser({ userId: "admin-1", adminRole: "super_admin", studentNo: "999999" })],
  classes: [{ id: "class-1", name: "测试一班", ownerUserId: "admin-1", timezone: "Asia/Shanghai", status: "active", activeJoinCode: "JOIN123", createdAt: now, updatedAt: now }],
  schedules: [
    {
      id: "schedule-1",
      classId: "class-1",
      title: "主课表",
      description: "描述",
      publishedVersionNo: 1,
      createdByUserId: "user-1",
      visibility: "public",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "draft-schedule",
      classId: "class-1",
      title: "草稿课表",
      description: "",
      publishedVersionNo: 0,
      createdByUserId: "user-1",
      visibility: "public",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "private-schedule",
      classId: "class-1",
      title: "私有课表",
      description: "",
      publishedVersionNo: 1,
      createdByUserId: "other-user",
      visibility: "private",
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
      entries: [{ id: "entry-1", day: 1, startSection: 1, endSection: 2, weekExpr: "1-2", parity: "all", courseName: "软件,工程", classroom: "A101", teacher: "张老师" }],
      createdByUserId: "user-1",
      createdAt: now,
    },
    {
      id: "version-private",
      scheduleId: "private-schedule",
      versionNo: 1,
      status: "published",
      entries: [{ id: "entry-private", day: 1, startSection: 1, endSection: 1, weekExpr: "1", parity: "all", courseName: "私有课", classroom: "", teacher: "" }],
      createdByUserId: "other-user",
      createdAt: now,
    },
  ],
  userScheduleEvents: [
    {
      id: "event-1",
      weekday: 2,
      startSection: 1,
      endSection: 1,
      weekExpr: "1",
      parity: "all",
      title: "个人事项",
      location: "图书馆",
      metadata: { teacherOrOwner: "Alice" },
    },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const context = {
    event: { headers: {} },
    method: overrides.method || "GET",
    path: overrides.path || "calendar/me/ics",
    query: overrides.query || {},
    store,
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireUser: () => ({ user: overrides.user || store.users[0] }),
  };
  return { context, store, handleCalendarIcsApi: handler.handleCalendarIcsApi };
};

test("exports current user's effective calendar as ICS", async () => {
  const handler = await loadCalendarIcsHandler();
  const { context, handleCalendarIcsApi } = createContext(handler, { query: { week: "3" } });

  const content = await handleCalendarIcsApi(context);

  assert.match(content, /BEGIN:VCALENDAR/);
  assert.match(content, /SUMMARY:个人事项/);
  assert.match(content, /LOCATION:图书馆/);
  assert.equal(context.event.headers["content-type"], "text/calendar; charset=utf-8");
  assert.equal(context.event.headers["content-disposition"], 'attachment; filename="touchx-calendar.ics"');
});

test("exports published calendar sources and escapes ICS text", async () => {
  const handler = await loadCalendarIcsHandler();
  const { context, handleCalendarIcsApi } = createContext(handler, { path: "calendar/sources/schedule%3Aschedule-1/ics" });

  const content = await handleCalendarIcsApi(context);

  assert.match(content, /SUMMARY:软件\\,工程/);
  assert.match(content, /X-TX-WEEK:1/);
  assert.match(content, /X-TX-WEEK:2/);
  assert.equal(context.event.headers["content-disposition"], `attachment; filename="${encodeURIComponent("主课表")}.ics"`);
});

test("maps calendar source ICS errors", async () => {
  const handler = await loadCalendarIcsHandler();
  const missing = createContext(handler, { path: "calendar/sources/missing/ics" });
  await assert.rejects(() => missing.handleCalendarIcsApi(missing.context), {
    statusCode: 404,
    code: "CALENDAR_SOURCE_NOT_FOUND",
  });

  const forbidden = createContext(handler, { path: "calendar/sources/private-schedule/ics" });
  await assert.rejects(() => forbidden.handleCalendarIcsApi(forbidden.context), {
    statusCode: 403,
    code: "CALENDAR_SOURCE_FORBIDDEN",
  });

  const notPublished = createContext(handler, { path: "calendar/sources/draft-schedule/ics" });
  await assert.rejects(() => notPublished.handleCalendarIcsApi(notPublished.context), {
    statusCode: 400,
    code: "CALENDAR_SOURCE_NOT_PUBLISHED",
  });
});

test("exports schedule ICS and maps schedule errors", async () => {
  const handler = await loadCalendarIcsHandler();
  const { context, handleCalendarIcsApi } = createContext(handler, { path: "schedules/schedule-1/ics" });

  const content = await handleCalendarIcsApi(context);
  assert.match(content, /X-WR-CALNAME:主课表/);
  assert.match(content, /SUMMARY:软件\\,工程/);

  const missing = createContext(handler, { path: "schedules/missing/ics" });
  await assert.rejects(() => missing.handleCalendarIcsApi(missing.context), {
    statusCode: 404,
    code: "SCHEDULE_NOT_FOUND",
  });

  const notPublished = createContext(handler, { path: "schedules/draft-schedule/ics" });
  await assert.rejects(() => notPublished.handleCalendarIcsApi(notPublished.context), {
    statusCode: 400,
    code: "SCHEDULE_NOT_PUBLISHED",
  });
});

test("ignores unrelated paths", async () => {
  const handler = await loadCalendarIcsHandler();
  const { context, handleCalendarIcsApi } = createContext(handler, { path: "calendar/me/effective" });

  assert.equal(handler.isCalendarIcsPath("calendar/me/ics"), true);
  assert.equal(handler.isCalendarIcsPath("calendar/sources/source-1/ics"), true);
  assert.equal(handler.isCalendarIcsPath("schedules/schedule-1/ics"), true);
  assert.equal(handler.isCalendarIcsPath("calendar/me/effective"), false);
  assert.equal(await handleCalendarIcsApi(context), null);
});
