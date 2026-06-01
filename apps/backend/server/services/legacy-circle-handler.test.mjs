import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-circle-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyCircleHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-circle-handler.ts"),
    "legacy-circle-handler.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          let seq = 0;
          export const storeHelpers = {
            createId: (prefix) => prefix + "_" + (++seq),
            generateShareToken: () => "share-token-1",
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      ["from \"@touchx/shared\";", `from ${JSON.stringify(dataModule(""))};`],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2305200101",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "一班",
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
    createUser({
      userId: "user-2",
      studentNo: "2305200102",
      studentId: "student-2",
      name: "Bob",
      nickname: "Bob同学",
      classLabel: "二班",
    }),
  ],
  socialCircles: [],
  socialCircleMembers: [],
  socialSubscriptionEdges: [],
  socialNotifications: [],
});

const createExistingCircleStore = () => {
  const store = createStore();
  store.socialCircles.push({
    id: "circle-1",
    name: "自习搭子",
    circleType: "custom",
    ownerUserId: "user-1",
    inviteToken: "invite-1",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  store.socialCircleMembers.push({
    id: "member-1",
    circleId: "circle-1",
    userId: "user-1",
    role: "owner",
    visibilityScope: "detail",
    status: "active",
    joinedAt: now,
    leftAt: "",
    updatedAt: now,
  });
  return store;
};

const normalizeVisibilityScope = (value, fallback = "busy_free") => {
  return ["busy_free", "detail", "hidden", "blocked"].includes(value) ? value : fallback;
};

const upsertSocialSubscriptionEdge = (store, input) => {
  const circleId = input.source === "circle" ? input.circleId || "" : "";
  const existing = store.socialSubscriptionEdges.find((item) => {
    return item.subscriberUserId === input.subscriberUserId && item.targetUserId === input.targetUser.userId && item.source === input.source && item.circleId === circleId && item.status === "active";
  });
  if (existing) {
    existing.visibilityScope = input.visibilityScope;
    existing.updatedAt = now;
    return;
  }
  store.socialSubscriptionEdges.push({
    id: `edge-${store.socialSubscriptionEdges.length + 1}`,
    subscriberUserId: input.subscriberUserId,
    targetUserId: input.targetUser.userId,
    visibilityScope: input.visibilityScope,
    source: input.source,
    circleId,
    status: "active",
    createdAt: now,
    updatedAt: now,
    revokedAt: "",
  });
};

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const context = {
    event: { body: overrides.body || {} },
    method: overrides.method || "GET",
    path: overrides.path || "social/circles",
    query: overrides.query || {},
    store,
    getStoreRevision: () => 11,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ user }),
    resolveSocialActorUser: () => user,
    normalizeVisibilityScope,
    upsertSocialSubscriptionEdge,
    syncLegacySubscriptionTarget: (targetStore, subscriberUserId, targetUser) => {
      targetStore.syncedPairs = targetStore.syncedPairs || [];
      targetStore.syncedPairs.push({ subscriberUserId, targetUserId: targetUser.userId });
    },
    createSocialNotification: (targetStore, input) => {
      const notification = {
        id: `notify-${targetStore.socialNotifications.length + 1}`,
        ...input,
        payload: input.payload || {},
        status: "unread",
        createdAt: now,
        readAt: "",
      };
      targetStore.socialNotifications.unshift(notification);
      return notification;
    },
    resolveUserDisplayLabel: (targetUser) => targetUser.nickname || targetUser.name || targetUser.studentNo || "未命名用户",
  };
  return { context, store, handleLegacyCircleApi: handler.handleLegacyCircleApi };
};

test("creates a circle with an owner member", async () => {
  const handler = await loadLegacyCircleHandler();
  const { context, store, handleLegacyCircleApi } = createContext(handler, {
    method: "POST",
    body: { name: "高数复习圈", circleType: "club" },
  });

  const response = await handleLegacyCircleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.stateRevision, 11);
  assert.equal(response.circle.name, "高数复习圈");
  assert.equal(response.circle.circleType, "club");
  assert.equal(response.circle.memberCount, 1);
  assert.equal(store.socialCircles.length, 1);
  assert.equal(store.socialCircleMembers[0].role, "owner");
});

