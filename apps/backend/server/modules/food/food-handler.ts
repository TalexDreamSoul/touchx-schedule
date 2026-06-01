import type { H3Event } from "h3";
import type {
  FoodCampaignRecord,
  FoodCampaignVoteRecord,
  FoodItemRecord,
  FoodPricingRuleVersionRecord,
  LocationGridRecord,
  NexusStore,
  UserRecord,
} from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import {
  clampNumber,
  estimateFoodCaloriesKcal,
  normalizeCaloriesKcal,
  resolveExerciseEquivalentMinutes,
} from "../../services/food-utils";
import { isAdminRole } from "../auth/auth-service";
import {
  buildFoodCategoryStats,
  buildPricingCurve,
  filterFoodItems,
  gridApprox,
  haversineKm,
  isLocationStale,
  parseFoodCsvText,
  resolveCampaignDeadlineIsoV1,
  resolveCampaignOptionIds,
  resolveCampaignVotes,
  resolvePricingFactor,
  sanitizeFoodPrice,
  sanitizeLatitude,
  sanitizeLongitude,
  serializeCampaignDetail,
  toAdminFoodItemPayload,
  toDistanceLevel,
} from "./food-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { user: UserRecord };
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface FoodHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireUser: RequireUser;
  requireAdmin: RequireAdmin;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
}

const asString = (value: unknown) => String(value || "").trim();

export const isFoodPath = (path: string) => {
  return (
    path === "location/update-grid" ||
    path === "foods/nearby" ||
    path === "admin/foods" ||
    path.startsWith("admin/foods/") ||
    path === "admin/food-pricing-rules" ||
    path.startsWith("admin/food-pricing-rules/") ||
    path === "food-campaigns" ||
    path.startsWith("food-campaigns/") ||
    path === "admin/food-campaigns" ||
    path === "admin/preview/food-vote-state"
  );
};

