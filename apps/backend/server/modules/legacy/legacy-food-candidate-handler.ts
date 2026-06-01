import type { H3Event } from "h3";
import type { FoodItemRecord, NexusStore, UserRecord } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import { estimateFoodCaloriesKcal, normalizeCaloriesKcal, resolveExerciseEquivalentMinutes } from "../../services/food-utils";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveBoundTargetUser = (store: NexusStore, accountUser: UserRecord) => UserRecord | null;
type IsAdminRole = (user: UserRecord) => boolean;

type LegacyCandidateStatus = "approved" | "pending_eat" | "pending_review" | "rejected";
type LegacyFoodCandidateSubmissionMode = "raw_text" | "structured";

interface LegacyFoodCandidateRecord {
  foodKey: string;
  sourceFoodId: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  brandKey: string;
  brandName: string;
  brandCombo: string;
  candidateStatus: LegacyCandidateStatus;
  note: string;
  createdByUserId: string;
  createdByStudentId: string;
  distanceKm: number;
  dailyPriceMin: number;
  dailyPriceMax: number;
  partyPriceMin: number;
  partyPriceMax: number;
  caloriesKcal: number;
  submissionMode: LegacyFoodCandidateSubmissionMode;
  rawText: string;
  evidenceAssetIds: string[];
  extractionWarnings: string[];
  reviewNote: string;
  isCaloriesEstimated: boolean;
}

export interface LegacyFoodCandidateState {
  foodCandidates: LegacyFoodCandidateRecord[];
  foodKeyBySourceFoodId: Map<string, string>;
  sourceFoodIdByFoodKey: Map<string, string>;
}

export interface LegacyFoodCandidateHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  state: LegacyFoodCandidateState;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  resolveBoundTargetUser: ResolveBoundTargetUser;
  isAdminRole: IsAdminRole;
}

interface ExtractedFoodCandidateFields {
  name: string;
  categoryKey: string;
  categoryName: string;
  brandKey: string;
  brandName: string;
  brandCombo: string;
  dailyPriceMin: number;
  dailyPriceMax: number;
  partyPriceMin: number;
  partyPriceMax: number;
  caloriesKcal: number;
  isCaloriesEstimated: boolean;
}

interface FoodCandidateExtractResult {
  extracted: Partial<ExtractedFoodCandidateFields>;
  warnings: string[];
  rawTextPreview: string;
}

const FOOD_CANDIDATE_CATEGORY_LABEL_MAP: Record<string, string> = {
  maocai: "冒菜",
  hotpot: "火锅",
  drink: "饮品",
  noodle: "面食",
  rice: "米饭",
  breakfast: "早餐",
  afternoon_tea: "下午茶",
  midnight_snack: "夜宵",
  grill: "烧烤",
  takeout: "外卖",
  stir_fry: "小炒",
  "light-meal": "轻食",
  "main-meal": "正餐",
};

const FOOD_CANDIDATE_CATEGORY_KEYWORDS: Array<{ categoryKey: string; keywords: string[] }> = [
  { categoryKey: "maocai", keywords: ["冒菜", "麻辣烫", "麻辣拌"] },
  { categoryKey: "hotpot", keywords: ["火锅", "串串", "涮锅"] },
  { categoryKey: "drink", keywords: ["奶茶", "果茶", "茶饮", "咖啡", "拿铁", "美式", "柠檬茶", "饮品", "冰淇淋"] },
  { categoryKey: "noodle", keywords: ["面", "米线", "粉", "拉面", "拌面", "热干面", "刀削面", "螺蛳粉"] },
  { categoryKey: "rice", keywords: ["盖饭", "炒饭", "焖饭", "煲仔饭", "便当", "米饭"] },
  { categoryKey: "breakfast", keywords: ["早餐", "包子", "豆浆", "煎饼", "馄饨", "粥"] },
  { categoryKey: "afternoon_tea", keywords: ["下午茶", "甜品", "蛋糕", "蛋挞", "泡芙"] },
  { categoryKey: "midnight_snack", keywords: ["夜宵", "烧夜", "宵夜"] },
  { categoryKey: "grill", keywords: ["烧烤", "烤串", "烤肉", "炸串"] },
  { categoryKey: "takeout", keywords: ["寿司", "沙拉", "披萨", "意面"] },
  { categoryKey: "stir_fry", keywords: ["小炒", "盖浇", "炒菜"] },
  { categoryKey: "light-meal", keywords: ["轻食", "低脂", "鸡胸肉"] },
  { categoryKey: "main-meal", keywords: ["套餐", "正餐"] },
];

const asString = (value: unknown) => String(value || "").trim();

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asString(item)).filter((item) => item);
};

