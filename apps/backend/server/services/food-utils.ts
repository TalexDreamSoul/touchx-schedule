import type { FoodItemRecord } from "./domain-store";

const FOOD_CATEGORY_CALORIE_BASE_MAP: Record<string, number> = {
  "light-meal": 420,
  "main-meal": 760,
  stir_fry: 760,
  maocai: 780,
  hotpot: 860,
  grill: 800,
  noodle: 650,
  rice: 700,
  breakfast: 430,
  afternoon_tea: 420,
  drink: 300,
  midnight_snack: 620,
  takeout: 680,
};

export const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const resolveCategoryCaloriesBase = (categoryKey: string) => {
  return FOOD_CATEGORY_CALORIE_BASE_MAP[categoryKey] ?? 560;
};

export const normalizeCaloriesKcal = (raw: unknown, fallback = 0) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.round(parsed);
};

export const resolveExerciseEquivalentMinutes = (caloriesKcal: number) => {
  const kcal = Math.max(0, Number(caloriesKcal) || 0);
  if (kcal <= 0) {
    return {
      running: 0,
      uphill: 0,
    };
  }
  return {
    running: Math.max(1, Math.round(kcal / 10)),
    uphill: Math.max(1, Math.round(kcal / 8)),
  };
};

export const estimateFoodCaloriesKcal = (
  item: Pick<FoodItemRecord, "categoryKey" | "priceMin" | "priceMax">,
  options: {
    baseShift: number;
    priceWeight: number;
    minKcal: number;
    maxKcal: number;
  },
) => {
  const averagePrice = (Math.max(0, item.priceMin) + Math.max(0, item.priceMax)) / 2;
  const estimated =
    resolveCategoryCaloriesBase(String(item.categoryKey || "").trim().toLowerCase()) +
    options.baseShift +
    Math.round((averagePrice - 14) * options.priceWeight);
  return Math.round(clampNumber(estimated, options.minKcal, options.maxKcal));
};
