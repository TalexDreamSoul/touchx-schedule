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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-food-campaign-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyFoodCampaignHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-food-campaign-handler.ts"),
    "legacy-food-campaign-handler.mjs",
    [
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          let seq = 0;
          export const FOOD_CAMPAIGN_OPTION_LIMIT = 3;
          export const storeHelpers = {
            createId: (prefix) => prefix + "_" + (++seq),
            generateShareToken: () => "share-token-" + (++seq),
            nowIso: () => "2026-06-01T08:00:00.000Z",
          };
        `))};`,
      ],
      [
        "from \"../../services/food-utils\";",
        `from ${JSON.stringify(dataModule(`
          export const normalizeCaloriesKcal = (value, fallback = 0) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
          };
          export const resolveExerciseEquivalentMinutes = (caloriesKcal) => Math.round(Number(caloriesKcal || 0) / 8);
        `))};`,
      ],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-06-01T08:00:00.000Z";
const futureDeadline = "2036-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2305200101",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "一班",
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

const createFoodItem = (overrides = {}) => ({
  id: "food-1",
  name: "冒菜套餐",
  categoryKey: "maocai",
  categoryName: "冒菜",
  merchantName: "川味食堂",
  latitude: 31.23,
  longitude: 121.47,
  priceMin: 12,
  priceMax: 18,
  caloriesKcal: 560,
  ...overrides,
});

const createCandidate = (overrides = {}) => ({
  foodKey: "1",
  sourceFoodId: "food-1",
  name: "冒菜套餐",
  categoryKey: "maocai",
  categoryName: "冒菜",
  brandKey: "chuan_wei",
  brandName: "川味食堂",
  brandCombo: "川味食堂-冒菜套餐",
  candidateStatus: "approved",
  note: "",
  createdByUserId: "user-1",
  createdByStudentId: "student-1",
  distanceKm: 1.2,
  dailyPriceMin: 12,
  dailyPriceMax: 18,
  partyPriceMin: 14.4,
  partyPriceMax: 23.4,
  caloriesKcal: 560,
  submissionMode: "structured",
  rawText: "",
  evidenceAssetIds: [],
  extractionWarnings: [],
  reviewNote: "",
  isCaloriesEstimated: false,
  ...overrides,
});

const createCampaign = (overrides = {}) => ({
  id: "campaign-1",
  title: "午饭投票",
  status: "open",
  classId: "class-1",
  createdByUserId: "user-1",
  deadlineAtIso: futureDeadline,
  shareToken: "share-token",
  isAnonymous: true,
  revealAfterClose: true,
  revealScope: "share_token",
  optionFoodIds: ["food-1", "food-2"],
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
    }),
    createUser({
      userId: "admin-1",
      studentNo: "admin",
      studentId: "admin-student",
      name: "Admin",
      nickname: "Admin",
      adminRole: "operator",
    }),
  ],
  foodItems: [
    createFoodItem(),
    createFoodItem({
      id: "food-2",
      name: "鸡腿饭",
      categoryKey: "rice",
      categoryName: "盖饭",
      merchantName: "一食堂",
      priceMin: 16,
      priceMax: 22,
      caloriesKcal: 680,
    }),
    createFoodItem({
      id: "food-3",
      name: "柠檬茶",
      categoryKey: "drink",
      categoryName: "饮品",
      merchantName: "茶小满",
      priceMin: 9,
      priceMax: 12,
      caloriesKcal: 220,
    }),
  ],
  foodCampaigns: [createCampaign()],
  foodCampaignVotes: [
    { id: "vote-1", campaignId: "campaign-1", userId: "user-2", foodId: "food-2", score: 1, createdAt: now },
  ],
  foodPricingRules: [
    {
      categoryKey: "maocai",
      categoryName: "冒菜",
      trendMode: "down",
      anchorHeadcount: 2,
      slope: 0.2,
      minFactor: 0.7,
      maxFactor: 1.3,
      updatedAt: now,
    },
  ],
});