const normalizeBrandKey = (text: string) => {
  const value = asString(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return value || "general";
};

const normalizeLegacyFoodCandidateSubmissionMode = (value: unknown): LegacyFoodCandidateSubmissionMode => {
  return asString(value).toLowerCase() === "raw_text" ? "raw_text" : "structured";
};

const buildLegacyCandidateStatusLabel = (status: LegacyCandidateStatus) => {
  if (status === "approved") {
    return "已通过";
  }
  if (status === "pending_eat") {
    return "待体验";
  }
  if (status === "pending_review") {
    return "待审核";
  }
  return "已拒绝";
};

const toHalfWidth = (value: string) => {
  return Array.from(value).map((char) => {
    const code = char.charCodeAt(0);
    if (code === 12288) {
      return " ";
    }
    if (code >= 65281 && code <= 65374) {
      return String.fromCharCode(code - 65248);
    }
    return char;
  }).join("");
};

const normalizeFoodCandidateRawText = (value: unknown) => {
  return toHalfWidth(asString(value))
    .replace(/\r\n?/g, "\n")
    .replace(/[|｜]/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const buildFoodCandidateRawTextPreview = (value: string) => {
  const compact = asString(value).replace(/\s+/g, " ");
  if (compact.length <= 96) {
    return compact;
  }
  return `${compact.slice(0, 93)}...`;
};

const resolveFoodCandidateCategoryName = (categoryKey: string) => {
  return FOOD_CANDIDATE_CATEGORY_LABEL_MAP[categoryKey] || categoryKey;
};

const clampFoodPrice = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Number(parsed.toFixed(2)));
};

const normalizeFoodPriceRange = (minRaw: unknown, maxRaw: unknown) => {
  const min = clampFoodPrice(minRaw);
  const max = Math.max(min, clampFoodPrice(maxRaw));
  return { min, max };
};

const derivePartyPriceRange = (dailyMin: number, dailyMax: number) => {
  return {
    min: Number((dailyMin * 1.2).toFixed(2)),
    max: Number((dailyMax * 1.3).toFixed(2)),
  };
};

const normalizeExtractWarnings = (value: unknown) => {
  return normalizeStringArray(value).filter((item, index, items) => items.indexOf(item) === index);
};

const extractLabeledLineValue = (text: string, labels: string[]) => {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`, "i");
    const match = pattern.exec(text);
    const candidate = asString(match?.[1]);
    if (candidate) {
      return candidate.replace(/[，。；;]+$/g, "").trim();
    }
  }
  return "";
};

const resolveFoodCandidateTitleLine = (rawText: string) => {
  const lines = rawText
    .split("\n")
    .map((line) => asString(line))
    .filter((line) => line);
  return (
    lines.find((line) => {
      if (line.length < 2 || line.length > 32) {
        return false;
      }
      if (/[¥￥]|人均|\d+\s*[-~～到至]\s*\d+/.test(line)) {
        return false;
      }
      if (/^(店名|商家|品牌|门店|地址|电话|营业时间)\s*[：:]/i.test(line)) {
        return false;
      }
      return /[\u4e00-\u9fffA-Za-z]/.test(line);
    }) || ""
  );
};

const inferFoodCandidateCategoryKey = (rawText: string, hint = "") => {
  const normalizedHint = asString(hint).toLowerCase();
  if (normalizedHint) {
    return normalizedHint;
  }
  const normalizedText = rawText.toLowerCase();
  const matched = FOOD_CANDIDATE_CATEGORY_KEYWORDS.find((item) => {
    return item.keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase()));
  });
  return matched?.categoryKey || "";
};

const extractFoodCandidateBrandCombo = (rawText: string) => {
  const match = /(?:招牌|推荐|热销|必点|搭配|推荐搭配)\s*[：:]\s*([^\n]+)/i.exec(rawText);
  return asString(match?.[1]).replace(/[，。；;]+$/g, "").trim();
};

const extractFoodCandidateDailyPriceRange = (rawText: string) => {
  const rangeMatch = Array.from(rawText.matchAll(/(?:¥|￥|RMB|rmb|人民币)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:-|~|～|至|到)\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:元|块|RMB|rmb|人民币)?/g))
    .map((match) => ({
      min: clampFoodPrice(match[1]),
      max: clampFoodPrice(match[2]),
    }))
    .find((item) => item.max > 0 && item.max <= 300);
  if (rangeMatch) {
    return {
      min: Math.min(rangeMatch.min, rangeMatch.max),
      max: Math.max(rangeMatch.min, rangeMatch.max),
      source: "range" as const,
    };
  }
  const avgMatch = /人均\s*(?:¥|￥)?\s*(\d{1,3}(?:\.\d{1,2})?)/i.exec(rawText);
  if (avgMatch) {
    const value = clampFoodPrice(avgMatch[1]);
    return {
      min: value,
      max: value,
      source: "average" as const,
    };
  }
  const singleMatch =
    /(?:套餐|售价|价格|仅售|只要)\s*(?:¥|￥)?\s*(\d{1,3}(?:\.\d{1,2})?)/i.exec(rawText) ||
    /(?:¥|￥)\s*(\d{1,3}(?:\.\d{1,2})?)/.exec(rawText) ||
    /(\d{1,3}(?:\.\d{1,2})?)\s*(?:元|块)/.exec(rawText);
  if (singleMatch) {
    const value = clampFoodPrice(singleMatch[1]);
    return {
      min: value,
      max: value,
      source: "single" as const,
    };
  }
  return null;
};

const extractFoodCandidateFields = (
  rawText: string,
  options: {
    brandHint?: string;
    categoryHint?: string;
  } = {},
): FoodCandidateExtractResult => {
  const normalizedText = normalizeFoodCandidateRawText(rawText);
  const warnings: string[] = [];
  if (!normalizedText) {
    return {
      extracted: {},
      warnings: ["原始文案为空，无法抽取"],
      rawTextPreview: "",
    };
  }
  const labeledStoreName =
    extractLabeledLineValue(normalizedText, ["店名", "商家", "门店"]) ||
    extractLabeledLineValue(normalizedText, ["品牌"]);
  const titleLine = resolveFoodCandidateTitleLine(normalizedText);
  const name = labeledStoreName || titleLine;
  const brandName =
    extractLabeledLineValue(normalizedText, ["品牌"]) ||
    asString(options.brandHint) ||
    labeledStoreName ||
    titleLine;
  const categoryKey = inferFoodCandidateCategoryKey(normalizedText, options.categoryHint);
  const priceRange = extractFoodCandidateDailyPriceRange(normalizedText);
  const brandCombo = extractFoodCandidateBrandCombo(normalizedText);
  if (!name) {
    warnings.push("未能识别店铺名称，请手动补充");
  }
  if (!categoryKey) {
    warnings.push("未能识别分类，请手动选择");
  }
  if (!priceRange) {
    warnings.push("未能识别价格区间，请手动填写");
  }
  const dailyRange = normalizeFoodPriceRange(priceRange?.min ?? 0, priceRange?.max ?? priceRange?.min ?? 0);
  const partyRange = derivePartyPriceRange(dailyRange.min, dailyRange.max);
  const estimatedCaloriesKcal =
    dailyRange.max > 0 || categoryKey
      ? estimateFoodCaloriesKcal(
          {
            categoryKey: categoryKey || "main-meal",
            priceMin: dailyRange.min,
            priceMax: dailyRange.max,
          },
          {
            baseShift: 0,
            priceWeight: 16,
            minKcal: 120,
            maxKcal: 1500,
          },
        )
      : 0;
  return {
    extracted: {
      name,
      categoryKey,
      categoryName: resolveFoodCandidateCategoryName(categoryKey),
      brandKey: normalizeBrandKey(brandName || name),
      brandName,
      brandCombo,
      dailyPriceMin: dailyRange.min,
      dailyPriceMax: dailyRange.max,
      partyPriceMin: partyRange.min,
      partyPriceMax: partyRange.max,
      caloriesKcal: estimatedCaloriesKcal,
      isCaloriesEstimated: estimatedCaloriesKcal > 0,
    },
    warnings,
    rawTextPreview: buildFoodCandidateRawTextPreview(normalizedText),
  };
};

const resolveCandidateEvidenceUrls = (store: NexusStore, assetIds: string[]) => {
  return assetIds
    .map((assetId) => {
      const media = store.mediaAssets.find((item) => item.id === assetId) || null;
      return media?.url || "";
    })
    .filter((item) => item);
};

const resolveApprovedFoodCandidates = (store: NexusStore, state: LegacyFoodCandidateState) => {
  const foodIdSet = new Set(store.foodItems.map((item) => item.id));
  return state.foodCandidates.filter((item) => {
    if (item.candidateStatus !== "approved") {
      return false;
    }
    const foodId = asString(item.sourceFoodId);
    return Boolean(foodId) && foodIdSet.has(foodId);
  });
};

const serializeFoodCandidatePayload = (
  store: NexusStore,
  item: LegacyFoodCandidateRecord,
  options: {
    includeRawText?: boolean;
    includeSourceFoodId?: boolean;
  } = {},
) => {
  const evidenceAssetIds = normalizeStringArray(item.evidenceAssetIds);
  const caloriesKcal = normalizeCaloriesKcal(item.caloriesKcal, 0);
  return {
    foodKey: item.foodKey,
    sourceFoodId: options.includeSourceFoodId ? asString(item.sourceFoodId) : undefined,
    name: item.name,
    categoryKey: item.categoryKey,
    categoryName: item.categoryName,
    brandKey: item.brandKey,
    brandName: item.brandName,
    brandCombo: item.brandCombo,
    candidateStatus: item.candidateStatus,
    candidateStatusLabel: buildLegacyCandidateStatusLabel(item.candidateStatus),
    note: item.note,
    createdByStudentId: item.createdByStudentId,
    distanceKm: item.distanceKm,
    dailyPriceMin: item.dailyPriceMin,
    dailyPriceMax: item.dailyPriceMax,
    partyPriceMin: item.partyPriceMin,
    partyPriceMax: item.partyPriceMax,
    caloriesKcal,
    exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(caloriesKcal),
    submissionMode: normalizeLegacyFoodCandidateSubmissionMode(item.submissionMode),
    rawTextPreview: buildFoodCandidateRawTextPreview(item.rawText),
    rawText: options.includeRawText ? asString(item.rawText) : undefined,
    evidenceAssetIds,
    evidenceUrls: resolveCandidateEvidenceUrls(store, evidenceAssetIds),
    extractionWarnings: normalizeExtractWarnings(item.extractionWarnings),
    reviewNote: asString(item.reviewNote),
    isCaloriesEstimated: Boolean(item.isCaloriesEstimated),
  };
};

const findFoodCandidateByKey = (state: LegacyFoodCandidateState, foodKey: string) => {
  return state.foodCandidates.find((item) => item.foodKey === foodKey) || null;
};

const findFoodItemByIdentity = (
  store: NexusStore,
  identity: {
    name: string;
    merchantName: string;
    categoryKey: string;
  },
) => {
  const targetName = asString(identity.name).toLowerCase();
  const targetMerchant = asString(identity.merchantName).toLowerCase();
  const targetCategoryKey = asString(identity.categoryKey).toLowerCase();
  if (!targetName || !targetMerchant || !targetCategoryKey) {
    return null;
  }
  return (
    store.foodItems.find((item) => {
      return (
        asString(item.name).toLowerCase() === targetName &&
        asString(item.merchantName).toLowerCase() === targetMerchant &&
        asString(item.categoryKey).toLowerCase() === targetCategoryKey
      );
    }) || null
  );
};

const upsertFoodItemFromCandidate = (
  store: NexusStore,
  candidate: LegacyFoodCandidateRecord,
) => {
  const merchantName = asString(candidate.brandName) || asString(candidate.name) || "未命名商家";
  const categoryKey = asString(candidate.categoryKey).toLowerCase();
  const categoryName = asString(candidate.categoryName) || resolveFoodCandidateCategoryName(categoryKey);
  const normalizedDailyRange = normalizeFoodPriceRange(candidate.dailyPriceMin, candidate.dailyPriceMax);
  const normalizedCaloriesKcal = normalizeCaloriesKcal(candidate.caloriesKcal, 0);
  const matchedById = asString(candidate.sourceFoodId)
    ? store.foodItems.find((item) => item.id === asString(candidate.sourceFoodId)) || null
    : null;
  const matchedByIdentity = matchedById
    ? matchedById
    : findFoodItemByIdentity(store, {
        name: candidate.name,
        merchantName,
        categoryKey,
      });
  const item = matchedByIdentity || null;
  if (item) {
    item.name = candidate.name;
    item.categoryKey = categoryKey;
    item.categoryName = categoryName;
    item.merchantName = merchantName;
    item.priceMin = normalizedDailyRange.min;
    item.priceMax = normalizedDailyRange.max;
    item.caloriesKcal = normalizedCaloriesKcal;
    return item;
  }
  const created: FoodItemRecord = {
    id: storeHelpers.createId("food"),
    name: candidate.name,
    categoryKey,
    categoryName,
    merchantName,
    latitude: 31.23,
    longitude: 121.47,
    priceMin: normalizedDailyRange.min,
    priceMax: normalizedDailyRange.max,
    caloriesKcal: normalizedCaloriesKcal,
  };
  store.foodItems.push(created);
  return created;
};

const bindCandidateToFoodItem = (
  state: LegacyFoodCandidateState,
  candidate: LegacyFoodCandidateRecord,
  foodItem: FoodItemRecord,
) => {
  const previousFoodId = asString(candidate.sourceFoodId);
  if (previousFoodId && previousFoodId !== foodItem.id) {
    state.foodKeyBySourceFoodId.delete(previousFoodId);
  }
  candidate.sourceFoodId = foodItem.id;
  state.foodKeyBySourceFoodId.set(foodItem.id, candidate.foodKey);
  state.sourceFoodIdByFoodKey.set(candidate.foodKey, foodItem.id);
};

export const isLegacyFoodCandidatePath = (path: string) => {
  return (
    path === "social/food-candidates/extract" ||
    path === "social/foods" ||
    path === "social/food-candidates" ||
    path === "admin/food-candidates" ||
    /^admin\/food-candidates\/[^/]+\/review$/.test(path)
  );
};

export const handleLegacyFoodCandidateApi = async (context: LegacyFoodCandidateHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    state,
    toApiError,
    readJsonBody,
    requireLegacyAuth,
    resolveBoundTargetUser,
    isAdminRole,
  } = context;

  if (method === "POST" && path === "social/food-candidates/extract") {
    requireLegacyAuth(event);
    const body = await readJsonBody<{
      rawText?: string;
      raw_text?: string;
      brandHint?: string;
      brand_hint?: string;
      categoryHint?: string;
      category_hint?: string;
    }>(event);
    const rawText = normalizeFoodCandidateRawText(body.rawText ?? body.raw_text);
    if (!rawText) {
      return toApiError(400, "FOOD_CANDIDATE_RAW_TEXT_REQUIRED", "rawText 不能为空");
    }
    const result = extractFoodCandidateFields(rawText, {
      brandHint: asString(body.brandHint || body.brand_hint),
      categoryHint: asString(body.categoryHint || body.category_hint),
    });
    return {
      ok: true,
      extracted: result.extracted,
      warnings: result.warnings,
      rawTextPreview: result.rawTextPreview,
    };
  }

  if (method === "GET" && path === "social/foods") {
    requireLegacyAuth(event);
    const categoryKey = asString(query.categoryKey || query.category_key).toLowerCase();
    const approved = resolveApprovedFoodCandidates(store, state);
    const categoryCount = new Map<string, { categoryName: string; count: number }>();
    approved.forEach((item) => {
      const existing = categoryCount.get(item.categoryKey);
      if (!existing) {
        categoryCount.set(item.categoryKey, { categoryName: item.categoryName, count: 1 });
        return;
      }
      existing.count += 1;
    });
    const brandCount = new Map<string, { brandName: string; count: number }>();
    approved.forEach((item) => {
      if (categoryKey && item.categoryKey !== categoryKey) {
        return;
      }
      const existing = brandCount.get(item.brandKey);
      if (!existing) {
        brandCount.set(item.brandKey, { brandName: item.brandName, count: 1 });
        return;
      }
      existing.count += 1;
    });
    return {
      ok: true,
      categories: Array.from(categoryCount.entries()).map(([key, payload]) => ({
        categoryKey: key,
        categoryName: payload.categoryName || key,
        count: payload.count,
      })),
      brands: Array.from(brandCount.entries()).map(([key, payload]) => ({
        brandKey: key,
        brandName: payload.brandName || key,
        count: payload.count,
      })),
    };
  }

  if (method === "GET" && path === "social/food-candidates") {
    const { user } = requireLegacyAuth(event);
    const status = asString(query.status).toLowerCase();
    const categoryKey = asString(query.categoryKey || query.category_key).toLowerCase();
    const brandKey = asString(query.brandKey || query.brand_key).toLowerCase();
    const keyword = asString(query.keyword).toLowerCase();
    const mineOnly = asString(query.mineOnly || query.mine_only) === "1";
    const bindTarget = resolveBoundTargetUser(store, user) || user;
    const items = state.foodCandidates
      .filter((item) => !status || status === "all" || item.candidateStatus === status)
      .filter((item) => !categoryKey || item.categoryKey.toLowerCase() === categoryKey)
      .filter((item) => !brandKey || item.brandKey.toLowerCase() === brandKey)
      .filter((item) => !keyword || `${item.name} ${item.note} ${item.brandName} ${item.rawText}`.toLowerCase().includes(keyword))
      .filter((item) => !mineOnly || item.createdByUserId === bindTarget.userId)
      .map((item) => serializeFoodCandidatePayload(store, item));
    return { ok: true, items };
  }

  if (method === "POST" && path === "social/food-candidates") {
    const { user } = requireLegacyAuth(event);
    const bindTarget = resolveBoundTargetUser(store, user) || user;
    const body = await readJsonBody<{
      name?: string;
      categoryKey?: string;
      category_key?: string;
      brandKey?: string;
      brand_key?: string;
      brandName?: string;
      brand_name?: string;
      brandCombo?: string;
      brand_combo?: string;
      dailyPriceMin?: number;
      daily_price_min?: number;
      dailyPriceMax?: number;
      daily_price_max?: number;
      partyPriceMin?: number;
      party_price_min?: number;
      partyPriceMax?: number;
      party_price_max?: number;
      distanceKm?: number;
      distance_km?: number;
      caloriesKcal?: number;
      calories_kcal?: number;
      submissionMode?: LegacyFoodCandidateSubmissionMode;
      submission_mode?: LegacyFoodCandidateSubmissionMode;
      rawText?: string;
      raw_text?: string;
      evidenceAssetIds?: string[];
      evidence_asset_ids?: string[];
      extractionWarnings?: string[];
      extraction_warnings?: string[];
      categoryName?: string;
      category_name?: string;
      note?: string;
    }>(event);
    const rawText = normalizeFoodCandidateRawText(body.rawText ?? body.raw_text);
    const submissionMode = normalizeLegacyFoodCandidateSubmissionMode(
      body.submissionMode || body.submission_mode || (rawText ? "raw_text" : "structured"),
    );
    if (submissionMode === "raw_text" && !rawText) {
      return toApiError(400, "FOOD_CANDIDATE_RAW_TEXT_REQUIRED", "文案抽取模式必须填写原始文案");
    }
    const extractionResult = rawText
      ? extractFoodCandidateFields(rawText, {
          brandHint: asString(body.brandName || body.brand_name),
          categoryHint: asString(body.categoryKey || body.category_key),
        })
      : { extracted: {}, warnings: [], rawTextPreview: "" };
    const name = asString(body.name) || asString(extractionResult.extracted.name);
    const categoryKey =
      asString(body.categoryKey || body.category_key).toLowerCase() || asString(extractionResult.extracted.categoryKey).toLowerCase();
    if (!name || !categoryKey) {
      return toApiError(400, "FOOD_CANDIDATE_INVALID", "name 与 category_key 不能为空");
    }
    const categoryName =
      asString(body.categoryName || body.category_name) ||
      asString(extractionResult.extracted.categoryName) ||
      resolveFoodCandidateCategoryName(categoryKey);
    const nextFoodKey = `${state.foodCandidates.length + 1}`;
    const brandName =
      asString(body.brandName || body.brand_name) ||
      asString(extractionResult.extracted.brandName) ||
      name ||
      "未命名品牌";
    const dailyRange = normalizeFoodPriceRange(
      body.dailyPriceMin ?? body.daily_price_min ?? extractionResult.extracted.dailyPriceMin ?? 0,
      body.dailyPriceMax ??
        body.daily_price_max ??
        body.dailyPriceMin ??
        body.daily_price_min ??
        extractionResult.extracted.dailyPriceMax ??
        extractionResult.extracted.dailyPriceMin ??
        0,
    );
    const hasPartyPriceInput =
      Object.prototype.hasOwnProperty.call(body, "partyPriceMin") ||
      Object.prototype.hasOwnProperty.call(body, "party_price_min") ||
      Object.prototype.hasOwnProperty.call(body, "partyPriceMax") ||
      Object.prototype.hasOwnProperty.call(body, "party_price_max");
    const fallbackPartyRange = derivePartyPriceRange(dailyRange.min, dailyRange.max);
    const partyRange = hasPartyPriceInput
      ? normalizeFoodPriceRange(
          body.partyPriceMin ?? body.party_price_min ?? 0,
          body.partyPriceMax ??
            body.party_price_max ??
            body.partyPriceMin ??
            body.party_price_min ??
            0,
        )
      : normalizeFoodPriceRange(
          extractionResult.extracted.partyPriceMin ?? fallbackPartyRange.min,
          extractionResult.extracted.partyPriceMax ?? fallbackPartyRange.max,
        );
    const hasCaloriesInput =
      Object.prototype.hasOwnProperty.call(body, "caloriesKcal") || Object.prototype.hasOwnProperty.call(body, "calories_kcal");
    const caloriesKcal = hasCaloriesInput
      ? normalizeCaloriesKcal(body.caloriesKcal ?? body.calories_kcal, 0)
      : normalizeCaloriesKcal(extractionResult.extracted.caloriesKcal, 0);
    const extractionWarnings = normalizeExtractWarnings([
      ...normalizeStringArray(body.extractionWarnings ?? body.extraction_warnings),
      ...extractionResult.warnings,
    ]);
    const candidate: LegacyFoodCandidateRecord = {
      foodKey: nextFoodKey,
      sourceFoodId: "",
      name,
      categoryKey,
      categoryName,
      brandKey:
        asString(body.brandKey || body.brand_key) ||
        asString(extractionResult.extracted.brandKey) ||
        normalizeBrandKey(brandName),
      brandName,
      brandCombo: asString(body.brandCombo || body.brand_combo) || asString(extractionResult.extracted.brandCombo),
      candidateStatus: "pending_review",
      note: asString(body.note),
      createdByUserId: bindTarget.userId,
      createdByStudentId: bindTarget.studentId || "",
      distanceKm: Math.max(0, Number(body.distanceKm ?? body.distance_km ?? 0)),
      dailyPriceMin: dailyRange.min,
      dailyPriceMax: dailyRange.max,
      partyPriceMin: partyRange.min,
      partyPriceMax: partyRange.max,
      caloriesKcal,
      submissionMode,
      rawText,
      evidenceAssetIds: normalizeStringArray(body.evidenceAssetIds ?? body.evidence_asset_ids),
      extractionWarnings,
      reviewNote: "",
      isCaloriesEstimated: hasCaloriesInput ? false : Boolean(extractionResult.extracted.isCaloriesEstimated),
    };
    state.foodCandidates.unshift(candidate);
    return {
      ok: true,
      item: serializeFoodCandidatePayload(store, candidate),
    };
  }

  if (method === "GET" && path === "admin/food-candidates") {
    const { user } = requireLegacyAuth(event);
    if (!isAdminRole(user)) {
      return toApiError(403, "ADMIN_FOOD_CANDIDATE_FORBIDDEN", "仅管理员可查看候选审核列表");
    }
    const status = asString(query.status).toLowerCase();
    const keyword = asString(query.keyword).toLowerCase();
    const items = state.foodCandidates
      .filter((item) => !status || status === "all" || item.candidateStatus === status)
      .filter((item) => !keyword || `${item.name} ${item.brandName} ${item.note} ${item.rawText}`.toLowerCase().includes(keyword))
      .map((item) => serializeFoodCandidatePayload(store, item, { includeRawText: true, includeSourceFoodId: true }));
    return {
      ok: true,
      items,
    };
  }

  const adminFoodCandidateReviewMatch = path.match(/^admin\/food-candidates\/([^/]+)\/review$/);
  if (method === "POST" && adminFoodCandidateReviewMatch) {
    const { user } = requireLegacyAuth(event);
    if (!isAdminRole(user)) {
      return toApiError(403, "ADMIN_FOOD_CANDIDATE_FORBIDDEN", "仅管理员可审核候选食物");
    }
    const foodKey = decodeURIComponent(adminFoodCandidateReviewMatch[1]);
    const candidate = findFoodCandidateByKey(state, foodKey);
    if (!candidate) {
      return toApiError(404, "FOOD_CANDIDATE_NOT_FOUND", "候选食物不存在");
    }
    const body = await readJsonBody<{
      action?: "approve" | "reject";
      name?: string;
      categoryKey?: string;
      category_key?: string;
      categoryName?: string;
      category_name?: string;
      brandKey?: string;
      brand_key?: string;
      brandName?: string;
      brand_name?: string;
      brandCombo?: string;
      brand_combo?: string;
      dailyPriceMin?: number;
      daily_price_min?: number;
      dailyPriceMax?: number;
      daily_price_max?: number;
      partyPriceMin?: number;
      party_price_min?: number;
      partyPriceMax?: number;
      party_price_max?: number;
      distanceKm?: number;
      distance_km?: number;
      caloriesKcal?: number;
      calories_kcal?: number;
      note?: string;
      reviewNote?: string;
      review_note?: string;
      rawText?: string;
      raw_text?: string;
    }>(event);
    const action = asString(body.action).toLowerCase();
    const reviewNote = asString(body.reviewNote || body.review_note);
    if (action !== "approve" && action !== "reject") {
      return toApiError(400, "FOOD_CANDIDATE_REVIEW_ACTION_INVALID", "action 仅支持 approve/reject");
    }
    if (action === "reject") {
      if (candidate.candidateStatus === "approved") {
        return toApiError(400, "FOOD_CANDIDATE_APPROVED_REJECT_FORBIDDEN", "已通过候选不可直接拒绝");
      }
      candidate.candidateStatus = "rejected";
      candidate.reviewNote = reviewNote;
      return {
        ok: true,
        item: serializeFoodCandidatePayload(store, candidate, { includeRawText: true, includeSourceFoodId: true }),
      };
    }

    const rawText = normalizeFoodCandidateRawText(body.rawText ?? body.raw_text ?? candidate.rawText);
    const extractionResult = rawText
      ? extractFoodCandidateFields(rawText, {
          brandHint: asString(body.brandName || body.brand_name || candidate.brandName),
          categoryHint: asString(body.categoryKey || body.category_key || candidate.categoryKey),
        })
      : { extracted: {}, warnings: [], rawTextPreview: "" };
    const name = asString(body.name) || candidate.name || asString(extractionResult.extracted.name);
    const categoryKey =
      asString(body.categoryKey || body.category_key).toLowerCase() ||
      asString(candidate.categoryKey).toLowerCase() ||
      asString(extractionResult.extracted.categoryKey).toLowerCase();
    if (!name || !categoryKey) {
      return toApiError(400, "FOOD_CANDIDATE_INVALID", "审核通过前必须确认店铺名称与分类");
    }
    const categoryName =
      asString(body.categoryName || body.category_name) ||
      asString(candidate.categoryName) ||
      asString(extractionResult.extracted.categoryName) ||
      resolveFoodCandidateCategoryName(categoryKey);
    const brandName =
      asString(body.brandName || body.brand_name) ||
      asString(candidate.brandName) ||
      asString(extractionResult.extracted.brandName) ||
      name;
    const dailyRange = normalizeFoodPriceRange(
      body.dailyPriceMin ?? body.daily_price_min ?? candidate.dailyPriceMin ?? extractionResult.extracted.dailyPriceMin ?? 0,
      body.dailyPriceMax ??
        body.daily_price_max ??
        candidate.dailyPriceMax ??
        body.dailyPriceMin ??
        body.daily_price_min ??
        extractionResult.extracted.dailyPriceMax ??
        extractionResult.extracted.dailyPriceMin ??
        0,
    );
    const hasPartyOverride =
      Object.prototype.hasOwnProperty.call(body, "partyPriceMin") ||
      Object.prototype.hasOwnProperty.call(body, "party_price_min") ||
      Object.prototype.hasOwnProperty.call(body, "partyPriceMax") ||
      Object.prototype.hasOwnProperty.call(body, "party_price_max");
    const fallbackPartyRange = derivePartyPriceRange(dailyRange.min, dailyRange.max);
    const partyRange = hasPartyOverride
      ? normalizeFoodPriceRange(
          body.partyPriceMin ?? body.party_price_min ?? 0,
          body.partyPriceMax ?? body.party_price_max ?? body.partyPriceMin ?? body.party_price_min ?? 0,
        )
      : normalizeFoodPriceRange(
          candidate.partyPriceMin || extractionResult.extracted.partyPriceMin || fallbackPartyRange.min,
          candidate.partyPriceMax || extractionResult.extracted.partyPriceMax || fallbackPartyRange.max,
        );
    const hasCaloriesOverride =
      Object.prototype.hasOwnProperty.call(body, "caloriesKcal") || Object.prototype.hasOwnProperty.call(body, "calories_kcal");
    const caloriesKcal = hasCaloriesOverride
      ? normalizeCaloriesKcal(body.caloriesKcal ?? body.calories_kcal, 0)
      : normalizeCaloriesKcal(
          candidate.caloriesKcal || extractionResult.extracted.caloriesKcal,
          candidate.caloriesKcal || 0,
        );

    candidate.name = name;
    candidate.categoryKey = categoryKey;
    candidate.categoryName = categoryName;
    candidate.brandName = brandName;
    candidate.brandKey =
      asString(body.brandKey || body.brand_key) ||
      asString(candidate.brandKey) ||
      asString(extractionResult.extracted.brandKey) ||
      normalizeBrandKey(brandName);
    candidate.brandCombo =
      asString(body.brandCombo || body.brand_combo) ||
      asString(candidate.brandCombo) ||
      asString(extractionResult.extracted.brandCombo);
    candidate.note = Object.prototype.hasOwnProperty.call(body, "note") ? asString(body.note) : candidate.note;
    candidate.distanceKm = Math.max(0, Number(body.distanceKm ?? body.distance_km ?? candidate.distanceKm ?? 0));
    candidate.dailyPriceMin = dailyRange.min;
    candidate.dailyPriceMax = dailyRange.max;
    candidate.partyPriceMin = partyRange.min;
    candidate.partyPriceMax = partyRange.max;
    candidate.caloriesKcal = caloriesKcal;
    candidate.rawText = rawText;
    candidate.reviewNote = reviewNote;
    candidate.extractionWarnings = normalizeExtractWarnings([
      ...candidate.extractionWarnings,
      ...extractionResult.warnings,
    ]);
    if (rawText) {
      candidate.submissionMode = "raw_text";
    }
    candidate.isCaloriesEstimated = hasCaloriesOverride ? false : Boolean(candidate.isCaloriesEstimated || extractionResult.extracted.isCaloriesEstimated);
    candidate.candidateStatus = "approved";
    const foodItem = upsertFoodItemFromCandidate(store, candidate);
    bindCandidateToFoodItem(state, candidate, foodItem);
    return {
      ok: true,
      item: serializeFoodCandidatePayload(store, candidate, { includeRawText: true, includeSourceFoodId: true }),
    };
  }

  return null;
};
