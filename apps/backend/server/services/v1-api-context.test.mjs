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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-v1-api-context-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadV1ApiContext = async (store = { auditLogs: [] }) => {
  globalThis.__touchxV1ApiContextStore = store;
  const domainStoreStub = dataModule(`
    export const getNexusStore = () => globalThis.__touchxV1ApiContextStore;
    export const storeHelpers = {
      createId: (prefix) => prefix + "_unit",
      nowIso: () => "2026-06-08T00:00:00.000Z",
    };
  `);
  const contextPath = transpileModuleToTemp(
    join(import.meta.dirname, "v1-api-context.ts"),
    "v1-api-context.mjs",
    [["\"./domain-store\"", JSON.stringify(domainStoreStub)]],
  );
  return import(pathToFileURL(contextPath).href);
};

const createUser = (overrides = {}) => ({
  userId: "user-1",
  accountName: "alice@example.test",
  studentNo: "2300000001",
  studentId: "sid-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: ["class-1"],
  avatarUrl: "",
  wallpaperUrl: "",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
  ...overrides,
});

test("normalizeReminderOffsets copies fallback and bounds user values", async () => {
  const { normalizeReminderOffsets } = await loadV1ApiContext();
  const fallback = [45, 15];
  const copiedFallback = normalizeReminderOffsets("bad", fallback);

  assert.deepEqual(copiedFallback, fallback);
  assert.notEqual(copiedFallback, fallback);
  assert.deepEqual(
    normalizeReminderOffsets([15, "30.8", -1, 0, "bad", 15, 20160, 20161, 45, 60, 75, 90, 105, 120]),
    [15, 30, 0, 20160, 45, 60, 75, 90],
  );
});

test("toV1UserPayload prefers meaningful names over placeholder identity text", async () => {
  const { toV1UserPayload } = await loadV1ApiContext();

  assert.equal(toV1UserPayload(createUser({ name: "2300000001", nickname: "小陈" })).name, "小陈");
  assert.equal(toV1UserPayload(createUser({ name: "2300000001", nickname: "2300000002" })).name, "");
  assert.deepEqual(
    Object.keys(toV1UserPayload(createUser())).sort(),
    [
      "accountName",
      "adminRole",
      "avatarUrl",
      "classIds",
      "classLabel",
      "createdAt",
      "name",
      "nickname",
      "reminderEnabled",
      "reminderWindowMinutes",
      "studentId",
      "studentNo",
      "updatedAt",
      "userId",
      "wallpaperUrl",
    ].sort(),
  );
});

test("appendV1Audit prepends records and caps audit log length", async () => {
  const store = {
    auditLogs: Array.from({ length: 2000 }, (_, index) => ({
      id: `old-${index}`,
      action: "old",
      actorUserId: "user-old",
      payload: {},
      createdAt: "2026-06-07T00:00:00.000Z",
    })),
  };
  const { appendV1Audit } = await loadV1ApiContext(store);

  appendV1Audit("calendar_settings_update", "user-1", { reminderEnabled: true });

  assert.equal(store.auditLogs.length, 2000);
  assert.deepEqual(store.auditLogs[0], {
    id: "audit_unit",
    action: "calendar_settings_update",
    actorUserId: "user-1",
    payload: { reminderEnabled: true },
    createdAt: "2026-06-08T00:00:00.000Z",
  });
  assert.equal(store.auditLogs.at(-1).id, "old-1998");
});
