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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-runtime-utils-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyRuntimeUtils = async () => {
  const runtimePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-runtime-utils.ts"),
    "legacy-runtime-utils.mjs",
    [
      [
        "import { createError, getRequestURL, type H3Event } from \"h3\";",
        `import { createError, getRequestURL } from ${JSON.stringify(dataModule(`
          export const createError = (payload) => {
            const error = new Error(payload?.statusMessage || payload?.message || "h3 error");
            Object.assign(error, payload);
            throw error;
          };
          export const getRequestURL = (event) => new URL(event.url || "https://touchx.example/api/v1/social/me");
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
        "from \"../../utils/api-envelope\";",
        `from ${JSON.stringify(dataModule(`
          export const getBearerToken = (event) => event.token || "";
          export const normalizeRoutePath = (event) => event.routePath || "";
          export const resolveSessionWithUser = (event) => event.resolvedSession || null;
        `))};`,
      ],
      [
        "from \"../../utils/session-token\";",
        `from ${JSON.stringify(dataModule(`
          export const createSignedSession = (_event, user, role, ttlHours) => ({
            token: "session:" + user.userId + ":" + role + ":" + ttlHours,
            expiresAt: 1999999999999,
          });
        `))};`,
      ],
      [
        "from \"../../services/schedule-calendar\";",
        `from ${JSON.stringify(dataModule(`
          export const SCHEDULE_DEFAULT_TIMEZONE = "Asia/Shanghai";
          export const toDateTimeParts = () => ({ year: 2026, month: 6, day: 1, hour: 9, minute: 0, dateKey: "2026-06-01" });
        `))};`,
      ],
    ],
  );
  return import(pathToFileURL(runtimePath).href);
};

const createUser = () => ({
  userId: "user_1",
  studentNo: "2305200101",
  studentId: "student_1",
  name: "Alice",
  classLabel: "一班",
  nickname: "Alice",
  avatarUrl: "",
  wallpaperUrl: "",
  classIds: ["class_1"],
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: "2026-06-01T08:00:00.000Z",
  updatedAt: "2026-06-01T08:00:00.000Z",
});

test("resolves legacy auth context and sessions", async () => {
  const runtime = await loadLegacyRuntimeUtils();
  const user = createUser();
  const event = {
    token: "token_1",
    resolvedSession: { session: { token: "token_1", userId: user.userId }, user },
  };

  assert.deepEqual(runtime.resolveLegacyAuthContext(event), {
    token: "token_1",
    session: { token: "token_1", userId: user.userId },
    user,
  });
  assert.deepEqual(runtime.createLegacySession({}, user, "user", 336), {
    token: "session:user_1:user:336",
    expiresAt: 1999999999999,
  });
  const store = { sessions: [] };
  runtime.registerLegacySession(store, { token: "token_1", expiresAt: 1999999999999, role: "user" }, user);
  assert.equal(store.sessions.length, 1);
  assert.equal(store.sessions[0].userId, "user_1");
  runtime.revokeLegacySession(store, "token_1");
  assert.ok(store.sessions[0].revokedAt);

  assert.throws(
    () => runtime.resolveLegacyAuthContext({ token: "" }),
    (error) => error.statusCode === 401 && error.data?.code === "AUTH_MISSING",
  );
});

test("resolves env, urls, paths, audit records, and exam dates", async () => {
  const runtime = await loadLegacyRuntimeUtils();
  const event = {
    url: "https://touchx.example/api/v1/ai/attachments",
    routePath: "/ai/attachments",
    context: { cloudflare: { env: { TOUCHX_TEST_KEY: "from-event" } } },
  };
  const env = runtime.resolveCloudflareEnv(event);

  assert.equal(env.TOUCHX_TEST_KEY, "from-event");
  assert.equal(runtime.resolveAbsoluteRequestUrl(event, "/media/avatar.png"), "https://touchx.example/media/avatar.png");
  assert.equal(runtime.resolveAbsoluteRequestUrl(event, "https://cdn.example/a.png"), "https://cdn.example/a.png");
  assert.equal(runtime.resolveAbsoluteRequestUrl(event, "media/avatar.png"), "media/avatar.png");
  assert.equal(runtime.toLegacyPath(event), "ai/attachments");
  assert.equal(runtime.extractExamDateFromText("2026年6月20日期末考试"), "2026-06-20");
  assert.equal(runtime.extractExamDateFromText("6月21日考试"), "2026-06-21");
  assert.equal(runtime.extractExamDateFromText("普通聚会"), "");

  const store = { auditLogs: [] };
  runtime.appendLegacyAudit(store, "test_action", "user_1", { ok: true });
  assert.equal(store.auditLogs.length, 1);
  assert.equal(store.auditLogs[0].id, "audit_1");
  assert.equal(store.auditLogs[0].createdAt, "2026-06-01T08:00:00.000Z");
});