test("lists only circles joined by the current actor", async () => {
  const handler = await loadLegacyCircleHandler();
  const store = createExistingCircleStore();
  store.socialCircles.push({
    id: "circle-2",
    name: "未加入圈子",
    circleType: "custom",
    ownerUserId: "user-2",
    inviteToken: "invite-2",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const { context, handleLegacyCircleApi } = createContext(handler, { store });

  const response = await handleLegacyCircleApi(context);

  assert.equal(response.ok, true);
  assert.deepEqual(response.items.map((item) => item.circleId), ["circle-1"]);
});

test("previews an invite token and reports joined state", async () => {
  const handler = await loadLegacyCircleHandler();
  const store = createExistingCircleStore();
  const { context, handleLegacyCircleApi } = createContext(handler, {
    store,
    path: "social/circles/join-preview",
    query: { token: "invite-1" },
  });

  const response = await handleLegacyCircleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.circle.circleId, "circle-1");
  assert.equal(response.joined, true);
  assert.equal(response.currentVisibilityScope, "detail");
});

test("joins a circle and creates bidirectional circle subscription edges", async () => {
  const handler = await loadLegacyCircleHandler();
  const store = createExistingCircleStore();
  const user = store.users[1];
  const { context, handleLegacyCircleApi } = createContext(handler, {
    store,
    user,
    method: "POST",
    path: "social/circles/circle-1/join",
    body: { inviteToken: "invite-1", visibilityScope: "busy_free" },
  });

  const response = await handleLegacyCircleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.member.userId, "user-2");
  assert.equal(store.socialCircleMembers.filter((item) => item.status === "active").length, 2);
  assert.equal(store.socialSubscriptionEdges.length, 2);
  assert.deepEqual(
    store.socialSubscriptionEdges.map((item) => [item.subscriberUserId, item.targetUserId, item.visibilityScope, item.circleId]),
    [
      ["user-2", "user-1", "detail", "circle-1"],
      ["user-1", "user-2", "busy_free", "circle-1"],
    ],
  );
  assert.equal(store.socialNotifications[0].type, "circle_joined");
});

test("leaves a circle and revokes related circle edges", async () => {
  const handler = await loadLegacyCircleHandler();
  const store = createExistingCircleStore();
  store.socialCircleMembers.push({
    id: "member-2",
    circleId: "circle-1",
    userId: "user-2",
    role: "member",
    visibilityScope: "busy_free",
    status: "active",
    joinedAt: now,
    leftAt: "",
    updatedAt: now,
  });
  store.socialSubscriptionEdges.push(
    {
      id: "edge-1",
      subscriberUserId: "user-2",
      targetUserId: "user-1",
      visibilityScope: "detail",
      source: "circle",
      circleId: "circle-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: "",
    },
    {
      id: "edge-2",
      subscriberUserId: "user-1",
      targetUserId: "user-2",
      visibilityScope: "busy_free",
      source: "circle",
      circleId: "circle-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: "",
    },
  );
  const user = store.users[1];
  const { context, handleLegacyCircleApi } = createContext(handler, {
    store,
    user,
    method: "POST",
    path: "social/circles/circle-1/leave",
  });

  const response = await handleLegacyCircleApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.left, true);
  assert.equal(store.socialCircleMembers.find((item) => item.id === "member-2").status, "left");
  assert.equal(store.socialSubscriptionEdges.every((item) => item.status === "revoked"), true);
  assert.deepEqual(store.syncedPairs, [
    { subscriberUserId: "user-2", targetUserId: "user-1" },
    { subscriberUserId: "user-1", targetUserId: "user-2" },
  ]);
  assert.equal(store.socialNotifications[0].type, "circle_left");
});

test("ignores unrelated legacy circle paths", async () => {
  const handler = await loadLegacyCircleHandler();
  const { context, handleLegacyCircleApi } = createContext(handler, { path: "social/users/search" });

  assert.equal(handler.isLegacyCirclePath("social/circles"), true);
  assert.equal(handler.isLegacyCirclePath("social/circles/join-preview"), true);
  assert.equal(handler.isLegacyCirclePath("social/circles/circle-1/join"), true);
  assert.equal(handler.isLegacyCirclePath("social/circles/circle-1/leave"), true);
  assert.equal(handler.isLegacyCirclePath("social/users/search"), false);
  assert.equal(await handleLegacyCircleApi(context), null);
});
