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
  const socialPath = transpileModuleToTemp(
    join(import.meta.dirname, "social-v1-api.ts"),
    "social-v1-api.mjs",
    [
      ["from \"./domain-store\";", `from ${JSON.stringify(pathToFileURL(domainStorePath).href)};`],
      ["from \"./schedule-calendar\";", `from ${JSON.stringify(pathToFileURL(calendarPath).href)};`],
      ["import { confirmScheduleImportPreviewEntries } from \"./schedule-import-service\";", "const confirmScheduleImportPreviewEntries = async () => ({});"],
      ["import { normalizeAiScheduleOcrPreview } from \"./schedule-import-preview\";", "const normalizeAiScheduleOcrPreview = () => ({});"],
      ["import { requestAiChatCompletion, resolveAiProviderConfig } from \"./ai-provider\";", "const requestAiChatCompletion = async () => ({}); const resolveAiProviderConfig = () => ({ enabled: false });"],
      [
        "import { createError, getHeader, getMethod, getQuery, getRequestURL, readMultipartFormData, setHeader, type H3Event } from \"h3\";",
        "const createError = (payload) => { const error = new Error(payload?.statusMessage || payload?.message || 'h3 error'); Object.assign(error, payload); throw error; }; const getHeader = (event, name) => event.headers?.[String(name).toLowerCase()] || ''; const getMethod = (event) => event.method || 'GET'; const getQuery = (event) => event.query || {}; const getRequestURL = (event) => new URL(event.url || 'http://127.0.0.1/api/v1/bot/clawdbot/webhook'); const readMultipartFormData = async () => []; const setHeader = () => {};",
      ],
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
