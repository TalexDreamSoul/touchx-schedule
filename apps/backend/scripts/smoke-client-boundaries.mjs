import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");

const readSource = (relativePath) => {
  const absolutePath = resolve(repoRoot, relativePath);
  return {
    absolutePath,
    source: readFileSync(absolutePath, "utf8"),
  };
};

const assertContains = (file, needle) => {
  assert.ok(file.source.includes(needle), `${file.absolutePath} must include ${needle}`);
};

const assertNotContains = (file, needle) => {
  assert.ok(!file.source.includes(needle), `${file.absolutePath} must not include ${needle}`);
};

const assertNoRawFetchCalls = (file) => {
  const sourceWithoutAllowedFetcher = file.source.replace(/fetcher:\s*fetch/g, "");
  assert.ok(!/\bfetch\s*\(/.test(sourceWithoutAllowedFetcher), `${file.absolutePath} must delegate fetch calls to @touchx/api-client`);
};

const assertNoRawEventColorMap = (file) => {
  assert.ok(
    !/\b(course|exam|todo|activity|holiday|deadline|custom)\s*:\s*["']#[0-9a-fA-F]{3,8}["']/.test(file.source),
    `${file.absolutePath} must delegate event color literals to @touchx/ui-tokens`,
  );
};

const assertUsesSharedScheduleDefaults = (file) => {
  assertContains(file, "from \"@touchx/shared\"");
  assertContains(file, "DEFAULT_SCHEDULE_SECTION_TIMES");
  assertContains(file, "DEFAULT_SCHEDULE_TERM_META");
  assertContains(file, "DEFAULT_SCHEDULE_WEEKDAY_LABELS");
  assertNotContains(file, "week1Monday:");
  assertNotContains(file, "maxWeek:");
};

const assertUsesCalendarColorTokens = (file) => {
  assertContains(file, "from \"@touchx/ui-tokens\"");
  assertContains(file, "calendarEventColors");
  assertContains(file, "...calendarEventColors");
  assertNoRawEventColorMap(file);
};

const miniappApi = readSource("apps/miniapp/src/lib/api.ts");
const miniappSchedule = readSource("apps/miniapp/src/lib/schedule.ts");
const mobileApi = readSource("apps/mobile/src/api.ts");
const mobileSchedule = readSource("apps/mobile/src/schedule.ts");
const apiClient = readSource("packages/api-client/src/index.ts");

[miniappApi, mobileApi].forEach((file) => {
  assertContains(file, "from \"@touchx/api-client\"");
  assertContains(file, "createTouchXApiClient");
  assertContains(file, "resolveTouchXApiBaseUrl");
  assertContains(file, "apiClient.request");
  assertNotContains(file, "\"/api/v1\"");
  assertNotContains(file, "'/api/v1'");
  assertNoRawFetchCalls(file);
});

assertContains(miniappApi, "Taro.uploadFile");
assertContains(miniappApi, "calendar/me/pdf-import/preview");
assertContains(mobileApi, "fetcher: fetch");
assertNotContains(mobileApi, "Taro.");

assertContains(apiClient, "DEFAULT_TOUCHX_API_BASE_URL");
assertContains(apiClient, "TOUCHX_API_BASE_URL");
assertContains(apiClient, "__TOUCHX_API_BASE_URL__");
assertContains(apiClient, "resolveTouchXApiBaseUrl");
assertContains(apiClient, "createTouchXApiClient");

[miniappSchedule, mobileSchedule].forEach((file) => {
  assertUsesSharedScheduleDefaults(file);
  assertUsesCalendarColorTokens(file);
});

console.log("ok client API and schedule boundary reuse for miniapp and mobile");
