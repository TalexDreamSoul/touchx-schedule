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
  const tmpDir = mkdtempSync(join(tmpdir(), "touchx-clawdbot-"));
  const tmpFile = join(tmpDir, fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadClawDBotModule = async () => {
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
      ["from \"h3\";", "from \"data:text/javascript,export const getHeader=(event,name)=>event.headers?.[String(name).toLowerCase()]||'';export const getRequestURL=(event)=>new URL(event.url||'http://127.0.0.1/api/v1/bot/clawdbot/webhook');\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildScheduleCandidateDrafts=(text)=>[{title:String(text).includes('数据结构')?'复习数据结构':'日程候选',description:String(text),day:3,startSection:7,endSection:8,weekExpr:'1-18',parity:'all',tags:['ai'],priorityScore:70,priorityLabel:'normal',examLike:false}];export const buildScheduleIntelligence=(text)=>({summary:String(text)});\""],
    ],
  );
  const legacyAiSchedulePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-ai-schedule-handler.ts"),
    "legacy-ai-schedule-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../services/social-collaboration-core\"", "\"data:text/javascript,export const buildScheduleCandidateDrafts=(text)=>[{title:String(text).includes('数据结构')?'复习数据结构':'日程候选',description:String(text),day:3,startSection:7,endSection:8,weekExpr:'1-18',parity:'all',tags:['ai'],priorityScore:70,priorityLabel:'normal',examLike:false}];export const buildScheduleIntelligence=(text)=>({examLike:false,repeatWeekdays:[1],suggestedStartSection:1,suggestedEndSection:1,tags:['ai'],priorityScore:70,priorityLabel:'normal'});\""],
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
        "const createError = (payload) => { const error = new Error(payload?.statusMessage || payload?.message || 'h3 error'); Object.assign(error, payload); throw error; }; const getRequestURL = (event) => new URL(event.url || 'http://127.0.0.1/api/v1/bot/clawdbot/webhook');",
      ],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"../../utils/api-envelope\"", "\"data:text/javascript,export const getBearerToken=()=>'';export const normalizeRoutePath=(event)=>{const p=new URL(event.url||'http://127.0.0.1/api/v1/').pathname;if(p==='/api/v1')return '';if(p.startsWith('/api/v1/'))return p.slice('/api/v1/'.length);return p.startsWith('/')?p.slice(1):p};export const resolveSessionWithUser=()=>null;\""],
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
      ["import { getMethod, getQuery, setHeader, type H3Event } from \"h3\";", "const getMethod = (event) => event.method || 'GET'; const getQuery = (event) => event.query || {}; const setHeader = () => {};"],
      [
        "from \"../utils/api-envelope\";",
        "from \"data:text/javascript,export const getBearerToken=()=>'';export const normalizeRoutePath=(event)=>{const p=new URL(event.url||'http://127.0.0.1/api/v1/').pathname;if(p==='/api/v1')return '';if(p.startsWith('/api/v1/'))return p.slice('/api/v1/'.length);return p.startsWith('/')?p.slice(1):p};export const readJsonBody=async(event)=>event.body||{};export const resolveSessionWithUser=()=>null;\";",
      ],
      ["from \"../utils/media-storage\";", "from \"data:text/javascript,export const buildR2MediaId=()=>'';export const resolveImageExtension=()=>'';export const resolveImageMimeType=()=>'';export const resolveMediaBucket=()=>null;\";"],
      ["from \"../utils/session-token\";", "from \"data:text/javascript,export const createSignedSession=()=>'';\";"],
      ["from \"./food-utils\";", "from \"data:text/javascript,export const estimateFoodCaloriesKcal=()=>0;export const normalizeCaloriesKcal=(v,f=0)=>Number(v||f||0);export const resolveExerciseEquivalentMinutes=()=>0;\";"],
      ["from \"./social-collaboration-core\";", "from \"data:text/javascript,export const buildActivitySplitDraft=()=>({});export const buildActivitySnapshotPosterSvg=()=>'';export const buildExamCountdownState=()=>({});export const buildScheduleCandidateDrafts=(text)=>[{title:String(text).includes('数据结构')?'复习数据结构':'日程候选',description:String(text),day:3,startSection:7,endSection:8,weekExpr:'1-18',parity:'all',tags:['ai'],priorityScore:70,priorityLabel:'normal',examLike:false}];export const buildScheduleIntelligence=(text)=>({summary:String(text)});export const buildSocialRelationStatus=()=>({});export const canUseSocialAccess=()=>true;export const normalizeVisibilityScope=(v)=>v||'hidden';export const pickStrongerVisibilityScope=(a)=>a;export const resolveCalendarViewKey=()=>'';export const resolveEffectiveVisibilityScope=()=> 'detail';export const resolveNextActivityStatus=(v)=>v;export const sortDailyPriorityItems=(v)=>v;\";"],
    ],
  );
  return {
    domainStore: await import(pathToFileURL(domainStorePath).href),
    social: await import(pathToFileURL(socialPath).href),
  };
};

const createEvent = (body, headers = {}) => ({
  method: "POST",
  url: "http://worker.example.test/api/v1/bot/clawdbot/webhook",
  headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
  context: {
    cloudflare: {
      env: {
        TOUCHX_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
      },
    },
  },
  body,
});

test("ClawDBot webhook parses message and returns a text reply", async () => {
  const { domainStore, social } = await loadClawDBotModule();
  const store = domainStore.resetNexusStore();
  const student = store.users.find((item) => item.studentNo === "2305200101");
  assert.ok(student);

  const response = await social.handleSocialV1Api(createEvent(
    {
      studentNo: student.studentNo,
      text: "周三下午3点复习数据结构",
      nickname: "Claw同学",
    },
    { "x-clawdbot-webhook-token": "webhook-secret" },
  ));

  assert.equal(response.ok, true);
  assert.equal(response.webhook, true);
  assert.equal(response.channel, "wechat_clawdbot");
  assert.equal(response.committed, false);
  assert.match(response.reply.text.content, /复习数据结构/);
  assert.equal(response.candidates.length, 1);
  assert.equal(store.auditLogs[0].action, "clawdbot_webhook_message");
});

test("ClawDBot webhook can identify users by active notification binding and commit", async () => {
  const { domainStore, social } = await loadClawDBotModule();
  const store = domainStore.resetNexusStore();
  const student = store.users.find((item) => item.studentNo === "2305200101");
  assert.ok(student);
  store.userNotificationBindings.push({
    id: "bind_1",
    userId: student.userId,
    channelType: "wechat_clawdbot",
    externalUserId: "wx-open-1",
    externalOpenId: "wx-open-1",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const response = await social.handleSocialV1Api(createEvent(
    {
      sender: { openId: "wx-open-1" },
      message: { text: "周三下午3点复习数据结构" },
      commit: true,
    },
    { "x-clawdbot-webhook-token": "webhook-secret" },
  ));

  assert.equal(response.ok, true);
  assert.equal(response.committed, true);
  assert.ok(response.event?.id);
  assert.equal(store.userScheduleEvents.length, 1);
  assert.equal(store.userScheduleEvents[0].userId, student.userId);
});

test("ClawDBot webhook rejects invalid tokens", async () => {
  const { social } = await loadClawDBotModule();
  await assert.rejects(
    () => social.handleSocialV1Api(createEvent(
      { studentNo: "2305200101", text: "周三下午3点复习数据结构" },
      { "x-clawdbot-webhook-token": "bad-token" },
    )),
    /ClawDBot webhook token 无效/,
  );
});
