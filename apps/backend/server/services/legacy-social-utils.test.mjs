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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-social-utils-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacySocialUtils = async () => {
  const statePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-state.ts"),
    "legacy-state.mjs",
    [
      [
        "from \"../../services/food-utils\";",
        `from ${JSON.stringify(dataModule("export const normalizeCaloriesKcal=(value,fallback=0)=>Number(value||fallback||0);"))};`,
      ],
    ],
  );
  const userUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-user-utils.ts"),
    "legacy-user-utils.mjs",
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
      ["\"./legacy-state\"", JSON.stringify(pathToFileURL(statePath).href)],
    ],
  );
  const socialUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-social-utils.ts"),
    "legacy-social-utils.mjs",
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
        "from \"../../services/schedule-calendar\";",
        `from ${JSON.stringify(dataModule(`
          export const getUserReminderTimezone = () => "Asia/Shanghai";
          export const resolveCurrentWeekForDate = () => 1;
          export const isScheduleEntryInWeek = () => true;
          export const getEffectiveScheduleEntriesForUser = (store, user) => store.effectiveScheduleEntriesByUserId?.[user.userId] || [];
        `))};`,
      ],
      [
        "from \"../../services/social-collaboration-core\";",
        `from ${JSON.stringify(dataModule(`
          const rank = { hidden: 0, busy_free: 1, detail: 2, blocked: 3 };
          export const normalizeVisibilityScope = (value, fallback = "busy_free") => Object.prototype.hasOwnProperty.call(rank, value) ? value : fallback;
          export const pickStrongerVisibilityScope = (left, right) => rank[right] > rank[left] ? right : left;
          export const resolveEffectiveVisibilityScope = (edges) => {
            if (edges.some((item) => item.status === "active" && item.visibilityScope === "blocked")) return "blocked";
            if (edges.some((item) => item.status === "active" && item.visibilityScope === "detail")) return "detail";
            if (edges.some((item) => item.status === "active" && item.visibilityScope === "busy_free")) return "busy_free";
            return "hidden";
          };
          export const buildSocialRelationStatus = (input) => ({
            status: input.isSelf ? "self" : input.effectiveVisibility === "hidden" ? "none" : "subscribed",
            visibilityScope: input.effectiveVisibility,
            sources: input.activeSources,
            canRequest: input.effectiveVisibility === "hidden",
            canUnsubscribe: input.activeSources.some((source) => source !== "circle"),
            canBlock: !input.isSelf,
          });
        `))};`,
      ],
      ["\"./legacy-state\"", JSON.stringify(pathToFileURL(statePath).href)],
      ["\"./legacy-user-utils\"", JSON.stringify(pathToFileURL(userUtilsPath).href)],
    ],
  );
  return import(pathToFileURL(socialUtilsPath).href);
};

const nowIso = "2026-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user_1",
  studentNo: "2305200101",
  studentId: "student_1",
  name: "Alice",
  classLabel: "一班",
  nickname: "Alice",
  avatarUrl: "",
  wallpaperUrl: "",
  classIds: ["class_1"],
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: nowIso,
  updatedAt: nowIso,
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser(),
    createUser({
      userId: "user_2",
      studentNo: "2305200202",
      studentId: "student_2",
      name: "Bob",
      classLabel: "二班",
      classIds: ["class_2"],
    }),
  ],
  classes: [
    { id: "class_1", name: "一班", ownerUserId: "user_1", timezone: "Asia/Shanghai", status: "active", activeJoinCode: "CLASS001", createdAt: nowIso, updatedAt: nowIso },
    { id: "class_2", name: "二班", ownerUserId: "user_2", timezone: "Asia/Shanghai", status: "active", activeJoinCode: "CLASS002", createdAt: nowIso, updatedAt: nowIso },
  ],
  schedules: [
    { id: "schedule_2", classId: "class_2", title: "二班课表", description: "", publishedVersionNo: 1, createdByUserId: "user_2", createdAt: nowIso, updatedAt: nowIso },
  ],
  scheduleSubscriptions: [],
  socialSubscriptionRequests: [],
  socialSubscriptionEdges: [],
  socialCircleMembers: [],
  socialNotifications: [],
  userScheduleEvents: [],
  effectiveScheduleEntriesByUserId: {},
});

const createState = () => ({
  randomCodeByUserId: new Map([["user_1", "0101"], ["user_2", "0202"]]),
  notifyBoundUserIds: new Set(),
  practiceCourseKeysByUserId: new Map(),
  subscriptionTargetsByUserId: new Map(),
  bindingTargetUserIdByUserId: new Map(),
  campaignMetaByCampaignId: new Map(),
  campaignParticipantsByCampaignId: new Map(),
  foodCandidates: [],
  foodKeyBySourceFoodId: new Map(),
  sourceFoodIdByFoodKey: new Map(),
});