export const handleFoodApi = async (context: FoodHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireUser, requireAdmin, readJsonBody, appendAudit } = context;

  if (method === "POST" && path === "location/update-grid") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ latitude?: number; longitude?: number }>(event);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return toApiError(400, "LOCATION_INVALID", "定位参数无效");
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return toApiError(400, "LOCATION_OUT_OF_RANGE", "定位超出有效经纬度范围");
    }
    const approx = gridApprox(latitude, longitude);
    const existing = store.locationGrids.find((item) => item.userId === user.userId) || null;
    const updatedAt = storeHelpers.nowIso();
    if (existing) {
      existing.gridId = approx.gridId;
      existing.latitudeApprox = approx.latitudeApprox;
      existing.longitudeApprox = approx.longitudeApprox;
      existing.updatedAt = updatedAt;
      existing.stale = false;
    } else {
      const nextGrid: LocationGridRecord = {
        userId: user.userId,
        gridId: approx.gridId,
        latitudeApprox: approx.latitudeApprox,
        longitudeApprox: approx.longitudeApprox,
        updatedAt,
        stale: false,
      };
      store.locationGrids.push(nextGrid);
    }
    appendAudit("location_update_grid", user.userId, { gridId: approx.gridId });
    return ok({
      gridId: approx.gridId,
      latitudeApprox: approx.latitudeApprox,
      longitudeApprox: approx.longitudeApprox,
      updatedAt,
      stale: false,
    });
  }

  if (method === "GET" && path === "foods/nearby") {
    const { user } = requireUser(event);
    const headcount = Math.max(1, Number(query.headcount || 1));
    const location = store.locationGrids.find((item) => item.userId === user.userId) || null;
    const locationStale = location ? isLocationStale(location.updatedAt) : true;
    const items = store.foodItems
      .map((item) => {
        const rule = store.foodPricingRules.find((ruleItem) => ruleItem.categoryKey === item.categoryKey) || null;
        const factor = rule ? resolvePricingFactor(rule, headcount) : 1;
        const dynamicPriceMin = Number((item.priceMin * factor).toFixed(2));
        const dynamicPriceMax = Number((item.priceMax * factor).toFixed(2));
        const distanceKm = location
          ? Number(haversineKm(location.latitudeApprox, location.longitudeApprox, item.latitude, item.longitude).toFixed(3))
          : -1;
        const caloriesKcal = normalizeCaloriesKcal(item.caloriesKcal, 0);
        return {
          foodId: item.id,
          foodName: item.name,
          merchantName: item.merchantName,
          categoryKey: item.categoryKey,
          categoryName: item.categoryName,
          basePriceMin: item.priceMin,
          basePriceMax: item.priceMax,
          caloriesKcal,
          exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(caloriesKcal),
          dynamicPriceMin,
          dynamicPriceMax,
          factor: Number(factor.toFixed(4)),
          distanceKm,
          distanceLevel: distanceKm < 0 ? "far" : toDistanceLevel(distanceKm),
        };
      })
      .sort((left, right) => {
        if (left.distanceKm < 0 && right.distanceKm >= 0) {
          return 1;
        }
        if (right.distanceKm < 0 && left.distanceKm >= 0) {
          return -1;
        }
        return left.distanceKm - right.distanceKm;
      });
    return ok({
      location: location
        ? {
            ...location,
            stale: locationStale,
          }
        : {
            gridId: "",
            latitudeApprox: 0,
            longitudeApprox: 0,
            updatedAt: "",
            stale: true,
          },
      staleHint: locationStale ? "位置超过24小时未更新，距离仅供参考" : "",
      items,
    });
  }

  if (method === "GET" && path === "admin/foods") {
    requireAdmin(event);
    const items = filterFoodItems(store.foodItems, {
      categoryKey: asString(query.categoryKey || query.category_key),
      keyword: asString(query.keyword),
    })
      .map((item) => toAdminFoodItemPayload(store, item))
      .sort((left, right) => left.categoryKey.localeCompare(right.categoryKey) || left.foodName.localeCompare(right.foodName));
    return ok({ items });
  }

  if (method === "GET" && path === "admin/foods/category-stats") {
    requireAdmin(event);
    const filteredItems = filterFoodItems(store.foodItems, {
      categoryKey: asString(query.categoryKey || query.category_key),
      keyword: asString(query.keyword),
    });
    const items = buildFoodCategoryStats(filteredItems);
    const zeroCaloriesCount = filteredItems.filter((item) => normalizeCaloriesKcal(item.caloriesKcal, 0) <= 0).length;
    return ok({
      totalFoods: filteredItems.length,
      totalCategories: items.length,
      zeroCaloriesCount,
      items,
    });
  }

  if (method === "POST" && path === "admin/foods") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      name?: string;
      merchantName?: string;
      categoryKey?: string;
      categoryName?: string;
      latitude?: number;
      longitude?: number;
      basePriceMin?: number;
      basePriceMax?: number;
      caloriesKcal?: number;
    }>(event);
    const name = asString(body.name);
    if (!name) {
      return toApiError(400, "FOOD_NAME_REQUIRED", "food name 不能为空");
    }
    const categoryKey = asString(body.categoryKey).toLowerCase();
    if (!categoryKey) {
      return toApiError(400, "FOOD_CATEGORY_REQUIRED", "categoryKey 不能为空");
    }
    const basePriceMin = sanitizeFoodPrice(body.basePriceMin);
    const basePriceMax = Math.max(basePriceMin, sanitizeFoodPrice(body.basePriceMax));
    const item: FoodItemRecord = {
      id: storeHelpers.createId("food"),
      name,
      merchantName: asString(body.merchantName) || "未命名商家",
      categoryKey,
      categoryName: asString(body.categoryName) || categoryKey,
      latitude: sanitizeLatitude(body.latitude),
      longitude: sanitizeLongitude(body.longitude),
      priceMin: basePriceMin,
      priceMax: basePriceMax,
      caloriesKcal: normalizeCaloriesKcal(body.caloriesKcal, 0),
    };
    store.foodItems.push(item);
    appendAudit("food_item_create", user.userId, { foodId: item.id, foodName: item.name, categoryKey: item.categoryKey });
    return ok({
      item: toAdminFoodItemPayload(store, item),
    });
  }

  const adminFoodUpdateMatch = path.match(/^admin\/foods\/([^/]+)\/update$/);
  if (method === "POST" && adminFoodUpdateMatch) {
    const { user } = requireAdmin(event);
    const foodId = decodeURIComponent(adminFoodUpdateMatch[1]);
    const item = store.foodItems.find((foodItem) => foodItem.id === foodId) || null;
    if (!item) {
      return toApiError(404, "FOOD_NOT_FOUND", "食物不存在");
    }
    const body = await readJsonBody<{
      name?: string;
      merchantName?: string;
      categoryKey?: string;
      categoryName?: string;
      latitude?: number;
      longitude?: number;
      basePriceMin?: number;
      basePriceMax?: number;
      caloriesKcal?: number;
    }>(event);
    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = asString(body.name);
      if (!name) {
        return toApiError(400, "FOOD_NAME_REQUIRED", "food name 不能为空");
      }
      item.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(body, "merchantName")) {
      item.merchantName = asString(body.merchantName) || item.merchantName;
    }
    if (Object.prototype.hasOwnProperty.call(body, "categoryKey")) {
      const categoryKey = asString(body.categoryKey).toLowerCase();
      if (!categoryKey) {
        return toApiError(400, "FOOD_CATEGORY_REQUIRED", "categoryKey 不能为空");
      }
      item.categoryKey = categoryKey;
    }
    if (Object.prototype.hasOwnProperty.call(body, "categoryName")) {
      item.categoryName = asString(body.categoryName) || item.categoryName;
    }
    if (Object.prototype.hasOwnProperty.call(body, "latitude")) {
      item.latitude = sanitizeLatitude(body.latitude, item.latitude);
    }
    if (Object.prototype.hasOwnProperty.call(body, "longitude")) {
      item.longitude = sanitizeLongitude(body.longitude, item.longitude);
    }
    if (Object.prototype.hasOwnProperty.call(body, "basePriceMin")) {
      item.priceMin = sanitizeFoodPrice(body.basePriceMin);
    }
    if (Object.prototype.hasOwnProperty.call(body, "basePriceMax")) {
      item.priceMax = sanitizeFoodPrice(body.basePriceMax);
    }
    if (item.priceMax < item.priceMin) {
      item.priceMax = item.priceMin;
    }
    if (Object.prototype.hasOwnProperty.call(body, "caloriesKcal")) {
      item.caloriesKcal = normalizeCaloriesKcal(body.caloriesKcal, item.caloriesKcal);
    }
    appendAudit("food_item_update", user.userId, { foodId: item.id, foodName: item.name, categoryKey: item.categoryKey });
    return ok({
      item: toAdminFoodItemPayload(store, item),
    });
  }

  const adminFoodDeleteMatch = path.match(/^admin\/foods\/([^/]+)\/delete$/);
  if (method === "POST" && adminFoodDeleteMatch) {
    const { user } = requireAdmin(event);
    if (store.foodItems.length <= 1) {
      return toApiError(400, "FOOD_DELETE_FORBIDDEN", "至少保留 1 条食物数据");
    }
    const foodId = decodeURIComponent(adminFoodDeleteMatch[1]);
    const target = store.foodItems.find((foodItem) => foodItem.id === foodId) || null;
    if (!target) {
      return toApiError(404, "FOOD_NOT_FOUND", "食物不存在");
    }
    const fallbackFoodIds = store.foodItems.filter((foodItem) => foodItem.id !== foodId).map((foodItem) => foodItem.id);
    let impactedCampaignCount = 0;
    store.foodCampaigns.forEach((campaign) => {
      if (!campaign.optionFoodIds.includes(foodId)) {
        return;
      }
      impactedCampaignCount += 1;
      const nextOptionIds = campaign.optionFoodIds.filter((optionId) => optionId !== foodId);
      campaign.optionFoodIds = nextOptionIds.length > 0 ? nextOptionIds : fallbackFoodIds.slice(0, 1);
      campaign.updatedAt = storeHelpers.nowIso();
    });
    const removedVoteCount = store.foodCampaignVotes.filter((vote) => vote.foodId === foodId).length;
    store.foodCampaignVotes = store.foodCampaignVotes.filter((vote) => vote.foodId !== foodId);
    store.foodPricingOverrideVersions = store.foodPricingOverrideVersions.filter((item) => item.foodId !== foodId);
    store.foodItems = store.foodItems.filter((foodItem) => foodItem.id !== foodId);
    appendAudit("food_item_delete", user.userId, {
      foodId,
      foodName: target.name,
      impactedCampaignCount,
      removedVoteCount,
    });
    return ok({
      deleted: true,
      foodId,
      impactedCampaignCount,
      removedVoteCount,
    });
  }

  if (method === "POST" && path === "admin/foods/import-csv") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      csvText?: string;
      mode?: "append" | "upsert";
    }>(event);
    const csvText = String(body.csvText || "").trim();
    if (!csvText) {
      return toApiError(400, "CSV_TEXT_REQUIRED", "csvText 不能为空");
    }
    const mode = body.mode === "upsert" ? "upsert" : "append";
    const parsed = parseFoodCsvText(csvText);
    if (parsed.rows.length === 0) {
      return toApiError(400, "CSV_ROWS_EMPTY", "CSV 至少需要 1 行数据");
    }
    const errors: Array<{ rowIndex: number; reason: string }> = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const upsertByIdentity = (row: Record<string, string>) => {
      const foodId = asString(row.foodId);
      if (foodId) {
        return store.foodItems.find((item) => item.id === foodId) || null;
      }
      const name = asString(row.name);
      const merchantName = asString(row.merchantName);
      const categoryKey = asString(row.categoryKey).toLowerCase();
      if (!name || !merchantName || !categoryKey) {
        return null;
      }
      return (
        store.foodItems.find(
          (item) => item.name === name && item.merchantName === merchantName && item.categoryKey === categoryKey,
        ) || null
      );
    };
    parsed.rows.forEach((row, rowOffset) => {
      const rowIndex = rowOffset + 2;
      const name = asString(row.name);
      const categoryKey = asString(row.categoryKey).toLowerCase();
      if (!name || !categoryKey) {
        skipped += 1;
        errors.push({ rowIndex, reason: "name 或 categoryKey 缺失，已跳过" });
        return;
      }
      const matched = mode === "upsert" ? upsertByIdentity(row) : null;
      if (matched) {
        matched.name = name;
        if (asString(row.merchantName)) {
          matched.merchantName = asString(row.merchantName);
        }
        matched.categoryKey = categoryKey;
        matched.categoryName = asString(row.categoryName) || matched.categoryName || categoryKey;
        if (asString(row.basePriceMin)) {
          matched.priceMin = sanitizeFoodPrice(row.basePriceMin);
        }
        if (asString(row.basePriceMax)) {
          matched.priceMax = sanitizeFoodPrice(row.basePriceMax);
        }
        if (matched.priceMax < matched.priceMin) {
          matched.priceMax = matched.priceMin;
        }
        if (asString(row.caloriesKcal)) {
          matched.caloriesKcal = normalizeCaloriesKcal(row.caloriesKcal, matched.caloriesKcal);
        }
        if (asString(row.latitude)) {
          matched.latitude = sanitizeLatitude(row.latitude, matched.latitude);
        }
        if (asString(row.longitude)) {
          matched.longitude = sanitizeLongitude(row.longitude, matched.longitude);
        }
        updated += 1;
        return;
      }
      const item: FoodItemRecord = {
        id: storeHelpers.createId("food"),
        name,
        merchantName: asString(row.merchantName) || "未命名商家",
        categoryKey,
        categoryName: asString(row.categoryName) || categoryKey,
        latitude: sanitizeLatitude(row.latitude),
        longitude: sanitizeLongitude(row.longitude),
        priceMin: sanitizeFoodPrice(row.basePriceMin),
        priceMax: sanitizeFoodPrice(row.basePriceMax),
        caloriesKcal: normalizeCaloriesKcal(row.caloriesKcal, 0),
      };
      if (item.priceMax < item.priceMin) {
        item.priceMax = item.priceMin;
      }
      store.foodItems.push(item);
      created += 1;
    });
    appendAudit("food_item_import_csv", user.userId, {
      mode,
      totalRows: parsed.rows.length,
      created,
      updated,
      skipped,
      errorCount: errors.length,
    });
    return ok({
      summary: {
        mode,
        totalRows: parsed.rows.length,
        created,
        updated,
        skipped,
        errorCount: errors.length,
      },
      errors: errors.slice(0, 50),
      items: store.foodItems.slice(0, 20).map((item) => toAdminFoodItemPayload(store, item)),
    });
  }

  if (method === "POST" && path === "admin/foods/calories/recalculate") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      scope?: "all" | "category";
      categoryKey?: string;
      keyword?: string;
      writeMode?: "fill_missing" | "overwrite";
      applyAction?: "commit" | "dry_run";
      baseShift?: number;
      priceWeight?: number;
      minKcal?: number;
      maxKcal?: number;
    }>(event);
    const scope = body.scope === "category" ? "category" : "all";
    const categoryKey = asString(body.categoryKey).toLowerCase();
    const keyword = asString(body.keyword);
    if (scope === "category" && !categoryKey) {
      return toApiError(400, "CATEGORY_KEY_REQUIRED", "按分类校正时 categoryKey 不能为空");
    }
    const writeMode = body.writeMode === "overwrite" ? "overwrite" : "fill_missing";
    const applyAction = body.applyAction === "dry_run" ? "dry_run" : "commit";
    const baseShift = Number.isFinite(Number(body.baseShift)) ? Math.round(Number(body.baseShift)) : 0;
    const priceWeightRaw = Number(body.priceWeight);
    const priceWeight = Number.isFinite(priceWeightRaw) ? clampNumber(priceWeightRaw, 4, 40) : 16;
    const minKcalRaw = Number(body.minKcal);
    const maxKcalRaw = Number(body.maxKcal);
    const normalizedMinKcal = Number.isFinite(minKcalRaw) ? clampNumber(Math.round(minKcalRaw), 50, 3000) : 120;
    const normalizedMaxKcal = Number.isFinite(maxKcalRaw) ? clampNumber(Math.round(maxKcalRaw), 50, 5000) : 1500;
    const minKcal = Math.min(normalizedMinKcal, normalizedMaxKcal);
    const maxKcal = Math.max(normalizedMinKcal, normalizedMaxKcal);

    const targetItems = filterFoodItems(store.foodItems, {
      categoryKey: scope === "category" ? categoryKey : "",
      keyword,
    });
    const examples: Array<{
      foodId: string;
      foodName: string;
      categoryKey: string;
      beforeCaloriesKcal: number;
      afterCaloriesKcal: number;
    }> = [];
    let updatedCount = 0;
    let skippedFilledCount = 0;
    let skippedUnchangedCount = 0;
    targetItems.forEach((item) => {
      const beforeCaloriesKcal = normalizeCaloriesKcal(item.caloriesKcal, 0);
      if (writeMode === "fill_missing" && beforeCaloriesKcal > 0) {
        skippedFilledCount += 1;
        return;
      }
      const afterCaloriesKcal = estimateFoodCaloriesKcal(item, {
        baseShift,
        priceWeight,
        minKcal,
        maxKcal,
      });
      if (beforeCaloriesKcal === afterCaloriesKcal) {
        skippedUnchangedCount += 1;
        return;
      }
      if (applyAction === "commit") {
        item.caloriesKcal = afterCaloriesKcal;
      }
      updatedCount += 1;
      if (examples.length < 30) {
        examples.push({
          foodId: item.id,
          foodName: item.name,
          categoryKey: item.categoryKey,
          beforeCaloriesKcal,
          afterCaloriesKcal,
        });
      }
    });

    appendAudit("food_calories_recalculate", user.userId, {
      scope,
      categoryKey: scope === "category" ? categoryKey : "",
      keyword: asString(keyword),
      writeMode,
      applyAction,
      baseShift,
      priceWeight,
      minKcal,
      maxKcal,
      targetCount: targetItems.length,
      updatedCount,
      skippedFilledCount,
      skippedUnchangedCount,
    });

    return ok({
      summary: {
        scope,
        categoryKey: scope === "category" ? categoryKey : "",
        keyword: asString(keyword),
        writeMode,
        applyAction,
        baseShift,
        priceWeight,
        minKcal,
        maxKcal,
        targetCount: targetItems.length,
        updatedCount,
        skippedFilledCount,
        skippedUnchangedCount,
      },
      examples,
      categoryStats: buildFoodCategoryStats(store.foodItems),
    });
  }

  if (method === "GET" && path === "admin/food-pricing-rules") {
    requireAdmin(event);
    return ok({
      items: store.foodPricingRules.map((item) => ({ ...item })),
    });
  }

  if (method === "POST" && path === "admin/food-pricing-rules") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      categoryKey?: string;
      categoryName?: string;
      trendMode?: "down" | "up";
      anchorHeadcount?: number;
      slope?: number;
      minFactor?: number;
      maxFactor?: number;
    }>(event);
    const categoryKey = asString(body.categoryKey);
    if (!categoryKey) {
      return toApiError(400, "CATEGORY_KEY_REQUIRED", "categoryKey 不能为空");
    }
    let rule = store.foodPricingRules.find((item) => item.categoryKey === categoryKey) || null;
    if (!rule) {
      rule = {
        categoryKey,
        categoryName: asString(body.categoryName) || categoryKey,
        trendMode: body.trendMode === "up" ? "up" : "down",
        anchorHeadcount: Math.max(1, Number(body.anchorHeadcount || 10)),
        slope: Number(body.slope || 0.03),
        minFactor: Number(body.minFactor || 0.8),
        maxFactor: Number(body.maxFactor || 1.2),
        updatedAt: storeHelpers.nowIso(),
      };
      store.foodPricingRules.push(rule);
    } else {
      rule.categoryName = asString(body.categoryName) || rule.categoryName;
      rule.trendMode = body.trendMode === "up" ? "up" : body.trendMode === "down" ? "down" : rule.trendMode;
      if (Number.isFinite(Number(body.anchorHeadcount))) {
        rule.anchorHeadcount = Math.max(1, Number(body.anchorHeadcount));
      }
      if (Number.isFinite(Number(body.slope))) {
        rule.slope = Number(body.slope);
      }
      if (Number.isFinite(Number(body.minFactor))) {
        rule.minFactor = Number(body.minFactor);
      }
      if (Number.isFinite(Number(body.maxFactor))) {
        rule.maxFactor = Number(body.maxFactor);
      }
      rule.updatedAt = storeHelpers.nowIso();
    }
    const version: FoodPricingRuleVersionRecord = {
      versionId: storeHelpers.createId("pricing_rule_ver"),
      categoryKey: rule.categoryKey,
      categoryName: rule.categoryName,
      trendMode: rule.trendMode,
      anchorHeadcount: rule.anchorHeadcount,
      slope: rule.slope,
      minFactor: rule.minFactor,
      maxFactor: rule.maxFactor,
      createdAt: storeHelpers.nowIso(),
    };
    store.foodPricingRuleVersions.unshift(version);
    appendAudit("food_pricing_rule_save", user.userId, { categoryKey: rule.categoryKey });
    return ok({ rule, versionId: version.versionId });
  }

  if (method === "POST" && path === "admin/food-pricing-rules/preview") {
    requireAdmin(event);
    const body = await readJsonBody<{
      categoryKey?: string;
      basePriceMin?: number;
      basePriceMax?: number;
      headcountStart?: number;
      headcountEnd?: number;
      headcountStep?: number;
    }>(event);
    const categoryKey = asString(body.categoryKey);
    const rule =
      store.foodPricingRules.find((item) => item.categoryKey === categoryKey) ||
      store.foodPricingRules[0] ||
      null;
    if (!rule) {
      return toApiError(404, "PRICING_RULE_NOT_FOUND", "暂无可用的价格规则");
    }
    const basePriceMin = Math.max(0.01, Number(body.basePriceMin || 10));
    const basePriceMax = Math.max(basePriceMin, Number(body.basePriceMax || basePriceMin * 1.3));
    const headcountStart = Math.max(1, Number(body.headcountStart || 1));
    const headcountEnd = Math.max(headcountStart, Number(body.headcountEnd || 30));
    const headcountStep = Math.max(1, Number(body.headcountStep || 1));
    const points = buildPricingCurve(rule, basePriceMin, basePriceMax, headcountStart, headcountEnd, headcountStep);
    return ok({
      preview: {
        categoryKey: rule.categoryKey,
        categoryName: rule.categoryName,
        rule,
        basePriceMin,
        basePriceMax,
        headcountStart,
        headcountEnd,
        headcountStep,
        points,
      },
    });
  }

  if (method === "GET" && path === "admin/food-pricing-rules/history") {
    requireAdmin(event);
    const categoryKey = asString(query.categoryKey || query.category_key);
    const items = store.foodPricingRuleVersions
      .filter((item) => !categoryKey || item.categoryKey === categoryKey)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((item) => ({
        ...item,
        createdAt: Date.parse(item.createdAt),
      }));
    return ok({ items });
  }

  if (method === "POST" && path === "admin/food-pricing-rules/rollback") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ versionId?: string; version_id?: string }>(event);
    const versionId = asString(body.versionId || body.version_id);
    if (!versionId) {
      return toApiError(400, "VERSION_ID_REQUIRED", "versionId 不能为空");
    }
    const version = store.foodPricingRuleVersions.find((item) => item.versionId === versionId) || null;
    if (!version) {
      return toApiError(404, "VERSION_NOT_FOUND", "历史版本不存在");
    }
    let rule = store.foodPricingRules.find((item) => item.categoryKey === version.categoryKey) || null;
    if (!rule) {
      rule = {
        categoryKey: version.categoryKey,
        categoryName: version.categoryName,
        trendMode: version.trendMode,
        anchorHeadcount: version.anchorHeadcount,
        slope: version.slope,
        minFactor: version.minFactor,
        maxFactor: version.maxFactor,
        updatedAt: storeHelpers.nowIso(),
      };
      store.foodPricingRules.push(rule);
    } else {
      rule.categoryName = version.categoryName;
      rule.trendMode = version.trendMode;
      rule.anchorHeadcount = version.anchorHeadcount;
      rule.slope = version.slope;
      rule.minFactor = version.minFactor;
      rule.maxFactor = version.maxFactor;
      rule.updatedAt = storeHelpers.nowIso();
    }
    const rollbackVersion: FoodPricingRuleVersionRecord = {
      versionId: storeHelpers.createId("pricing_rule_ver"),
      categoryKey: rule.categoryKey,
      categoryName: rule.categoryName,
      trendMode: rule.trendMode,
      anchorHeadcount: rule.anchorHeadcount,
      slope: rule.slope,
      minFactor: rule.minFactor,
      maxFactor: rule.maxFactor,
      createdAt: storeHelpers.nowIso(),
    };
    store.foodPricingRuleVersions.unshift(rollbackVersion);
    appendAudit("food_pricing_rule_rollback", user.userId, { targetVersionId: versionId, categoryKey: rule.categoryKey });
    return ok({
      rollback: true,
      rule,
      versionId: rollbackVersion.versionId,
    });
  }

  const foodPricingHistoryMatch = path.match(/^admin\/foods\/([^/]+)\/pricing-history$/);
  if (method === "GET" && foodPricingHistoryMatch) {
    requireAdmin(event);
    const foodId = decodeURIComponent(foodPricingHistoryMatch[1]);
    const food = store.foodItems.find((item) => item.id === foodId) || null;
    if (!food) {
      return toApiError(404, "FOOD_NOT_FOUND", "食物不存在");
    }
    const categoryVersions = store.foodPricingRuleVersions.filter((item) => item.categoryKey === food.categoryKey);
    const overrideVersions = store.foodPricingOverrideVersions.filter((item) => item.foodId === foodId);
    return ok({
      food: {
        foodId: food.id,
        foodName: food.name,
        categoryKey: food.categoryKey,
        categoryName: food.categoryName,
        caloriesKcal: normalizeCaloriesKcal(food.caloriesKcal, 0),
      },
      categoryVersions,
      overrideVersions,
    });
  }

  if (method === "GET" && path === "food-campaigns") {
    const { user } = requireUser(event);
    const status = asString(query.status) || "all";
    const items = store.foodCampaigns
      .filter((item) => status === "all" || item.status === status)
      .map((item) => {
        const detail = serializeCampaignDetail(store, item, user.userId, "");
        return {
          campaignId: item.id,
          title: item.title,
          status: item.status,
          isAnonymous: item.isAnonymous,
          deadlineAtIso: item.deadlineAtIso,
          optionCount: item.optionFoodIds.length,
          joined: detail.myVotes.length > 0,
        };
      });
    return ok({ items });
  }

  if (method === "POST" && path === "food-campaigns") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      title?: string;
      classId?: string;
      deadlineAtIso?: string;
      isAnonymous?: boolean;
      optionFoodIds?: string[];
    }>(event);
    const title = asString(body.title) || `食物投票-${new Date().toISOString().slice(0, 10)}`;
    const optionFoodIds = resolveCampaignOptionIds(store, body.optionFoodIds);
    const campaign: FoodCampaignRecord = {
      id: storeHelpers.createId("campaign"),
      title,
      status: "open",
      classId: asString(body.classId) || undefined,
      createdByUserId: user.userId,
      deadlineAtIso: resolveCampaignDeadlineIsoV1(asString(body.deadlineAtIso), toApiError),
      shareToken: storeHelpers.generateShareToken(),
      isAnonymous: body.isAnonymous !== false,
      revealAfterClose: true,
      revealScope: "share_token",
      optionFoodIds,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.foodCampaigns.unshift(campaign);
    appendAudit("food_campaign_create", user.userId, { campaignId: campaign.id, isAnonymous: campaign.isAnonymous });
    return ok({
      campaignId: campaign.id,
      shareToken: campaign.shareToken,
      isAnonymous: campaign.isAnonymous,
      status: campaign.status,
    });
  }

  const foodCampaignDetailMatch = path.match(/^food-campaigns\/([^/]+)$/);
  if (method === "GET" && foodCampaignDetailMatch) {
    const campaignId = decodeURIComponent(foodCampaignDetailMatch[1]);
    const { user } = requireUser(event);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "投票活动不存在");
    }
    const shareToken = asString(query.shareToken || query.share_token);
    return ok(serializeCampaignDetail(store, campaign, user.userId, shareToken));
  }

  const foodCampaignVoteMatch = path.match(/^food-campaigns\/([^/]+)\/vote$/);
  if (method === "POST" && foodCampaignVoteMatch) {
    const campaignId = decodeURIComponent(foodCampaignVoteMatch[1]);
    const { user } = requireUser(event);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "投票活动不存在");
    }
    if (campaign.status !== "open") {
      return toApiError(400, "FOOD_CAMPAIGN_CLOSED", "当前投票活动已结束");
    }
    const body = await readJsonBody<{ foodId?: string; score?: number }>(event);
    const foodId = asString(body.foodId);
    if (!foodId || !campaign.optionFoodIds.includes(foodId)) {
      return toApiError(400, "FOOD_OPTION_INVALID", "投票选项不合法");
    }
    const score = Math.max(1, Math.min(10, Number(body.score || 1)));
    const existing = store.foodCampaignVotes.find((item) => item.campaignId === campaignId && item.userId === user.userId) || null;
    if (existing) {
      existing.foodId = foodId;
      existing.score = score;
      existing.createdAt = storeHelpers.nowIso();
    } else {
      const vote: FoodCampaignVoteRecord = {
        id: storeHelpers.createId("campaign_vote"),
        campaignId,
        userId: user.userId,
        foodId,
        score,
        createdAt: storeHelpers.nowIso(),
      };
      store.foodCampaignVotes.push(vote);
    }
    appendAudit("food_campaign_vote", user.userId, { campaignId, foodId, score });
    return ok(serializeCampaignDetail(store, campaign, user.userId, ""));
  }

  const foodCampaignCloseMatch = path.match(/^food-campaigns\/([^/]+)\/close$/);
  if (method === "POST" && foodCampaignCloseMatch) {
    const campaignId = decodeURIComponent(foodCampaignCloseMatch[1]);
    const contextUser = requireUser(event);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "投票活动不存在");
    }
    if (campaign.createdByUserId !== contextUser.user.userId && !isAdminRole(contextUser.user)) {
      return toApiError(403, "FOOD_CAMPAIGN_CLOSE_FORBIDDEN", "仅创建者或管理员可以结束投票");
    }
    campaign.status = "closed";
    campaign.updatedAt = storeHelpers.nowIso();
    appendAudit("food_campaign_close", contextUser.user.userId, { campaignId });
    return ok(serializeCampaignDetail(store, campaign, contextUser.user.userId, campaign.shareToken));
  }

  if (method === "GET" && path === "admin/food-campaigns") {
    requireAdmin(event);
    const items = store.foodCampaigns.map((item) => ({
      campaignId: item.id,
      title: item.title,
      status: item.status,
      isAnonymous: item.isAnonymous,
      deadlineAtIso: item.deadlineAtIso,
      optionCount: item.optionFoodIds.length,
      voteCount: resolveCampaignVotes(store, item.id).length,
    }));
    return ok({ items });
  }

  if (method === "GET" && path === "admin/preview/food-vote-state") {
    requireAdmin(event);
    const campaignId = asString(query.campaignId || query.campaign_id);
    const studentNo = asString(query.studentNo || query.student_no);
    const shareToken = asString(query.shareToken || query.share_token);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || store.foodCampaigns[0] || null;
    if (!campaign) {
      return toApiError(404, "PREVIEW_CAMPAIGN_NOT_FOUND", "暂无可预览投票活动");
    }
    const user =
      store.users.find((item) => item.studentNo === studentNo) ||
      store.users.find((item) => item.adminRole === "none") ||
      store.users[0];
    return ok({
      studentNo: user.studentNo,
      campaignId: campaign.id,
      detail: serializeCampaignDetail(store, campaign, user.userId, shareToken),
    });
  }

  return null;
};
