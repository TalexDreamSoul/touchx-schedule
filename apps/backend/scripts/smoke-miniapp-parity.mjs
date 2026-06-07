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

const readJson = (relativePath) => {
  const file = readSource(relativePath);
  return {
    ...file,
    data: JSON.parse(file.source),
  };
};

const assertContains = (file, needle) => {
  assert.ok(file.source.includes(needle), `${file.absolutePath} must include ${needle}`);
};

const assertNotContains = (file, needle) => {
  assert.ok(!file.source.includes(needle), `${file.absolutePath} must not include ${needle}`);
};

const assertMatches = (file, pattern, message) => {
  assert.ok(pattern.test(file.source), `${file.absolutePath} ${message}`);
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertNoDemoFallbacks = (file) => {
  assertNotContains(file, "mock");
  assertNotContains(file, "Mock");
  assertNotContains(file, "demo");
  assertNotContains(file, "Demo");
  assertNotContains(file, "fallback");
};

const assertImports = (file, names) => {
  names.forEach((name) => assertContains(file, name));
  assertContains(file, "from \"../../lib/api\"");
};

const assertApiWrapperDelegates = (file) => {
  [
    "getTodayBrief()",
    "apiClient.getTodayBrief()",
    "listMyEffectiveCalendar(params",
    "apiClient.listMyEffectiveCalendar(params)",
    "listPersonalEvents()",
    "apiClient.listPersonalEvents()",
    "createPersonalEvent(input",
    "apiClient.createPersonalEvent(input)",
    "updatePersonalEvent(eventId",
    "apiClient.updatePersonalEvent(eventId, input)",
    "markPersonalEventDone(eventId",
    "apiClient.markPersonalEventDone(eventId)",
    "archivePersonalEvent(eventId",
    "apiClient.archivePersonalEvent(eventId)",
    "getCalendarSettings()",
    "apiClient.getCalendarSettings()",
    "updateCalendarSettings(input",
    "apiClient.updateCalendarSettings(input)",
    "register(input",
    "apiClient.register(input)",
    "login(input",
    "apiClient.login(input)",
    "updateAuthProfile(input",
    "apiClient.updateAuthProfile(input)",
    "getAuthMe()",
    "apiClient.getAuthMe()",
    "logout()",
    "apiClient.logout()",
    "listNotificationBindings()",
    "apiClient.listNotificationBindings()",
    "createWechatClawDBotBindingQr()",
    "apiClient.createWechatClawDBotBindingQr()",
    "unbindWechatClawDBot()",
    "apiClient.unbindWechatClawDBot()",
    "upsertCalendarSource(input",
    "apiClient.upsertCalendarSource(input)",
    "listCalendarSources()",
    "calendar/sources",
    "listMyCalendarSubscriptions()",
    "apiClient.listMyCalendarSubscriptions()",
    "subscribeCalendarSource(sourceId",
    "apiClient.subscribeCalendarSource(sourceId)",
    "cancelCalendarSubscription(subscriptionId",
    "apiClient.cancelCalendarSubscription(subscriptionId)",
    "uploadPdfImportPreview(filePath",
    "Taro.uploadFile",
    "calendar/me/pdf-import/preview",
  ].forEach((needle) => assertContains(file, needle));
};

const assertTodayScheduleParity = (file) => {
  assertImports(file, [
    "archivePersonalEvent",
    "createPersonalEvent",
    "getSessionToken",
    "getTodayBrief",
    "listMyEffectiveCalendar",
    "listPersonalEvents",
    "markPersonalEventDone",
    "updatePersonalEvent",
    "type EffectiveCalendarItem",
    "type PersonalEventRow",
  ]);

  [
    "const [todayInfo, setTodayInfo]",
    "const [events, setEvents]",
    "const [todoItems, setTodoItems]",
    "const [loading, setLoading]",
    "const [message, setMessage]",
    "const syncServerClock = async ()",
    "syncServerOffsetFromIso(brief.serverNowIso)",
    "const load = async ()",
    "const nextTodayInfo = await syncServerClock()",
    "if (!getSessionToken())",
    "setEvents([])",
    "setTodoItems([])",
    "完成账号密码登录",
    "setLoading(true)",
    "Promise.all([",
    "listMyEffectiveCalendar({ date: nextTodayInfo.dateKey })",
    "listPersonalEvents()",
    "setEvents(calendar.items || [])",
    "setTodoItems(activeTodos)",
    "setMessage(`今天 ${calendar.items?.length || 0} 条日程，${activeTodos.length} 个待办`)",
    "catch (error)",
    "error instanceof Error ? error.message : \"加载失败\"",
    "setLoading(false)",
    "今日待上课程",
    "待授权",
    "去“我的”登录后同步课表",
    "今天暂无待上课程",
    "今日课程",
    "今天没有安排课程",
    "今日优先事项",
    "新增 Todo",
    "await createPersonalEvent(payload)",
    "await updatePersonalEvent(editingTodoId, payload)",
    "await markPersonalEventDone(id)",
    "await archivePersonalEvent(id)",
    "暂无待办",
  ].forEach((needle) => assertContains(file, needle));

  assertMatches(file, /useEffect\(\(\) => \{ void load\(\); \}, \[\]\)/, "must load today schedule on first render");
  assertNotContains(file, "useMemo(() => getTodayInfo(), [])");
  assertNotContains(file, "new Date().getHours()");
  assertNotContains(file, "学号登录");
};

const assertWeekScheduleParity = (file) => {
  assertImports(file, [
    "getCalendarSettings",
    "getSessionToken",
    "getTodayBrief",
    "listMyEffectiveCalendar",
    "updateCalendarSettings",
    "type EffectiveCalendarItem",
  ]);

  [
    "const [todayInfo, setTodayInfo]",
    "const [events, setEvents]",
    "const [message, setMessage]",
    "const [loading, setLoading]",
    "const [mode, setMode]",
    "const [showSettings, setShowSettings]",
    "const syncServerClock = async ()",
    "syncServerOffsetFromIso(brief.serverNowIso)",
    "const load = async (targetWeekNo = weekNo, options: { alignWithServerWeek?: boolean } = {})",
    "const resolvedWeekNo = options.alignWithServerWeek ? nextTodayInfo.week : targetWeekNo",
    "if (!getSessionToken())",
    "setEvents([])",
    "完成账号密码登录",
    "setLoading(true)",
    "Promise.all([",
    "listMyEffectiveCalendar({ week: resolvedWeekNo })",
    "getCalendarSettings().catch(() => null)",
    "setEvents(calendar.items || [])",
    "setReminderEnabled(Boolean(settings.reminderEnabled))",
    "setReminderOffsetsText((settings.reminderWindowMinutes || [30, 15]).join(\",\"))",
    "catch (error)",
    "error instanceof Error ? error.message : \"加载失败\"",
    "Taro.stopPullDownRefresh()",
    "usePullDownRefresh(() => { void load(weekNo); })",
    "日程表配置",
    "await updateCalendarSettings({ reminderEnabled, reminderWindowMinutes: offsets.length > 0 ? offsets : [30, 15] })",
    "日程表",
    "课表模式",
    "暂无日程。登录后订阅/发布日程源或新增 Todo 即可展示。",
    "点击展开详情",
  ].forEach((needle) => assertContains(file, needle));

  assertMatches(file, /useEffect\(\(\) => \{ void load\(weekIndex \+ 1,\s*\{ alignWithServerWeek: true \}\); \}, \[\]\)/, "must load week schedule from the server-calibrated current week on first render");
  assertNotContains(file, "useMemo(() => getTodayInfo(), [])");
  assertMatches(file, /mode === "course"[\s\S]*tx-schedule-card/, "must keep course-grid mode");
  assertMatches(file, /mode === "timeline"[\s\S]*tx-timeline-scroll|tx-timeline-scroll[\s\S]*groupedTimeline/, "must keep timeline mode");
};

const assertMiniappServerTimeParity = ({ api, schedule, today, week }) => {
  [
    "getTodayBrief()",
    "apiClient.getTodayBrief()",
  ].forEach((needle) => assertContains(api, needle));

  [
    "let serverOffsetMs = 0",
    "getServerOffsetMs",
    "syncServerOffsetFromIso",
    "serverOffsetMs = serverNowMs - Date.now()",
    "getServerNow",
    "getTodayInfo = (now = getServerNow())",
    "isEventFutureOrOngoing = (event: EffectiveCalendarItem, now = getServerNow())",
    "resolveSemesterElapsed = (now = getServerNow())",
  ].forEach((needle) => assertContains(schedule, needle));

  [today, week].forEach((file) => {
    assertContains(file, "getTodayBrief");
    assertContains(file, "syncServerOffsetFromIso");
    assertContains(file, "syncServerClock");
    assertContains(file, "setTodayInfo(nextTodayInfo)");
    assertNotContains(file, "useMemo(() => getTodayInfo(), [])");
  });
};

const assertProfileAccountParity = (file) => {
  assertImports(file, [
    "getAuthMe",
    "login",
    "logout",
    "register",
    "setSessionToken",
    "setStoredUser",
    "updateAuthProfile",
    "clearAuthState",
  ]);
  [
    "const submitAuth = async ()",
    "authMode === \"register\"",
    "await register(",
    "await login(",
    "setSessionToken(data.sessionToken)",
    "setStoredUser(data.user)",
    "await refreshBindings()",
    "const refreshMe = async ()",
    "await getAuthMe()",
    "clearAuthState()",
    "const saveNickname = async ()",
    "await updateAuthProfile(",
    "const submitLogout = async ()",
    "await logout()",
    "账号密码",
    "注册并登录",
    "登录",
    "保存昵称",
    "退出",
  ].forEach((needle) => assertContains(file, needle));
};

const assertProfileNotificationParity = (file) => {
  assertImports(file, [
    "createWechatClawDBotBindingQr",
    "listNotificationBindings",
    "unbindWechatClawDBot",
    "type NotificationBindingRow",
  ]);
  [
    "const refreshBindings = async ()",
    "await listNotificationBindings()",
    "item.channelType === \"wechat_clawdbot\"",
    "item.status === \"active\"",
    "const createQr = async ()",
    "if (!getSessionToken())",
    "await createWechatClawDBotBindingQr()",
    "setQrImageUrl(data.qrImageUrl)",
    "await refreshBindings()",
    "const unbindWechat = async ()",
    "await unbindWechatClawDBot()",
    "微信 ClawDBot",
    "生成二维码绑定",
    "取消绑定",
  ].forEach((needle) => assertContains(file, needle));
};

const assertProfilePdfParity = (file) => {
  assertImports(file, ["uploadPdfImportPreview", "type PdfImportPreviewResult"]);
  [
    "const choosePdf = async ()",
    "if (!getSessionToken())",
    "Taro.chooseMessageFile",
    "extension: [\"pdf\"]",
    "await uploadPdfImportPreview(",
    "setPdfPreview(preview)",
    "上传解析 PDF 日程",
    "选择 PDF",
    "PDF 已解析出",
  ].forEach((needle) => assertContains(file, needle));

  assertMatches(file, /previewEntries\.slice\(0,\s*5\)\.map/, "must render parsed PDF preview entries");
};

const assertSourcePublishParity = (file) => {
  assertImports(file, [
    "cancelCalendarSubscription",
    "listCalendarSources",
    "listMyCalendarSubscriptions",
    "subscribeCalendarSource",
    "upsertCalendarSource",
    "type CalendarSourceRow",
    "type CalendarSubscriptionRow",
  ]);
  [
    "const load = async ()",
    "await listCalendarSources()",
    "await listMyCalendarSubscriptions()",
    "setSubscribedSourceIds(",
    "const subscribe = async (sourceId: string)",
    "await subscribeCalendarSource(sourceId)",
    "const cancel = async (subscriptionId: string)",
    "await cancelCalendarSubscription(subscriptionId)",
    "const publishCustom = async ()",
    "if (!getSessionToken())",
    "await upsertCalendarSource({",
    "visibility: \"public\"",
    "publish: true",
    "events: [{",
    "setShowPublish(false)",
    "await load()",
    "自定义发布",
    "订阅中心",
    "已订阅",
    "暂无真实日程源",
  ].forEach((needle) => assertContains(file, needle));

  assertMatches(file, /type:\s*type === "activity" \? "club_activity" : type === "exam" \? "exam_schedule" : "manual_collection"/, "must map custom source event types to CalendarSource types");
};

const resolveMicroappRoutes = (pagesJsonFile) => {
  const pages = pagesJsonFile.data.pages || [];
  const subpackages = pagesJsonFile.data.subpackages || [];
  const rootRoutes = pages.map((page) => page.path);
  const packageRoutes = subpackages.flatMap((subpackage) => {
    return (subpackage.pages || []).map((page) => `${subpackage.root}/${page.path}`);
  });
  return [...rootRoutes, ...packageRoutes];
};

const assertMicroappRouteCoverage = (decisionDoc, pagesJsonFile) => {
  const routes = resolveMicroappRoutes(pagesJsonFile);
  assert.ok(routes.length >= 20, `${pagesJsonFile.absolutePath} must expose the expected microapp route surface`);

  [
    "## Microapp Route Coverage Matrix",
    "`Covered` means",
    "`Partial` means",
    "`Deferred` means",
    "| Microapp route | V1 decision | Taro equivalent or defer decision |",
  ].forEach((needle) => assertContains(decisionDoc, needle));

  routes.forEach((route) => {
    const rowPattern = new RegExp(`\\|\\s*\`${escapeRegExp(route)}\`\\s*\\|\\s*(Covered|Partial|Deferred)\\s*\\|`);
    assertMatches(decisionDoc, rowPattern, `must document a Covered, Partial, or Deferred V1 decision for ${route}`);
  });

  assertNotContains(decisionDoc, "TBD");
  assertNotContains(decisionDoc, "TODO route");
};

const assertManualSmokeChecklist = (file) => {
  [
    "# Miniapp WeChat DevTools Smoke Checklist",
    "## Prerequisites",
    "## Required Manual Scenarios",
    "## Evidence To Record",
    "## Decision Rule",
    "pnpm verify:v1-release",
    "pnpm --filter @touchx/microapp build:mp-weixin",
    "apps/microapp/dist/build/mp-weixin",
    "WeChat DevTools",
    "First load",
    "Login and profile",
    "Today schedule",
    "Week schedule",
    "Subscription and sources",
    "PDF import preview",
    "Notification binding",
    "Fallback route check",
    "fallback route check",
    "Do not archive or replace `apps/microapp` unless every required manual scenario passes",
  ].forEach((needle) => assertContains(file, needle));
};

const assertReleaseGateScript = (packageJsonFile) => {
  const scripts = packageJsonFile.data.scripts || {};
  assert.equal(scripts["build:miniapp"], "pnpm --filter @touchx/miniapp build:weapp", "root build:miniapp must build the Taro WeChat route");
  assert.equal(scripts["build:microapp"], "pnpm --filter @touchx/microapp build:mp-weixin", "root build:microapp must build the uni-app fallback route");

  const releaseSteps = String(scripts["verify:v1-release"] || "")
    .split("&&")
    .map((step) => step.trim())
    .filter(Boolean);
  assert.deepEqual(releaseSteps, [
    "pnpm --filter @touchx/backend verify:v1-local",
    "pnpm --filter @touchx/miniapp build:weapp",
    "pnpm --filter @touchx/microapp type-check",
    "pnpm --filter @touchx/microapp build:mp-weixin",
  ], `${packageJsonFile.absolutePath} verify:v1-release must guard backend, Taro build, and uni-app fallback build`);
};

const assertReleaseGateDocs = ({ readme, todo, miniappDecisionDoc, v1CloseoutStatus, calendarRoadmap }) => {
  const files = [readme, todo, miniappDecisionDoc, v1CloseoutStatus, calendarRoadmap];
  const sharedNeedles = [
    "smoke:miniapp-parity",
    "pnpm verify:v1-release",
    "@touchx/miniapp build:weapp",
    "@touchx/microapp type-check",
    "@touchx/microapp build:mp-weixin",
    "docs/miniapp-wechat-smoke-checklist.md",
  ];

  files.forEach((file) => {
    sharedNeedles.forEach((needle) => assertContains(file, needle));
  });

  assertMatches(
    calendarRoadmap,
    /最近本地 gate：[\s\S]*`smoke:miniapp-parity`[\s\S]*`pnpm verify:v1-release`[\s\S]*`pnpm --filter @touchx\/microapp type-check`[\s\S]*`pnpm --filter @touchx\/microapp build:mp-weixin`/,
    "must keep the roadmap closeout summary aligned with the release gate",
  );

  [todo, v1CloseoutStatus, calendarRoadmap].forEach((file) => {
    assertMatches(
      file,
      /最近通过的本地 release-candidate gate（2026-06-08）：`pnpm verify:v1-release`[\s\S]*(?:@touchx\/miniapp build:weapp|Taro weapp)[\s\S]*(?:@touchx\/microapp type-check|旧 uni-app type-check)[\s\S]*(?:@touchx\/microapp build:mp-weixin|微信小程序构建)/,
      "must keep the latest local release-candidate gate evidence in closeout docs",
    );
  });
};

const api = readSource("apps/miniapp/src/lib/api.ts");
const schedule = readSource("apps/miniapp/src/lib/schedule.ts");
const today = readSource("apps/miniapp/src/pages/today/index.tsx");
const week = readSource("apps/miniapp/src/pages/week/index.tsx");
const profile = readSource("apps/miniapp/src/pages/profile/index.tsx");
const sources = readSource("apps/miniapp/src/pages/sources/index.tsx");
const microappPagesJson = readJson("apps/microapp/src/pages.json");
const miniappDecisionDoc = readSource("docs/miniapp-route-decision.md");
const manualSmokeChecklist = readSource("docs/miniapp-wechat-smoke-checklist.md");
const readme = readSource("README.md");
const todo = readSource("TODO.md");
const v1CloseoutStatus = readSource("docs/v1-closeout-status.md");
const calendarRoadmap = readSource("docs/touchx-calendar-platform-roadmap.md");
const rootPackageJson = readJson("package.json");

assertApiWrapperDelegates(api);
assertMiniappServerTimeParity({ api, schedule, today, week });

[today, week, profile, sources].forEach(assertNoDemoFallbacks);
assertTodayScheduleParity(today);
assertWeekScheduleParity(week);
assertProfileAccountParity(profile);
assertProfileNotificationParity(profile);
assertProfilePdfParity(profile);
assertSourcePublishParity(sources);
assertMicroappRouteCoverage(miniappDecisionDoc, microappPagesJson);
assertManualSmokeChecklist(manualSmokeChecklist);
assertReleaseGateScript(rootPackageJson);
assertReleaseGateDocs({ readme, todo, miniappDecisionDoc, v1CloseoutStatus, calendarRoadmap });

console.log("ok miniapp schedule, server-time, route coverage, release gate, manual smoke checklist, profile, notification, PDF import and custom source parity gates");
