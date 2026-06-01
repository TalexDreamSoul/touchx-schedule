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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-api-envelope-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2300000001",
  accountName: "alice@example.test",
  adminRole: "none",
  ...overrides,
});

const loadApiEnvelope = async (store) => {
  globalThis.__touchxApiEnvelopeStore = store;
  globalThis.useRuntimeConfig = () => ({
    sessionTokenSecret: "unit-test-secret",
    adminLoginPassword: "",
  });
  const h3Stub = dataModule(`
    export const createError = (payload) => {
      const error = new Error(payload?.statusMessage || "h3 error");
      Object.assign(error, payload);
      return error;
    };
    export const getHeader = (event, name) => event.headers?.[String(name).toLowerCase()] || event.headers?.[name] || "";
    export const getRequestURL = (event) => new URL(event.url || "https://touchx.example/api/v1/auth/me");
    export const readBody = async (event) => event.body || {};
  `);
  const domainStoreStub = dataModule(`
    export const getNexusStore = () => {
      const store = globalThis.__touchxApiEnvelopeStore;
      if (!Array.isArray(store.sessions)) {
        store.sessions = [];
      }
      return store;
    };
  `);
  const sessionPath = transpileModuleToTemp(
    join(import.meta.dirname, "../utils/session-token.ts"),
    "session-token.mjs",
    [["from \"h3\";", `from ${JSON.stringify(h3Stub)};`]],
  );
  const apiEnvelopePath = transpileModuleToTemp(
    join(import.meta.dirname, "../utils/api-envelope.ts"),
    "api-envelope.mjs",
    [
      ["from \"h3\";", `from ${JSON.stringify(h3Stub)};`],
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../services/domain-store\"", JSON.stringify(domainStoreStub)],
      ["\"./session-token\"", JSON.stringify(pathToFileURL(sessionPath).href)],
    ],
  );
  const [sessionToken, apiEnvelope] = await Promise.all([
    import(pathToFileURL(sessionPath).href),
    import(pathToFileURL(apiEnvelopePath).href),
  ]);
  return { sessionToken, apiEnvelope };
};

test("auth rejects revoked registered sessions while preserving unsigned-store compatibility", async () => {
  const user = createUser();
  const store = {
    users: [user],
  };
  const { sessionToken, apiEnvelope } = await loadApiEnvelope(store);
  const session = sessionToken.createSignedSession({}, user, "user", 1);
  const event = {
    headers: { authorization: `Bearer ${session.token}` },
  };

  const resolvedBeforeRegistration = apiEnvelope.requireUser(event);
  assert.equal(resolvedBeforeRegistration.user.userId, user.userId);

  store.sessions.push({
    ...session,
    revokedAt: "2026-06-01T08:00:00.000Z",
  });
  assert.throws(
    () => apiEnvelope.requireUser(event),
    (error) => error.statusCode === 401 && error.data?.error?.code === "AUTH_INVALID",
  );
});

test("admin auth rejects revoked registered admin sessions", async () => {
  const admin = createUser({
    userId: "admin-1",
    studentNo: "999999",
    accountName: "admin@example.test",
    adminRole: "operator",
  });
  const store = {
    users: [admin],
    sessions: [],
  };
  const { sessionToken, apiEnvelope } = await loadApiEnvelope(store);
  const session = sessionToken.createSignedSession({}, admin, "admin", 1);
  const event = {
    headers: { authorization: `Bearer ${session.token}` },
  };

  const resolvedAdmin = apiEnvelope.requireAdmin(event);
  assert.equal(resolvedAdmin.user.userId, admin.userId);

  store.sessions.push({
    ...session,
    revokedAt: "2026-06-01T08:00:00.000Z",
  });
  assert.throws(
    () => apiEnvelope.requireAdmin(event),
    (error) => error.statusCode === 401 && error.data?.error?.code === "ADMIN_AUTH_INVALID",
  );
});
