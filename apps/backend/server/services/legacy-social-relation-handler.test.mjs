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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-social-relation-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacySocialRelationHandler = async () => {
  const circlePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-circle-handler.ts"),
    "legacy-circle-handler.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          export const storeHelpers = {
            createId: (prefix) => prefix + "_1",
            generateShareToken: () => "share-token-1",
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      ["from \"@touchx/shared\";", `from ${JSON.stringify(dataModule(""))};`],
    ],
  );
  const relationPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-social-relation-handler.ts"),
    "legacy-social-relation-handler.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          let seq = 0;
          export const storeHelpers = {
            createId: (prefix) => prefix + "_" + (++seq),
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      [
        "from \"../../services/social-collaboration-core\";",
        `from ${JSON.stringify(dataModule(`
          const scopes = ["busy_free", "detail", "hidden", "blocked"];
          export const normalizeVisibilityScope = (value, fallback = "busy_free") => scopes.includes(value) ? value : fallback;
          export const pickStrongerVisibilityScope = (left, right) => {
            const rank = { hidden: 0, busy_free: 1, detail: 2, blocked: 3 };
            return rank[right] > rank[left] ? right : left;
          };
          export const resolveEffectiveVisibilityScope = (edges) => {
            if (edges.some((edge) => edge.visibilityScope === "blocked")) return "blocked";
            if (edges.some((edge) => edge.visibilityScope === "detail")) return "detail";
            if (edges.some((edge) => edge.visibilityScope === "busy_free")) return "busy_free";
            return "hidden";
          };
          export const buildSocialRelationStatus = (input) => {
            const visibilityScope = normalizeVisibilityScope(input.effectiveVisibility, "hidden");
            let status = "none";
            if (input.isSelf) status = "self";
            else if (visibilityScope === "blocked") status = "blocked";
            else if (visibilityScope === "busy_free" || visibilityScope === "detail") status = "subscribed";
            else if (input.outboundPending) status = "pending_outbound";
            else if (input.inboundPending) status = "pending_inbound";
            const sources = Array.from(new Set(input.activeSources || []));
            return {
              status,
              visibilityScope,
              sources,
              canRequest: status === "none",
              canUnsubscribe: status === "subscribed" && sources.some((source) => source !== "circle"),
              canBlock: status !== "self" && status !== "blocked",
            };
          };
        `))};`,
      ],
      ["\"./legacy-circle-handler\"", JSON.stringify(pathToFileURL(circlePath).href)],
    ],
  );
  return import(pathToFileURL(relationPath).href);
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
    createUser({
      userId: "user-3",
      studentNo: "2305200103",
      studentId: "student-3",
      name: "Carol",
      nickname: "Carol同学",
      classLabel: "三班",
    }),
  ],
  socialSubscriptionRequests: [],
  socialSubscriptionEdges: [],
  socialNotifications: [],
  socialCircles: [],
  socialCircleMembers: [],
});

const createState = () => ({
  randomCodeByUserId: new Map([["user-1", "1234"]]),
  notifyBoundUserIds: new Set(["user-1"]),
  practiceCourseKeysByUserId: new Map([["user-1", new Set(["course-1"])]]),
  subscriptionTargetsByUserId: new Map(),
});

const upsertSocialSubscriptionEdge = (store, input) => {
  const circleId = input.source === "circle" ? input.circleId || "" : "";
  const existing = store.socialSubscriptionEdges.find((item) => {
    return item.subscriberUserId === input.subscriberUserId && item.targetUserId === input.targetUser.userId && item.source === input.source && item.circleId === circleId && item.status === "active";
  });
  if (existing) {
    existing.visibilityScope = input.visibilityScope;
    existing.updatedAt = now;
  } else {
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
  }
  const targets = contextState.subscriptionTargetsByUserId.get(input.subscriberUserId) || new Set();
  targets.add(input.targetUser.userId);
  contextState.subscriptionTargetsByUserId.set(input.subscriberUserId, targets);
};

let contextState = createState();

