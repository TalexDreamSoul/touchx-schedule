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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-food-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadFoodHandler = async () => {
  const domainStoreStub = [
    "let seq = 0;",
    "export const FOOD_CAMPAIGN_OPTION_LIMIT = 3;",
    "export const storeHelpers = {",
    "  nowIso: () => '2026-05-18T00:00:00.000Z',",
    "  createId: (prefix) => `${prefix}-${++seq}`,",
    "  generateShareToken: () => `share-${++seq}`",
    "};",
  ].join("\n");
  const authServiceStub = "export const isAdminRole = (user) => user.adminRole === 'super_admin' || user.adminRole === 'operator';";
  const foodUtilsPath = transpileModuleToTemp(
    join(import.meta.dirname, "food-utils.ts"),
    "food-utils.mjs",
    [],
  );
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/food/food-service.ts"),
    "food-service.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(domainStoreStub)}`)],
      ["\"../../services/food-utils\"", JSON.stringify(pathToFileURL(foodUtilsPath).href)],
      ["\"@touchx/shared\"", JSON.stringify("data:text/javascript,export {};")],
    ],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/food/food-handler.ts"),
    "food-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(domainStoreStub)}`)],
      ["\"../../services/food-utils\"", JSON.stringify(pathToFileURL(foodUtilsPath).href)],
      ["\"../auth/auth-service\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(authServiceStub)}`)],
      ["\"./food-service\"", JSON.stringify(pathToFileURL(servicePath).href)],
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

const createFood = (overrides = {}) => ({
  id: "food-1",
  name: "牛肉饭",
  categoryKey: "rice",
  categoryName: "盖饭",
  merchantName: "一食堂",
  latitude: 31.23,
  longitude: 121.47,
  priceMin: 12,
  priceMax: 18,
  caloriesKcal: 0,
  ...overrides,
});

const createRule = (overrides = {}) => ({
  categoryKey: "rice",
  categoryName: "盖饭",
  trendMode: "down",
  anchorHeadcount: 10,
  slope: 0.1,
  minFactor: 0.7,
  maxFactor: 1.3,
  updatedAt: now,
  ...overrides,
});

const createCampaign = (overrides = {}) => ({
  id: "campaign-1",
  title: "午饭投票",
  status: "open",
  classId: "class-1",
  createdByUserId: "user-1",
  deadlineAtIso: "2026-05-01T03:00:00.000Z",
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
    createUser({ userId: "user-2", studentNo: "2300000002", name: "Bob" }),
    createUser({ userId: "admin-1", studentNo: "999999", name: "Admin", adminRole: "super_admin" }),
  ],
  locationGrids: [
    {
      userId: "user-1",
      gridId: "grid_31.22_121.46",
      latitudeApprox: 31.22,
      longitudeApprox: 121.46,
      updatedAt: "2026-05-17T00:00:00.000Z",
      stale: false,
    },
  ],
  foodItems: [
    createFood(),
    createFood({ id: "food-2", name: "麻辣烫", categoryKey: "maocai", categoryName: "麻辣烫", merchantName: "二食堂", latitude: 31.25, longitude: 121.49, priceMin: 20, priceMax: 28, caloriesKcal: 720 }),
  ],
  foodCampaigns: [createCampaign()],
  foodCampaignVotes: [
    { id: "vote-1", campaignId: "campaign-1", userId: "user-2", foodId: "food-2", score: 8, createdAt: now },
  ],
  foodPricingRules: [createRule()],
  foodPricingRuleVersions: [
    {
      versionId: "ver-1",
      categoryKey: "rice",
      categoryName: "盖饭",
      trendMode: "down",
      anchorHeadcount: 8,
      slope: 0.05,
      minFactor: 0.8,
      maxFactor: 1.2,
      createdAt: "2026-05-02T00:00:00.000Z",
    },
  ],
  foodPricingOverrideVersions: [
    {
      versionId: "override-1",
      foodId: "food-1",
      categoryKey: "rice",
      priceMin: 10,
      priceMax: 16,
      reason: "测试",
      createdAt: now,
    },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "admin/foods",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireUser: () => ({ user: overrides.user || store.users[0] }),
    requireAdmin: () => ({ user: overrides.adminUser || store.users[2] }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
  };
  return { context, store, audits, handleFoodApi: handler.handleFoodApi };
};

test("updates location grid and lists nearby foods with dynamic pricing", async () => {
  const handler = await loadFoodHandler();
  const { context, store, audits, handleFoodApi } = createContext(handler, {
    method: "POST",
    path: "location/update-grid",
    body: { latitude: 31.234, longitude: 121.476 },
  });

  const updated = await handleFoodApi(context);
  assert.equal(updated.data.gridId, "grid_31.24_121.48");
  assert.equal(store.locationGrids[0].gridId, "grid_31.24_121.48");
  assert.equal(audits[0].action, "location_update_grid");
  store.locationGrids[0].updatedAt = new Date().toISOString();

  context.method = "GET";
  context.path = "foods/nearby";
  context.query = { headcount: 20 };
  const nearby = await handleFoodApi(context);
  assert.equal(nearby.data.items[0].foodId, "food-1");
  assert.equal(nearby.data.items[0].factor, 0.9);
  assert.equal(nearby.data.items[0].dynamicPriceMin, 10.8);
  assert.equal(nearby.data.staleHint, "");
});

test("manages admin foods, CSV import, and calorie recalculation", async () => {
  const handler = await loadFoodHandler();
  const { context, store, audits, handleFoodApi } = createContext(handler, {
    query: { keyword: "牛肉" },
  });

  const listed = await handleFoodApi(context);
  assert.deepEqual(listed.data.items.map((item) => item.foodId), ["food-1"]);
  assert.equal(listed.data.items[0].linkedCampaignCount, 1);

  context.path = "admin/foods/category-stats";
  context.query = {};
  const stats = await handleFoodApi(context);
  assert.equal(stats.data.totalFoods, 2);
  assert.equal(stats.data.zeroCaloriesCount, 1);

  context.method = "POST";
  context.path = "admin/foods";
  context.body = { name: "鸡腿饭", categoryKey: "rice", merchantName: "三食堂", basePriceMin: 15, basePriceMax: 12, caloriesKcal: 650 };
  context.readJsonBody = async () => context.body;
  const created = await handleFoodApi(context);
  assert.equal(created.data.item.foodName, "鸡腿饭");
  assert.equal(created.data.item.basePriceMax, 15);
  assert.equal(audits.at(-1).action, "food_item_create");

  context.path = `admin/foods/${created.data.item.foodId}/update`;
  context.body = { name: "鸡腿饭大份", basePriceMin: 16, basePriceMax: 18 };
  const updated = await handleFoodApi(context);
  assert.equal(updated.data.item.foodName, "鸡腿饭大份");

  context.path = "admin/foods/import-csv";
  context.body = {
    mode: "upsert",
    csvText: "foodId,name,merchantName,categoryKey,basePriceMin,basePriceMax,caloriesKcal\nfood-1,牛肉饭升级,一食堂,rice,13,19,690\n,缺分类,一食堂,,10,12,300",
  };
  const imported = await handleFoodApi(context);
  assert.equal(imported.data.summary.updated, 1);
  assert.equal(imported.data.summary.skipped, 1);
  assert.equal(store.foodItems.find((item) => item.id === "food-1").name, "牛肉饭升级");

  context.path = "admin/foods/calories/recalculate";
  context.body = { scope: "category", categoryKey: "rice", writeMode: "overwrite", applyAction: "dry_run", minKcal: 100, maxKcal: 900 };
  const dryRun = await handleFoodApi(context);
  assert.equal(dryRun.data.summary.applyAction, "dry_run");
  assert.equal(store.foodItems.find((item) => item.id === "food-1").caloriesKcal, 690);

  context.body = { scope: "category", categoryKey: "rice", writeMode: "overwrite", applyAction: "commit", minKcal: 100, maxKcal: 900 };
  const committed = await handleFoodApi(context);
  assert.equal(committed.data.summary.applyAction, "commit");
  assert.notEqual(store.foodItems.find((item) => item.id === "food-1").caloriesKcal, 690);
});

test("manages pricing rules, preview, rollback, and food pricing history", async () => {
  const handler = await loadFoodHandler();
  const { context, store, audits, handleFoodApi } = createContext(handler, {
    path: "admin/food-pricing-rules",
  });

  const listed = await handleFoodApi(context);
  assert.equal(listed.data.items.length, 1);

  context.method = "POST";
  context.body = { categoryKey: "rice", categoryName: "盖饭", trendMode: "up", anchorHeadcount: 5, slope: 0.2, minFactor: 0.6, maxFactor: 1.8 };
  context.readJsonBody = async () => context.body;
  const saved = await handleFoodApi(context);
  assert.equal(saved.data.rule.trendMode, "up");
  assert.equal(store.foodPricingRuleVersions[0].versionId, saved.data.versionId);
  assert.equal(audits.at(-1).action, "food_pricing_rule_save");

  context.path = "admin/food-pricing-rules/preview";
  context.body = { categoryKey: "rice", basePriceMin: 10, basePriceMax: 20, headcountStart: 1, headcountEnd: 3, headcountStep: 1 };
  const preview = await handleFoodApi(context);
  assert.equal(preview.data.preview.points.length, 3);
  assert.equal(preview.data.preview.points[0].headcount, 1);

  context.method = "GET";
  context.path = "admin/food-pricing-rules/history";
  context.query = { categoryKey: "rice" };
  const history = await handleFoodApi(context);
  assert.equal(history.data.items[0].categoryKey, "rice");
  assert.equal(typeof history.data.items[0].createdAt, "number");

  context.method = "POST";
  context.path = "admin/food-pricing-rules/rollback";
  context.body = { versionId: "ver-1" };
  const rolledBack = await handleFoodApi(context);
  assert.equal(rolledBack.data.rollback, true);
  assert.equal(rolledBack.data.rule.anchorHeadcount, 8);
  assert.equal(audits.at(-1).action, "food_pricing_rule_rollback");

  context.method = "GET";
  context.path = "admin/foods/food-1/pricing-history";
  const pricingHistory = await handleFoodApi(context);
  assert.equal(pricingHistory.data.food.foodId, "food-1");
  assert.equal(pricingHistory.data.overrideVersions.length, 1);
});

test("creates, votes, closes, previews, and lists food campaigns", async () => {
  const handler = await loadFoodHandler();
  const { context, store, audits, handleFoodApi } = createContext(handler, {
    path: "food-campaigns",
  });

  const campaigns = await handleFoodApi(context);
  assert.equal(campaigns.data.items[0].joined, false);

  context.method = "POST";
  context.body = { title: "晚饭投票", isAnonymous: false, optionFoodIds: ["food-1", "food-2"] };
  context.readJsonBody = async () => context.body;
  const created = await handleFoodApi(context);
  assert.equal(created.data.status, "open");
  assert.equal(created.data.isAnonymous, false);

  context.method = "GET";
  context.path = `food-campaigns/${created.data.campaignId}`;
  const detail = await handleFoodApi(context);
  assert.equal(detail.data.options.length, 2);
  assert.equal(detail.data.visibility.canSeeNamedVotes, true);

  context.method = "POST";
  context.path = `food-campaigns/${created.data.campaignId}/vote`;
  context.body = { foodId: "food-2", score: 9 };
  const voted = await handleFoodApi(context);
  assert.equal(voted.data.myVotes[0].foodId, "food-2");
  assert.equal(audits.at(-1).action, "food_campaign_vote");

  context.path = `food-campaigns/${created.data.campaignId}/close`;
  context.body = {};
  const closed = await handleFoodApi(context);
  assert.equal(closed.data.status, "closed");
  assert.equal(audits.at(-1).action, "food_campaign_close");

  context.method = "GET";
  context.path = "admin/food-campaigns";
  const adminList = await handleFoodApi(context);
  assert.equal(adminList.data.items.some((item) => item.campaignId === created.data.campaignId), true);

  context.path = "admin/preview/food-vote-state";
  context.query = { campaignId: created.data.campaignId, studentNo: "2300000001", shareToken: created.data.shareToken };
  const preview = await handleFoodApi(context);
  assert.equal(preview.data.campaignId, created.data.campaignId);
  assert.equal(preview.data.detail.campaignId, created.data.campaignId);

  context.method = "POST";
  context.path = "admin/foods/food-2/delete";
  context.body = {};
  const deleted = await handleFoodApi(context);
  assert.equal(deleted.data.deleted, true);
  assert.equal(deleted.data.impactedCampaignCount >= 1, true);
  assert.equal(store.foodCampaignVotes.some((vote) => vote.foodId === "food-2"), false);
});

test("returns typed errors and null for unrelated paths", async () => {
  const handler = await loadFoodHandler();
  const invalidLocation = createContext(handler, {
    method: "POST",
    path: "location/update-grid",
    body: { latitude: 100, longitude: 121 },
  });
  await assert.rejects(() => invalidLocation.handleFoodApi(invalidLocation.context), {
    statusCode: 400,
    code: "LOCATION_OUT_OF_RANGE",
  });

  const missingName = createContext(handler, {
    method: "POST",
    path: "admin/foods",
    body: { categoryKey: "rice" },
  });
  await assert.rejects(() => missingName.handleFoodApi(missingName.context), {
    statusCode: 400,
    code: "FOOD_NAME_REQUIRED",
  });

  const badVote = createContext(handler, {
    method: "POST",
    path: "food-campaigns/campaign-1/vote",
    body: { foodId: "missing", score: 1 },
  });
  await assert.rejects(() => badVote.handleFoodApi(badVote.context), {
    statusCode: 400,
    code: "FOOD_OPTION_INVALID",
  });

  const unrelated = createContext(handler, {
    path: "me/profile",
  });
  assert.equal(await unrelated.handleFoodApi(unrelated.context), null);
  assert.equal(handler.isFoodPath("admin/foods/category-stats"), true);
  assert.equal(handler.isFoodPath("me/profile"), false);
});
