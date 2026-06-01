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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-clawdbot-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyClawDBotHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-clawdbot-handler.ts"),
    "legacy-clawdbot-handler.mjs",
    [
      ["from \"h3\";", "from \"data:text/javascript,export const getHeader=(event,name)=>event.headers?.[String(name).toLowerCase()]||'';export const getRequestURL=(event)=>new URL(event.url||'http://127.0.0.1/api/v1/bot/clawdbot/simulate');\";"],
      ["from \"../../services/domain-store\";", "from \"data:text/javascript,export const storeHelpers={createId:(prefix)=>prefix+'_1',nowIso:()=> '2026-06-01T08:00:00.000Z'};\";"],
      ["from \"../../services/social-collaboration-core\";", "from \"data:text/javascript,export const buildScheduleCandidateDrafts=(text)=>[{title:String(text).includes('数据结构')?'复习数据结构':'日程候选',description:String(text),day:3,startSection:7,endSection:8,weekExpr:'1-18',parity:'all',tags:['ai'],priorityScore:70,priorityLabel:'normal',examLike:false}];export const buildScheduleIntelligence=(text)=>({summary:String(text)});\";"],
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
  classLabel: "",
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

const createStore = () => ({
  users: [createUser()],
  userScheduleEvents: [],
  userNotificationBindings: [
    {
      id: "bind-1",
      userId: "user-1",
      channelType: "wechat_clawdbot",
      externalUserId: "wx-open-1",
      externalOpenId: "wx-open-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ],
  auditLogs: [],
});

const normalizeHeaders = (headers = {}) => Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const context = {
    event: {
      method: "POST",
      url: overrides.url || "http://127.0.0.1/api/v1/bot/clawdbot/simulate",
      headers: normalizeHeaders(overrides.headers),
      body: overrides.body || {},
    },
    method: "POST",
    path: overrides.path || "bot/clawdbot/simulate",
    store,
    getStoreRevision: () => 7,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    resolveEnv: () => overrides.env || { TOUCHX_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret", TOUCHX_CLAWDBOT_SIM_TOKEN: "sim-secret" },
    findUserByStudentNo: (targetStore, studentNo) => targetStore.users.find((item) => item.studentNo === studentNo) || null,
    findClawDBotUser: (targetStore, identity) => {
      const values = [identity.openId, identity.unionId, identity.externalUserId].filter(Boolean);
      const binding = targetStore.userNotificationBindings.find((item) => values.includes(item.externalUserId) || values.includes(item.externalOpenId));
      return binding ? targetStore.users.find((item) => item.userId === binding.userId) || null : null;
    },
    createClawDBotUser: (targetStore, studentNo, nickname = "") => {
      const user = createUser({
        userId: "user-created",
        studentNo,
        studentId: "",
        nickname: nickname || `ClawDBot ${studentNo}`,
      });
      targetStore.users.push(user);
      return user;
    },
    toLegacyAuthUser: (user) => ({ studentNo: user.studentNo, nickname: user.nickname }),
    buildConflictPayload: () => ({ conflicts: [], alternatives: [] }),
    extractExamDate: () => "",
    appendAudit: (targetStore, action, actorUserId, payload) => targetStore.auditLogs.push({ action, actorUserId, payload }),
  };
  return { context, store, handleLegacyClawDBotApi: handler.handleLegacyClawDBotApi };
};

test("simulates ClawDBot locally and creates missing student users", async () => {
  const handler = await loadLegacyClawDBotHandler();
  const { context, store, handleLegacyClawDBotApi } = createContext(handler, {
    body: { text: "周三下午3点复习数据结构", studentNo: "2305999999", nickname: "新同学" },
  });

  const response = await handleLegacyClawDBotApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.channel, "wechat_clawdbot");
  assert.equal(response.candidates[0].title, "复习数据结构");
  assert.equal(response.stateRevision, 7);
  assert.equal(store.users.some((item) => item.studentNo === "2305999999"), true);
});

test("requires a token for non-local ClawDBot simulation", async () => {
  const handler = await loadLegacyClawDBotHandler();
  const { context, handleLegacyClawDBotApi } = createContext(handler, {
    url: "https://worker.example.test/api/v1/bot/clawdbot/simulate",
    body: { text: "周三下午3点复习数据结构", studentNo: "2305200101" },
    headers: { "x-clawdbot-sim-token": "bad-token" },
  });

  await assert.rejects(() => handleLegacyClawDBotApi(context), {
    statusCode: 401,
    code: "CLAWDBOT_SIM_TOKEN_REQUIRED",
  });
});

test("handles ClawDBot webhook identity lookup and commit", async () => {
  const handler = await loadLegacyClawDBotHandler();
  const { context, store, handleLegacyClawDBotApi } = createContext(handler, {
    path: "bot/clawdbot/webhook",
    url: "https://worker.example.test/api/v1/bot/clawdbot/webhook",
    headers: { "x-clawdbot-webhook-token": "webhook-secret" },
    body: {
      sender: { openId: "wx-open-1" },
      message: { text: "周三下午3点复习数据结构" },
      commit: true,
    },
  });

  const response = await handleLegacyClawDBotApi(context);

  assert.equal(response.webhook, true);
  assert.equal(response.committed, true);
  assert.equal(store.userScheduleEvents.length, 1);
  assert.equal(store.auditLogs[0].action, "clawdbot_webhook_message");
});

test("rejects invalid ClawDBot webhook tokens", async () => {
  const handler = await loadLegacyClawDBotHandler();
  const { context, handleLegacyClawDBotApi } = createContext(handler, {
    path: "bot/clawdbot/webhook",
    url: "https://worker.example.test/api/v1/bot/clawdbot/webhook",
    headers: { "x-clawdbot-webhook-token": "bad-token" },
    body: { studentNo: "2305200101", text: "周三下午3点复习数据结构" },
  });

  await assert.rejects(() => handleLegacyClawDBotApi(context), {
    statusCode: 401,
    code: "CLAWDBOT_WEBHOOK_TOKEN_INVALID",
  });
});

test("ignores unrelated legacy ClawDBot paths", async () => {
  const handler = await loadLegacyClawDBotHandler();
  const { context, handleLegacyClawDBotApi } = createContext(handler, {
    path: "bot/templates",
  });

  assert.equal(handler.isLegacyClawDBotPath("bot/clawdbot/simulate"), true);
  assert.equal(handler.isLegacyClawDBotPath("bot/clawdbot/webhook"), true);
  assert.equal(handler.isLegacyClawDBotPath("bot/templates"), false);
  assert.equal(await handleLegacyClawDBotApi(context), null);
});
