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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-social-activity-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacySocialActivityHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-social-activity-handler.ts"),
    "legacy-social-activity-handler.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          let seq = 0;
          export const storeHelpers = {
            createId: (prefix) => prefix + "_" + (++seq),
            generateShareToken: () => "share-token-" + (++seq),
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      [
        "from \"../../services/social-collaboration-core\";",
        `from ${JSON.stringify(dataModule(`
          export const buildActivitySplitDraft = ({ activityId, totalAmount, currency, participants, perPerson }) => ({
            activityId,
            totalAmount,
            currency,
            rows: perPerson || participants.map((item) => ({ userId: item.userId, studentId: item.studentId, name: item.name, amount: Number((totalAmount / Math.max(1, participants.length)).toFixed(2)) })),
          });
          export const buildActivitySnapshotPosterSvg = ({ title, statusLabel, timeLabel, participants }) => '<svg><text>' + title + '</text><text>' + statusLabel + '</text><text>' + timeLabel + '</text><text>' + participants.join(',') + '</text></svg>';
          export const canUseSocialAccess = (value) => {
            const relation = value?.relationStatus || {};
            return relation.status === "self" || relation.status === "subscribed";
          };
          export const resolveNextActivityStatus = (status, action) => {
            if (action === "send" && status === "draft") return "inviting";
            if (action === "confirm") return "confirmed";
            if (action === "cancel") return "cancelled";
            if (action === "expire") return "expired";
            return status;
          };
        `))};`,
      ],
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
    createUser({
      userId: "user-3",
      studentNo: "2305200103",
      studentId: "student-3",
      name: "Carol",
      nickname: "Carol同学",
      classLabel: "三班",
    }),
  ],
  socialActivities: [],
  socialActivityInvitations: [],
  socialNotifications: [],
  socialCircles: [],
  socialCircleMembers: [],
  userScheduleEvents: [],
});

const createActivity = (overrides = {}) => ({
  id: "activity-1",
  title: "高数复习",
  activityType: "study",
  status: "inviting",
  createdByUserId: "user-1",
  participantUserIds: ["user-1", "user-2"],
  week: 2,
  day: 3,
  startSection: 7,
  endSection: 8,
  calendarToken: "calendar-token-1",
  metadata: { description: "一起复习" },
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const user = overrides.user || store.users[0];
  const headers = {};
  const context = {
    event: { body: overrides.body || {}, headers },
    method: overrides.method || "GET",
    path: overrides.path || "social/activities",
    query: overrides.query || {},
    store,
    getStoreRevision: () => 17,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ user }),
    resolveSocialActorUser: () => user,
    findUserByUserId: (targetStore, userId) => targetStore.users.find((item) => item.userId === userId) || null,
    findUserByStudentId: (targetStore, studentId) => targetStore.users.find((item) => item.studentId === studentId) || null,
    isAdminRole: (targetUser) => targetUser.adminRole === "super_admin" || targetUser.adminRole === "operator",
    resolveViewerVisibilityScope: (_targetStore, viewer, target) => (viewer.userId === target.userId || target.userId === "user-2" ? "detail" : "hidden"),
    buildSocialRelationStatusPayload: (_targetStore, viewer, target) => ({
      status: viewer.userId === target.userId ? "self" : target.userId === "user-2" ? "subscribed" : "none",
      visibilityScope: target.userId === "user-2" ? "detail" : "hidden",
    }),
    getEffectiveScheduleEntriesForUser: () => [],
    isScheduleEntryInWeek: () => true,
    setHeader: (_event, name, value) => {
      headers[name.toLowerCase()] = value;
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
  };
  return { context, store, headers, handleLegacySocialActivityApi: handler.handleLegacySocialActivityApi };
};

test("lists current actor activities and exports ICS by token", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const store = createStore();
  store.socialActivities.push(createActivity());
  store.socialActivityInvitations.push({
    id: "invite-1",
    activityId: "activity-1",
    inviterUserId: "user-1",
    inviteeUserId: "user-2",
    status: "pending",
    createdAt: now,
    updatedAt: now,
    respondedAt: "",
  });
  const listContext = createContext(handler, { store });

  const listResponse = await listContext.handleLegacySocialActivityApi(listContext.context);

  assert.equal(listResponse.ok, true);
  assert.equal(listResponse.items[0].activityId, "activity-1");
  assert.equal(listResponse.items[0].invitationStats.pending, 1);

  const icsContext = createContext(handler, {
    store,
    path: "social/activities/calendar.ics",
    query: { activityId: "activity-1", token: "calendar-token-1" },
  });
  const ics = await icsContext.handleLegacySocialActivityApi(icsContext.context);

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:高数复习/);
  assert.equal(icsContext.headers["content-type"], "text/calendar; charset=utf-8");
});

test("builds free heatmap for visible users", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const { context, handleLegacySocialActivityApi } = createContext(handler, {
    path: "social/free-heatmap",
    query: { week: "2", studentIds: "student-2,student-3" },
  });

  const response = await handleLegacySocialActivityApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.heatmap.week, 2);
  assert.equal(response.heatmap.participantCount, 2);
  assert.equal(response.heatmap.cells.length, 77);
});

