import type { DistanceLevel } from "@touchx/shared";
import {
  FOOD_CAMPAIGN_OPTION_LIMIT,
  type FoodCampaignRecord,
  type FoodItemRecord,
  type FoodPricingRuleRecord,
  type NexusStore,
} from "../../services/domain-store";
import {
  normalizeCaloriesKcal,
  resolveExerciseEquivalentMinutes,
} from "../../services/food-utils";

type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;

const asString = (value: unknown) => String(value || "").trim();

export const sanitizeFoodPrice = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Number(parsed.toFixed(2)));
};

export const sanitizeLatitude = (value: unknown, fallback = 31.23) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(90, Math.max(-90, Number(parsed.toFixed(6))));
};

export const sanitizeLongitude = (value: unknown, fallback = 121.47) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(180, Math.max(-180, Number(parsed.toFixed(6))));
};

export const buildFoodCategoryStats = (items: FoodItemRecord[]) => {
  const grouped = new Map<
    string,
    {
      categoryKey: string;
      categoryName: string;
      foodCount: number;
      merchantSet: Set<string>;
      minPrice: number;
      maxPrice: number;
      totalAvgPrice: number;
      totalCalories: number;
      caloriesSamples: number;
      zeroCaloriesCount: number;
    }
  >();
  items.forEach((item) => {
    const categoryKey = asString(item.categoryKey).toLowerCase() || "uncategorized";
    const categoryName = asString(item.categoryName) || categoryKey;
    let bucket = grouped.get(categoryKey);
    if (!bucket) {
      bucket = {
        categoryKey,
        categoryName,
        foodCount: 0,
        merchantSet: new Set<string>(),
        minPrice: Number.POSITIVE_INFINITY,
        maxPrice: 0,
        totalAvgPrice: 0,
        totalCalories: 0,
        caloriesSamples: 0,
        zeroCaloriesCount: 0,
      };
      grouped.set(categoryKey, bucket);
    }
    const priceMin = Math.max(0, Number(item.priceMin) || 0);
    const priceMax = Math.max(priceMin, Number(item.priceMax) || priceMin);
    const caloriesKcal = normalizeCaloriesKcal(item.caloriesKcal, 0);
    bucket.foodCount += 1;
    if (asString(item.merchantName)) {
      bucket.merchantSet.add(asString(item.merchantName));
    }
    bucket.minPrice = Math.min(bucket.minPrice, priceMin);
    bucket.maxPrice = Math.max(bucket.maxPrice, priceMax);
    bucket.totalAvgPrice += (priceMin + priceMax) / 2;
    bucket.totalCalories += caloriesKcal;
    bucket.caloriesSamples += 1;
    if (caloriesKcal <= 0) {
      bucket.zeroCaloriesCount += 1;
    }
  });
  return Array.from(grouped.values())
    .map((item) => ({
      categoryKey: item.categoryKey,
      categoryName: item.categoryName,
      foodCount: item.foodCount,
      merchantCount: item.merchantSet.size,
      minPrice: item.foodCount > 0 ? Number(item.minPrice.toFixed(2)) : 0,
      maxPrice: item.foodCount > 0 ? Number(item.maxPrice.toFixed(2)) : 0,
      avgPrice: item.foodCount > 0 ? Number((item.totalAvgPrice / item.foodCount).toFixed(2)) : 0,
      avgCaloriesKcal: item.caloriesSamples > 0 ? Math.round(item.totalCalories / item.caloriesSamples) : 0,
      zeroCaloriesCount: item.zeroCaloriesCount,
    }))
    .sort((left, right) => {
      if (left.foodCount !== right.foodCount) {
        return right.foodCount - left.foodCount;
      }
      return left.categoryName.localeCompare(right.categoryName);
    });
};

export const toAdminFoodItemPayload = (store: NexusStore, item: FoodItemRecord) => {
  const linkedCampaignCount = store.foodCampaigns.filter((campaign) => campaign.optionFoodIds.includes(item.id)).length;
  const linkedVoteCount = store.foodCampaignVotes.filter((vote) => vote.foodId === item.id).length;
  const caloriesKcal = normalizeCaloriesKcal(item.caloriesKcal, 0);
  return {
    foodId: item.id,
    foodName: item.name,
    merchantName: item.merchantName,
    categoryKey: item.categoryKey,
    categoryName: item.categoryName,
    latitude: item.latitude,
    longitude: item.longitude,
    basePriceMin: item.priceMin,
    basePriceMax: item.priceMax,
    caloriesKcal,
    exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(caloriesKcal),
    linkedCampaignCount,
    linkedVoteCount,
  };
};

