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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-state-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyState = async () => {
  const modulePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-state.ts"),
    "legacy-state.mjs",
    [
      [
        "from \"../../services/food-utils\";",
        `from ${JSON.stringify(dataModule("export const normalizeCaloriesKcal=(value,fallback=0)=>Number(value||fallback||0);"))};`,
      ],
    ],
  );
  return import(pathToFileURL(modulePath).href);
};

const nowIso = "2026-06-01T08:00:00.000Z";

const createStore = () => ({
  users: [
    {
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
    },
    {
      userId: "user_2",
      studentNo: "2305200202",
      studentId: "",
      name: "Bob",
      classLabel: "二班",
      nickname: "Bob",
      avatarUrl: "",
      wallpaperUrl: "",
      classIds: ["class_2"],
      adminRole: "none",
      reminderEnabled: true,
      reminderWindowMinutes: [30, 15],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ],
  classes: [
    {
      id: "class_1",
      name: "一班",
      ownerUserId: "user_1",
      timezone: "Asia/Shanghai",
      status: "active",
      activeJoinCode: "CLASS001",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: "class_2",
      name: "二班",
      ownerUserId: "user_2",
      timezone: "Asia/Shanghai",
      status: "active",
      activeJoinCode: "CLASS002",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ],
  schedules: [
    {
      id: "schedule_2",
      classId: "class_2",
      title: "二班课表",
      description: "",
      publishedVersionNo: 1,
      createdByUserId: "user_2",
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ],
  scheduleSubscriptions: [
    {
      id: "subscription_1",
      subscriberUserId: "user_1",
      sourceScheduleId: "schedule_2",
      baseVersionNo: 1,
      followMode: "following",
      createdAt: nowIso,
    },
  ],
  foodItems: [
    {
      id: "food_1",
      name: "鸡腿饭",
      categoryKey: "rice",
      categoryName: "盖饭",
      merchantName: "TouchX 食堂",
      latitude: 31.1,
      longitude: 121.1,
      priceMin: 12,
      priceMax: 18,
      caloriesKcal: 650,
    },
  ],
  foodCampaigns: [
    {
      id: "campaign_1",
      title: "午餐投票",
      status: "closed",
      createdByUserId: "user_1",
      deadlineAtIso: "2026-06-01T10:00:00.000Z",
      shareToken: "share-token",
      isAnonymous: false,
      revealAfterClose: true,
      revealScope: "public",
      optionFoodIds: ["food_1"],
      createdAt: nowIso,
      updatedAt: "2026-06-01T11:00:00.000Z",
    },
  ],
});

test("initializes legacy compat state from nexus store data", async () => {
  const legacyState = await loadLegacyState();
  const store = createStore();
  const state = legacyState.getLegacyState(store);

  assert.equal(state.randomCodeByUserId.get("user_1"), "0101");
  assert.equal(state.randomCodeByUserId.get("user_2"), "0202");
  assert.equal(state.notifyBoundUserIds.has("user_1"), true);
  assert.equal(state.notifyBoundUserIds.has("user_2"), false);
  assert.equal(legacyState.isLegacyNotifyBoundUser(store, "user_1"), true);
  assert.equal(legacyState.isLegacyNotifyBoundUser(store, "user_2"), false);
  assert.deepEqual(Array.from(state.subscriptionTargetsByUserId.get("user_1") || []), ["user_2"]);
  assert.equal(state.bindingTargetUserIdByUserId.get("user_1"), "user_1");

  assert.equal(state.foodCandidates.length, 1);
  assert.equal(state.foodCandidates[0].foodKey, "1");
  assert.equal(state.foodCandidates[0].sourceFoodId, "food_1");
  assert.equal(state.foodCandidates[0].caloriesKcal, 650);
  assert.equal(state.foodKeyBySourceFoodId.get("food_1"), "1");

  assert.equal(state.campaignMetaByCampaignId.get("campaign_1")?.closedAtUnix, 1780311600);
  assert.equal(state.campaignParticipantsByCampaignId.get("campaign_1")?.get("user_1")?.source, "creator");
});

test("serializes and hydrates legacy compat state snapshot", async () => {
  const legacyState = await loadLegacyState();
  const store = createStore();
  const state = legacyState.getLegacyState(store);
  state.randomCodeByUserId.set("user_1", "9999");
  state.notifyBoundUserIds.add("user_2");
  state.practiceCourseKeysByUserId.set("user_1", new Set(["course_a"]));
  state.subscriptionTargetsByUserId.set("user_2", new Set(["user_1"]));
  state.bindingTargetUserIdByUserId.set("user_1", "user_2");
  state.campaignMetaByCampaignId.set("campaign_1", {
    templateKey: "daily",
    joinMode: "password",
    joinPassword: "1234",
    maxVotesPerUser: 2,
    closedAtUnix: 1780311600,
    inviteeUserIds: ["user_2"],
  });
  state.campaignParticipantsByCampaignId.set("campaign_1", new Map([
    ["user_2", { userId: "user_2", source: "invitee", approvalStatus: "pending" }],
  ]));

  const snapshot = legacyState.serializeLegacyCompatState(store);
  const hydratedStore = createStore();
  legacyState.hydrateLegacyCompatState(hydratedStore, snapshot);
  const hydratedState = legacyState.getLegacyState(hydratedStore);

  assert.equal(hydratedState.randomCodeByUserId.get("user_1"), "9999");
  assert.equal(legacyState.isLegacyNotifyBoundUser(hydratedStore, "user_2"), true);
  assert.deepEqual(Array.from(hydratedState.practiceCourseKeysByUserId.get("user_1") || []), ["course_a"]);
  assert.deepEqual(Array.from(hydratedState.subscriptionTargetsByUserId.get("user_2") || []), ["user_1"]);
  assert.equal(hydratedState.bindingTargetUserIdByUserId.get("user_1"), "user_2");
  assert.equal(hydratedState.campaignMetaByCampaignId.get("campaign_1")?.joinMode, "password");
  assert.equal(hydratedState.campaignParticipantsByCampaignId.get("campaign_1")?.get("user_2")?.approvalStatus, "pending");
  assert.equal(hydratedState.foodCandidates[0].sourceFoodId, "food_1");
});
