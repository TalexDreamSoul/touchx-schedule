import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadAdminDashboardModule = async () => {
  const sourcePath = join(import.meta.dirname, "../modules/admin/dashboard-service.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-admin-dashboard-")), "dashboard-service.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

const createStore = () => {
  const auditLogs = Array.from({ length: 10 }, (_, index) => ({
    id: `audit-${index + 1}`,
    action: "test_action",
    actorUserId: "admin-1",
    payload: { index },
    createdAt: `2026-05-18T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));
  const notificationDeliveries = [
    { id: "delivery-pending-1", status: "pending" },
    { id: "delivery-sent-1", status: "sent" },
    { id: "delivery-failed-1", status: "failed" },
    { id: "delivery-pending-2", status: "pending" },
    { id: "delivery-cancelled-1", status: "cancelled" },
    { id: "delivery-failed-2", status: "failed" },
    { id: "delivery-sending-1", status: "sending" },
    { id: "delivery-sent-2", status: "sent" },
    { id: "delivery-pending-3", status: "pending" },
  ];
  return {
    users: [{ userId: "user-1" }, { userId: "user-2" }],
    classes: [{ id: "class-1" }],
    schedules: [
      { id: "schedule-1", publishedVersionNo: 1 },
      { id: "schedule-2", publishedVersionNo: 0 },
      { id: "schedule-3", publishedVersionNo: 3 },
    ],
    userScheduleEvents: [{ id: "event-1" }, { id: "event-2" }],
    notificationChannels: [{ id: "channel-1" }, { id: "channel-2" }],
    notificationDeliveries,
    importJobs: [{ id: "job-1" }, { id: "job-2" }],
    importCandidateEvents: [
      { id: "candidate-1", status: "pending" },
      { id: "candidate-2", status: "accepted" },
      { id: "candidate-3", status: "pending" },
    ],
    auditLogs,
  };
};

test("builds admin dashboard stats from store state", async () => {
  const { buildAdminDashboard } = await loadAdminDashboardModule();
  const dashboard = buildAdminDashboard(createStore());

  assert.deepEqual(dashboard.stats, {
    users: 2,
    classes: 1,
    calendarSources: 3,
    publishedCalendarSources: 2,
    personalEvents: 2,
    notificationChannels: 2,
    pendingDeliveries: 3,
    failedDeliveries: 2,
    importJobs: 2,
    pendingImports: 2,
    auditLogs: 10,
  });
});

test("limits recent dashboard lists without reordering the store", async () => {
  const { buildAdminDashboard } = await loadAdminDashboardModule();
  const store = createStore();
  const dashboard = buildAdminDashboard(store);

  assert.equal(dashboard.recentAuditLogs.length, 8);
  assert.equal(dashboard.recentDeliveries.length, 8);
  assert.deepEqual(dashboard.recentAuditLogs.map((item) => item.id), store.auditLogs.slice(0, 8).map((item) => item.id));
  assert.deepEqual(dashboard.recentDeliveries.map((item) => item.id), store.notificationDeliveries.slice(0, 8).map((item) => item.id));
  assert.equal(store.auditLogs.length, 10);
  assert.equal(store.notificationDeliveries.length, 9);
});
