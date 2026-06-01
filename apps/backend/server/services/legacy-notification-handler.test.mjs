import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadLegacyNotificationHandler = async () => {
  const sourcePath = join(import.meta.dirname, "../modules/legacy/legacy-notification-handler.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-notification-handler-")), "legacy-notification-handler.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

const now = "2026-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2300000001",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "",
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

const createNotification = (overrides = {}) => ({
  id: "notify-1",
  type: "subscription_request",
  recipientUserId: "user-1",
  actorUserId: "actor-1",
  title: "新的订阅请求",
  body: "有人想查看你的日程",
  payload: { requestId: "req-1" },
  status: "unread",
  createdAt: "2026-06-01T08:00:00.000Z",
  readAt: "",
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser(),
    createUser({
      userId: "actor-1",
      studentNo: "2300000002",
      studentId: "student-2",
      name: "2300000002",
      nickname: "Bob同学",
    }),
    createUser({
      userId: "bound-1",
      studentNo: "2300000003",
      studentId: "student-3",
      name: "Carol",
      nickname: "Carol同学",
    }),
    createUser({
      userId: "other-1",
      studentNo: "2300000004",
      studentId: "student-4",
      name: "Other",
      nickname: "Other同学",
    }),
  ],
  socialNotifications: [
    createNotification({ id: "notify-latest", createdAt: "2026-06-01T09:00:00.000Z" }),
    createNotification({ id: "notify-bound", recipientUserId: "bound-1", createdAt: "2026-06-01T08:30:00.000Z" }),
    createNotification({ id: "notify-read", status: "read", createdAt: "2026-06-01T08:15:00.000Z", readAt: "2026-06-01T08:20:00.000Z" }),
    createNotification({ id: "notify-other", recipientUserId: "other-1", createdAt: "2026-06-01T10:00:00.000Z" }),
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const currentUser = overrides.user || store.users[0];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "notifications",
    query: overrides.query || {},
    store,
    getStoreRevision: () => 42,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireLegacyAuth: () => ({ user: currentUser }),
    resolveRecipientUserIds: overrides.resolveRecipientUserIds || (() => [currentUser.userId, "bound-1"]),
    nowIso: () => "2026-06-01T12:00:00.000Z",
  };
  return { context, store, handleLegacyNotificationApi: handler.handleLegacyNotificationApi };
};

test("lists notifications for account and bound target recipients", async () => {
  const handler = await loadLegacyNotificationHandler();
  const { context, handleLegacyNotificationApi } = createContext(handler, { query: { limit: "2" } });

  const response = await handleLegacyNotificationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.stateRevision, 42);
  assert.equal(response.unreadCount, 2);
  assert.deepEqual(response.items.map((item) => item.notificationId), ["notify-latest", "notify-bound"]);
  assert.equal(response.items[0].actorName, "Bob同学");
  assert.equal(response.items.some((item) => item.notificationId === "notify-other"), false);
});

test("marks an owned notification as read", async () => {
  const handler = await loadLegacyNotificationHandler();
  const { context, store, handleLegacyNotificationApi } = createContext(handler, {
    method: "POST",
    path: "notifications/notify-bound/read",
  });

  const response = await handleLegacyNotificationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.notification.notificationId, "notify-bound");
  assert.equal(response.notification.status, "read");
  assert.equal(response.notification.readAt, "2026-06-01T12:00:00.000Z");
  assert.equal(store.socialNotifications.find((item) => item.id === "notify-bound").status, "read");
});

test("rejects reading notifications outside visible recipients", async () => {
  const handler = await loadLegacyNotificationHandler();
  const { context, handleLegacyNotificationApi } = createContext(handler, {
    method: "POST",
    path: "notifications/notify-other/read",
  });

  await assert.rejects(() => handleLegacyNotificationApi(context), {
    statusCode: 404,
    code: "NOTIFICATION_NOT_FOUND",
  });
});

test("ignores unrelated legacy notification paths", async () => {
  const handler = await loadLegacyNotificationHandler();
  const { context, handleLegacyNotificationApi } = createContext(handler, {
    path: "social/me",
  });

  assert.equal(handler.isLegacyNotificationPath("notifications"), true);
  assert.equal(handler.isLegacyNotificationPath("notifications/notify-1/read"), true);
  assert.equal(handler.isLegacyNotificationPath("notifications/notify-1/delete"), false);
  assert.equal(await handleLegacyNotificationApi(context), null);
});