const revokeSocialSubscriptionBetweenUsers = (store, leftUser, rightUser, options = {}) => {
  const includeCircle = options.includeCircle !== false;
  let removed = false;
  store.socialSubscriptionEdges.forEach((edge) => {
    const matches =
      (edge.subscriberUserId === leftUser.userId && edge.targetUserId === rightUser.userId) ||
      (edge.subscriberUserId === rightUser.userId && edge.targetUserId === leftUser.userId);
    if (!matches || edge.status !== "active") return;
    if (!includeCircle && edge.source === "circle") return;
    edge.status = "revoked";
    edge.revokedAt = now;
    edge.updatedAt = now;
    removed = true;
  });
  return removed;
};

const blockSocialSubscriptionBetweenUsers = (store, leftUser, rightUser) => {
  const edges = [
    {
      id: `edge-${store.socialSubscriptionEdges.length + 1}`,
      subscriberUserId: leftUser.userId,
      targetUserId: rightUser.userId,
      visibilityScope: "blocked",
      source: "legacy",
      circleId: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: "",
    },
    {
      id: `edge-${store.socialSubscriptionEdges.length + 2}`,
      subscriberUserId: rightUser.userId,
      targetUserId: leftUser.userId,
      visibilityScope: "blocked",
      source: "legacy",
      circleId: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
      revokedAt: "",
    },
  ];
  store.socialSubscriptionEdges.push(...edges);
  return edges;
};

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  contextState = overrides.state || createState();
  const user = overrides.user || store.users[0];
  const context = {
    event: { body: overrides.body || {} },
    method: overrides.method || "GET",
    path: overrides.path || "social/me",
    query: overrides.query || {},
    store,
    state: contextState,
    getStoreRevision: () => 13,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ user }),
    resolveSocialActorUser: () => user,
    resolveRecipientUserIds: () => [user.userId, "user-2"],
    findUserByStudentId: (targetStore, studentId) => targetStore.users.find((item) => item.studentId === studentId) || null,
    isAdminRole: (targetUser) => targetUser.adminRole === "super_admin" || targetUser.adminRole === "operator",
    upsertSocialSubscriptionEdge,
    revokeSocialSubscriptionBetweenUsers,
    blockSocialSubscriptionBetweenUsers,
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
  };
  return { context, store, state: contextState, handleLegacySocialRelationApi: handler.handleLegacySocialRelationApi };
};

test("builds social me payload with subscriptions, candidates, circles, and unread notifications", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const store = createStore();
  const state = createState();
  state.subscriptionTargetsByUserId.set("user-1", new Set(["user-2"]));
  store.socialSubscriptionEdges.push({
    id: "edge-1",
    subscriberUserId: "user-1",
    targetUserId: "user-2",
    visibilityScope: "detail",
    source: "request",
    circleId: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
    revokedAt: "",
  });
  store.socialSubscriptionRequests.push({
    id: "req-1",
    requesterUserId: "user-3",
    targetUserId: "user-1",
    requestedVisibility: "busy_free",
    status: "pending",
    decidedVisibility: "hidden",
    decidedAt: "",
    createdAt: now,
    updatedAt: now,
  });
  store.socialCircles.push({
    id: "circle-1",
    name: "自习圈",
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
  store.socialNotifications.push({
    id: "notify-1",
    type: "subscription_request",
    recipientUserId: "user-2",
    actorUserId: "user-3",
    title: "订阅请求",
    body: "测试",
    payload: {},
    status: "unread",
    createdAt: now,
    readAt: "",
  });
  const { context, handleLegacySocialRelationApi } = createContext(handler, { store, state });

  const response = await handleLegacySocialRelationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.me.studentId, "student-1");
  assert.equal(response.subscriptions[0].studentId, "student-2");
  assert.equal(response.subscriptions[0].relationStatus.status, "subscribed");
  assert.equal(response.candidates.some((item) => item.studentId === "student-3"), true);
  assert.equal(response.subscriptionRequests[0].requestId, "req-1");
  assert.equal(response.circles[0].circleId, "circle-1");
  assert.equal(response.unreadNotificationCount, 1);
  assert.equal(response.stateRevision, 13);
});