test("predicts activity success and computes smart reminder lead", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const predictContext = createContext(handler, {
    method: "POST",
    path: "social/activities/predict",
    body: { activityType: "study", day: 3, startSection: 9, participantStudentIds: ["student-2"] },
  });

  const prediction = await predictContext.handleLegacySocialActivityApi(predictContext.context);

  assert.equal(prediction.ok, true);
  assert.equal(prediction.prediction.successRate > 0, true);

  const leadContext = createContext(handler, {
    method: "POST",
    path: "social/reminders/smart-lead",
    body: { distanceMeters: 800, activityType: "study", locationLabel: "教学楼A" },
  });
  const reminder = await leadContext.handleLegacySocialActivityApi(leadContext.context);

  assert.equal(reminder.ok, true);
  assert.equal(reminder.reminder.walkingMinutes, 10);
  assert.equal(reminder.reminder.bufferMinutes, 8);
});

test("creates activities with invitations and notifications", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const { context, store, handleLegacySocialActivityApi } = createContext(handler, {
    method: "POST",
    path: "social/activities",
    body: {
      title: "图书馆复习",
      activityType: "study",
      week: 2,
      day: 4,
      startSection: 9,
      endSection: 10,
      participantStudentIds: ["student-2", "student-3"],
      description: "复习高数",
    },
  });

  const response = await handleLegacySocialActivityApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.activity.title, "图书馆复习");
  assert.equal(store.socialActivities.length, 1);
  assert.equal(store.socialActivityInvitations.length, 1);
  assert.equal(store.socialNotifications[0].type, "activity_invite");
});

test("builds snapshots, split drafts, and cancellation notifications", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const store = createStore();
  store.socialActivities.push(createActivity());
  const snapshotContext = createContext(handler, { store, path: "social/activities/activity-1/snapshot" });

  const snapshot = await snapshotContext.handleLegacySocialActivityApi(snapshotContext.context);

  assert.equal(snapshot.ok, true);
  assert.match(snapshot.card.posterSvg, /高数复习/);

  const splitContext = createContext(handler, {
    store,
    method: "POST",
    path: "social/activities/activity-1/splits",
    body: { totalAmount: 60, currency: "CNY" },
  });
  const split = await splitContext.handleLegacySocialActivityApi(splitContext.context);

  assert.equal(split.ok, true);
  assert.equal(split.split.totalAmount, 60);
  assert.equal(store.socialActivities[0].metadata.split.totalAmount, 60);

  const cancelContext = createContext(handler, {
    store,
    method: "POST",
    path: "social/activities/activity-1/cancel",
  });
  const cancel = await cancelContext.handleLegacySocialActivityApi(cancelContext.context);

  assert.equal(cancel.ok, true);
  assert.equal(cancel.activity.status, "cancelled");
  assert.equal(store.socialNotifications[0].type, "activity_cancelled");
});

test("expires activities and confirms invitations when all invitees accept", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const store = createStore();
  store.socialActivities.push(createActivity({ id: "activity-expire", status: "inviting" }));
  const expireContext = createContext(handler, {
    store,
    method: "POST",
    path: "social/activities/activity-expire/expire",
  });

  const expire = await expireContext.handleLegacySocialActivityApi(expireContext.context);

  assert.equal(expire.ok, true);
  assert.equal(expire.activity.status, "expired");
  assert.equal(store.socialNotifications[0].type, "activity_expired");

  const confirmStore = createStore();
  confirmStore.socialActivities.push(createActivity({ id: "activity-confirm", participantUserIds: ["user-1"] }));
  confirmStore.socialActivityInvitations.push({
    id: "invite-1",
    activityId: "activity-confirm",
    inviterUserId: "user-1",
    inviteeUserId: "user-2",
    status: "pending",
    createdAt: now,
    updatedAt: now,
    respondedAt: "",
  });
  const confirmContext = createContext(handler, {
    store: confirmStore,
    user: confirmStore.users[1],
    method: "POST",
    path: "social/activities/activity-confirm/invitations/invite-1/respond",
    body: { action: "accept" },
  });

  const confirm = await confirmContext.handleLegacySocialActivityApi(confirmContext.context);

  assert.equal(confirm.ok, true);
  assert.equal(confirm.invitation.status, "accepted");
  assert.equal(confirm.activity.status, "confirmed");
  assert.deepEqual(confirmStore.socialActivities[0].participantUserIds, ["user-1", "user-2"]);
  assert.equal(confirmStore.socialNotifications[0].type, "activity_confirmed");
});

test("ignores unrelated social activity paths", async () => {
  const handler = await loadLegacySocialActivityHandler();
  const { context, handleLegacySocialActivityApi } = createContext(handler, { path: "social/me" });

  assert.equal(handler.isLegacySocialActivityPath("social/free-heatmap"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities/calendar.ics"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities/activity-1/snapshot"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities/activity-1/splits"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities/activity-1/cancel"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities/activity-1/expire"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/activities/activity-1/invitations/invite-1/respond"), true);
  assert.equal(handler.isLegacySocialActivityPath("social/me"), false);
  assert.equal(await handleLegacySocialActivityApi(context), null);
});
