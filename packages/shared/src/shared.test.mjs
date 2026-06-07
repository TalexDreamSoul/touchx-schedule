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
  throw new Error("esbuild binary is required to run shared tests");
}

const outDir = "/tmp/touchx-shared-test";
const outFile = join(outDir, "shared.mjs");
await mkdir(outDir, { recursive: true });
execFileSync(esbuildBin, [
  join(repoRoot, "packages/shared/src/index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${outFile}`,
], { stdio: "pipe" });

const shared = await import(outFile);

const assertUnique = (items, label) => {
  assert.deepEqual([...new Set(items)], items, `${label} must not contain duplicates`);
};

test("calendar enums cover V1 source, event and personal event contracts", () => {
  assert.deepEqual(shared.CALENDAR_SOURCE_TYPES, [
    "class_schedule",
    "exam_schedule",
    "school_calendar",
    "club_activity",
    "organization_event",
    "public_calendar",
    "academic_system",
    "pdf_import",
    "manual_collection",
    "personal_template",
    "custom",
  ]);
  assert.deepEqual(shared.CALENDAR_EVENT_TYPES, ["course", "exam", "todo", "activity", "holiday", "deadline", "custom"]);
  assert.deepEqual(shared.CALENDAR_PARITIES, ["all", "odd", "even"]);
  assert.deepEqual(shared.CALENDAR_SUBSCRIPTION_STATUSES, ["active", "paused", "cancelled"]);
  assert.deepEqual(shared.USER_EVENT_OVERRIDE_ACTIONS, ["hide", "modify", "reminder_only"]);
  assert.deepEqual(shared.PERSONAL_EVENT_PRIORITIES, ["low", "normal", "high"]);
  [
    ["calendar source types", shared.CALENDAR_SOURCE_TYPES],
    ["calendar event types", shared.CALENDAR_EVENT_TYPES],
    ["personal event sources", shared.PERSONAL_EVENT_SOURCES],
  ].forEach(([label, items]) => assertUnique(items, label));
});

test("import and notification enums stay aligned with core package normalizers", () => {
  assert.deepEqual(shared.IMPORT_JOB_TYPES, ["pdf", "image", "academic_system", "text", "manual"]);
  assert.deepEqual(shared.IMPORT_JOB_STATUSES, ["uploaded", "parsing", "parsed", "reviewing", "committed", "failed"]);
  assert.deepEqual(shared.IMPORT_CANDIDATE_STATUSES, ["pending", "accepted", "rejected", "corrected"]);
  assert.deepEqual(shared.NOTIFICATION_CHANNEL_TYPES, ["wechat_clawdbot", "feishu"]);
  assert.deepEqual(shared.FEISHU_PROVIDER_TYPES, ["webhook_bot", "tenant_app"]);
  assert.deepEqual(shared.FEISHU_RECEIVE_ID_TYPES, ["open_id", "user_id", "union_id", "email", "chat_id"]);
  assert.deepEqual(shared.REMINDER_CHANNEL_STRATEGIES, ["both", "primary_then_fallback", "primary_only"]);
  assert.deepEqual(shared.NOTIFICATION_DELIVERY_STATUSES, ["pending", "sending", "sent", "failed", "cancelled"]);
  [
    ["import job statuses", shared.IMPORT_JOB_STATUSES],
    ["candidate statuses", shared.IMPORT_CANDIDATE_STATUSES],
    ["notification channel types", shared.NOTIFICATION_CHANNEL_TYPES],
    ["delivery statuses", shared.NOTIFICATION_DELIVERY_STATUSES],
  ].forEach(([label, items]) => assertUnique(items, label));
});

test("default schedule term metadata remains a valid V1 academic calendar", () => {
  assert.equal(shared.DEFAULT_SCHEDULE_TERM_TIMEZONE, "Asia/Shanghai");
  assert.match(shared.DEFAULT_SCHEDULE_TERM_META.week1Monday, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(shared.DEFAULT_SCHEDULE_TERM_META.maxWeek >= 18);
  assert.equal(shared.DEFAULT_SCHEDULE_WEEKDAY_LABELS.length, 7);
  assert.deepEqual(shared.DEFAULT_SCHEDULE_WEEKDAY_LABELS, ["一", "二", "三", "四", "五", "六", "日"]);
  assert.ok(shared.DEFAULT_SCHEDULE_SECTION_TIMES.length >= 10);
  for (const item of shared.DEFAULT_SCHEDULE_SECTION_TIMES) {
    assert.equal(typeof item.section, "number");
    assert.match(item.start, /^\d{2}:\d{2}$/);
    assert.match(item.end, /^\d{2}:\d{2}$/);
    assert.ok(item.start < item.end);
  }
});

test("social and admin enums keep stable V1 compatibility values", () => {
  assert.deepEqual(shared.ADMIN_ROLES, ["super_admin", "operator", "none"]);
  assert.deepEqual(shared.CLASS_ROLES, ["class_owner", "class_admin", "class_editor", "class_viewer"]);
  assert.deepEqual(shared.SOCIAL_VISIBILITY_SCOPES, ["busy_free", "detail", "hidden", "blocked"]);
  assert.deepEqual(shared.SOCIAL_SUBSCRIPTION_REQUEST_STATUSES, ["pending", "accepted", "rejected", "cancelled"]);
  assert.deepEqual(shared.SOCIAL_SUBSCRIPTION_STATUSES, ["active", "revoked"]);
  assert.deepEqual(shared.SOCIAL_NOTIFICATION_STATUSES, ["unread", "read"]);
  assertUnique(shared.SOCIAL_NOTIFICATION_TYPES, "social notification types");
});