test("syncs subscription edges with legacy targets and schedule subscriptions", async () => {
  const utils = await loadLegacySocialUtils();
  const store = createStore();
  const state = createState();

  utils.upsertSocialSubscriptionEdge(store, state, {
    subscriberUserId: "user_1",
    targetUser: store.users[1],
    visibilityScope: "busy_free",
    source: "request",
  });

  assert.equal(store.socialSubscriptionEdges.length, 1);
  assert.deepEqual(Array.from(state.subscriptionTargetsByUserId.get("user_1") || []), ["user_2"]);
  assert.equal(store.scheduleSubscriptions.length, 1);
  assert.equal(store.scheduleSubscriptions[0].sourceScheduleId, "schedule_2");

  utils.upsertSocialSubscriptionEdge(store, state, {
    subscriberUserId: "user_1",
    targetUser: store.users[1],
    visibilityScope: "detail",
    source: "request",
  });
  assert.equal(store.socialSubscriptionEdges.length, 1);
  assert.equal(store.socialSubscriptionEdges[0].visibilityScope, "detail");
});

test("revokes and blocks social subscriptions while updating legacy targets", async () => {
  const utils = await loadLegacySocialUtils();
  const store = createStore();
  const state = createState();
  utils.upsertSocialSubscriptionEdge(store, state, {
    subscriberUserId: "user_1",
    targetUser: store.users[1],
    visibilityScope: "detail",
    source: "request",
  });

  const removed = utils.revokeSocialSubscriptionBetweenUsers(store, state, store.users[0], store.users[1]);
  assert.equal(removed, true);
  assert.equal(store.socialSubscriptionEdges[0].status, "revoked");
  assert.deepEqual(Array.from(state.subscriptionTargetsByUserId.get("user_1") || []), []);
  assert.equal(store.scheduleSubscriptions.length, 0);

  const blockedEdges = utils.blockSocialSubscriptionBetweenUsers(store, state, store.users[0], store.users[1]);
  assert.equal(blockedEdges.length, 2);
  assert.equal(utils.resolveViewerVisibilityScope(store, store.users[0], store.users[1]), "blocked");
});

test("resolves circle visibility, relation status, notifications, and conflicts", async () => {
  const utils = await loadLegacySocialUtils();
  const store = createStore();
  const state = createState();
  store.socialCircleMembers.push(
    { id: "member_1", circleId: "circle_1", userId: "user_1", role: "member", visibilityScope: "busy_free", status: "active", joinedAt: nowIso, leftAt: "", updatedAt: nowIso },
    { id: "member_2", circleId: "circle_1", userId: "user_2", role: "member", visibilityScope: "detail", status: "active", joinedAt: nowIso, leftAt: "", updatedAt: nowIso },
  );
  store.socialSubscriptionRequests.push({
    id: "request_1",
    requesterUserId: "user_1",
    targetUserId: "user_2",
    requestedVisibility: "detail",
    status: "pending",
    decidedVisibility: "hidden",
    decidedAt: "",
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  assert.equal(utils.resolveViewerVisibilityScope(store, store.users[0], store.users[1]), "detail");
  const relationStatus = utils.buildSocialRelationStatusPayload(store, store.users[0], store.users[1]);
  assert.equal(relationStatus.status, "subscribed");
  assert.equal(relationStatus.canBlock, true);

  const firstNotification = utils.createSocialNotification(store, {
    type: "subscription_request",
    recipientUserId: "user_2",
    actorUserId: "user_1",
    title: "订阅请求",
    body: "Alice 请求订阅",
    payload: { requestId: "request_1" },
  });
  const duplicateNotification = utils.createSocialNotification(store, {
    type: "subscription_request",
    recipientUserId: "user_2",
    actorUserId: "user_1",
    title: "订阅请求",
    body: "Alice 请求订阅",
    payload: { requestId: "request_1" },
  });
  assert.equal(firstNotification, duplicateNotification);
  assert.equal(store.socialNotifications.length, 1);

  store.effectiveScheduleEntriesByUserId.user_1 = [
    { id: "entry_1", day: 3, startSection: 3, endSection: 4, weekExpr: "1-18", parity: "all", courseName: "数据结构", classroom: "A101", teacher: "李老师" },
  ];
  const conflict = utils.buildScheduleCandidateConflictPayload(store, store.users[0], {
    day: 3,
    startSection: 3,
    endSection: 4,
  });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.alternatives.length, 3);
});
