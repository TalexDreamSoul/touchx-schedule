import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const transpileModuleToTemp = (sourcePath, fileName, replacements = []) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [needle, replacement] of replacements) {
    source = source.split(needle).join(replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpDir = mkdtempSync(join(tmpdir(), "touchx-notification-delivery-"));
  const tmpFile = join(tmpDir, fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadNotificationModule = async () => {
  const sharedPath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/shared/src/index.ts"),
    "shared.mjs",
  );
  const notificationCorePath = transpileModuleToTemp(
    join(import.meta.dirname, "../../../../packages/notification-core/src/index.ts"),
    "notification-core.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["export * from \"./adapters\";", readFileSync(join(import.meta.dirname, "../../../../packages/notification-core/src/adapters.ts"), "utf8")
        .replace("import type { NotificationChannel, NotificationChannelType } from \"@touchx/shared\";", "")
        .replaceAll("export interface", "interface")
        .replaceAll("export const", "const")
        .concat("\nexport { buildWechatClawDBotWebhookPayload, buildFeishuTenantAccessTokenPayload, buildFeishuTenantAccessTokenUrl, buildFeishuTenantAppMessagePayload, buildFeishuTenantMessageUrl, buildFeishuWebhookPayload, parseFeishuMessageSendResponse, parseFeishuTenantAccessTokenResponse, resolveFeishuProviderType, resolveFeishuReceiveId, validateNotificationChannelReady };\n")],
    ],
  );
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const adaptersPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/notification-adapters.ts"),
    "notification-adapters.mjs",
    [
      ["from \"node:crypto\";", "from \"node:crypto\";"],
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["from \"@touchx/notification-core\";", `from ${JSON.stringify(pathToFileURL(notificationCorePath).href)};`],
    ],
  );
  const deliveryPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/notification-delivery-service.ts"),
    "notification-delivery-service.mjs",
    [
      ["from \"@touchx/shared\";", `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
      ["\"./notification-adapters\"", JSON.stringify(pathToFileURL(adaptersPath).href)],
    ],
  );
  return import(pathToFileURL(deliveryPath).href);
};

const createStore = () => {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    users: [],
    classes: [],
    classMembers: [],
    schedules: [],
    scheduleVersions: [],
    scheduleSubscriptions: [],
    socialSubscriptionRequests: [],
    socialSubscriptionEdges: [],
    socialCircles: [],
    socialCircleMembers: [],
    socialActivities: [],
    socialActivityInvitations: [],
    socialNotifications: [],
    userScheduleEvents: [],
    scheduleCorrections: [],
    schedulePatches: [],
    scheduleConflicts: [],
    sessions: [],
    locationGrids: [],
    foodItems: [],
    foodCampaigns: [],
    foodCampaignVotes: [],
    foodPricingRules: [],
    foodPricingRuleVersions: [],
    foodPricingOverrideVersions: [],
    mediaAssets: [],
    botTemplates: [],
    botJobs: [],
    notificationChannels: [
      {
        id: "channel-wechat",
        type: "wechat_clawdbot",
        name: "ClawDBot",
        enabled: true,
        config: { webhookUrl: "https://notify.example.test/wechat" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "channel-feishu",
        type: "feishu",
        name: "Feishu",
        enabled: true,
        config: { webhookUrl: "https://notify.example.test/feishu" },
        createdAt: now,
        updatedAt: now,
      },
    ],
    notificationDeliveries: [],
    reminderRules: [],
    userNotificationBindings: [],
    importJobs: [],
    importCandidateEvents: [],
    auditLogs: [],
    partyGameRooms: [],
    partyGameMembers: [],
    partyGameStates: [],
    partyGameEvents: [],
    partyGameHeartOpenWords: [],
  };
};

const createLoopbackWebhook = async (status = 200, responseBody = "message-id-1") => {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: JSON.parse(bodyText || "{}"),
      });
      response.writeHead(status, { "content-type": "text/plain" });
      response.end(responseBody);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/webhook`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

test("dispatches a pending ClawDBot delivery through a real HTTP webhook", async () => {
  const delivery = await loadNotificationModule();
  const store = createStore();
  const webhook = await createLoopbackWebhook();
  store.notificationChannels[0].config.webhookUrl = webhook.url;
  try {
    const item = delivery.createNotificationDelivery(store, {
      userId: "user-1",
      channelType: "wechat_clawdbot",
      title: "上课提醒",
      body: "30 分钟后开始",
      payload: { source: "test" },
      dedupeKey: "reminder:user-1:course-1",
      scheduledAt: "2026-05-18T00:00:00.000Z",
    });

    const result = await delivery.dispatchNotificationDelivery(store, item.id);

    assert.equal(result.status, "sent");
    assert.equal(result.externalMessageId, "message-id-1");
    assert.equal(result.attemptCount, 1);
    assert.equal(webhook.requests.length, 1);
    assert.equal(webhook.requests[0].method, "POST");
    assert.equal(webhook.requests[0].url, "/webhook");
    assert.match(String(webhook.requests[0].headers["content-type"]), /application\/json/);
    assert.equal(webhook.requests[0].body.msgtype, "text");
    assert.match(webhook.requests[0].body.text.content, /上课提醒/);
    assert.match(webhook.requests[0].body.text.content, /30 分钟后开始/);
  } finally {
    await webhook.close();
  }
});

test("signs Feishu webhook bot payload when signingSecret is configured", async () => {
  const delivery = await loadNotificationModule();
  const store = createStore();
  const webhook = await createLoopbackWebhook();
  store.notificationChannels[1].config = {
    provider: "webhook_bot",
    webhookUrl: webhook.url,
    signingSecret: "feishu-secret",
  };
  try {
    const item = delivery.createNotificationDelivery(store, {
      userId: "user-1",
      channelType: "feishu",
      title: "飞书机器人提醒",
      body: "签名测试",
      payload: { source: "test" },
      dedupeKey: "feishu-webhook:user-1:test",
      scheduledAt: "2026-05-18T00:00:00.000Z",
    });

    const result = await delivery.dispatchNotificationDelivery(store, item.id);

    assert.equal(result.status, "sent");
    assert.equal(webhook.requests.length, 1);
    assert.equal(webhook.requests[0].body.msg_type, "text");
    assert.ok(webhook.requests[0].body.timestamp);
    assert.ok(webhook.requests[0].body.sign);
  } finally {
    await webhook.close();
  }
});

test("dispatches a Feishu tenant app delivery through token and message APIs", async () => {
  const delivery = await loadNotificationModule();
  const store = createStore();
  const calls = [];
  const originalFetch = globalThis.fetch;
  store.notificationChannels[1].config = {
    provider: "tenant_app",
    appId: "cli_test",
    appSecret: "secret_test",
    receiveIdType: "open_id",
    defaultReceiveId: "ou_test",
  };
  globalThis.fetch = async (url, init = {}) => {
    const bodyText = String(init.body || "{}");
    calls.push({ url: String(url), headers: init.headers || {}, body: JSON.parse(bodyText) });
    if (String(url).includes("tenant_access_token")) {
      return Response.json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 });
    }
    return Response.json({ code: 0, data: { message_id: "om_test_message" } });
  };
  try {
    const item = delivery.createNotificationDelivery(store, {
      userId: "user-1",
      channelType: "feishu",
      title: "飞书提醒",
      body: "应用消息测试",
      payload: { feishuReceiveId: "ou_payload" },
      dedupeKey: "feishu:user-1:test",
      scheduledAt: "2026-05-18T00:00:00.000Z",
    });

    const result = await delivery.dispatchNotificationDelivery(store, item.id);

    assert.equal(result.status, "sent");
    assert.equal(result.externalMessageId, "om_test_message");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /tenant_access_token\/internal$/);
    assert.equal(calls[0].body.app_id, "cli_test");
    assert.equal(calls[1].url, "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id");
    assert.equal(calls[1].headers.Authorization, "Bearer tenant-token");
    assert.equal(calls[1].body.receive_id, "ou_payload");
    assert.equal(calls[1].body.msg_type, "text");
    assert.match(JSON.parse(calls[1].body.content).text, /飞书提醒/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries a failed delivery in-place and increments attempts", async () => {
  const delivery = await loadNotificationModule();
  const store = createStore();
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("temporary bad gateway", { status: 502 });
    }
    return new Response("retry-ok-message", { status: 200 });
  };
  try {
    const item = delivery.createNotificationDelivery(store, {
      userId: "user-1",
      channelType: "wechat_clawdbot",
      title: "失败后重试",
      body: "第一次失败，第二次成功",
      payload: { source: "test" },
      dedupeKey: "retry:user-1:test",
      scheduledAt: "2026-05-18T00:00:00.000Z",
    });

    const failed = await delivery.dispatchNotificationDelivery(store, item.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorMessage, "temporary bad gateway");
    assert.equal(failed.attemptCount, 1);

    const retried = await delivery.retryFailedNotificationDelivery(store, item.id);
    assert.equal(retried.retried, true);
    assert.equal(retried.reason, "retried");
    assert.equal(retried.item.status, "sent");
    assert.equal(retried.item.externalMessageId, "retry-ok-message");
    assert.equal(retried.item.attemptCount, 2);
    assert.equal(retried.item.payload.manualRetryCount, 1);
    assert.ok(retried.item.payload.lastManualRetryAt);
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry a non-failed delivery", async () => {
  const delivery = await loadNotificationModule();
  const store = createStore();
  const item = delivery.createNotificationDelivery(store, {
    userId: "user-1",
    channelType: "wechat_clawdbot",
    title: "待发送",
    body: "pending 不应直接重试",
    payload: { source: "test" },
    dedupeKey: "retry:user-1:pending",
    scheduledAt: "2026-05-18T00:00:00.000Z",
  });

  const result = await delivery.retryFailedNotificationDelivery(store, item.id);

  assert.equal(result.retried, false);
  assert.equal(result.reason, "not_failed");
  assert.equal(result.item.status, "pending");
  assert.equal(result.item.attemptCount, 0);
});

test("creates a fallback delivery when primary channel fails", async () => {
  const delivery = await loadNotificationModule();
  const store = createStore();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("wechat")) {
      return new Response("bad webhook", { status: 500 });
    }
    return new Response("fallback-ok", { status: 200 });
  };
  try {
    const item = delivery.createNotificationDelivery(store, {
      userId: "user-1",
      channelType: "wechat_clawdbot",
      title: "Todo 提醒",
      body: "请处理待办",
      payload: { channelStrategy: "primary_then_fallback" },
      dedupeKey: "reminder:user-1:todo-1",
      scheduledAt: "2026-05-18T00:00:00.000Z",
    });

    const result = await delivery.dispatchNotificationDelivery(store, item.id);

    assert.equal(result.status, "failed");
    assert.equal(result.errorMessage, "bad webhook");
    const fallback = store.notificationDeliveries.find((candidate) => candidate.id !== item.id);
    assert.ok(fallback);
    assert.equal(fallback.channelType, "feishu");
    assert.equal(fallback.status, "pending");
    assert.equal(fallback.payload.fallbackFromDeliveryId, item.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