const createState = (overrides = {}) => ({
  campaignMetaByCampaignId: new Map([
    ["campaign-1", {
      templateKey: "daily",
      joinMode: "all",
      joinPassword: "",
      maxVotesPerUser: 2,
      closedAtUnix: 0,
      inviteeUserIds: [],
    }],
  ]),
  campaignParticipantsByCampaignId: new Map([
    ["campaign-1", new Map([
      ["user-1", { userId: "user-1", source: "creator", approvalStatus: "approved" }],
    ])],
  ]),
  foodCandidates: [
    createCandidate(),
    createCandidate({
      foodKey: "2",
      sourceFoodId: "food-2",
      name: "鸡腿饭",
      categoryKey: "rice",
      categoryName: "盖饭",
      brandKey: "canteen",
      brandName: "一食堂",
      brandCombo: "一食堂-鸡腿饭",
      dailyPriceMin: 16,
      dailyPriceMax: 22,
      caloriesKcal: 680,
    }),
    createCandidate({
      foodKey: "3",
      sourceFoodId: "food-3",
      name: "柠檬茶",
      categoryKey: "drink",
      categoryName: "饮品",
      brandKey: "tea_shop",
      brandName: "茶小满",
      brandCombo: "茶小满-柠檬茶",
      dailyPriceMin: 9,
      dailyPriceMax: 12,
      caloriesKcal: 220,
    }),
  ],
  foodKeyBySourceFoodId: new Map([["food-1", "1"], ["food-2", "2"], ["food-3", "3"]]),
  sourceFoodIdByFoodKey: new Map([["1", "food-1"], ["2", "food-2"], ["3", "food-3"]]),
  ...overrides,
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const state = overrides.state || createState();
  const user = overrides.user || store.users[0];
  const context = {
    event: { body: overrides.body || {} },
    method: overrides.method || "GET",
    path: overrides.path || "social/food-campaigns",
    query: overrides.query || {},
    store,
    state,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    readJsonBody: async (event) => event.body || {},
    requireLegacyAuth: () => ({ user }),
    resolveBoundTargetUser: (_targetStore, accountUser) => overrides.boundTarget || accountUser,
    findUserByStudentId: (targetStore, studentId) => {
      return targetStore.users.find((item) => item.studentId === studentId || item.studentNo === studentId) || null;
    },
    isAdminRole: (targetUser) => targetUser.adminRole === "super_admin" || targetUser.adminRole === "operator",
    resolveUserDisplayLabel: (targetUser) => targetUser.name || targetUser.nickname || targetUser.studentNo || targetUser.studentId,
  };
  return { context, store, state, handleLegacyFoodCampaignApi: handler.handleLegacyFoodCampaignApi };
};

test("lists campaigns and reports recent campaign stats", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const { context, handleLegacyFoodCampaignApi } = createContext(handler);

  const listResponse = await handleLegacyFoodCampaignApi(context);
  assert.equal(listResponse.ok, true);
  assert.equal(listResponse.items.length, 1);
  assert.equal(listResponse.items[0].campaignId, "campaign-1");
  assert.equal(listResponse.items[0].candidateCount, 2);
  assert.equal(listResponse.items[0].headcount, 1);

  context.path = "social/food-campaigns/stats";
  context.query = { recentDays: 99999 };
  const statsResponse = await handleLegacyFoodCampaignApi(context);
  assert.equal(statsResponse.ok, true);
  assert.equal(statsResponse.stats.campaignCount, 1);
  assert.equal(statsResponse.stats.selectionCount, 1);
  assert.equal(statsResponse.stats.mostSelectedFood.foodId, 2);
});

test("creates campaigns from approved candidates and previews by share token", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const store = createStore();
  const state = createState();
  const { context, handleLegacyFoodCampaignApi } = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns",
    body: {
      title: "今日午饭",
      categoryKeys: ["drink"],
      maxVotesPerUser: 3,
      deadlineAt: "2036-06-01T09:00:00.000Z",
      isAnonymous: false,
    },
  });

  const createResponse = await handleLegacyFoodCampaignApi(context);
  const campaignId = createResponse.campaign.campaignId;
  assert.equal(createResponse.ok, true);
  assert.equal(createResponse.campaign.title, "今日午饭");
  assert.equal(createResponse.campaign.candidateCount, 3);
  assert.equal(store.foodCampaigns[0].optionFoodIds.includes("food-3"), true);
  assert.equal(state.campaignMetaByCampaignId.get(campaignId).maxVotesPerUser, 3);

  context.method = "GET";
  context.path = "social/food-campaigns/preview";
  context.query = { shareToken: createResponse.campaign.shareToken };
  context.event = { body: {} };
  const previewResponse = await handleLegacyFoodCampaignApi(context);
  assert.equal(previewResponse.campaign.campaignId, campaignId);
  assert.equal(previewResponse.campaign.status, "open");
});

test("joins campaigns and returns campaign detail with participant state", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const store = createStore();
  const joinUser = store.users[1];
  const { context, state, handleLegacyFoodCampaignApi } = createContext(handler, {
    store,
    user: joinUser,
    method: "POST",
    path: "social/food-campaigns/join",
    body: { shareToken: "share-token" },
  });

  const joinResponse = await handleLegacyFoodCampaignApi(context);

  assert.equal(joinResponse.ok, true);
  assert.equal(joinResponse.campaign.campaignId, "campaign-1");
  assert.equal(joinResponse.campaign.participants.some((item) => item.studentId === "student-2"), true);
  assert.equal(state.campaignParticipantsByCampaignId.get("campaign-1").get("user-2").approvalStatus, "approved");
});

