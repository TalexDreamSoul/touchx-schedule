import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const esbuildBin = [
  "node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/bin/esbuild",
  "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild",
  "node_modules/.pnpm/esbuild@0.20.2/node_modules/esbuild/bin/esbuild",
  "node_modules/.pnpm/esbuild@0.18.20/node_modules/esbuild/bin/esbuild",
].map((item) => join(repoRoot, item)).find((item) => existsSync(item));

if (!esbuildBin) {
  throw new Error("esbuild binary is required to run calendar-core tests");
}

const outDir = "/tmp/touchx-calendar-core-test";
const outFile = join(outDir, "calendar-core.mjs");
await mkdir(outDir, { recursive: true });
execFileSync(esbuildBin, [
  join(repoRoot, "packages/calendar-core/src/index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${outFile}`,
], { stdio: "pipe" });

const core = await import(outFile);

const sourceEvent = {
  id: "event-1",
  sourceId: "source-1",
  versionId: "version-1",
  title: "高等数学",
  description: "",
  eventType: "course",
  location: "A101",
  teacherOrOwner: "王老师",
  recurrenceType: "weekly",
  weekday: 1,
  weekExpr: "1-18",
  parity: "all",
  startTime: "08:30",
  endTime: "10:05",
  startSection: 1,
  endSection: 2,
  tags: ["学习"],
  metadata: {},
};

test("applies latest user override and hides removed events", () => {
  const items = core.applyUserEventOverrides([sourceEvent], [
    {
      id: "override-old",
      userId: "user-1",
      sourceEventId: "event-1",
      action: "modify",
      title: "旧标题",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    {
      id: "override-new",
      userId: "user-1",
      sourceEventId: "event-1",
      action: "modify",
      title: "线性代数",
      location: "B202",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    },
  ], "user-1");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "线性代数");
  assert.equal(items[0].location, "B202");

  const hidden = core.applyUserEventOverrides([sourceEvent], [{
    id: "override-hide",
    userId: "user-1",
    sourceEventId: "event-1",
    action: "hide",
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
  }], "user-1");
  assert.deepEqual(hidden, []);
});

test("resolves effective events from active subscriptions and personal todos", () => {
  const items = core.resolveEffectiveCalendarEvents({
    sources: [{
      id: "source-1",
      type: "class_schedule",
      title: "软件工程课表",
      description: "",
      ownerType: "class",
      ownerId: "class-1",
      timezone: "Asia/Shanghai",
      visibility: "class_only",
      status: "published",
      currentVersionId: "version-1",
      createdBy: "admin",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }],
    sourceEvents: [sourceEvent],
    subscriptions: [{
      id: "sub-1",
      userId: "user-1",
      sourceId: "source-1",
      sourceVersionId: "version-1",
      followMode: "auto",
      status: "active",
      defaultReminderEnabled: true,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }],
    personalEvents: [{
      id: "todo-1",
      userId: "user-1",
      title: "提交实验",
      description: "",
      eventType: "todo",
      status: "pending",
      priority: "high",
      weekday: 1,
      startSection: 2,
      endSection: 2,
      tags: ["个人"],
      source: "manual",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "高等数学");
  assert.equal(items[1].title, "提交实验");
  assert.equal(items[0].metadata.sourceTitle, "软件工程课表");
});

test("expands weekly events and detects section conflicts", () => {
  const expanded = core.expandRecurringEvents([
    {
      id: "a",
      originType: "source",
      originId: "a",
      title: "A",
      description: "",
      eventType: "course",
      weekday: 1,
      weekExpr: "1-2",
      parity: "all",
      startSection: 1,
      endSection: 2,
      location: "A101",
      tags: [],
      reminderEnabled: true,
      overrideState: "none",
      metadata: {},
    },
    {
      id: "b",
      originType: "personal",
      originId: "b",
      title: "B",
      description: "",
      eventType: "todo",
      weekday: 1,
      weekExpr: "2",
      parity: "all",
      startSection: 2,
      endSection: 3,
      location: "",
      tags: [],
      reminderEnabled: true,
      overrideState: "none",
      metadata: {},
    },
  ], { week: 2, week1Monday: "2026-03-02" });
  assert.deepEqual(expanded.map((item) => item.date), ["2026-03-09", "2026-03-09"]);
  const conflicts = core.detectCalendarConflicts(expanded);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "warning");
});

test("resolves reminder candidates from matching rules", () => {
  const candidates = core.resolveReminderCandidates({
    userId: "user-1",
    now: new Date("2026-05-01T00:00:00.000Z"),
    events: [{
      id: "personal:todo-1",
      originType: "personal",
      originId: "todo-1",
      title: "提交实验",
      description: "",
      eventType: "todo",
      date: "2026-05-02",
      startTime: "10:00",
      location: "线上",
      tags: [],
      reminderEnabled: true,
      overrideState: "none",
      metadata: {},
    }],
    rules: [{
      id: "rule-1",
      targetType: "personal_event",
      targetId: "todo-1",
      enabled: true,
      offsetMinutes: 30,
      templateKey: "todo.reminder",
      channelStrategy: "primary_only",
      quietHoursRespect: true,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }],
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].scheduledAt, "2026-05-02T01:30:00.000Z");
  assert.equal(candidates[0].metadata.ruleId, "rule-1");
});
