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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-ai-schedule-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyAiScheduleHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-ai-schedule-handler.ts"),
    "legacy-ai-schedule-handler.mjs",
    [
      [
        "from \"../../services/social-collaboration-core\";",
        `from ${JSON.stringify(dataModule(`
          export const buildScheduleCandidateDrafts = (text) => [{
            title: String(text).includes("高数") ? "高数考试" : "日程候选",
            description: String(text),
            day: 2,
            startSection: 3,
            endSection: 4,
            weekExpr: "1-18",
            parity: "all",
            tags: ["exam"],
            priorityScore: 88,
            priorityLabel: "high",
            examLike: String(text).includes("考试"),
          }];
          export const buildScheduleIntelligence = (text) => ({
            examLike: String(text).includes("考试"),
            repeatWeekdays: [4],
            suggestedStartSection: 5,
            suggestedEndSection: 6,
            tags: String(text).includes("考试") ? ["exam"] : ["ai"],
            priorityScore: 86,
            priorityLabel: "high",
          });
        `))};`,
      ],
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
        "from \"../../services/ai-provider\";",
        `from ${JSON.stringify(dataModule(`
          export const resolveAiProviderConfig = (env) => env?.TOUCHX_AI_API_KEY
            ? { enabled: true, baseUrl: "https://ai.example.test", apiKey: "test-key", model: "test-model" }
            : { enabled: false, reason: "AI_PROVIDER_DISABLED" };
          export const requestAiChatCompletion = async () => "AI response";
        `))};`,
      ],
      [
        "from \"../../services/schedule-import-service\";",
        `from ${JSON.stringify(dataModule(`
          export const confirmScheduleImportPreviewEntries = async (_event, userId, input) => ({
            jobId: "import_job_1",
            userId,
            importedCount: input.previewEntries.length,
            previewEntries: input.previewEntries,
          });
        `))};`,
      ],
      [
        "from \"../../services/schedule-import-preview\";",
        `from ${JSON.stringify(dataModule(`
          export const normalizeAiScheduleOcrPreview = () => ({
            studentNo: "2305200101",
            term: "2025-2026-2",
            parsedName: "测试同学",
            previewEntries: [{
              courseName: "高等数学",
              weekday: 1,
              sections: [1, 2],
              weeks: "1-16",
              parity: "all",
              location: "A101",
              teacher: "李老师",
            }],
          });
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
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const context = {
    event: {
      method: overrides.method || "POST",
      url: overrides.url || "http://worker.example.test/api/v1/ai/schedule/parse",
      body: overrides.body || {},
    },
    method: overrides.method || "POST",
    path: overrides.path || "ai/schedule/parse",
    store,
    getStoreRevision: () => 9,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ user }),
    resolveEnv: () => overrides.env || {},
    resolveAbsoluteUrl: (_event, url) => new URL(url, "http://worker.example.test").href,
    buildConflictPayload: () => ({ conflicts: [{ eventId: "user_event_conflict" }], alternatives: [{ day: 3, startSection: 5, endSection: 6 }] }),
    extractExamDate: () => "2026-06-20",
  };
  return { context, store, handleLegacyAiScheduleApi: handler.handleLegacyAiScheduleApi };
};

test("recognizes legacy AI schedule paths without taking attachment uploads", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, { path: "ai/attachments" });

  assert.equal(handler.isLegacyAiSchedulePath("ai/chat"), true);
  assert.equal(handler.isLegacyAiSchedulePath("ai/schedule/ocr-preview"), true);
  assert.equal(handler.isLegacyAiSchedulePath("ai/schedule/ocr-confirm"), true);
  assert.equal(handler.isLegacyAiSchedulePath("ai/schedule/parse"), true);
  assert.equal(handler.isLegacyAiSchedulePath("ai/schedule/commit"), true);
  assert.equal(handler.isLegacyAiSchedulePath("ai/attachments"), false);
  assert.equal(await handleLegacyAiScheduleApi(context), null);
});

test("rejects empty schedule parse text", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    body: { text: "   " },
  });

  await assert.rejects(() => handleLegacyAiScheduleApi(context), {
    statusCode: 400,
    code: "AI_SCHEDULE_TEXT_REQUIRED",
  });
});

test("parses schedule text into candidates with exam date and conflicts", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    body: { text: "6月20日高数考试" },
  });

  const response = await handleLegacyAiScheduleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.provider, "rules");
  assert.equal(response.userId, "user-1");
  assert.equal(response.candidates[0].title, "高数考试");
  assert.equal(response.candidates[0].examDate, "2026-06-20");
  assert.equal(response.candidates[0].conflicts[0].eventId, "user_event_conflict");
});

test("commits an AI schedule event into the user schedule store", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, store, handleLegacyAiScheduleApi } = createContext(handler, {
    path: "ai/schedule/commit",
    body: { title: "高数考试", description: "6月20日闭卷考试", startSection: 7, endSection: 8 },
  });

  const response = await handleLegacyAiScheduleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.stateRevision, 9);
  assert.equal(store.userScheduleEvents.length, 1);
  assert.equal(response.event.title, "高数考试");
  assert.equal(response.event.source, "exam");
  assert.equal(response.event.day, 4);
  assert.equal(response.event.startSection, 7);
  assert.equal(response.event.endSection, 8);
  assert.equal(response.event.examDate, "2026-06-20");
});

test("reports unavailable AI chat provider configuration", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    path: "ai/chat",
    body: { text: "帮我看看日程" },
  });

  await assert.rejects(() => handleLegacyAiScheduleApi(context), {
    statusCode: 503,
    code: "AI_PROVIDER_DISABLED",
  });
});

test("returns AI chat cards when the provider is configured", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    path: "ai/chat",
    env: { TOUCHX_AI_API_KEY: "test-key" },
    body: { text: "6月20日高数考试" },
  });

  const response = await handleLegacyAiScheduleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.provider, "openai-compatible");
  assert.equal(response.message.content, "AI response");
  assert.equal(response.cards[0].type, "schedule_candidate");
  assert.equal(response.cards[0].candidate.examDate, "2026-06-20");
});

test("requires an OCR preview asset URL", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    path: "ai/schedule/ocr-preview",
    body: {},
  });

  await assert.rejects(() => handleLegacyAiScheduleApi(context), {
    statusCode: 400,
    code: "AI_OCR_ASSET_REQUIRED",
  });
});

test("normalizes OCR preview output when the provider is configured", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    path: "ai/schedule/ocr-preview",
    env: { TOUCHX_AI_API_KEY: "test-key" },
    body: { assetUrl: "/uploads/schedule.png", term: "2026-2027-1" },
  });

  const response = await handleLegacyAiScheduleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.assetUrl, "/uploads/schedule.png");
  assert.equal(response.studentNo, "2305200101");
  assert.equal(response.term, "2026-2027-1");
  assert.equal(response.previewEntries[0].courseName, "高等数学");
});

test("confirms OCR preview entries through the import service", async () => {
  const handler = await loadLegacyAiScheduleHandler();
  const { context, handleLegacyAiScheduleApi } = createContext(handler, {
    path: "ai/schedule/ocr-confirm",
    body: {
      term: "2025-2026-2",
      previewEntries: [{ courseName: "高等数学" }],
    },
  });

  const response = await handleLegacyAiScheduleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.jobId, "import_job_1");
  assert.equal(response.importedCount, 1);
  assert.equal(response.stateRevision, 9);
});
