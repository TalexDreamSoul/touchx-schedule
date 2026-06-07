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

const assertUsesMiniappThemeStyle = (file) => {
  assertContains(file, "miniappPageThemeStyles");
  assertNotContains(file, "theme-green");
  assertNotContains(file, "theme-purple");
  assert.ok(
    /<View\b(?=[^>]*className="tx-page[^"]*")(?=[^>]*style=\{miniappPageThemeStyles\.)/.test(file.source),
    `${file.absolutePath} must inject miniapp page theme CSS variables from apps/miniapp/src/lib/theme.ts`,
  );
};

const assertMiniappStylesUseThemeVariables = (file) => {
  assertNotContains(file, ".tx-page.theme-green {");
  assertNotContains(file, ".tx-page.theme-purple {");
  assert.ok(
    !/\.event-(course|exam|todo|activity|holiday|deadline|custom)\s*\{[^}]*#[0-9a-fA-F]{3,8}/.test(file.source),
    `${file.absolutePath} must not hardcode event swatches inside miniapp event classes`,
  );
  assertContains(file, "--event-course-color");
  assertContains(file, "--event-exam-color");
  assertContains(file, "--event-todo-color");
  assertContains(file, "--event-activity-color");
  assertContains(file, "--event-holiday-color");
  assertContains(file, "--event-deadline-color");
  assertContains(file, "--event-custom-color");
};

const miniappApi = readSource("apps/miniapp/src/lib/api.ts");
const miniappSchedule = readSource("apps/miniapp/src/lib/schedule.ts");
const miniappTheme = readSource("apps/miniapp/src/lib/theme.ts");
const miniappStyles = readSource("apps/miniapp/src/styles/app.css");
const miniappPages = [
  readSource("apps/miniapp/src/pages/today/index.tsx"),
  readSource("apps/miniapp/src/pages/week/index.tsx"),
  readSource("apps/miniapp/src/pages/sources/index.tsx"),
  readSource("apps/miniapp/src/pages/profile/index.tsx"),
];
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

assertContains(miniappTheme, "from \"@touchx/ui-tokens\"");
assertContains(miniappTheme, "miniappPageThemes");
assertContains(miniappTheme, "miniappEventTones");
assertContains(miniappTheme, "miniappChromeTheme");
assertContains(miniappTheme, "miniappPageThemeStyles");
assertMiniappStylesUseThemeVariables(miniappStyles);
miniappPages.forEach(assertUsesMiniappThemeStyle);

console.log("ok client API, schedule and miniapp theme boundary reuse");