export const filterFoodItems = (
  items: FoodItemRecord[],
  options: {
    categoryKey?: string;
    keyword?: string;
  },
) => {
  const categoryKey = asString(options.categoryKey).toLowerCase();
  const keyword = asString(options.keyword).toLowerCase();
  return items
    .filter((item) => !categoryKey || item.categoryKey.toLowerCase() === categoryKey)
    .filter((item) => {
      if (!keyword) {
        return true;
      }
      const bag = `${item.name} ${item.merchantName} ${item.categoryName} ${item.categoryKey}`.toLowerCase();
      return bag.includes(keyword);
    });
};

export const resolveCampaignOptionIds = (store: NexusStore, rawOptionFoodIds?: string[]) => {
  const fallback = store.foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id);
  if (!Array.isArray(rawOptionFoodIds)) {
    return fallback;
  }
  const foodIdSet = new Set(store.foodItems.map((item) => item.id));
  const normalized: string[] = [];
  rawOptionFoodIds.forEach((value) => {
    const foodId = asString(value);
    if (!foodId || !foodIdSet.has(foodId) || normalized.includes(foodId)) {
      return;
    }
    normalized.push(foodId);
  });
  const limited = normalized.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT);
  if (limited.length > 0) {
    return limited;
  }
  return fallback;
};

const FOOD_CSV_HEADER_MAP: Record<string, string> = {
  foodid: "foodId",
  id: "foodId",
  foodname: "name",
  name: "name",
  merchantname: "merchantName",
  merchant: "merchantName",
  brandname: "merchantName",
  categorykey: "categoryKey",
  categoryname: "categoryName",
  basepricemin: "basePriceMin",
  basepricemax: "basePriceMax",
  pricemin: "basePriceMin",
  pricemax: "basePriceMax",
  calorieskcal: "caloriesKcal",
  calories: "caloriesKcal",
  kcal: "caloriesKcal",
  latitude: "latitude",
  lat: "latitude",
  longitude: "longitude",
  lng: "longitude",
  lon: "longitude",
};

const normalizeCsvHeader = (value: string) => {
  return asString(value)
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
};

const parseCsvLine = (line: string, delimiter = ",") => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 2;
        continue;
      }
      inQuotes = !inQuotes;
      index += 1;
      continue;
    }
    if (!inQuotes && char === delimiter) {
      result.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  result.push(current);
  return result.map((item) => item.trim());
};

export const parseFoodCsvText = (csvText: string) => {
  const lines = String(csvText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length < 2) {
    return {
      headers: [] as string[],
      rows: [] as Array<Record<string, string>>,
    };
  }
  const rawHeaders = parseCsvLine(lines[0]);
  const headers = rawHeaders.map((header) => {
    const normalized = normalizeCsvHeader(header);
    return FOOD_CSV_HEADER_MAP[normalized] || asString(header);
  });
  const rows: Array<Record<string, string>> = [];
  lines.slice(1).forEach((line) => {
    const columns = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = asString(columns[index] || "");
    });
    rows.push(row);
  });
  return {
    headers,
    rows,
  };
};

