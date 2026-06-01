import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadDevHandler = async () => {
  const sourcePath = join(import.meta.dirname, "../modules/dev/dev-handler.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-dev-handler-")), "dev-handler.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("resets store behind admin guard and records audit", async () => {
  const handler = await loadDevHandler();
  const audits = [];
  const response = await handler.handleDevApi({
    event: {},
    method: "POST",
    path: "dev/reset-store",
    ok: (data) => ({ ok: true, data }),
    requireAdmin: () => ({ user: { userId: "admin-1" } }),
    resetStore: () => ({ users: [{ userId: "user-1" }, { userId: "user-2" }] }),
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
  });

  assert.deepEqual(response.data, { reset: true, users: 2 });
  assert.deepEqual(audits, [
    {
      action: "dev_reset_store",
      actorUserId: "admin-1",
      payload: { userCount: 2 },
    },
  ]);
});

test("ignores unrelated dev paths", async () => {
  const handler = await loadDevHandler();
  const response = await handler.handleDevApi({
    event: {},
    method: "POST",
    path: "dev/seed",
    ok: (data) => ({ ok: true, data }),
    requireAdmin: () => ({ user: { userId: "admin-1" } }),
    resetStore: () => ({ users: [] }),
    appendAudit: () => {},
  });

  assert.equal(handler.isDevPath("dev/reset-store"), true);
  assert.equal(handler.isDevPath("dev/seed"), false);
  assert.equal(response, null);
});
