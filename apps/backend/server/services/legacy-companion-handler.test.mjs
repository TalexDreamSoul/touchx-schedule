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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-companion-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyCompanionHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-companion-handler.ts"),
    "legacy-companion-handler.mjs",
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
          export const SCHEDULE_DEFAULT_TIMEZONE = "Asia/Shanghai";
          export const SCHEDULE_TERM_META = { week1Monday: "2026-03-02", maxWeek: 25 };
          export const SCHEDULE_WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
          export const addDaysToDateKey = (dateKey, offsetDays) => {
            const date = new Date(dateKey + "T00:00:00.000Z");
            date.setUTCDate(date.getUTCDate() + offsetDays);
            return date.toISOString().slice(0, 10);
          };
          export const getEffectiveScheduleEntriesForUser = (store, user) => store.effectiveScheduleEntriesByUser?.[user.userId] || store.effectiveScheduleEntries || [];
          export const getSectionTimeBySection = (section) => [
            { section: 1, start: "08:00", end: "08:45" },
            { section: 2, start: "08:50", end: "09:35" },
            { section: 7, start: "16:25", end: "17:10" },
            { section: 8, start: "17:15", end: "18:00" },
          ].find((item) => item.section === section) || null;
          export const getUserReminderTimezone = () => "Asia/Shanghai";
          export const isScheduleEntryInWeek = () => true;
          export const resolveCurrentWeekForDate = () => 2;
          export const resolveScheduleClassDateContext = () => ({
            currentWeek: 2,
            weekday: 2,
            nowParts: { dateKey: "2026-06-01" },
          });
          export const toDateTimeParts = () => ({ year: 2026, month: 6, day: 1, hour: 9, minute: 0, dateKey: "2026-06-01" });
          export const zonedDateTimeToUtc = () => new Date(Date.now() + 60 * 60 * 1000);
        `))};`,
      ],
      [
        "from \"../../services/social-collaboration-core\";",
        `from ${JSON.stringify(dataModule(`
          const dateMs = (value) => Date.parse(String(value || "") + "T00:00:00.000Z");
          export const buildExamCountdownState = (examDate, todayDate) => {
            const examTs = dateMs(examDate);
            const todayTs = dateMs(todayDate);
            if (!Number.isFinite(examTs) || !Number.isFinite(todayTs)) return { daysRemaining: null, status: "unknown" };
            const daysRemaining = Math.ceil((examTs - todayTs) / 86400000);
            return { daysRemaining, status: daysRemaining < 0 ? "finished" : daysRemaining === 0 ? "today" : "upcoming" };
          };
          export const resolveCalendarViewKey = ({ tags, source, title }) => {
            const text = [...(Array.isArray(tags) ? tags : []), source, title].join(" ");
            if (/学习|考试|course|exam/.test(text)) return "learning";
            if (/社交|聚会|party|activity/.test(text)) return "social";
            return "personal";
          };
          export const sortDailyPriorityItems = (items) => [...items].sort((left, right) => Number(right.priorityScore || 0) - Number(left.priorityScore || 0));
        `))};`,
      ],
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

const createActivity = (overrides = {}) => ({
  id: "activity-1",
  title: "考后聚餐",
  activityType: "exam-after",
  status: "confirmed",
  createdByUserId: "user-1",
  participantUserIds: ["user-1", "user-2"],
  week: 2,
  day: 2,
  startSection: 7,
  endSection: 8,
  calendarToken: "calendar-token-1",
  metadata: {},
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
    }),
  ],
  effectiveScheduleEntries: [
    {
      id: "entry-1",
      day: 2,
      startSection: 1,
      endSection: 2,
      weekExpr: "2",
      parity: "all",
      courseName: "高数考试",
      classroom: "A101",
      teacher: "李老师",
      timezone: "Asia/Shanghai",
    },
  ],
  userScheduleEvents: [
    {
      id: "event-1",
      userId: "user-1",
      title: "英语考试",
      description: "闭卷",
      source: "exam",
      day: 2,
      startSection: 7,
      endSection: 8,
      weekExpr: "2",
      parity: "all",
      tags: ["考试"],
      priorityScore: 90,
      priorityLabel: "high",
      examDate: "2026-06-20",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "event-2",
      userId: "user-1",
      title: "社团报名",
      description: "补材料",
      source: "manual",
      day: 2,
      startSection: 7,
      endSection: 8,
      weekExpr: "2",
      parity: "all",
      tags: ["个人"],
      priorityScore: 40,
      priorityLabel: "normal",
      examDate: "",
      createdAt: now,
      updatedAt: now,
    },
  ],
  socialActivities: [
    createActivity(),
    createActivity({
      id: "activity-2",
      title: "晚饭聚会",
      activityType: "party",
      calendarToken: "calendar-token-2",
    }),
  ],
  socialActivityInvitations: [
    {
      id: "invite-1",
      activityId: "activity-1",
      inviterUserId: "user-1",
      inviteeUserId: "user-2",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      respondedAt: "",
    },
  ],
  scheduleCorrections: [],
});

