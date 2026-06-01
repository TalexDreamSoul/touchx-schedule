import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-bot-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadBotHandler = async () => {
  const h3Stub = "data:text/javascript,export const getHeader=(event,name)=>event.headers?.[name]||'';";
  const domainStoreStub = [
    "let seq = 0;",
    "export const storeHelpers = {",
    "  nowIso: () => '2026-05-18T00:00:00.000Z',",
    "  createId: (prefix) => `${prefix}-${++seq}`,",
    "};",
  ].join("\n");
  const suggestionStub = "data:text/javascript,export const buildSmartSuggestions=()=>[{ code: 'rain', title: '带伞', score: 90 }];";
  const scheduleServiceStub = [
    "export const getPublishedScheduleVersion = (store, scheduleId, versionNo) =>",
    "  store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo) || null;",
  ].join("\n");
  const reminderStub = [
    "export const ackNotificationReminderDelivery = (store, deliveryId, body) => {",
    "  const item = store.notificationDeliveries.find((candidate) => candidate.id === deliveryId);",
    "  if (!item || item.status !== 'sending') return false;",
    "  item.status = body.status || (body.success === false ? 'failed' : 'sent');",
    "  item.externalMessageId = body.externalMessageId || '';",
    "  return true;",
    "};",
    "export const getBotDeliveryTokenHeader = () => 'x-bot-delivery-token';",
    "export const resolveReminderDeliveryQueue = (value) => value === 'legacy' ? 'legacy' : 'notification';",
    "export const pullPendingNotificationReminderDeliveries = (store, options) => {",
    "  store.pulledNotificationLimit = options.limit;",
    "  return store.notificationDeliveries.filter((item) => item.status === 'pending').slice(0, options.limit).map((item) => {",
    "    item.status = 'sending';",
    "    item.attemptCount = (item.attemptCount || 0) + 1;",
    "    return { id: item.id, renderedTitle: item.title, renderedBody: item.body, status: 'delivering', attemptCount: item.attemptCount };",
    "  });",
    "};",
    "export const requireBotDeliveryToken = (event, configuredToken) => event.headers?.['x-bot-delivery-token'] === configuredToken;",
    "export const resolveReminderDbFromEvent = (event) => event.context?.db || null;",
    "export const pullPendingReminderDeliveries = async (db, options) => {",
    "  db.pulledLimit = options.limit;",
    "  return (db.pending || []).slice(0, options.limit);",
    "};",
    "export const ackReminderDelivery = async (db, deliveryId, body) => {",
    "  db.acks = [...(db.acks || []), { deliveryId, body }];",
    "  return !(db.missingAck === deliveryId);",
    "};",
    "export const runReminderHeartbeat = async (db, options) => {",
    "  db.heartbeatOptions = options;",
    "  if (options.nowIso === 'bad') throw new Error('HEARTBEAT_NOW_INVALID');",
    "  return {",
    "    skipped: false,",
    "    triggerKey: '2026-05-18_09:00',",
    "    timezone: options.timezone,",
    "    inWindow: true,",
    "    shouldRunNextDay: options.runNextDay === true,",
    "    dryRun: options.dryRun === true,",
    "    queuedCounts: { nextDayDigest: 1, preClassReminder: 2, duplicate: 0 },",
    "  };",
    "};",
  ].join("\n");
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/bot/bot-service.ts"),
    "bot-service.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(domainStoreStub)}`)],
      ["\"../../services/suggestion-engine\"", JSON.stringify(suggestionStub)],
      ["\"../schedule/schedule-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(scheduleServiceStub)}`)],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/bot/bot-handler.ts"),
    "bot-handler.mjs",
    [
      ["from \"h3\";", `from ${JSON.stringify(h3Stub)};`],
      ["\"../../services/reminder-delivery-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(reminderStub)}`)],
      ["\"./bot-service\"", JSON.stringify(pathToFileURL(servicePath).href)],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-05-01T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  accountName: "alice@example.test",
  studentNo: "2300000001",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: ["class-1"],
  avatarUrl: "",
  wallpaperUrl: "",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser(),
    createUser({
      userId: "admin-1",
      accountName: "admin@example.test",
      studentNo: "999999",
      studentId: "admin-student",
      name: "Admin",
      nickname: "Admin",
      adminRole: "super_admin",
      classIds: [],
    }),
  ],
  classMembers: [{ id: "member-1", classId: "class-1", userId: "user-1", classRole: "class_owner", joinedAt: now }],
  schedules: [
    {
      id: "schedule-1",
      classId: "class-1",
      title: "主课表",
      description: "",
      publishedVersionNo: 1,
      createdByUserId: "admin-1",
      createdAt: now,
      updatedAt: now,
    },
  ],
  scheduleVersions: [
    {
      id: "version-1",
      scheduleId: "schedule-1",
      versionNo: 1,
      status: "published",
      entries: [{ id: "entry-1", day: 2, startSection: 1, endSection: 2, weekExpr: "1-20", parity: "all", courseName: "软件工程" }],
      createdByUserId: "admin-1",
      createdAt: now,
    },
  ],
  locationGrids: [{ userId: "user-1", gridId: "grid", latitudeApprox: 31.2, longitudeApprox: 121.4, updatedAt: new Date().toISOString(), stale: false }],
  botTemplates: [{ id: "tpl-1", key: "next_day_brief", title: "次日", body: "你好", enabled: true, updatedAt: now }],
  botJobs: [{ id: "job-1", type: "manual_trigger", status: "done", createdBy: "admin-1", createdAt: now, finishedAt: now, summary: "历史", suggestions: [] }],
  notificationDeliveries: [
    {
      id: "notification-delivery-1",
      userId: "user-1",
      channelType: "wechat_clawdbot",
      templateKey: "pre_class_reminder",
      title: "课前提醒",
      body: "准备上课",
      payload: { reminderType: "pre_class_reminder", sourceQueue: "notification" },
      status: "pending",
      dedupeKey: "dedupe-1",
      scheduledAt: now,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const audits = [];
  const db = overrides.db === undefined ? { pending: [{ id: "delivery-1" }] } : overrides.db;
  const context = {
    event: { headers: overrides.headers || {}, context: { db } },
    method: overrides.method || "GET",
    path: overrides.path || "bot/templates",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireAdmin: () => ({ user: overrides.adminUser || store.users[1] }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
    getBearerToken: () => overrides.bearerToken || "",
    getRuntimeConfig: () => overrides.runtimeConfig || { botDeliveryToken: "delivery-token", heartbeatToken: "heartbeat-token", heartbeatTimezone: "Asia/Shanghai" },
  };
  return { context, store, audits, db, handleBotApi: handler.handleBotApi };
};

test("lists and saves bot templates with audit records", async () => {
  const handler = await loadBotHandler();
  const listedContext = createContext(handler);
  const listed = await listedContext.handleBotApi(listedContext.context);
  assert.deepEqual(listed.data.items.map((item) => item.id), ["tpl-1"]);

  const { context, store, audits, handleBotApi } = createContext(handler, {
    method: "POST",
    path: "bot/templates",
    body: { key: "pre_class_reminder", title: "课前", body: "准备上课", enabled: false },
  });
  const saved = await handleBotApi(context);

  assert.equal(saved.data.template.key, "pre_class_reminder");
  assert.equal(saved.data.template.enabled, false);
  assert.equal(store.botTemplates.some((item) => item.id === saved.data.template.id), true);
  assert.deepEqual(audits, [
    {
      action: "bot_template_save",
      actorUserId: "admin-1",
      payload: { templateId: saved.data.template.id, key: "pre_class_reminder" },
    },
  ]);
});

test("rejects invalid bot templates", async () => {
  const handler = await loadBotHandler();
  const { context, handleBotApi } = createContext(handler, {
    method: "POST",
    path: "bot/templates",
    body: { key: "empty" },
  });

  await assert.rejects(() => handleBotApi(context), {
    statusCode: 400,
    code: "BOT_TEMPLATE_INVALID",
  });
});

test("triggers next-day bot jobs and exposes job history", async () => {
  const handler = await loadBotHandler();
  const { context, store, audits, handleBotApi } = createContext(handler, {
    method: "POST",
    path: "bot/jobs/trigger-next-day",
    body: { rainy: true, date: "2026-05-19T00:00:00.000Z" },
  });

  const triggered = await handleBotApi(context);

  assert.equal(triggered.data.job.type, "next_day_broadcast");
  assert.equal(triggered.data.job.createdBy, "admin-1");
  assert.equal(triggered.data.job.suggestions[0].code, "2300000001_rain");
  assert.equal(store.botJobs[0].id, triggered.data.job.id);
  assert.equal(audits[0].action, "bot_job_trigger_next_day");

  context.method = "GET";
  context.path = "bot/jobs/history";
  context.query = { limit: "1" };
  const history = await handleBotApi(context);
  assert.equal(history.data.total, 2);
  assert.deepEqual(
    history.data.items.map((item) => item.id),
    [triggered.data.job.id],
  );
});

test("runs heartbeat through token auth and records non-dry-run audit", async () => {
  const handler = await loadBotHandler();
  const { context, audits, db, handleBotApi } = createContext(handler, {
    method: "POST",
    path: "bot/jobs/heartbeat",
    headers: { "x-heartbeat-token": "heartbeat-token" },
    body: { runNextDay: true },
  });

  const heartbeat = await handleBotApi(context);

  assert.equal(heartbeat.data.window, "08:00-23:59");
  assert.equal(db.heartbeatOptions.caller, "cron");
  assert.equal(db.heartbeatOptions.actorUserId, "admin-1");
  assert.equal(db.heartbeatOptions.runNextDay, true);
  assert.equal(db.heartbeatOptions.deliveryQueue, "notification");
  assert.deepEqual(audits.map((item) => item.action), ["bot_job_heartbeat"]);
});

test("rejects invalid heartbeat token and maps invalid time errors", async () => {
  const handler = await loadBotHandler();
  const invalidToken = createContext(handler, {
    method: "POST",
    path: "bot/jobs/heartbeat",
    headers: { "x-heartbeat-token": "bad-token" },
  });

  await assert.rejects(() => invalidToken.handleBotApi(invalidToken.context), {
    statusCode: 401,
    code: "HEARTBEAT_TOKEN_INVALID",
  });

  const invalidTime = createContext(handler, {
    method: "POST",
    path: "bot/jobs/heartbeat",
    headers: { "x-heartbeat-token": "heartbeat-token" },
    body: { nowIso: "bad" },
  });

  await assert.rejects(() => invalidTime.handleBotApi(invalidTime.context), {
    statusCode: 400,
    code: "HEARTBEAT_NOW_INVALID",
  });
});

test("pulls and acknowledges legacy bot deliveries through delivery token", async () => {
  const handler = await loadBotHandler();
  const { context, db, handleBotApi } = createContext(handler, {
    path: "bot/deliveries/pending",
    query: { limit: "2" },
    headers: { "x-bot-delivery-token": "delivery-token" },
    runtimeConfig: { botDeliveryToken: "delivery-token", reminderDeliveryQueue: "legacy" },
    db: { pending: [{ id: "delivery-1" }, { id: "delivery-2" }, { id: "delivery-3" }] },
  });

  const pending = await handleBotApi(context);

  assert.equal(pending.data.limit, 2);
  assert.deepEqual(pending.data.items.map((item) => item.id), ["delivery-1", "delivery-2"]);
  assert.equal(db.pulledLimit, 2);

  context.method = "POST";
  context.path = "bot/deliveries/delivery-1/ack";
  context.readJsonBody = async () => ({ success: true, externalMessageId: "external-1" });
  const acked = await handleBotApi(context);
  assert.deepEqual(acked.data, { deliveryId: "delivery-1", status: "sent" });
  assert.equal(db.acks[0].deliveryId, "delivery-1");
});

test("pulls and acknowledges default notification-queue bot deliveries without D1", async () => {
  const handler = await loadBotHandler();
  const { context, store, handleBotApi } = createContext(handler, {
    path: "bot/deliveries/pending",
    query: { limit: "1" },
    headers: { "x-bot-delivery-token": "delivery-token" },
    runtimeConfig: { botDeliveryToken: "delivery-token" },
    db: null,
  });

  const pending = await handleBotApi(context);

  assert.equal(pending.data.limit, 1);
  assert.deepEqual(pending.data.items.map((item) => item.id), ["notification-delivery-1"]);
  assert.equal(store.pulledNotificationLimit, 1);
  assert.equal(store.notificationDeliveries[0].status, "sending");

  context.method = "POST";
  context.path = "bot/deliveries/notification-delivery-1/ack";
  context.readJsonBody = async () => ({ success: true, externalMessageId: "external-notification-1" });
  const acked = await handleBotApi(context);
  assert.deepEqual(acked.data, { deliveryId: "notification-delivery-1", status: "sent" });
  assert.equal(store.notificationDeliveries[0].status, "sent");
  assert.equal(store.notificationDeliveries[0].externalMessageId, "external-notification-1");
});

test("rejects missing delivery token config and missing delivery ack targets", async () => {
  const handler = await loadBotHandler();
  const missingConfig = createContext(handler, {
    path: "bot/deliveries/pending",
    headers: { "x-bot-delivery-token": "delivery-token" },
    runtimeConfig: {},
  });

  await assert.rejects(() => missingConfig.handleBotApi(missingConfig.context), {
    statusCode: 503,
    code: "BOT_DELIVERY_TOKEN_NOT_CONFIGURED",
  });

  const missingAck = createContext(handler, {
    method: "POST",
    path: "bot/deliveries/missing/ack",
    headers: { "x-bot-delivery-token": "delivery-token" },
    db: { pending: [], missingAck: "missing" },
  });

  await assert.rejects(() => missingAck.handleBotApi(missingAck.context), {
    statusCode: 404,
    code: "BOT_DELIVERY_NOT_FOUND",
  });
});

test("ignores unrelated paths", async () => {
  const handler = await loadBotHandler();
  const { context, handleBotApi } = createContext(handler, { path: "admin/users" });

  assert.equal(handler.isBotPath("bot/templates"), true);
  assert.equal(handler.isBotPath("bot/jobs/heartbeat"), true);
  assert.equal(handler.isBotPath("bot/deliveries/pending"), true);
  assert.equal(handler.isBotPath("admin/users"), false);
  assert.equal(await handleBotApi(context), null);
});
