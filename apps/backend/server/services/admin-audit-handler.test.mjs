import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadAdminAuditHandler = async () => {
  const sourcePath = join(import.meta.dirname, "../modules/admin/admin-audit-handler.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-admin-audit-handler-")), "admin-audit-handler.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("paginates admin audit logs without mutating store", async () => {
  const handler = await loadAdminAuditHandler();
  const store = {
    auditLogs: Array.from({ length: 5 }, (_, index) => ({
      id: `audit-${index + 1}`,
      action: "test",
      actorUserId: "admin-1",
      payload: {},
      createdAt: "2026-05-18T00:00:00.000Z",
    })),
  };
  const response = await handler.handleAdminAuditApi({
    event: {},
    method: "GET",
    path: "admin/audit",
    query: { limit: "2", offset: "1" },
    store,
    ok: (data) => ({ ok: true, data }),
    requireAdmin: () => ({ user: { userId: "admin-1" } }),
  });

  assert.equal(response.data.total, 5);
  assert.equal(response.data.limit, 2);
  assert.equal(response.data.offset, 1);
  assert.deepEqual(response.data.items.map((item) => item.id), ["audit-2", "audit-3"]);
  assert.equal(store.auditLogs.length, 5);
});

test("ignores unrelated admin audit paths", async () => {
  const handler = await loadAdminAuditHandler();
  const response = await handler.handleAdminAuditApi({
    event: {},
    method: "GET",
    path: "admin/dashboard",
    query: {},
    store: { auditLogs: [] },
    ok: (data) => ({ ok: true, data }),
    requireAdmin: () => ({ user: { userId: "admin-1" } }),
  });

  assert.equal(handler.isAdminAuditPath("admin/audit"), true);
  assert.equal(handler.isAdminAuditPath("admin/audit/logs"), false);
  assert.equal(response, null);
});
