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
    source = source.replace(needle, replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpDir = mkdtempSync(join(tmpdir(), "touchx-reminder-"));
  const tmpFile = join(tmpDir, fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadReminderModule = async () => {
  const sharedPath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/shared/src/index.ts"),
    "shared.mjs",
  );
  const calendarPath = transpileModuleToTemp(
    join(import.meta.dirname, "schedule-calendar.ts"),
    "schedule-calendar.mjs",
    [["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`]],
  );
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const socialPath = transpileModuleToTemp(
    join(import.meta.dirname, "social-v1-api.ts"),
    "social-v1-api.mjs",
    [
      ["from \"./domain-store\";", `from ${JSON.stringify(pathToFileURL(domainStorePath).href)};`],
      ["from \"./schedule-calendar\";", `from ${JSON.stringify(pathToFileURL(calendarPath).href)};`],
      ["import { confirmScheduleImportPreviewEntries } from \"./schedule-import-service\";", "const confirmScheduleImportPreviewEntries = async () => ({});"],
      ["import { normalizeAiScheduleOcrPreview } from \"./schedule-import-preview\";", "const normalizeAiScheduleOcrPreview = () => ({});"],
      ["import { requestAiChatCompletion, resolveAiProviderConfig } from \"./ai-provider\";", "const requestAiChatCompletion = async () => ({}); const resolveAiProviderConfig = () => ({ enabled: false });"],
      ["import { createError, getMethod, getQuery, getRequestURL, readMultipartFormData, setHeader, type H3Event } from \"h3\";", "const createError = (payload) => new Error(payload?.message || 'h3 error'); const getMethod = () => 'GET'; const getQuery = () => ({}); const getRequestURL = () => new URL('http://localhost/'); const readMultipartFormData = async () => []; const setHeader = () => {};"],
      ["from \"../utils/api-envelope\";", "from \"data:text/javascript,export const getBearerToken=()=>'';export const normalizeRoutePath=()=>'';export const readJsonBody=async()=>({});export const resolveSessionWithUser=()=>null;\";"],
      ["from \"../utils/media-storage\";", "from \"data:text/javascript,export const buildR2MediaId=()=>'';export const resolveImageExtension=()=>'';export const resolveImageMimeType=()=>'';export const resolveMediaBucket=()=>null;\";"],
      ["from \"../utils/session-token\";", "from \"data:text/javascript,export const createSignedSession=()=>'';\";"],
      ["from \"./food-utils\";", "from \"data:text/javascript,export const estimateFoodCaloriesKcal=()=>0;export const normalizeCaloriesKcal=()=>0;export const resolveExerciseEquivalentMinutes=()=>0;\";"],
      ["from \"./social-collaboration-core\";", "from \"data:text/javascript,export const buildActivitySplitDraft=()=>({});export const buildActivitySnapshotPosterSvg=()=>'';export const buildExamCountdownState=()=>({});export const buildScheduleCandidateDrafts=()=>[];export const buildScheduleIntelligence=()=>({});export const buildSocialRelationStatus=()=>({});export const canUseSocialAccess=()=>true;export const normalizeVisibilityScope=(v)=>v||'hidden';export const pickStrongerVisibilityScope=(a)=>a;export const resolveCalendarViewKey=()=>'';export const resolveEffectiveVisibilityScope=()=> 'detail';export const resolveNextActivityStatus=(v)=>v;export const sortDailyPriorityItems=(v)=>v;\";"],
    ],
  );
  const reminderPath = transpileModuleToTemp(
    join(import.meta.dirname, "reminder-delivery-service.ts"),
    "reminder-delivery-service.mjs",
    [
      ["from \"./domain-store\";", `from ${JSON.stringify(pathToFileURL(domainStorePath).href)};`],
      ["from \"./schedule-calendar\";", `from ${JSON.stringify(pathToFileURL(calendarPath).href)};`],
      ["from \"./social-v1-api\";", `from ${JSON.stringify(pathToFileURL(socialPath).href)};`],
      ["import type { H3Event } from \"h3\";", ""],
      ["import { getHeader } from \"h3\";", "const getHeader = () => '';"],
    ],
  );
  return {
    domainStore: await import(pathToFileURL(domainStorePath).href),
    reminder: await import(pathToFileURL(reminderPath).href),
  };
};

const createStore = (entry) => {
  const nowIso = "2026-04-01T00:00:00.000Z";
  return {
    users: [
      {
        userId: "user_1",
        studentNo: "2300000001",
        studentId: "student_1",
        name: "测试同学",
        classLabel: "测试班",
        nickname: "测试同学",
        avatarUrl: "",
        wallpaperUrl: "",
        classIds: ["class_1"],
        adminRole: "none",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    classes: [
      {
        id: "class_1",
        name: "测试班",
        ownerUserId: "user_1",
        timezone: "Asia/Shanghai",
        status: "active",
        activeJoinCode: "ABCDEFGH",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    classMembers: [
      {
        id: "member_1",
        classId: "class_1",
        userId: "user_1",
        classRole: "class_owner",
        joinedAt: nowIso,
      },
    ],
    schedules: [
      {
        id: "schedule_1",
        classId: "class_1",
        title: "测试班课表",
        description: "测试",
        publishedVersionNo: 1,
        createdByUserId: "user_1",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
    scheduleVersions: [
      {
        id: "schedule_version_1",
        scheduleId: "schedule_1",
        versionNo: 1,
        status: "published",
        entries: [entry],
        createdByUserId: "user_1",
        createdAt: nowIso,
      },
    ],
    scheduleSubscriptions: [
      {
        id: "schedule_sub_1",
        subscriberUserId: "user_1",
        sourceScheduleId: "schedule_1",
        baseVersionNo: 1,
        followMode: "following",
        createdAt: nowIso,
      },
    ],
    socialSubscriptionRequests: [],
    socialSubscriptionEdges: [],
    socialCircles: [],
    socialCircleMembers: [],
    socialActivities: [],
    socialActivityInvitations: [],
    socialNotifications: [],
    userScheduleEvents: [],
    scheduleCorrections: [],
    schedulePatches: [],
    scheduleConflicts: [],
    sessions: [],
    locationGrids: [],
    foodItems: [],
    foodCampaigns: [],
    foodCampaignVotes: [],
    foodPricingRules: [],
    foodPricingRuleVersions: [],
    foodPricingOverrideVersions: [],
    mediaAssets: [],
    botTemplates: [],
    botJobs: [],
    auditLogs: [],
    partyGameRooms: [],
    partyGameMembers: [],
    partyGameStates: [],
    partyGameEvents: [],
    partyGameHeartOpenWords: [],
  };
};

const createMemoryDb = () => {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (/INSERT OR IGNORE INTO schedule_reminder_deliveries/i.test(sql)) {
            const dedupeKey = String(this.values[2] || "");
            if (rows.some((row) => row.dedupeKey === dedupeKey)) {
              return { meta: { changes: 0 } };
            }
            rows.push({
              id: this.values[0],
              reminderType: this.values[1],
              dedupeKey,
              dueAt: this.values[3],
              recipientUserId: this.values[4],
              studentNo: this.values[5],
              templateKey: this.values[6],
              payload: JSON.parse(String(this.values[7] || "{}")),
            });
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
      };
    },
  };
};

const runReminderCase = async ({ nowIso, entry }) => {
  const { domainStore, reminder } = await loadReminderModule();
  const db = createMemoryDb();
  const store = createStore(entry);
  const result = await domainStore.runWithNexusStoreScope({ store, revision: 1 }, () =>
    reminder.runReminderHeartbeat(db, {
      nowIso,
      timezone: "Asia/Shanghai",
      force: true,
    }),
  );
  return { result, rows: db.rows, reminder };
};

test("queues 13:30 pre-class reminder for afternoon classes before holidays", async () => {
  const { result, rows, reminder } = await runReminderCase({
    nowIso: "2026-04-03T05:30:00.000Z",
    entry: {
      id: "entry_afternoon",
      day: 5,
      startSection: 5,
      endSection: 6,
      weekExpr: "1-25",
      parity: "all",
      courseName: "节前下午课",
      classroom: "10-101",
      teacher: "张老师",
    },
  });

  assert.equal(reminder.isDayBeforeScheduleHoliday("2026-04-03"), true);
  assert.equal(result.queuedCounts.preClassReminder, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.windowMinutes, 60);
  assert.equal(rows[0].dueAt, "2026-04-03T05:30:00.000Z");
});

test("does not apply holiday eve 60-minute window to morning classes", async () => {
  const { result, rows } = await runReminderCase({
    nowIso: "2026-04-03T01:30:00.000Z",
    entry: {
      id: "entry_morning",
      day: 5,
      startSection: 3,
      endSection: 4,
      weekExpr: "1-25",
      parity: "all",
      courseName: "节前上午课",
      classroom: "10-102",
      teacher: "李老师",
    },
  });

  assert.equal(result.queuedCounts.preClassReminder, 0);
  assert.equal(rows.length, 0);
});

test("keeps regular configured windows for normal afternoon classes", async () => {
  const { result, rows, reminder } = await runReminderCase({
    nowIso: "2026-04-10T06:00:00.000Z",
    entry: {
      id: "entry_regular",
      day: 5,
      startSection: 5,
      endSection: 6,
      weekExpr: "1-25",
      parity: "all",
      courseName: "普通下午课",
      classroom: "10-103",
      teacher: "王老师",
    },
  });

  assert.equal(reminder.isDayBeforeScheduleHoliday("2026-04-10"), false);
  assert.equal(result.queuedCounts.preClassReminder, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.windowMinutes, 30);
  assert.equal(rows[0].dueAt, "2026-04-10T06:00:00.000Z");
});