export const isLocationStale = (updatedAt: string, maxAgeHours = 24) => {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp > maxAgeHours * 60 * 60 * 1000;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const haversineKm = (latitude1: number, longitude1: number, latitude2: number, longitude2: number) => {
  const earthRadius = 6371;
  const dLat = toRadians(latitude2 - latitude1);
  const dLng = toRadians(longitude2 - longitude1);
  const lat1 = toRadians(latitude1);
  const lat2 = toRadians(latitude2);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

export const toDistanceLevel = (distanceKm: number): DistanceLevel => {
  if (distanceKm < 1.2) {
    return "near";
  }
  if (distanceKm < 3) {
    return "medium";
  }
  return "far";
};

export const gridApprox = (latitude: number, longitude: number) => {
  const gridSize = 0.02;
  const latitudeApprox = Math.round(latitude / gridSize) * gridSize;
  const longitudeApprox = Math.round(longitude / gridSize) * gridSize;
  const gridId = `grid_${latitudeApprox.toFixed(2)}_${longitudeApprox.toFixed(2)}`;
  return { gridId, latitudeApprox, longitudeApprox };
};

const clamp = (value: number, min: number, max: number) => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

export const resolvePricingFactor = (rule: FoodPricingRuleRecord, headcount: number) => {
  const anchor = Math.max(1, Number(rule.anchorHeadcount || 1));
  const delta = (headcount - anchor) / anchor;
  const trendBase = rule.trendMode === "down" ? 1 - rule.slope * delta : 1 + rule.slope * delta;
  return clamp(trendBase, rule.minFactor, rule.maxFactor);
};

export const buildPricingCurve = (
  rule: FoodPricingRuleRecord,
  basePriceMin: number,
  basePriceMax: number,
  start: number,
  end: number,
  step: number,
) => {
  const points: Array<{
    headcount: number;
    dynamicPriceMin: number;
    dynamicPriceMax: number;
    dynamicPriceMid: number;
    factor: number;
  }> = [];
  const safeStart = Math.max(1, Math.floor(start));
  const safeEnd = Math.max(safeStart, Math.floor(end));
  const safeStep = Math.max(1, Math.floor(step));
  for (let headcount = safeStart; headcount <= safeEnd; headcount += safeStep) {
    const factor = resolvePricingFactor(rule, headcount);
    const dynamicPriceMin = Number((basePriceMin * factor).toFixed(2));
    const dynamicPriceMax = Number((basePriceMax * factor).toFixed(2));
    points.push({
      headcount,
      dynamicPriceMin,
      dynamicPriceMax,
      dynamicPriceMid: Number(((dynamicPriceMin + dynamicPriceMax) / 2).toFixed(2)),
      factor: Number(factor.toFixed(4)),
    });
  }
  return points;
};

export const resolveCampaignDeadlineIsoV1 = (inputIso: string, toApiError: ApiError) => {
  const now = Date.now();
  const defaultMinutes = 180;
  const minMinutes = 6;
  const maxMinutes = 360;
  const parsed = Date.parse(asString(inputIso));
  if (!Number.isFinite(parsed)) {
    return new Date(now + defaultMinutes * 60 * 1000).toISOString();
  }
  const diffMinutes = Math.floor((parsed - now) / (60 * 1000));
  if (diffMinutes < minMinutes) {
    return toApiError(400, "DEADLINE_TOO_SOON", `竞选持续时间至少 ${minMinutes} 分钟`);
  }
  if (diffMinutes > maxMinutes) {
    return new Date(now + maxMinutes * 60 * 1000).toISOString();
  }
  return new Date(parsed).toISOString();
};

export const resolveCampaignVotes = (store: NexusStore, campaignId: string) => {
  return store.foodCampaignVotes.filter((item) => item.campaignId === campaignId);
};

const campaignCanRevealNamedVotes = (campaign: FoodCampaignRecord, shareToken: string) => {
  if (!campaign.isAnonymous) {
    return true;
  }
  if (campaign.status !== "closed") {
    return false;
  }
  if (!campaign.revealAfterClose) {
    return false;
  }
  if (campaign.revealScope === "public") {
    return true;
  }
  return shareToken && shareToken === campaign.shareToken;
};

export const serializeCampaignDetail = (
  store: NexusStore,
  campaign: FoodCampaignRecord,
  viewerUserId: string,
  shareToken: string,
) => {
  const votes = resolveCampaignVotes(store, campaign.id);
  const foods = store.foodItems.filter((item) => campaign.optionFoodIds.includes(item.id));
  const aggregates = campaign.optionFoodIds.map((foodId) => {
    const matched = votes.filter((vote) => vote.foodId === foodId);
    const food = foods.find((item) => item.id === foodId);
    return {
      foodId,
      foodName: food?.name || foodId,
      voteCount: matched.length,
      scoreTotal: matched.reduce((total, item) => total + item.score, 0),
    };
  });
  const shouldReveal = campaignCanRevealNamedVotes(campaign, shareToken);
  const myVotes = votes
    .filter((item) => item.userId === viewerUserId)
    .map((item) => {
      const food = foods.find((foodItem) => foodItem.id === item.foodId);
      return {
        voteId: item.id,
        foodId: item.foodId,
        foodName: food?.name || item.foodId,
        score: item.score,
        createdAt: item.createdAt,
      };
    });
  const voteDetails = shouldReveal
    ? votes.map((item) => {
        const user = store.users.find((userItem) => userItem.userId === item.userId);
        const food = foods.find((foodItem) => foodItem.id === item.foodId);
        return {
          voteId: item.id,
          foodId: item.foodId,
          foodName: food?.name || item.foodId,
          score: item.score,
          userId: item.userId,
          studentNo: user?.studentNo || "",
          userName: user?.name || user?.nickname || item.userId,
          createdAt: item.createdAt,
        };
      })
    : [];
  return {
    campaignId: campaign.id,
    title: campaign.title,
    status: campaign.status,
    deadlineAtIso: campaign.deadlineAtIso,
    shareTokenHint: campaign.status === "closed" ? campaign.shareToken : "",
    isAnonymous: campaign.isAnonymous,
    revealAfterClose: campaign.revealAfterClose,
    revealScope: campaign.revealScope,
    options: foods.map((item) => {
      const caloriesKcal = normalizeCaloriesKcal(item.caloriesKcal, 0);
      return {
        foodId: item.id,
        foodName: item.name,
        merchantName: item.merchantName,
        categoryKey: item.categoryKey,
        categoryName: item.categoryName,
        caloriesKcal,
        exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(caloriesKcal),
      };
    }),
    aggregates,
    myVotes,
    voteDetails,
    visibility: {
      canSeeNamedVotes: shouldReveal,
      reason: shouldReveal
        ? "REVEAL_ALLOWED"
        : campaign.isAnonymous
          ? "ANONYMOUS_IN_PROGRESS_OR_SHARE_TOKEN_REQUIRED"
          : "NON_ANONYMOUS",
    },
  };
};
