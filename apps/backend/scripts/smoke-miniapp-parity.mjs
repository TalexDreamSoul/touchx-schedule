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

const assertMatches = (file, pattern, message) => {
  assert.ok(pattern.test(file.source), `${file.absolutePath} ${message}`);
};

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

const api = readSource("apps/miniapp/src/lib/api.ts");
const profile = readSource("apps/miniapp/src/pages/profile/index.tsx");
const sources = readSource("apps/miniapp/src/pages/sources/index.tsx");

assertApiWrapperDelegates(api);

[profile, sources].forEach(assertNoDemoFallbacks);
assertProfileAccountParity(profile);
assertProfileNotificationParity(profile);
assertProfilePdfParity(profile);
assertSourcePublishParity(sources);

console.log("ok miniapp profile, notification, PDF import and custom source parity gates");
