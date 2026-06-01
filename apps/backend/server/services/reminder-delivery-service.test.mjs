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
  const tmpDir = mkdtempSync(join(tmpdir(), "touchx-reminder-"));
  const tmpFile = join(tmpDir, fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadReminderModule = async () => {
  const sharedPath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/shared/src/index.ts"),
    "shared.mjs",
    [
      ["export * from \"./calendar\";", ""],
      ["export * from \"./notification\";", ""],
      ["export * from \"./import\";", ""],
    ],
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
  const legacyNotificationPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-notification-handler.ts"),
    "legacy-notification-handler.mjs",
    [["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)]],
  );
  const legacyAccountPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-account-handler.ts"),
    "legacy-account-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-calendar\"", JSON.stringify(pathToFileURL(calendarPath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,\""],
    ],
  );
  const legacyClawDBotPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-clawdbot-handler.ts"),
    "legacy-clawdbot-handler.mjs",
    [
      ["from \"h3\";", "from \"data:text/javascript,export const getHeader=()=>'';export const getRequestURL=()=>new URL('http://localhost/');\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildScheduleCandidateDrafts=()=>[];export const buildScheduleIntelligence=()=>({});\""],
    ],
  );
  const legacyAiSchedulePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-ai-schedule-handler.ts"),
    "legacy-ai-schedule-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildScheduleCandidateDrafts=()=>[];export const buildScheduleIntelligence=()=>({examLike:false,repeatWeekdays:[1],suggestedStartSection:1,suggestedEndSection:1,tags:['ai'],priorityScore:0,priorityLabel:'normal'});\""],
      ["\"../../services/ai-provider\"", "\"data:text/javascript,export const requestAiChatCompletion=async()=>'';export const resolveAiProviderConfig=()=>({enabled:false,reason:'AI_PROVIDER_DISABLED'});\""],
      ["\"../../services/schedule-import-service\"", "\"data:text/javascript,export const confirmScheduleImportPreviewEntries=async()=>({});\""],
      ["\"../../services/schedule-import-preview\"", "\"data:text/javascript,export const normalizeAiScheduleOcrPreview=()=>({previewEntries:[]});\""],
    ],
  );
  const legacyCirclePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-circle-handler.ts"),
    "legacy-circle-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"@touchx/shared\"", "\"data:text/javascript,\""],
    ],
  );
  const legacySocialRelationPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-social-relation-handler.ts"),
    "legacy-social-relation-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildSocialRelationStatus=()=>({});export const normalizeVisibilityScope=(v)=>v||'hidden';export const pickStrongerVisibilityScope=(a)=>a;export const resolveEffectiveVisibilityScope=()=> 'detail';\""],
      ["\"./legacy-circle-handler\"", JSON.stringify(pathToFileURL(legacyCirclePath).href)],
    ],
  );
  const legacySocialActivityPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-social-activity-handler.ts"),
    "legacy-social-activity-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildActivitySplitDraft=()=>({});export const buildActivitySnapshotPosterSvg=()=>'';export const canUseSocialAccess=()=>true;export const resolveNextActivityStatus=(v)=>v;\""],
    ],
  );
  const legacyFoodCandidatePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-food-candidate-handler.ts"),
    "legacy-food-candidate-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/food-utils\"", "\"data:text/javascript,export const estimateFoodCaloriesKcal=()=>0;export const normalizeCaloriesKcal=(v,f=0)=>Number(v||f||0);export const resolveExerciseEquivalentMinutes=()=>0;\""],
    ],
  );
  const legacyFoodCampaignPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-food-campaign-handler.ts"),
    "legacy-food-campaign-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/food-utils\"", "\"data:text/javascript,export const normalizeCaloriesKcal=(v,f=0)=>Number(v||f||0);export const resolveExerciseEquivalentMinutes=()=>0;\""],
    ],
  );
  const legacyUploadPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-upload-handler.ts"),
    "legacy-upload-handler.mjs",
    [
      ["from \"h3\";", "from \"data:text/javascript,export const readMultipartFormData=async(event)=>event.multipartFormData||[];\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["from \"../../utils/media-storage\";", "from \"data:text/javascript,export const buildR2MediaId=()=>'';export const resolveImageExtension=()=>'';export const resolveImageMimeType=()=>'';export const resolveMediaBucket=()=>null;\";"],
    ],
  );
  const legacyCompanionPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-companion-handler.ts"),
    "legacy-companion-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-calendar\"", JSON.stringify(pathToFileURL(calendarPath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildExamCountdownState=()=>({daysRemaining:null,status:'unknown'});export const resolveCalendarViewKey=()=> 'personal';export const sortDailyPriorityItems=(v)=>v;\""],
    ],
  );
  const legacyStatePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-state.ts"),
    "legacy-state.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/food-utils\"", "\"data:text/javascript,export const normalizeCaloriesKcal=(v,f=0)=>Number(v||f||0);\""],
    ],
  );
  const legacyUserUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-user-utils.ts"),
    "legacy-user-utils.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"./legacy-state\"", JSON.stringify(pathToFileURL(legacyStatePath).href)],
    ],
  );
  const legacySocialUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-social-utils.ts"),
    "legacy-social-utils.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/schedule-calendar\"", JSON.stringify(pathToFileURL(calendarPath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildSocialRelationStatus=()=>({});export const normalizeVisibilityScope=(v)=>v||'hidden';export const pickStrongerVisibilityScope=(a)=>a;export const resolveEffectiveVisibilityScope=()=> 'detail';\""],
      ["\"./legacy-state\"", JSON.stringify(pathToFileURL(legacyStatePath).href)],
      ["\"./legacy-user-utils\"", JSON.stringify(pathToFileURL(legacyUserUtilsPath).href)],
    ],
  );
  const legacyRuntimeUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-runtime-utils.ts"),
    "legacy-runtime-utils.mjs",
    [
      [
        "import { createError, getRequestURL, type H3Event } from \"h3\";",
        "const createError = (payload) => new Error(payload?.message || 'h3 error'); const getRequestURL = () => new URL('http://localhost/');",
      ],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../utils/api-envelope\"", "\"data:text/javascript,export const getBearerToken=()=>'';export const normalizeRoutePath=()=>'';export const resolveSessionWithUser=()=>null;\""],
      ["\"../../utils/session-token\"", "\"data:text/javascript,export const createSignedSession=()=>'';\""],
      ["\"../../services/schedule-calendar\"", JSON.stringify(pathToFileURL(calendarPath).href)],
    ],
  );
  const socialPath = transpileModuleToTemp(
    join(import.meta.dirname, "social-v1-api.ts"),
    "social-v1-api.mjs",
    [
      ["from \"./domain-store\";", `from ${JSON.stringify(pathToFileURL(domainStorePath).href)};`],
      ["\"../modules/legacy/legacy-account-handler\"", JSON.stringify(pathToFileURL(legacyAccountPath).href)],
      ["\"../modules/legacy/legacy-ai-schedule-handler\"", JSON.stringify(pathToFileURL(legacyAiSchedulePath).href)],
      ["\"../modules/legacy/legacy-clawdbot-handler\"", JSON.stringify(pathToFileURL(legacyClawDBotPath).href)],
      ["\"../modules/legacy/legacy-circle-handler\"", JSON.stringify(pathToFileURL(legacyCirclePath).href)],
      ["\"../modules/legacy/legacy-companion-handler\"", JSON.stringify(pathToFileURL(legacyCompanionPath).href)],
      ["\"../modules/legacy/legacy-food-campaign-handler\"", JSON.stringify(pathToFileURL(legacyFoodCampaignPath).href)],
      ["\"../modules/legacy/legacy-food-candidate-handler\"", JSON.stringify(pathToFileURL(legacyFoodCandidatePath).href)],
      ["\"../modules/legacy/legacy-notification-handler\"", JSON.stringify(pathToFileURL(legacyNotificationPath).href)],
      ["\"../modules/legacy/legacy-runtime-utils\"", JSON.stringify(pathToFileURL(legacyRuntimeUtilsPath).href)],
      ["\"../modules/legacy/legacy-social-utils\"", JSON.stringify(pathToFileURL(legacySocialUtilsPath).href)],
      ["\"../modules/legacy/legacy-social-activity-handler\"", JSON.stringify(pathToFileURL(legacySocialActivityPath).href)],
      ["\"../modules/legacy/legacy-social-relation-handler\"", JSON.stringify(pathToFileURL(legacySocialRelationPath).href)],
      ["\"../modules/legacy/legacy-state\"", JSON.stringify(pathToFileURL(legacyStatePath).href)],
      ["\"../modules/legacy/legacy-upload-handler\"", JSON.stringify(pathToFileURL(legacyUploadPath).href)],
      ["\"../modules/legacy/legacy-user-utils\"", JSON.stringify(pathToFileURL(legacyUserUtilsPath).href)],
      ["from \"./schedule-calendar\";", `from ${JSON.stringify(pathToFileURL(calendarPath).href)};`],
      ["import { getMethod, getQuery, setHeader, type H3Event } from \"h3\";", "const getMethod = () => 'GET'; const getQuery = () => ({}); const setHeader = () => {};"],
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
      ["from \"../modules/legacy/legacy-state\";", `from ${JSON.stringify(pathToFileURL(legacyStatePath).href)};`],
      ["from \"../modules/notification/notification-delivery-service\";", "from \"data:text/javascript,let seq=0;export const createNotificationDelivery=(store,input)=>{const now='2026-04-01T00:00:00.000Z';const item={id:`notification_delivery_${++seq}`,userId:input.userId,channelType:input.channelType,templateKey:input.templateKey||'manual',title:input.title,body:input.body,payload:input.payload||{},status:'pending',dedupeKey:input.dedupeKey,scheduledAt:input.scheduledAt||now,attemptCount:0,createdAt:now,updatedAt:now};store.notificationDeliveries.unshift(item);return item;};\";"],
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
    notificationChannels: [{ id: "channel_1", type: "wechat_clawdbot", name: "ClawDBot", enabled: true, config: {}, createdAt: nowIso, updatedAt: nowIso }],
    notificationDeliveries: [],
    reminderRules: [],
    userNotificationBindings: [],
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
      deliveryQueue: "legacy",
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

test("queues heartbeat reminders into notification deliveries when selected", async () => {
  const { domainStore, reminder } = await loadReminderModule();
  const db = createMemoryDb();
  const store = createStore({
    id: "entry_notification_queue",
    day: 5,
    startSection: 5,
    endSection: 6,
    weekExpr: "1-25",
    parity: "all",
    courseName: "通知队列课",
    classroom: "10-104",
    teacher: "赵老师",
  });
  const result = await domainStore.runWithNexusStoreScope({ store, revision: 1 }, () =>
    reminder.runReminderHeartbeat(db, {
      nowIso: "2026-04-10T06:00:00.000Z",
      timezone: "Asia/Shanghai",
      force: true,
      deliveryQueue: "notification",
    }),
  );

  assert.equal(result.queuedCounts.preClassReminder, 1);
  assert.equal(db.rows.length, 0);
  assert.equal(store.notificationDeliveries.length, 1);
  const delivery = store.notificationDeliveries[0];
  assert.equal(delivery.channelType, "wechat_clawdbot");
  assert.equal(delivery.templateKey, "pre_class_reminder");
  assert.equal(delivery.scheduledAt, "2026-04-10T06:00:00.000Z");
  assert.equal(delivery.payload.reminderType, "pre_class_reminder");
  assert.equal(delivery.payload.sourceQueue, "notification");
  assert.equal(delivery.payload.windowMinutes, 30);
});

test("queues heartbeat reminders into notification deliveries by default", async () => {
  const { domainStore, reminder } = await loadReminderModule();
  const db = createMemoryDb();
  const store = createStore({
    id: "entry_notification_default",
    day: 5,
    startSection: 5,
    endSection: 6,
    weekExpr: "1-25",
    parity: "all",
    courseName: "默认通知队列课",
    classroom: "10-105",
    teacher: "钱老师",
  });
  const result = await domainStore.runWithNexusStoreScope({ store, revision: 1 }, () =>
    reminder.runReminderHeartbeat(db, {
      nowIso: "2026-04-10T06:00:00.000Z",
      timezone: "Asia/Shanghai",
      force: true,
    }),
  );

  assert.equal(result.queuedCounts.preClassReminder, 1);
  assert.equal(db.rows.length, 0);
  assert.equal(store.notificationDeliveries.length, 1);
  assert.match(result.job.summary, /deliveryQueue=notification/);
  assert.equal(store.notificationDeliveries[0].payload.sourceQueue, "notification");
});