const resolveUserDisplayLabel = (user) => user.name || user.nickname || user.studentNo || user.studentId || "未命名用户";

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const context = {
    event: { body: overrides.body || {} },
    method: overrides.method || "GET",
    path: overrides.path || "exams/companion",
    query: overrides.query || {},
    store,
    getStoreRevision: () => 23,
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ user }),
    resolveSocialActorUser: () => overrides.actor || user,
    findUserByStudentId: (targetStore, studentId) => targetStore.users.find((item) => item.studentId === studentId) || null,
    findUserByUserId: (targetStore, userId) => targetStore.users.find((item) => item.userId === userId) || null,
    resolveUserDisplayLabel,
    resolveMeaningfulUserName: resolveUserDisplayLabel,
  };
  return { context, store, handleLegacyCompanionApi: handler.handleLegacyCompanionApi };
};

test("handles exam companion countdowns and precreated activities", async () => {
  const handler = await loadLegacyCompanionHandler();
  const { context, handleLegacyCompanionApi } = createContext(handler);

  const response = await handleLegacyCompanionApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.countdowns[0].title, "高数考试");
  assert.equal(response.precreatedActivities[0].activityId, "activity-1");
  assert.equal(response.precreatedActivities[0].createdBy.name, "Alice");
  assert.equal(response.precreatedActivities[0].invitationStats.pending, 1);
});

test("builds calendar views across learning social and personal buckets", async () => {
  const handler = await loadLegacyCompanionHandler();
  const { context, handleLegacyCompanionApi } = createContext(handler, {
    path: "calendar/views",
    query: { week: "2" },
  });

  const response = await handleLegacyCompanionApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.week, 2);
  assert.equal(response.stateRevision, 23);
  assert.ok(response.views.find((item) => item.key === "learning").items.some((item) => item.title === "高数考试"));
  assert.ok(response.views.find((item) => item.key === "social").items.some((item) => item.title === "晚饭聚会"));
  assert.ok(response.views.find((item) => item.key === "personal").items.some((item) => item.title === "社团报名"));
});

test("records schedule import corrections", async () => {
  const handler = await loadLegacyCompanionHandler();
  const { context, store, handleLegacyCompanionApi } = createContext(handler, {
    method: "POST",
    path: "schedule-import/corrections",
    body: {
      jobId: "job-1",
      originalPayload: { courseName: "旧课程" },
      correctedPayload: { courseName: "新课程" },
    },
  });

  const response = await handleLegacyCompanionApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.correction.jobId, "job-1");
  assert.equal(response.stateRevision, 23);
  assert.equal(store.scheduleCorrections.length, 1);
  assert.deepEqual(store.scheduleCorrections[0].correctedPayload, { courseName: "新课程" });
});

test("returns today brief and theme image compatibility payloads", async () => {
  const handler = await loadLegacyCompanionHandler();
  const briefContext = createContext(handler, {
    path: "today-brief",
    query: { studentId: "student-1" },
  });

  const brief = await briefContext.handleLegacyCompanionApi(briefContext.context);

  assert.equal(brief.studentId, "student-1");
  assert.equal(brief.weekNo, 2);
  assert.equal(brief.dayLabel, "周二");
  assert.ok(brief.priorityItems.some((item) => item.title === "高数考试"));

  const themeContext = createContext(handler, { path: "theme-images" });
  const theme = await themeContext.handleLegacyCompanionApi(themeContext.context);
  assert.equal(theme.ok, true);
  assert.deepEqual(theme.images, {});
});

test("recognizes only companion compatibility paths", async () => {
  const handler = await loadLegacyCompanionHandler();
  const { context, handleLegacyCompanionApi } = createContext(handler, { path: "social/me" });

  assert.equal(handler.isLegacyCompanionPath("exams/companion"), true);
  assert.equal(handler.isLegacyCompanionPath("calendar/views"), true);
  assert.equal(handler.isLegacyCompanionPath("schedule-import/corrections"), true);
  assert.equal(handler.isLegacyCompanionPath("today-brief"), true);
  assert.equal(handler.isLegacyCompanionPath("theme-images"), true);
  assert.equal(handler.isLegacyCompanionPath("social/me"), false);
  assert.equal(await handleLegacyCompanionApi(context), null);
});
