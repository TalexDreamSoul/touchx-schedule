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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-notification-binding-user-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadNotificationBindingUserHandler = async () => {
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/notification-binding-service.ts"),
    "notification-binding-service.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/notification-binding-user-handler.ts"),
    "notification-binding-user-handler.mjs",
    [
      ["\"../../services/domain-store\"", "\"data:text/javascript,export {};\""],
      ["\"./notification-binding-service\"", JSON.stringify(pathToFileURL(servicePath).href)],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-05-18T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2300000001",
  studentId: "student-1",
  accountName: "alice@example.test",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: [],
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
    createUser({ userId: "user-2", studentNo: "2300000002", accountName: "bob@example.test", nickname: "Bob同学" }),
  ],
  userNotificationBindings: [
    {
      id: "binding-owned",
      userId: "user-1",
      channelType: "feishu",
      externalUserId: "ou_user_1",
      externalOpenId: "ou_user_1",
      externalUnionId: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "binding-other",
      userId: "user-2",
      channelType: "wechat_clawdbot",
      externalUserId: "wx_user_2",
      externalOpenId: "wx_open_2",
      externalUnionId: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "calendar/me/notification-bindings",
    store,
    ok: (data) => ({ ok: true, data }),
    requireUser: () => ({ user }),
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
  };
  return { context, store, user, audits, handleNotificationBindingUserApi: handler.handleNotificationBindingUserApi };
};

test("lists current user's notification bindings only", async () => {
  const handler = await loadNotificationBindingUserHandler();
  const { context, handleNotificationBindingUserApi } = createContext(handler);

  const response = await handleNotificationBindingUserApi(context);

  assert.equal(response.data.total, 1);
  assert.equal(response.data.items[0].id, "binding-owned");
});

test("creates and refreshes WeChat ClawDBot binding QR payload", async () => {
  const handler = await loadNotificationBindingUserHandler();
  const { context, store, audits, handleNotificationBindingUserApi } = createContext(handler, {
    method: "POST",
    path: "calendar/me/notification-bindings/wechat-clawdbot/qr",
  });

  const created = await handleNotificationBindingUserApi(context);
  const createdBinding = store.userNotificationBindings.find((item) => item.userId === "user-1" && item.channelType === "wechat_clawdbot");

  assert.match(created.data.bindingToken, /^wxbind_[0-9a-f]{32}$/);
  assert.match(created.data.qrPayload, /^touchx:\/\/wechat-clawdbot\/bind\?/);
  assert.match(created.data.qrImageUrl, /^data:image\/svg\+xml;utf8,/);
  assert.equal(created.data.binding.id, createdBinding.id);
  assert.equal(createdBinding.externalOpenId, created.data.bindingToken);
  assert.equal(createdBinding.externalUserId, "alice@example.test");
  assert.equal(createdBinding.status, "active");
  assert.equal(audits[0].action, "wechat_clawdbot_qr_create");

  const refreshed = await handleNotificationBindingUserApi(context);
  const ownedWechatBindings = store.userNotificationBindings.filter((item) => item.userId === "user-1" && item.channelType === "wechat_clawdbot");
  assert.equal(ownedWechatBindings.length, 1);
  assert.notEqual(refreshed.data.bindingToken, created.data.bindingToken);
  assert.equal(ownedWechatBindings[0].externalOpenId, refreshed.data.bindingToken);
});

test("unbinds current user's WeChat ClawDBot bindings", async () => {
  const handler = await loadNotificationBindingUserHandler();
  const store = createStore();
  store.userNotificationBindings.push({
    id: "binding-owned-wechat",
    userId: "user-1",
    channelType: "wechat_clawdbot",
    externalUserId: "alice@example.test",
    externalOpenId: "wxbind_old",
    externalUnionId: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const { context, audits, handleNotificationBindingUserApi } = createContext(handler, {
    store,
    method: "POST",
    path: "calendar/me/notification-bindings/wechat-clawdbot/unbind",
  });

  const response = await handleNotificationBindingUserApi(context);

  assert.equal(response.data.unbound, true);
  assert.equal(store.userNotificationBindings.find((item) => item.id === "binding-owned-wechat").status, "disabled");
  assert.equal(store.userNotificationBindings.find((item) => item.id === "binding-other").status, "active");
  assert.equal(audits[0].action, "wechat_clawdbot_unbind");
});

test("ignores unrelated notification binding paths", async () => {
  const handler = await loadNotificationBindingUserHandler();
  const { context, handleNotificationBindingUserApi } = createContext(handler, { path: "calendar/me/reminder-rules" });

  assert.equal(handler.isNotificationBindingUserPath("calendar/me/notification-bindings"), true);
  assert.equal(handler.isNotificationBindingUserPath("calendar/me/notification-bindings/wechat-clawdbot/qr"), true);
  assert.equal(handler.isNotificationBindingUserPath("calendar/me/reminder-rules"), false);
  assert.equal(await handleNotificationBindingUserApi(context), null);
});