test("searches users and includes relation status", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const { context, handleLegacySocialRelationApi } = createContext(handler, {
    path: "social/users/search",
    query: { q: "Bob" },
  });

  const response = await handleLegacySocialRelationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.total, 1);
  assert.equal(response.items[0].studentId, "student-2");
  assert.equal(response.items[0].relationStatus.status, "none");
});

test("creates a subscription request and notification", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const { context, store, handleLegacySocialRelationApi } = createContext(handler, {
    method: "POST",
    path: "social/subscription-requests",
    body: { targetStudentId: "student-2", visibilityScope: "detail" },
  });

  const response = await handleLegacySocialRelationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.pending, true);
  assert.equal(response.request.requestedVisibility, "detail");
  assert.equal(store.socialSubscriptionRequests.length, 1);
  assert.equal(store.socialNotifications[0].type, "subscription_request");
});

test("handles legacy subscribe route for pending requests and admin direct grants", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const pendingContext = createContext(handler, {
    method: "POST",
    path: "social/subscribe",
    body: { targetStudentId: "student-2", visibilityScope: "detail" },
  });

  const pendingResponse = await pendingContext.handleLegacySocialRelationApi(pendingContext.context);

  assert.equal(pendingResponse.ok, true);
  assert.equal(pendingResponse.pending, true);
  assert.equal(pendingResponse.subscribed, false);
  assert.equal(pendingResponse.request.requestedVisibility, "detail");
  assert.equal(pendingContext.store.socialSubscriptionRequests.length, 1);
  assert.equal(pendingContext.store.socialNotifications[0].type, "subscription_request");

  const adminStore = createStore();
  const adminContext = createContext(handler, {
    store: adminStore,
    user: createUser({
      userId: "admin-1",
      studentNo: "999999",
      studentId: "admin-student",
      adminRole: "operator",
    }),
    method: "POST",
    path: "social/subscribe",
    body: { targetStudentId: "student-2", visibilityScope: "busy_free" },
  });

  const adminResponse = await adminContext.handleLegacySocialRelationApi(adminContext.context);

  assert.equal(adminResponse.ok, true);
  assert.equal(adminResponse.subscribed, true);
  assert.equal(adminResponse.visibilityScope, "detail");
  assert.equal(adminStore.socialSubscriptionEdges[0].source, "legacy");
  assert.equal(adminStore.socialSubscriptionEdges[0].visibilityScope, "detail");
});

test("accepts a subscription request and creates bidirectional edges", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const store = createStore();
  store.socialSubscriptionRequests.push({
    id: "req-1",
    requesterUserId: "user-1",
    targetUserId: "user-2",
    requestedVisibility: "detail",
    status: "pending",
    decidedVisibility: "hidden",
    decidedAt: "",
    createdAt: now,
    updatedAt: now,
  });
  const { context, handleLegacySocialRelationApi } = createContext(handler, {
    store,
    user: store.users[1],
    method: "POST",
    path: "social/subscription-requests/req-1/decision",
    body: { decision: "accept", visibilityScope: "detail" },
  });

  const response = await handleLegacySocialRelationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.request.status, "accepted");
  assert.equal(store.socialSubscriptionEdges.length, 2);
  assert.deepEqual(
    store.socialSubscriptionEdges.map((item) => [item.subscriberUserId, item.targetUserId, item.visibilityScope, item.source]),
    [
      ["user-1", "user-2", "detail", "request"],
      ["user-2", "user-1", "busy_free", "request"],
    ],
  );
  assert.equal(store.socialNotifications[0].type, "subscription_accepted");
});

