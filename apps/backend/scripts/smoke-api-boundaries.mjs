import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const backendRoot = resolve(import.meta.dirname, "..");

const readSource = (relativePath) => {
  const absolutePath = join(backendRoot, relativePath);
  const source = readFileSync(absolutePath, "utf8");
  const lineCount = source.split(/\r?\n/).length;
  return { absolutePath, source, lineCount };
};

const countMatches = (source, pattern) => source.match(pattern)?.length || 0;

const assertLineBudget = (file, maxLines) => {
  assert.ok(
    file.lineCount <= maxLines,
    `${file.absolutePath} must stay under ${maxLines} lines; current ${file.lineCount}`,
  );
};

const assertImportsModule = (file, modulePath) => {
  assert.ok(
    file.source.includes(modulePath),
    `${file.absolutePath} must delegate to ${modulePath}`,
  );
};

const v1Api = readSource("server/services/v1-api.ts");
const socialV1Api = readSource("server/services/social-v1-api.ts");

assertLineBudget(v1Api, 700);
assertLineBudget(socialV1Api, 450);

[
  "../modules/auth/auth-handler",
  "../modules/calendar/calendar-user-handler",
  "../modules/calendar/calendar-ics-handler",
  "../modules/admin/admin-dashboard-handler",
  "../modules/admin/admin-user-handler",
  "../modules/admin/admin-preview-handler",
  "../modules/admin/admin-audit-handler",
  "../modules/notification/notification-admin-handler",
  "../modules/notification/notification-binding-user-handler",
  "../modules/notification/reminder-user-handler",
  "../modules/import/import-handler",
  "../modules/schedule/schedule-class-handler",
  "../modules/media/media-handler",
  "../modules/bot/bot-handler",
  "../modules/party-game/party-game-handler",
  "../modules/food/food-handler",
  "../modules/dev/dev-handler",
].forEach((modulePath) => assertImportsModule(v1Api, modulePath));

[
  "../modules/legacy/legacy-account-handler",
  "../modules/legacy/legacy-ai-schedule-handler",
  "../modules/legacy/legacy-clawdbot-handler",
  "../modules/legacy/legacy-circle-handler",
  "../modules/legacy/legacy-companion-handler",
  "../modules/legacy/legacy-food-campaign-handler",
  "../modules/legacy/legacy-food-candidate-handler",
  "../modules/legacy/legacy-notification-handler",
  "../modules/legacy/legacy-runtime-utils",
  "../modules/legacy/legacy-social-activity-handler",
  "../modules/legacy/legacy-social-relation-handler",
  "../modules/legacy/legacy-social-utils",
  "../modules/legacy/legacy-state",
  "../modules/legacy/legacy-upload-handler",
  "../modules/legacy/legacy-user-utils",
].forEach((modulePath) => assertImportsModule(socialV1Api, modulePath));

const v1InlineBranchCount = countMatches(v1Api.source, /method === ["'](?:GET|POST|PUT|PATCH|DELETE)["']/g);
const socialInlineBranchCount = countMatches(socialV1Api.source, /method === ["'](?:GET|POST|PUT|PATCH|DELETE)["']/g);

assert.ok(
  v1InlineBranchCount <= 1,
  `v1-api.ts should remain a dispatcher; found ${v1InlineBranchCount} inline HTTP method branches`,
);
assert.equal(
  socialInlineBranchCount,
  0,
  `social-v1-api.ts should remain a legacy dispatcher; found ${socialInlineBranchCount} inline HTTP method branches`,
);

assert.ok(!v1Api.source.includes("readMultipartFormData"), "v1-api.ts must not own upload parsing");
assert.ok(!socialV1Api.source.includes("readMultipartFormData"), "social-v1-api.ts must not own upload parsing");

console.log(`ok API boundary budgets v1=${v1Api.lineCount} social=${socialV1Api.lineCount}`);
