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
  throw new Error("esbuild binary is required to run notification-core tests");
}

const outDir = "/tmp/touchx-notification-core-test";
const outFile = join(outDir, "notification-core.mjs");
await mkdir(outDir, { recursive: true });
execFileSync(esbuildBin, [
  join(repoRoot, "packages/notification-core/src/index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${outFile}`,
], { stdio: "pipe" });

const core = await import(outFile);

const nowIso = "2026-06-08T10:00:00.000Z";
const channel = (overrides = {}) => ({
  id: "channel-1",
  type: "feishu",
  name: "飞书",
  enabled: true,
  config: {
    webhookUrl: "https://example.test/webhook",
    defaultReceiveId: "default-open-id",
    ...overrides.config,
  },
  createdAt: nowIso,
  updatedAt: nowIso,
  ...overrides,
});

test("renders notification templates with nested params and missing values", () => {
  assert.equal(
    core.renderNotificationTemplate("{{ user.name }} 今天 {{event.title}} @ {{ event.location }}{{missing}}", {
      user: { name: "小唐" },
      event: { title: "高等数学", location: "A101" },
    }),
    "小唐 今天 高等数学 @ A101",
  );
});

test("resolves channel order by reminder strategy", () => {
  assert.deepEqual(
    core.resolveChannelOrder("wechat_clawdbot", ["feishu", "wechat_clawdbot", "feishu"], "both"),
    ["feishu", "wechat_clawdbot"],
  );
  assert.deepEqual(
    core.resolveChannelOrder("wechat_clawdbot", ["feishu", "wechat_clawdbot"], "primary_only"),
    ["wechat_clawdbot"],
  );
  assert.deepEqual(
    core.resolveChannelOrder("wechat_clawdbot", ["feishu"], "primary_only"),
    [],
  );
  assert.deepEqual(
    core.resolveChannelOrder("wechat_clawdbot", ["feishu", "wechat_clawdbot"], "primary_then_fallback"),
    ["wechat_clawdbot", "feishu"],
  );
});

test("creates and transitions delivery records immutably", () => {
  const delivery = core.createDeliveryRecord({
    id: "delivery-1",
    userId: "user-1",
    channelType: "feishu",
    templateKey: "course.reminder",
    title: "上课提醒",
    body: "10 分钟后开始",
    payload: { eventId: "event-1" },
    dedupeKey: "user-1:event-1:10:feishu",
    scheduledAt: "2026-06-08T10:20:00.000Z",
    nowIso,
  });

  const sending = core.markDeliverySending(delivery, "2026-06-08T10:01:00.000Z");
  const sent = core.markDeliverySent(sending, "2026-06-08T10:02:00.000Z", "msg-1");
  const failed = core.markDeliveryFailed(sending, "2026-06-08T10:03:00.000Z", "network failed");

  assert.equal(delivery.status, "pending");
  assert.equal(sending.status, "sending");
  assert.equal(sending.attemptCount, 1);
  assert.equal(sent.status, "sent");
  assert.equal(sent.externalMessageId, "msg-1");
  assert.equal(sent.errorMessage, "");
  assert.equal(failed.status, "failed");
  assert.equal(failed.errorMessage, "network failed");
});

test("dedupes active delivery statuses only", () => {
  const base = core.createDeliveryRecord({
    id: "delivery-1",
    userId: "user-1",
    channelType: "wechat_clawdbot",
    templateKey: "manual",
    title: "通知",
    body: "body",
    dedupeKey: "dedupe-1",
    scheduledAt: nowIso,
    nowIso,
  });

  assert.equal(core.shouldDedupeDelivery([base], "dedupe-1"), true);
  assert.equal(core.shouldDedupeDelivery([{ ...base, status: "failed" }], "dedupe-1"), false);
  assert.equal(core.shouldDedupeDelivery([{ ...base, status: "cancelled" }], "dedupe-1"), false);
});

test("builds webhook and Feishu tenant app payloads", () => {
  assert.deepEqual(core.buildWechatClawDBotWebhookPayload({
    title: "标题",
    body: "正文",
    payload: { eventId: "event-1" },
  }), {
    msgtype: "text",
    text: { content: "标题\n正文" },
    payload: { eventId: "event-1" },
  });

  assert.deepEqual(core.buildFeishuWebhookPayload({ title: "标题", body: "正文" }), {
    msg_type: "text",
    content: { text: "标题\n正文" },
  });

  assert.deepEqual(core.buildFeishuTenantAppMessagePayload(channel({
    config: { receiveIdType: "union_id", defaultReceiveId: "default-union-id" },
  }), {
    title: "标题",
    body: "正文",
    payload: { externalUnionId: "union-1" },
  }), {
    receive_id: "union-1",
    msg_type: "text",
    content: JSON.stringify({ text: "标题\n正文" }),
  });
});

test("normalizes Feishu provider, receive IDs and readiness errors", () => {
  assert.equal(core.resolveFeishuProviderType(channel({
    config: { appId: "cli_a", appSecret: "secret" },
  })), "tenant_app");
  assert.equal(core.resolveFeishuProviderType(channel({
    config: { webhookUrl: "https://example.test/webhook" },
  })), "webhook_bot");
  assert.equal(core.resolveFeishuReceiveIdType(channel({
    config: { receiveIdType: "email" },
  })), "email");
  assert.equal(core.resolveFeishuReceiveId(channel({
    config: { receiveIdType: "open_id", defaultReceiveId: "default-open-id" },
  }), { title: "", body: "", payload: { externalOpenId: "open-1" } }), "open-1");
  assert.equal(core.validateNotificationChannelReady(channel({ enabled: false })), "通知通道未启用");
  assert.match(
    core.validateNotificationChannelReady(channel({
      config: { provider: "tenant_app", appId: "cli_a", appSecret: "" },
    })),
    /appId\/appSecret 未配置/,
  );
});

test("parses Feishu API responses", () => {
  assert.deepEqual(core.parseFeishuTenantAccessTokenResponse({
    code: 0,
    tenant_access_token: "tenant-token",
    expire: 7200,
  }), {
    ok: true,
    token: "tenant-token",
    expireSeconds: 7200,
  });
  assert.deepEqual(core.parseFeishuTenantAccessTokenResponse({ code: 999, msg: "invalid app" }), {
    ok: false,
    errorMessage: "invalid app",
  });
  assert.deepEqual(core.parseFeishuMessageSendResponse({
    code: 0,
    data: { message_id: "message-1" },
  }), {
    ok: true,
    externalMessageId: "message-1",
  });
  assert.deepEqual(core.parseFeishuMessageSendResponse({ code: 230001, msg: "bad receive id" }), {
    ok: false,
    errorMessage: "bad receive id",
  });
});