test("records votes and rejects empty, excessive, and invalid selections", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const store = createStore();
  const state = createState();

  const emptyVote = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/vote",
    body: { selectedFoodIds: [] },
  });
  await assert.rejects(() => emptyVote.handleLegacyFoodCampaignApi(emptyVote.context), {
    code: "CAMPAIGN_VOTE_EMPTY",
  });

  const excessiveVote = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/vote",
    body: { selectedFoodIds: [1, 2, 3] },
  });
  await assert.rejects(() => excessiveVote.handleLegacyFoodCampaignApi(excessiveVote.context), {
    code: "CAMPAIGN_VOTE_EXCEED",
  });

  const invalidVote = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/vote",
    body: { selectedFoodIds: [3] },
  });
  await assert.rejects(() => invalidVote.handleLegacyFoodCampaignApi(invalidVote.context), {
    code: "CAMPAIGN_VOTE_INVALID",
  });

  const validVote = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/vote",
    body: { selectedFoodIds: [1, 2] },
  });
  const voteResponse = await validVote.handleLegacyFoodCampaignApi(validVote.context);

  assert.equal(voteResponse.ok, true);
  assert.deepEqual(voteResponse.campaign.viewerVoteFoodIds, [1, 2]);
  assert.deepEqual(
    store.foodCampaignVotes
      .filter((item) => item.campaignId === "campaign-1" && item.userId === "user-1")
      .map((item) => item.foodId),
    ["food-1", "food-2"],
  );
});

test("supplements fallback food and candidate when no unused food exists", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const store = createStore();
  store.foodItems = [createFoodItem({ id: "food-1" })];
  store.foodCampaigns = [createCampaign({ optionFoodIds: ["food-1"] })];
  const state = createState({
    foodCandidates: [createCandidate()],
    foodKeyBySourceFoodId: new Map([["food-1", "1"]]),
    sourceFoodIdByFoodKey: new Map([["1", "food-1"]]),
  });
  const { context, handleLegacyFoodCampaignApi } = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/supplement",
  });

  const response = await handleLegacyFoodCampaignApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.campaign.candidateCount, 2);
  assert.equal(store.foodItems.length, 2);
  assert.equal(state.foodCandidates[0].note, "supplement-auto-generated");
  assert.equal(state.sourceFoodIdByFoodKey.get("2"), store.foodItems[1].id);
});

test("closes campaigns and syncs expired campaigns on write requests", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const store = createStore();
  const state = createState();
  const { context, handleLegacyFoodCampaignApi } = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/close",
  });

  const closeResponse = await handleLegacyFoodCampaignApi(context);
  assert.equal(closeResponse.campaign.status, "closed");
  assert.equal(state.campaignMetaByCampaignId.get("campaign-1").closedAtUnix > 0, true);

  store.foodCampaigns.push(createCampaign({
    id: "campaign-expired",
    title: "过期投票",
    deadlineAtIso: "2020-01-01T00:00:00.000Z",
    shareToken: "expired-token",
    optionFoodIds: ["food-1"],
  }));
  const expiredContext = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-expired/vote",
    body: { selectedFoodIds: [1] },
  });
  await assert.rejects(() => expiredContext.handleLegacyFoodCampaignApi(expiredContext.context), {
    code: "FOOD_CAMPAIGN_CLOSED",
  });
  assert.equal(store.foodCampaigns.find((item) => item.id === "campaign-expired").status, "closed");
});

test("approves participant review routes with creator or admin permission", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const store = createStore();
  const state = createState({
    campaignParticipantsByCampaignId: new Map([
      ["campaign-1", new Map([
        ["user-1", { userId: "user-1", source: "creator", approvalStatus: "approved" }],
        ["user-2", { userId: "user-2", source: "join", approvalStatus: "pending" }],
      ])],
    ]),
  });
  const { context, handleLegacyFoodCampaignApi } = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-campaigns/campaign-1/participants/student-2/approve",
  });

  const response = await handleLegacyFoodCampaignApi(context);

  assert.equal(response.ok, true);
  assert.equal(state.campaignParticipantsByCampaignId.get("campaign-1").get("user-2").approvalStatus, "approved");
  assert.equal(response.campaign.participants.find((item) => item.studentId === "student-2").approvalStatus, "approved");
});

test("ignores unrelated campaign paths", async () => {
  const handler = await loadLegacyFoodCampaignHandler();
  const { context, handleLegacyFoodCampaignApi } = createContext(handler, { path: "social/food-candidates" });

  assert.equal(handler.isLegacyFoodCampaignPath("social/food-campaigns"), true);
  assert.equal(handler.isLegacyFoodCampaignPath("social/food-campaigns/campaign-1/vote"), true);
  assert.equal(handler.isLegacyFoodCampaignPath("social/food-candidates"), false);
  assert.equal(await handleLegacyFoodCampaignApi(context), null);
});
