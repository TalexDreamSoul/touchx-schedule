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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-food-candidate-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyFoodCandidateHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-food-candidate-handler.ts"),
    "legacy-food-candidate-handler.mjs",
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
        "from \"../../services/food-utils\";",
        `from ${JSON.stringify(dataModule(`
          export const estimateFoodCaloriesKcal = ({ categoryKey, priceMax }) => {
            const base = categoryKey === "drink" ? 180 : 420;
            return Math.max(120, Math.min(1500, base + Number(priceMax || 0) * 10));
          };
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
  foodItems: [createFoodItem()],
  mediaAssets: [
    {
      id: "asset-1",
      ownerUserId: "user-1",
      usage: "other",
      objectKey: "food/evidence.jpg",
      url: "/media/asset-1",
      mime: "image/jpeg",
      size: 1234,
      referenced: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
});

const createState = (overrides = {}) => ({
  foodCandidates: [createCandidate()],
  foodKeyBySourceFoodId: new Map([["food-1", "1"]]),
  sourceFoodIdByFoodKey: new Map([["1", "food-1"]]),
  ...overrides,
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const state = overrides.state || createState();
  const user = overrides.user || store.users[0];
  const context = {
    event: { body: overrides.body || {} },
    method: overrides.method || "GET",
    path: overrides.path || "social/food-candidates",
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
    isAdminRole: (targetUser) => targetUser.adminRole === "super_admin" || targetUser.adminRole === "operator",
  };
  return { context, store, state, handleLegacyFoodCandidateApi: handler.handleLegacyFoodCandidateApi };
};

test("extracts food candidate fields from raw text and rejects empty raw text", async () => {
  const handler = await loadLegacyFoodCandidateHandler();
  const emptyContext = createContext(handler, {
    method: "POST",
    path: "social/food-candidates/extract",
    body: { rawText: "   " },
  });

  await assert.rejects(
    () => emptyContext.handleLegacyFoodCandidateApi(emptyContext.context),
    (error) => error.code === "FOOD_CANDIDATE_RAW_TEXT_REQUIRED",
  );

  const extractContext = createContext(handler, {
    method: "POST",
    path: "social/food-candidates/extract",
    body: {
      rawText: "店名：川味冒菜\n人均 18-24 元\n招牌：牛肉冒菜",
    },
  });

  const response = await extractContext.handleLegacyFoodCandidateApi(extractContext.context);

  assert.equal(response.ok, true);
  assert.equal(response.extracted.name, "川味冒菜");
  assert.equal(response.extracted.categoryKey, "maocai");
  assert.equal(response.extracted.dailyPriceMin, 18);
  assert.equal(response.extracted.dailyPriceMax, 24);
  assert.equal(response.warnings.length, 0);
});

test("creates raw-text candidates and filters candidate lists", async () => {
  const handler = await loadLegacyFoodCandidateHandler();
  const store = createStore();
  const state = createState({ foodCandidates: [], foodKeyBySourceFoodId: new Map(), sourceFoodIdByFoodKey: new Map() });
  const createContextResult = createContext(handler, {
    store,
    state,
    method: "POST",
    path: "social/food-candidates",
    body: {
      rawText: "品牌：茶小满\n柠檬茶 12 元\n推荐：鸭屎香柠檬茶",
      categoryKey: "drink",
      note: "适合下午茶",
      evidenceAssetIds: ["asset-1"],
    },
  });

  const createResponse = await createContextResult.handleLegacyFoodCandidateApi(createContextResult.context);

  assert.equal(createResponse.ok, true);
  assert.equal(createResponse.item.foodKey, "1");
  assert.equal(createResponse.item.candidateStatus, "pending_review");
  assert.equal(createResponse.item.submissionMode, "raw_text");
  assert.deepEqual(createResponse.item.evidenceUrls, ["/media/asset-1"]);
  assert.equal(state.foodCandidates.length, 1);

  const listContext = createContext(handler, {
    store,
    state,
    path: "social/food-candidates",
    query: { status: "pending_review", category_key: "drink", keyword: "下午茶", mine_only: "1" },
  });
  const listResponse = await listContext.handleLegacyFoodCandidateApi(listContext.context);

  assert.equal(listResponse.ok, true);
  assert.equal(listResponse.items.length, 1);
  assert.equal(listResponse.items[0].brandName, "茶小满");
});

test("summarizes approved food catalog by category and brand", async () => {
  const handler = await loadLegacyFoodCandidateHandler();
  const store = createStore();
  store.foodItems.push(createFoodItem({
    id: "food-2",
    name: "美式咖啡",
    categoryKey: "drink",
    categoryName: "饮品",
    merchantName: "咖啡站",
    priceMin: 10,
    priceMax: 15,
    caloriesKcal: 60,
  }));
  const state = createState({
    foodCandidates: [
      createCandidate(),
      createCandidate({
        foodKey: "2",
        sourceFoodId: "food-2",
        name: "美式咖啡",
        categoryKey: "drink",
        categoryName: "饮品",
        brandKey: "coffee_station",
        brandName: "咖啡站",
        brandCombo: "咖啡站-美式咖啡",
      }),
      createCandidate({
        foodKey: "3",
        sourceFoodId: "",
        name: "待审米线",
        candidateStatus: "pending_review",
        categoryKey: "noodle",
        categoryName: "面食",
      }),
    ],
    foodKeyBySourceFoodId: new Map([["food-1", "1"], ["food-2", "2"]]),
    sourceFoodIdByFoodKey: new Map([["1", "food-1"], ["2", "food-2"]]),
  });
  const { context, handleLegacyFoodCandidateApi } = createContext(handler, {
    store,
    state,
    path: "social/foods",
    query: { categoryKey: "drink" },
  });

  const response = await handleLegacyFoodCandidateApi(context);

  assert.equal(response.ok, true);
  assert.deepEqual(response.categories.map((item) => [item.categoryKey, item.count]), [["maocai", 1], ["drink", 1]]);
  assert.deepEqual(response.brands, [{ brandKey: "coffee_station", brandName: "咖啡站", count: 1 }]);
});

test("admin reviews candidates with approve and reject flows", async () => {
  const handler = await loadLegacyFoodCandidateHandler();
  const store = createStore();
  const state = createState({
    foodCandidates: [
      createCandidate({
        foodKey: "2",
        sourceFoodId: "",
        name: "待审小炒",
        categoryKey: "stir_fry",
        categoryName: "小炒",
        brandKey: "campus_kitchen",
        brandName: "校园小厨",
        candidateStatus: "pending_review",
        dailyPriceMin: 16,
        dailyPriceMax: 22,
        caloriesKcal: 0,
      }),
      createCandidate({
        foodKey: "3",
        sourceFoodId: "",
        name: "待拒绝甜品",
        categoryKey: "afternoon_tea",
        categoryName: "下午茶",
        brandKey: "sweet",
        brandName: "甜品铺",
        candidateStatus: "pending_review",
      }),
    ],
    foodKeyBySourceFoodId: new Map(),
    sourceFoodIdByFoodKey: new Map(),
  });
  const nonAdminContext = createContext(handler, {
    store,
    state,
    path: "admin/food-candidates",
  });

  await assert.rejects(
    () => nonAdminContext.handleLegacyFoodCandidateApi(nonAdminContext.context),
    (error) => error.code === "ADMIN_FOOD_CANDIDATE_FORBIDDEN",
  );

  const adminUser = store.users.find((item) => item.adminRole === "operator");
  const approveContext = createContext(handler, {
    store,
    state,
    user: adminUser,
    method: "POST",
    path: "admin/food-candidates/2/review",
    body: { action: "approve", caloriesKcal: 610, reviewNote: "通过" },
  });
  const approveResponse = await approveContext.handleLegacyFoodCandidateApi(approveContext.context);

  assert.equal(approveResponse.ok, true);
  assert.equal(approveResponse.item.candidateStatus, "approved");
  assert.equal(approveResponse.item.sourceFoodId, "food_1");
  assert.equal(store.foodItems.length, 2);
  assert.equal(state.foodKeyBySourceFoodId.get("food_1"), "2");
  assert.equal(state.sourceFoodIdByFoodKey.get("2"), "food_1");

  const rejectContext = createContext(handler, {
    store,
    state,
    user: adminUser,
    method: "POST",
    path: "admin/food-candidates/3/review",
    body: { action: "reject", review_note: "信息不足" },
  });
  const rejectResponse = await rejectContext.handleLegacyFoodCandidateApi(rejectContext.context);

  assert.equal(rejectResponse.ok, true);
  assert.equal(rejectResponse.item.candidateStatus, "rejected");
  assert.equal(rejectResponse.item.reviewNote, "信息不足");

  const listContext = createContext(handler, {
    store,
    state,
    user: adminUser,
    path: "admin/food-candidates",
    query: { status: "all", keyword: "小炒" },
  });
  const listResponse = await listContext.handleLegacyFoodCandidateApi(listContext.context);

  assert.equal(listResponse.items.length, 1);
  assert.equal(listResponse.items[0].rawText, "");
  assert.equal(listResponse.items[0].sourceFoodId, "food_1");
});

test("ignores unrelated food candidate paths", async () => {
  const handler = await loadLegacyFoodCandidateHandler();
  const { context, handleLegacyFoodCandidateApi } = createContext(handler, { path: "social/food-campaigns" });

  assert.equal(handler.isLegacyFoodCandidatePath("social/food-candidates/extract"), true);
  assert.equal(handler.isLegacyFoodCandidatePath("social/foods"), true);
  assert.equal(handler.isLegacyFoodCandidatePath("social/food-candidates"), true);
  assert.equal(handler.isLegacyFoodCandidatePath("admin/food-candidates"), true);
  assert.equal(handler.isLegacyFoodCandidatePath("admin/food-candidates/1/review"), true);
  assert.equal(handler.isLegacyFoodCandidatePath("social/food-candidates/evidence"), false);
  assert.equal(handler.isLegacyFoodCandidatePath("social/food-campaigns"), false);
  assert.equal(await handleLegacyFoodCandidateApi(context), null);
});