test("rejects a subscription request without creating edges", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const store = createStore();
  store.socialSubscriptionRequests.push({
    id: "req-1",
    requesterUserId: "user-1",
    targetUserId: "user-2",
    requestedVisibility: "detail",
    status: "pending",
    decidedVisibility: "hidden",
    decidedAt: "",
    createdAt: now,
    updatedAt: now,
  });
  const { context, handleLegacySocialRelationApi } = createContext(handler, {
    store,
    user: store.users[1],
    method: "POST",
    path: "social/subscription-requests/req-1/decision",
    body: { decision: "reject" },
  });

  const response = await handleLegacySocialRelationApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.request.status, "rejected");
  assert.equal(store.socialSubscriptionEdges.length, 0);
  assert.equal(store.socialNotifications[0].type, "subscription_rejected");
});

test("deletes active subscriptions and blocks users", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const store = createStore();
  store.socialSubscriptionEdges.push({
    id: "edge-1",
    subscriberUserId: "user-1",
    targetUserId: "user-2",
    visibilityScope: "detail",
    source: "request",
    circleId: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
    revokedAt: "",
  });
  const deleteContext = createContext(handler, {
    store,
    method: "DELETE",
    path: "social/subscriptions/edge-1",
  });

  const deleteResponse = await deleteContext.handleLegacySocialRelationApi(deleteContext.context);

  assert.equal(deleteResponse.ok, true);
  assert.equal(deleteResponse.removed, true);
  assert.equal(store.socialSubscriptionEdges[0].status, "revoked");
  assert.equal(store.socialNotifications[0].type, "subscription_revoked");

  const blockContext = createContext(handler, {
    store,
    method: "POST",
    path: "social/subscriptions/block",
    body: { targetStudentId: "student-2" },
  });

  const blockResponse = await blockContext.handleLegacySocialRelationApi(blockContext.context);

  assert.equal(blockResponse.ok, true);
  assert.equal(blockResponse.blocked, true);
  assert.equal(blockResponse.edges.length, 2);
  assert.equal(store.socialSubscriptionEdges.filter((item) => item.visibilityScope === "blocked").length, 2);
});

test("handles legacy subscribe remove while preserving circle visibility hint", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const store = createStore();
  store.socialSubscriptionEdges.push(
    {
      id: "edge-1",
      subscriberUserId: "user-1",
      targetUserId: "user-2",
      visibilityScope: "detail",
      source: "request",
      circleId: "",
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
  store.socialCircleMembers.push(
    {
      id: "member-1",
      circleId: "circle-1",
      userId: "user-1",
      role: "member",
      visibilityScope: "busy_free",
      status: "active",
      joinedAt: now,
      leftAt: "",
      updatedAt: now,
    },
    {
      id: "member-2",
      circleId: "circle-1",
      userId: "user-2",
      role: "member",
      visibilityScope: "busy_free",
      status: "active",
      joinedAt: now,
      leftAt: "",
      updatedAt: now,
    },
  );
  const removeContext = createContext(handler, {
    store,
    method: "POST",
    path: "social/subscribe/remove",
    body: { targetStudentId: "student-2" },
  });

  const response = await removeContext.handleLegacySocialRelationApi(removeContext.context);

  assert.equal(response.ok, true);
  assert.equal(response.removed, true);
  assert.equal(response.stillVisibleViaCircle, true);
  assert.equal(store.socialSubscriptionEdges[0].status, "revoked");
  assert.equal(store.socialSubscriptionEdges[1].status, "active");
  assert.equal(store.socialNotifications[0].type, "subscription_revoked");
});

test("ignores unrelated social relation paths", async () => {
  const handler = await loadLegacySocialRelationHandler();
  const { context, handleLegacySocialRelationApi } = createContext(handler, { path: "social/circles" });

  assert.equal(handler.isLegacySocialRelationPath("social/me"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/users/search"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/subscribe"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/subscribe/remove"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/subscription-requests"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/subscription-requests/req-1/decision"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/subscriptions/edge-1"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/subscriptions/block"), true);
  assert.equal(handler.isLegacySocialRelationPath("social/circles"), false);
  assert.equal(await handleLegacySocialRelationApi(context), null);
});
