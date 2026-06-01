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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-notification-admin-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const toDataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const loadNotificationAdminHandler = async () => {
  const channelService = `
    export const listNotificationChannels = () => ({ items: [{ id: 'channel-feishu', type: 'feishu' }], total: 1 });
    export const upsertNotificationChannel = (_store, input) => ({ id: input.id || 'channel-feishu', type: input.type, name: input.name || 'Feishu', enabled: input.enabled ?? true, config: input.config || {} });
    export const createNotificationTestDelivery = async () => ({ id: 'delivery-test', status: 'sent' });
  `;
  const deliveryService = `
    export const dispatchPendingNotificationDeliveries = async (_store, options = {}) => ({ items: [], total: 0, limit: options.limit || 20 });
    export const retryFailedNotificationDelivery = async (_store, deliveryId) => ({ item: { id: deliveryId, status: 'sent', attemptCount: 1, channelType: 'feishu' }, retried: true, reason: 'retried' });
  `;
  const bindingService = `
    export const listAdminNotificationBindings = (_store, options) => ({ items: [], total: 0, limit: options.limit, offset: options.offset });
    export const upsertAdminNotificationBinding = (_store, input) => ({ ok: true, item: { id: input.id || 'binding-created', userId: input.userId, channelType: input.channelType || 'feishu', status: input.status || 'active' }, created: !input.id });
    export const deleteAdminNotificationBinding = (_store, bindingId) => ({ id: bindingId, userId: 'user-1', channelType: 'feishu', status: 'active' });
  `;
  const reminderRuleService = `
    export const listReminderRules = () => ({ items: [], total: 0 });
    export const upsertReminderRule = (_store, input) => ({ id: input.id || 'rule-created', targetType: input.targetType || 'global', targetId: input.targetId || 'global' });
    export const deleteReminderRule = (_store, ruleId) => ({ id: ruleId, targetType: 'global', targetId: 'global' });
  `;
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/notification-admin-handler.ts"),
    "notification-admin-handler.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", "\"data:text/javascript,export {};\""],
      ["\"./notification-channel-service\"", JSON.stringify(toDataModule(channelService))],
      ["\"./notification-delivery-service\"", JSON.stringify(toDataModule(deliveryService))],
      ["\"./notification-binding-service\"", JSON.stringify(toDataModule(bindingService))],
      ["\"./reminder-rule-service\"", JSON.stringify(toDataModule(reminderRuleService))],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const createStore = () => ({
  notificationDeliveries: [
    { id: "delivery-1", status: "failed", payload: {} },
    { id: "delivery-2", status: "pending", payload: { sourceQueue: "notification" } },
    { id: "delivery-3", status: "sent", payload: {} },
  ],
});

const createContext = ({
  method = "GET",
  path = "admin/notification-channels",
  query = {},
  body = {},
  authenticated = true,
  store = createStore(),
} = {}) => {
  const calls = {
    requireAdmin: 0,
    readJsonBody: 0,
    audits: [],
  };
  const context = {
    event: {},
    method,
    path,
    query,
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireAdmin: () => {
      calls.requireAdmin += 1;
      if (!authenticated) {
        const error = new Error("admin required");
        Object.assign(error, { statusCode: 401, code: "ADMIN_AUTH_REQUIRED" });
        throw error;
      }
      return { user: { userId: "admin-1" } };
    },
    readJsonBody: async () => {
      calls.readJsonBody += 1;
      return body;
    },
    appendAudit: (action, actorUserId, payload) => calls.audits.push({ action, actorUserId, payload }),
  };
  return { context, calls };
};

const protectedRoutes = [
  { method: "GET", path: "admin/notification-channels" },
  { method: "POST", path: "admin/notification-channels" },
  { method: "POST", path: "admin/notification-channels/feishu/test" },
  { method: "GET", path: "admin/notification-bindings" },
  { method: "POST", path: "admin/notification-bindings" },
  { method: "POST", path: "admin/notification-bindings/binding-1/delete" },
  { method: "GET", path: "admin/notification-deliveries" },
  { method: "POST", path: "admin/notification-deliveries/dispatch-pending" },
  { method: "POST", path: "admin/notification-deliveries/delivery-1/retry" },
  { method: "GET", path: "admin/reminder-rules" },
  { method: "POST", path: "admin/reminder-rules" },
  { method: "POST", path: "admin/reminder-rules/rule-1/delete" },
];

test("requires admin before handling notification admin routes", async () => {
  const { handleNotificationAdminApi } = await loadNotificationAdminHandler();

  for (const route of protectedRoutes) {
    const { context, calls } = createContext({
      ...route,
      authenticated: false,
      body: { userId: "user-1", channelType: "feishu", externalOpenId: "ou_user_1" },
    });

    await assert.rejects(() => handleNotificationAdminApi(context), (error) => {
      assert.equal(error.statusCode, 401, `${route.method} ${route.path}`);
      assert.equal(error.code, "ADMIN_AUTH_REQUIRED", `${route.method} ${route.path}`);
      return true;
    });
    assert.equal(calls.requireAdmin, 1, `${route.method} ${route.path}`);
    assert.equal(calls.readJsonBody, 0, `${route.method} ${route.path}`);
    assert.equal(calls.audits.length, 0, `${route.method} ${route.path}`);
  }
});

test("handles authorized notification binding upsert through admin handler", async () => {
  const { handleNotificationAdminApi } = await loadNotificationAdminHandler();
  const { context, calls } = createContext({
    method: "POST",
    path: "admin/notification-bindings",
    body: { userId: "user-1", channelType: "feishu", externalOpenId: "ou_user_1" },
  });

  const response = await handleNotificationAdminApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.data.item.id, "binding-created");
  assert.equal(calls.requireAdmin, 1);
  assert.equal(calls.readJsonBody, 1);
  assert.equal(calls.audits[0].action, "notification_binding_upsert");
  assert.equal(calls.audits[0].actorUserId, "admin-1");
});

test("filters notification deliveries by status and source queue", async () => {
  const { handleNotificationAdminApi } = await loadNotificationAdminHandler();
  const { context } = createContext({
    method: "GET",
    path: "admin/notification-deliveries",
    query: { status: "pending", sourceQueue: "notification" },
  });

  const response = await handleNotificationAdminApi(context);

  assert.equal(response.ok, true);
  assert.deepEqual(response.data.items.map((item) => item.id), ["delivery-2"]);
  assert.equal(response.data.total, 1);
});

test("filters notification deliveries without a source queue as standard", async () => {
  const { handleNotificationAdminApi } = await loadNotificationAdminHandler();
  const { context } = createContext({
    method: "GET",
    path: "admin/notification-deliveries",
    query: { sourceQueue: "standard" },
  });

  const response = await handleNotificationAdminApi(context);

  assert.equal(response.ok, true);
  assert.deepEqual(response.data.items.map((item) => item.id), ["delivery-1", "delivery-3"]);
  assert.equal(response.data.total, 2);
});

test("ignores non-notification admin paths without requiring admin", async () => {
  const { handleNotificationAdminApi } = await loadNotificationAdminHandler();
  const { context, calls } = createContext({
    path: "admin/import-candidate-jobs",
  });

  const response = await handleNotificationAdminApi(context);

  assert.equal(response, null);
  assert.equal(calls.requireAdmin, 0);
});
