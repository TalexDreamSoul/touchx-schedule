import { getHeader, getMethod, getQuery, getRequestURL, H3Event, setHeader, setResponseStatus } from "h3";
import type {
  ClassRole,
  DistanceLevel,
  ScheduleConflict,
  SchedulePatch,
  ScheduleSubscription,
} from "@touchx/shared";
import {
  DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO,
  FOOD_CAMPAIGN_OPTION_LIMIT,
  getNexusStore,
  resetNexusStore,
  storeHelpers,
  type AuditLogRecord,
  type AuthSessionRecord,
  type BotJobRecord,
  type ClassMemberRecord,
  type ClassRecord,
  type FoodCampaignRecord,
  type FoodCampaignVoteRecord,
  type FoodItemRecord,
  type FoodPricingRuleRecord,
  type FoodPricingRuleVersionRecord,
  type LocationGridRecord,
  type MediaAssetRecord,
  type HeartOpenDifficulty,
  type PartyGameEventRecord,
  type PartyGameHeartOpenWordRecord,
  type PartyGameMemberRecord,
  type PartyGameRoomRecord,
  type PartyGameStateRecord,
  type ScheduleEntryRecord,
  type ScheduleRecord,
  type ScheduleVersionRecord,
  type UserRecord,
} from "./domain-store";
import { buildSmartSuggestions } from "./suggestion-engine";
import {
  fail,
  getBearerToken,
  normalizeRoutePath,
  ok,
  readJsonBody,
  requireAdmin,
  requireUser,
  resolveSessionWithUser,
  toApiError,
} from "../utils/api-envelope";
import { createSignedSession } from "../utils/session-token";
import { handleSocialV1Api } from "./social-v1-api";
import type { ScheduleImportPreviewEntry } from "./schedule-import-preview";
import {
  confirmScheduleImportJob,
  createScheduleImportJob,
  getScheduleImportJobStatus,
  listRecentScheduleImportJobs,
  listRecentScheduleImportJobIds,
  toScheduleImportErrorPayload,
} from "./schedule-import-service";
import {
  ackReminderDelivery,
  getBotDeliveryTokenHeader,
  pullPendingReminderDeliveries,
  requireBotDeliveryToken,
  resolveReminderDbFromEvent,
  runReminderHeartbeat,
} from "./reminder-delivery-service";
import { clampNumber, estimateFoodCaloriesKcal, normalizeCaloriesKcal, resolveExerciseEquivalentMinutes } from "./food-utils";

const asString = (value: unknown) => String(value || "").trim();

interface AdminAuthState {
  bootstrapStudentNo: string;
  password: string;
  initialized: boolean;
  updatedAt: string;
}

export interface AdminAuthStateSnapshot {
  bootstrapStudentNo: string;
  password: string;
  initialized: boolean;
  updatedAt: string;
}

const adminAuthStateMap = new WeakMap<ReturnType<typeof getNexusStore>, AdminAuthState>();

const sanitizeFoodPrice = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Number(parsed.toFixed(2)));
};

const sanitizeLatitude = (value: unknown, fallback = 31.23) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(90, Math.max(-90, Number(parsed.toFixed(6))));
};

const sanitizeLongitude = (value: unknown, fallback = 121.47) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(180, Math.max(-180, Number(parsed.toFixed(6))));
};

const buildFoodCategoryStats = (items: FoodItemRecord[]) => {
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

const toAdminFoodItemPayload = (store: ReturnType<typeof getNexusStore>, item: FoodItemRecord) => {
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

const filterFoodItems = (
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

const resolveCampaignOptionIds = (store: ReturnType<typeof getNexusStore>, rawOptionFoodIds?: string[]) => {
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

const parseFoodCsvText = (csvText: string) => {
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

const isAdminRole = (user: UserRecord) => {
  return user.adminRole === "super_admin" || user.adminRole === "operator";
};

const requireScheduleImportAccess = (event: H3Event) => {
  try {
    return requireAdmin(event);
  } catch (error) {
    const resolved = resolveSessionWithUser(event);
    if (resolved && isAdminRole(resolved.user)) {
      return resolved;
    }
    throw error;
  }
};

const resolveBootstrapStudentNo = (store: ReturnType<typeof getNexusStore>, config: ReturnType<typeof useRuntimeConfig>) => {
  const configured = asString(config.adminBootstrapStudentNo || DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO);
  const admins = store.users.filter((item) => isAdminRole(item));
  if (configured && admins.some((item) => item.studentNo === configured)) {
    return configured;
  }
  return admins[0]?.studentNo || configured || DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO;
};

const getAdminAuthState = (store: ReturnType<typeof getNexusStore>, config: ReturnType<typeof useRuntimeConfig>) => {
  const existing = adminAuthStateMap.get(store);
  const bootstrapStudentNo = resolveBootstrapStudentNo(store, config);
  const configuredPassword = asString(config.adminLoginPassword);
  if (existing) {
    if (!existing.initialized && configuredPassword) {
      existing.password = configuredPassword;
      existing.initialized = true;
      existing.updatedAt = storeHelpers.nowIso();
    }
    if (existing.bootstrapStudentNo !== bootstrapStudentNo) {
      existing.bootstrapStudentNo = bootstrapStudentNo;
      existing.updatedAt = storeHelpers.nowIso();
    }
    return existing;
  }
  const created: AdminAuthState = {
    bootstrapStudentNo,
    password: configuredPassword,
    initialized: Boolean(configuredPassword),
    updatedAt: storeHelpers.nowIso(),
  };
  adminAuthStateMap.set(store, created);
  return created;
};

export const serializeAdminAuthState = (store: ReturnType<typeof getNexusStore>): AdminAuthStateSnapshot | null => {
  const state = adminAuthStateMap.get(store);
  if (!state) {
    return null;
  }
  return {
    bootstrapStudentNo: asString(state.bootstrapStudentNo),
    password: asString(state.password),
    initialized: Boolean(state.initialized),
    updatedAt: asString(state.updatedAt),
  };
};

export const hydrateAdminAuthState = (
  store: ReturnType<typeof getNexusStore>,
  snapshot: AdminAuthStateSnapshot | null | undefined,
) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  adminAuthStateMap.set(store, {
    bootstrapStudentNo: asString(snapshot.bootstrapStudentNo),
    password: asString(snapshot.password),
    initialized: Boolean(snapshot.initialized),
    updatedAt: asString(snapshot.updatedAt) || storeHelpers.nowIso(),
  });
};

const createSession = (event: H3Event, user: UserRecord, role: AuthSessionRecord["role"], ttlHours = 24 * 7) => {
  const session = createSignedSession(event, user, role, ttlHours);
  return session;
};

const revokeSession = (token: string) => {
  void token;
};

const appendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => {
  const store = getNexusStore();
  const record: AuditLogRecord = {
    id: storeHelpers.createId("audit"),
    action,
    actorUserId,
    payload,
    createdAt: storeHelpers.nowIso(),
  };
  store.auditLogs.unshift(record);
  if (store.auditLogs.length > 2000) {
    store.auditLogs.length = 2000;
  }
};

const toUserPayload = (user: UserRecord) => {
  const isPlaceholderIdentityText = (value: unknown) => {
    const normalized = asString(value);
    if (!normalized) {
      return false;
    }
    if (normalized === asString(user.studentNo) || normalized === asString(user.studentId)) {
      return true;
    }
    return /^\d{6,32}$/.test(normalized);
  };
  const resolveMeaningfulUserName = () => {
    const name = asString(user.name);
    if (name && !isPlaceholderIdentityText(name)) {
      return name;
    }
    const nickname = asString(user.nickname);
    if (nickname && !isPlaceholderIdentityText(nickname)) {
      return nickname;
    }
    return "";
  };
  return {
    userId: user.userId,
    studentNo: user.studentNo,
    studentId: user.studentId || "",
    name: resolveMeaningfulUserName(),
    nickname: user.nickname,
    classLabel: user.classLabel || "",
    classIds: user.classIds,
    avatarUrl: user.avatarUrl,
    wallpaperUrl: user.wallpaperUrl,
    adminRole: user.adminRole,
    reminderEnabled: user.reminderEnabled,
    reminderWindowMinutes: user.reminderWindowMinutes,
    createdAt: user.createdAt,
  };
};

const toAuthUserPayload = (user: UserRecord) => {
  const basePayload = toUserPayload(user);
  return {
    ...basePayload,
    openId: `wx_${user.userId}`,
    studentName: basePayload.name,
  };
};

const isGhostUserRecord = (user: UserRecord, scheduleSubscriptions: ScheduleSubscription[]) => {
  if (user.adminRole !== "none") {
    return false;
  }
  if (Array.isArray(user.classIds) && user.classIds.length > 0) {
    return false;
  }
  if (scheduleSubscriptions.some((item) => item.subscriberUserId === user.userId)) {
    return false;
  }
  if (asString(user.classLabel)) {
    return false;
  }
  const studentNo = asString(user.studentNo);
  const name = asString(user.name);
  const nickname = asString(user.nickname);
  const isNamePlaceholder = !name || name === studentNo;
  const isNicknamePlaceholder = !nickname || nickname === studentNo || nickname === name;
  return isNamePlaceholder && isNicknamePlaceholder;
};

const ensureClassAccess = (user: UserRecord, classId: string, roles: ClassRole[]) => {
  const store = getNexusStore();
  if (isAdminRole(user)) {
    return {
      classItem: store.classes.find((item) => item.id === classId) || null,
      member: null as ClassMemberRecord | null,
    };
  }
  const member = store.classMembers.find((item) => item.classId === classId && item.userId === user.userId) || null;
  if (!member) {
    return toApiError(403, "CLASS_FORBIDDEN", "当前用户不在该班级中");
  }
  if (!roles.includes(member.classRole)) {
    return toApiError(403, "CLASS_PERMISSION_DENIED", "当前用户无该班级操作权限");
  }
  const classItem = store.classes.find((item) => item.id === classId) || null;
  if (!classItem) {
    return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
  }
  return { classItem, member };
};

const getClassMemberRole = (userId: string, classId: string) => {
  const store = getNexusStore();
  return store.classMembers.find((item) => item.classId === classId && item.userId === userId)?.classRole || null;
};

const ensureUniquePush = <T>(array: T[], value: T) => {
  if (!array.includes(value)) {
    array.push(value);
  }
};

const normalizeEntries = (raw: unknown): ScheduleEntryRecord[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: ScheduleEntryRecord[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const data = item as Partial<ScheduleEntryRecord>;
    const day = Number(data.day || 0);
    const startSection = Number(data.startSection || 0);
    const endSection = Number(data.endSection || 0);
    const courseName = asString(data.courseName);
    if (!day || !startSection || !endSection || !courseName) {
      return;
    }
    items.push({
      id: storeHelpers.createId("entry"),
      day,
      startSection,
      endSection,
      weekExpr: asString(data.weekExpr) || "1-20",
      parity: data.parity === "odd" || data.parity === "even" ? data.parity : "all",
      courseName,
      classroom: asString(data.classroom),
      teacher: asString(data.teacher),
    });
  });
  return items;
};

const getScheduleVersions = (scheduleId: string) => {
  const store = getNexusStore();
  return store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId)
    .sort((left, right) => left.versionNo - right.versionNo);
};

const getLatestScheduleVersion = (scheduleId: string) => {
  const versions = getScheduleVersions(scheduleId);
  return versions.length > 0 ? versions[versions.length - 1] : null;
};

const getPublishedScheduleVersion = (scheduleId: string, versionNo = 0) => {
  const store = getNexusStore();
  if (versionNo > 0) {
    return (
      store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo && item.status === "published") ||
      null
    );
  }
  const versions = store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId && item.status === "published")
    .sort((left, right) => right.versionNo - left.versionNo);
  return versions[0] || null;
};

const createConflict = (
  subscription: ScheduleSubscription,
  entryId: string,
  sourceVersionNo: number,
  conflictType: ScheduleConflict["conflictType"],
) => {
  const store = getNexusStore();
  const exists = store.scheduleConflicts.find(
    (item) =>
      item.subscriptionId === subscription.id &&
      item.entryId === entryId &&
      item.sourceVersionNo === sourceVersionNo &&
      item.resolutionStatus === "pending",
  );
  if (exists) {
    return exists;
  }
  const conflict: ScheduleConflict = {
    id: storeHelpers.createId("schedule_conflict"),
    subscriptionId: subscription.id,
    entryId,
    sourceVersionNo,
    conflictType,
    resolutionStatus: "pending",
    createdAt: storeHelpers.nowIso(),
  };
  store.scheduleConflicts.push(conflict);
  return conflict;
};

const onSchedulePublished = (schedule: ScheduleRecord, newVersionNo: number) => {
  const store = getNexusStore();
  const relatedSubscriptions = store.scheduleSubscriptions.filter((item) => item.sourceScheduleId === schedule.id);
  relatedSubscriptions.forEach((subscription) => {
    const patches = store.schedulePatches.filter((patch) => patch.subscriptionId === subscription.id);
    if (patches.length === 0) {
      subscription.followMode = "following";
      subscription.baseVersionNo = newVersionNo;
      return;
    }
    subscription.followMode = "patched";
    subscription.baseVersionNo = newVersionNo;
    patches.forEach((patch) => {
      createConflict(subscription, patch.entryId, newVersionNo, "source_changed_after_patch");
    });
  });
};

const summarizeClassSubscriptionsForUser = (store: ReturnType<typeof getNexusStore>, user: UserRecord) => {
  const memberships = store.classMembers
    .filter((item) => item.userId === user.userId)
    .map((item) => {
      const classItem = store.classes.find((classRow) => classRow.id === item.classId) || null;
      return {
        classId: item.classId,
        classLabel: classItem?.name || "",
        role: item.classRole,
      };
    });
  const subscriptions = store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .map((item) => {
      const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
      const classItem = schedule ? store.classes.find((classRow) => classRow.id === schedule.classId) || null : null;
      return {
        subscriptionId: item.id,
        followMode: item.followMode,
        baseVersionNo: item.baseVersionNo,
        scheduleId: item.sourceScheduleId,
        scheduleTitle: schedule?.title || "",
        classId: classItem?.id || "",
        classLabel: classItem?.name || "",
        createdByUserId: schedule?.createdByUserId || "",
        patchCount: store.schedulePatches.filter((patch) => patch.subscriptionId === item.id).length,
        pendingConflictCount: store.scheduleConflicts.filter(
          (conflict) => conflict.subscriptionId === item.id && conflict.resolutionStatus === "pending",
        ).length,
      };
    });
  return { memberships, subscriptions };
};

const findStaleOwnScheduleSubscriptionIds = (store: ReturnType<typeof getNexusStore>, user: UserRecord) => {
  const activeClassIds = new Set(user.classIds);
  return store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .filter((item) => {
      const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
      if (!schedule) {
        return true;
      }
      if (activeClassIds.has(schedule.classId)) {
        return false;
      }
      return true;
    })
    .map((item) => item.id);
};

const toAcademicWeekDay = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

const HEARTBEAT_TOKEN_HEADER = "x-heartbeat-token";

const collectNextDaySuggestions = (
  store: ReturnType<typeof getNexusStore>,
  options: {
    targetDate: Date;
    rainy?: boolean;
  },
) => {
  const targetDay = toAcademicWeekDay(options.targetDate);
  const enabledUsers = store.users.filter((item) => item.reminderEnabled);
  const suggestions = enabledUsers.flatMap((targetUser) => {
    const classIdSet = new Set(store.classMembers.filter((member) => member.userId === targetUser.userId).map((member) => member.classId));
    const schedules = store.schedules.filter((schedule) => classIdSet.has(schedule.classId));
    const entries = schedules.flatMap((schedule) => {
      const publishedVersion = getPublishedScheduleVersion(schedule.id, schedule.publishedVersionNo);
      if (!publishedVersion) {
        return [];
      }
      return publishedVersion.entries.filter((entry) => entry.day === targetDay);
    });
    const location = store.locationGrids.find((item) => item.userId === targetUser.userId) || null;
    const items = buildSmartSuggestions({
      user: targetUser,
      nextDayCourses: entries,
      hasRainWeather: Boolean(options.rainy),
      hasLocation: Boolean(location && !isLocationStale(location.updatedAt)),
      longDistanceCourseCount: entries.length >= 3 ? 1 : 0,
    });
    return items.map((item) => ({
      ...item,
      code: `${targetUser.studentNo}_${item.code}`,
    }));
  });
  return {
    userCount: enabledUsers.length,
    suggestions,
  };
};

const isLocationStale = (updatedAt: string, maxAgeHours = 24) => {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp > maxAgeHours * 60 * 60 * 1000;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineKm = (latitude1: number, longitude1: number, latitude2: number, longitude2: number) => {
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

const toDistanceLevel = (distanceKm: number): DistanceLevel => {
  if (distanceKm < 1.2) {
    return "near";
  }
  if (distanceKm < 3) {
    return "medium";
  }
  return "far";
};

const gridApprox = (latitude: number, longitude: number) => {
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

const resolvePricingFactor = (rule: FoodPricingRuleRecord, headcount: number) => {
  const anchor = Math.max(1, Number(rule.anchorHeadcount || 1));
  const delta = (headcount - anchor) / anchor;
  const trendBase = rule.trendMode === "down" ? 1 - rule.slope * delta : 1 + rule.slope * delta;
  return clamp(trendBase, rule.minFactor, rule.maxFactor);
};

const buildPricingCurve = (
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
      dynamicPriceMid: Number((((dynamicPriceMin + dynamicPriceMax) / 2).toFixed(2))),
      factor: Number(factor.toFixed(4)),
    });
  }
  return points;
};

const resolveCampaignDeadlineIsoV1 = (inputIso: string) => {
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

const resolveCampaignVotes = (campaignId: string) => {
  const store = getNexusStore();
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

const serializeCampaignDetail = (campaign: FoodCampaignRecord, viewerUserId: string, shareToken: string) => {
  const store = getNexusStore();
  const votes = resolveCampaignVotes(campaign.id);
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

const toIcsContent = (schedule: ScheduleRecord, version: ScheduleVersionRecord, timezone: string) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TouchX//ScheduleNexus//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  version.entries.forEach((entry, index) => {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${schedule.id}-${version.versionNo}-${index}@touchx`);
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\\.\\d{3}Z$/, "Z")}`);
    lines.push(`SUMMARY:${entry.courseName}`);
    lines.push(`DESCRIPTION:教师 ${entry.teacher || "-"} / 周次 ${entry.weekExpr}`);
    lines.push(`LOCATION:${entry.classroom || "-"}`);
    lines.push(`X-TX-DAY:${entry.day}`);
    lines.push(`X-TX-SECTION:${entry.startSection}-${entry.endSection}`);
    lines.push(`X-WR-TIMEZONE:${timezone}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\\r\\n");
};

const isSocialCompatPath = (path: string) => {
  return (
    path.startsWith("social/") ||
    path.startsWith("notifications") ||
    path.startsWith("ai/schedule/") ||
    path.startsWith("exams/") ||
    path.startsWith("schedule-import/corrections") ||
    path.startsWith("admin/food-candidates") ||
    path === "auth/wechat-login" ||
    path === "auth/unbind" ||
    path === "today-brief" ||
    path === "theme-images" ||
    path === "schedules/student"
  );
};

const parsePagination = (query: Record<string, unknown>) => {
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100)));
  const offset = Math.max(0, Number(query.offset || 0));
  return { limit, offset };
};

const PARTY_GAME_KEYS = new Set(["werewolf", "undercover", "avalon", "telephone", "drawguess", "turtle"]);
const PARTY_GAME_OFFLINE_TTL_MS = 45 * 1000;
const PARTY_GAME_MAX_EVENTS_PER_ROOM = 800;
const HEART_OPEN_DIFFICULTY_SET = new Set<HeartOpenDifficulty>(["easy", "medium", "hard"]);
const HEART_OPEN_DIFFICULTIES: HeartOpenDifficulty[] = ["easy", "medium", "hard"];

const HEART_OPEN_DIFFICULTY_LABEL_MAP: Record<HeartOpenDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const sanitizePartyGameKey = (value: unknown) => {
  const key = asString(value).toLowerCase();
  if (!PARTY_GAME_KEYS.has(key)) {
    return "";
  }
  return key;
};

const sanitizeHeartOpenDifficulty = (value: unknown, fallback: HeartOpenDifficulty = "medium"): HeartOpenDifficulty => {
  const difficulty = asString(value).toLowerCase() as HeartOpenDifficulty;
  if (!HEART_OPEN_DIFFICULTY_SET.has(difficulty)) {
    return fallback;
  }
  return difficulty;
};

const normalizeHeartOpenCategory = (value: unknown) => {
  return asString(value).replace(/\s+/g, " ").trim();
};

const toHeartOpenWordPayload = (item: PartyGameHeartOpenWordRecord) => {
  return {
    wordId: item.id,
    word: item.word,
    punishment: item.punishment,
    category: item.category,
    difficulty: item.difficulty,
    difficultyLabel: HEART_OPEN_DIFFICULTY_LABEL_MAP[item.difficulty],
    enabled: item.enabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const filterHeartOpenWords = (
  words: PartyGameHeartOpenWordRecord[],
  options: {
    category?: string;
    difficulty?: string;
    keyword?: string;
    enabled?: boolean;
  },
) => {
  const category = normalizeHeartOpenCategory(options.category).toLowerCase();
  const difficulty = asString(options.difficulty).toLowerCase();
  const keyword = asString(options.keyword).toLowerCase();
  return words
    .filter((item) => (typeof options.enabled === "boolean" ? item.enabled === options.enabled : true))
    .filter((item) => (!category ? true : item.category.toLowerCase() === category))
    .filter((item) => {
      if (!difficulty) {
        return true;
      }
      return item.difficulty === difficulty;
    })
    .filter((item) => {
      if (!keyword) {
        return true;
      }
      const bag = `${item.word} ${item.punishment} ${item.category}`.toLowerCase();
      return bag.includes(keyword);
    });
};

const buildHeartOpenOptions = (items: PartyGameHeartOpenWordRecord[]) => {
  const categorySet = new Set<string>();
  items.forEach((item) => {
    if (item.category) {
      categorySet.add(item.category);
    }
  });
  return {
    categories: Array.from(categorySet.values()).sort((left, right) => left.localeCompare(right, "zh-CN")),
    difficulties: HEART_OPEN_DIFFICULTIES.map((difficulty) => ({
      value: difficulty,
      label: HEART_OPEN_DIFFICULTY_LABEL_MAP[difficulty],
    })),
  };
};

const PARTY_GAME_DEFAULT_TITLE_MAP: Record<string, string> = {
  werewolf: "狼人杀快节奏局",
  undercover: "谁是卧底双卧底局",
  avalon: "阿瓦隆标准局",
  telephone: "传声筒剧情局",
  drawguess: "你画我猜接力局",
  turtle: "海龟汤速推理局",
};

const resolvePartyGameTitle = (gameKey: string, rawTitle: unknown) => {
  const title = asString(rawTitle);
  if (title) {
    return title;
  }
  return PARTY_GAME_DEFAULT_TITLE_MAP[gameKey] || "聚会游戏房间";
};

const refreshPartyGameMemberOnlineState = (
  store: ReturnType<typeof getNexusStore>,
  roomId: string,
  nowTs = Date.now(),
) => {
  store.partyGameMembers.forEach((member) => {
    if (member.roomId !== roomId) {
      return;
    }
    const lastTs = Date.parse(member.lastHeartbeatAt || "");
    if (!Number.isFinite(lastTs)) {
      member.online = false;
      return;
    }
    member.online = nowTs - lastTs <= PARTY_GAME_OFFLINE_TTL_MS;
  });
};

const getPartyGameRoomMembers = (store: ReturnType<typeof getNexusStore>, roomId: string) => {
  return store.partyGameMembers
    .filter((item) => item.roomId === roomId)
    .sort((left, right) => Date.parse(left.joinedAt) - Date.parse(right.joinedAt));
};

const getPartyGameRoomState = (store: ReturnType<typeof getNexusStore>, roomId: string) => {
  return store.partyGameStates.find((item) => item.roomId === roomId) || null;
};

const appendPartyGameEvent = (
  store: ReturnType<typeof getNexusStore>,
  input: {
    roomId: string;
    type: string;
    actorUserId: string;
    payload?: Record<string, unknown>;
    clientActionId?: string;
  },
) => {
  const maxSeq = store.partyGameEvents
    .filter((item) => item.roomId === input.roomId)
    .reduce((acc, item) => Math.max(acc, item.seq), 0);
  const event: PartyGameEventRecord = {
    id: storeHelpers.createId("pg_event"),
    roomId: input.roomId,
    seq: maxSeq + 1,
    type: asString(input.type) || "party_game.event",
    actorUserId: input.actorUserId,
    clientActionId: asString(input.clientActionId),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    createdAt: storeHelpers.nowIso(),
  };
  store.partyGameEvents.push(event);
  const roomEventIds = store.partyGameEvents
    .filter((item) => item.roomId === input.roomId)
    .sort((left, right) => left.seq - right.seq);
  if (roomEventIds.length > PARTY_GAME_MAX_EVENTS_PER_ROOM) {
    const removeCount = roomEventIds.length - PARTY_GAME_MAX_EVENTS_PER_ROOM;
    const removeIdSet = new Set(roomEventIds.slice(0, removeCount).map((item) => item.id));
    store.partyGameEvents = store.partyGameEvents.filter((item) => !removeIdSet.has(item.id));
  }
  return event;
};

const toPartyGameRoomSummary = (
  store: ReturnType<typeof getNexusStore>,
  room: PartyGameRoomRecord,
  currentUserId: string,
) => {
  refreshPartyGameMemberOnlineState(store, room.id);
  const members = getPartyGameRoomMembers(store, room.id);
  const hostUser = store.users.find((item) => item.userId === room.hostUserId) || null;
  const meMember = members.find((item) => item.userId === currentUserId) || null;
  return {
    roomId: room.id,
    roomCode: room.roomCode,
    gameKey: room.gameKey,
    title: room.title,
    status: room.status,
    hostUserId: room.hostUserId,
    hostName: hostUser?.name || hostUser?.nickname || "",
    maxPlayers: room.maxPlayers,
    memberCount: members.length,
    onlineCount: members.filter((item) => item.online).length,
    readyCount: members.filter((item) => item.ready).length,
    joined: Boolean(meMember),
    isHost: room.hostUserId === currentUserId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
};

const serializePartyGameRoomSnapshot = (
  store: ReturnType<typeof getNexusStore>,
  room: PartyGameRoomRecord,
  currentUserId: string,
  afterSeq = 0,
) => {
  refreshPartyGameMemberOnlineState(store, room.id);
  const members = getPartyGameRoomMembers(store, room.id).map((item) => {
    const user = store.users.find((userItem) => userItem.userId === item.userId) || null;
    return {
      memberId: item.id,
      userId: item.userId,
      studentNo: user?.studentNo || "",
      nickname: item.nickname || user?.nickname || user?.name || "",
      ready: item.ready,
      online: item.online,
      joinedAt: item.joinedAt,
      lastHeartbeatAt: item.lastHeartbeatAt,
      isMe: item.userId === currentUserId,
      isHost: item.userId === room.hostUserId,
    };
  });
  const state = getPartyGameRoomState(store, room.id);
  const events = store.partyGameEvents
    .filter((item) => item.roomId === room.id && item.seq > Math.max(0, Math.floor(afterSeq)))
    .sort((left, right) => left.seq - right.seq)
    .slice(-200)
    .map((item) => ({
      eventId: item.id,
      seq: item.seq,
      type: item.type,
      actorUserId: item.actorUserId,
      payload: item.payload,
      createdAt: item.createdAt,
      clientActionId: item.clientActionId,
    }));
  const latestSeq = store.partyGameEvents
    .filter((item) => item.roomId === room.id)
    .reduce((acc, item) => Math.max(acc, item.seq), 0);
  return {
    room: toPartyGameRoomSummary(store, room, currentUserId),
    members,
    state: {
      version: state?.version || 0,
      data: state?.data || {},
      updatedAt: state?.updatedAt || room.updatedAt,
      updatedByUserId: state?.updatedByUserId || room.hostUserId,
    },
    events,
    latestSeq,
    serverTime: storeHelpers.nowIso(),
  };
};

export const handleV1Api = async (event: H3Event) => {
  const pathname = getRequestURL(event).pathname;
  const isExplicitV1Path = pathname === "/api/v1" || pathname.startsWith("/api/v1/");
  if (!isExplicitV1Path) {
    return toApiError(410, "API_V1_REQUIRED", "请使用 /api/v1/* 接口");
  }

  const requestPath = normalizeRoutePath(event);
  const path = requestPath.replace(/^\/+/, "");
  if (isSocialCompatPath(path)) {
    const socialResponse = await handleSocialV1Api(event);
    if (socialResponse) {
      return socialResponse;
    }
  }
  const method = getMethod(event).toUpperCase();
  const query = getQuery(event);
  const store = getNexusStore();

  if (method === "GET" && path === "") {
    return ok({
      service: "touchx-backend",
      mode: "api-v1",
      apiBase: "/api/v1",
      nexus: "/nexus",
      timestamp: storeHelpers.nowIso(),
    });
  }

  if (method === "POST" && path === "dev/reset-store") {
    const { user } = requireAdmin(event);
    const refreshed = resetNexusStore();
    appendAudit("dev_reset_store", user.userId, { userCount: refreshed.users.length });
    return ok({ reset: true, users: refreshed.users.length });
  }

  if (method === "GET" && path === "admin/bootstrap-status") {
    const config = useRuntimeConfig(event);
    const authState = getAdminAuthState(store, config);
    return ok({
      bootstrapStudentNo: authState.bootstrapStudentNo,
      passwordInitialized: authState.initialized,
      requirePassword: authState.initialized,
    });
  }

  if (method === "POST" && path === "admin/login") {
    const config = useRuntimeConfig(event);
    const body = await readJsonBody<{ password?: string; studentNo?: string }>(event);
    const studentNo = asString(body.studentNo);
    const password = asString(body.password);
    const authState = getAdminAuthState(store, config);
    if (!studentNo) {
      return toApiError(400, "ADMIN_STUDENT_NO_REQUIRED", "请输入管理员学号");
    }
    if (authState.initialized && !password) {
      return toApiError(400, "ADMIN_PASSWORD_REQUIRED", "请输入登录密码");
    }
    const targetAdmin = store.users.find((item) => item.studentNo === studentNo) || null;
    if (!targetAdmin || !isAdminRole(targetAdmin)) {
      return toApiError(401, "ADMIN_LOGIN_FAILED", "管理员账号不存在或无权限");
    }
    if (authState.initialized) {
      if (password !== authState.password) {
        return toApiError(401, "ADMIN_LOGIN_FAILED", "登录密码错误");
      }
    } else if (studentNo !== authState.bootstrapStudentNo) {
      return toApiError(401, "ADMIN_BOOTSTRAP_ONLY", "首次初始化仅允许默认管理员学号登录");
    }
    const session = createSession(event, targetAdmin, "admin", 24);
    appendAudit("admin_login", targetAdmin.userId, { studentNo: targetAdmin.studentNo });
    return ok({
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      user: toUserPayload(targetAdmin),
      needInit: !authState.initialized,
      bootstrapStudentNo: authState.bootstrapStudentNo,
    });
  }

  if (method === "POST" && path === "admin/logout") {
    const { user } = requireAdmin(event);
    const token = getBearerToken(event);
    revokeSession(token);
    appendAudit("admin_logout", user.userId, {});
    return ok({ loggedOut: true });
  }

  if (method === "GET" && path === "admin/me") {
    const config = useRuntimeConfig(event);
    const { user, session } = requireAdmin(event);
    const authState = getAdminAuthState(store, config);
    return ok({
      user: toUserPayload(user),
      role: session.role,
      expiresAt: session.expiresAt,
      needInit: !authState.initialized,
      bootstrapStudentNo: authState.bootstrapStudentNo,
    });
  }

  if (method === "POST" && path === "admin/init-password") {
    const config = useRuntimeConfig(event);
    const { user } = requireAdmin(event);
    const authState = getAdminAuthState(store, config);
    const body = await readJsonBody<{
      password?: string;
      confirmPassword?: string;
    }>(event);
    if (authState.initialized) {
      return toApiError(400, "ADMIN_PASSWORD_ALREADY_INITIALIZED", "管理员密码已初始化");
    }
    if (user.studentNo !== authState.bootstrapStudentNo) {
      return toApiError(403, "ADMIN_INIT_FORBIDDEN", "仅默认管理员可完成首次初始化");
    }
    const password = asString(body.password);
    const confirmPassword = asString(body.confirmPassword);
    if (!password) {
      return toApiError(400, "ADMIN_PASSWORD_REQUIRED", "请设置登录密码");
    }
    if (password.length < 6) {
      return toApiError(400, "ADMIN_PASSWORD_TOO_SHORT", "登录密码至少 6 位");
    }
    if (!confirmPassword) {
      return toApiError(400, "ADMIN_PASSWORD_CONFIRM_REQUIRED", "请确认登录密码");
    }
    if (password !== confirmPassword) {
      return toApiError(400, "ADMIN_PASSWORD_CONFIRM_MISMATCH", "两次输入密码不一致");
    }
    authState.password = password;
    authState.initialized = true;
    authState.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_init_password", user.userId, { studentNo: user.studentNo });
    return ok({
      initialized: true,
    });
  }

  if (method === "POST" && path === "auth/login") {
    const body = await readJsonBody<{ studentNo?: string; name?: string; nickname?: string; classLabel?: string }>(event);
    const studentNo = asString(body.studentNo);
    if (!studentNo) {
      return toApiError(400, "STUDENT_NO_REQUIRED", "登录需要提供 studentNo");
    }
    if (!/^\d{6,32}$/.test(studentNo)) {
      return toApiError(400, "STUDENT_NO_INVALID", "学号格式不正确");
    }
    let user = store.users.find((item) => item.studentNo === studentNo) || null;
    if (!user) {
      const inputName = asString(body.name);
      const inputNickname = asString(body.nickname) || inputName;
      user = {
        userId: storeHelpers.createId("user"),
        studentNo,
        studentId: "",
        name: inputName,
        classLabel: asString(body.classLabel),
        nickname: inputNickname,
        avatarUrl: "",
        wallpaperUrl: "",
        classIds: [],
        adminRole: "none",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      };
      store.users.push(user);
      appendAudit("auth_register", user.userId, { studentNo: user.studentNo });
    } else {
      if (asString(body.name)) {
        user.name = asString(body.name);
      }
      if (asString(body.nickname)) {
        user.nickname = asString(body.nickname);
      }
      if (asString(body.classLabel)) {
        user.classLabel = asString(body.classLabel);
      }
      user.updatedAt = storeHelpers.nowIso();
    }
    const session = createSession(event, user, "user", 24 * 14);
    appendAudit("auth_login", user.userId, {});
    return ok({
      sessionToken: session.token,
      expiresAt: session.expiresAt,
      mode: "mock",
      user: toAuthUserPayload(user),
    });
  }

  if (method === "POST" && path === "auth/logout") {
    const context = requireUser(event);
    const token = getBearerToken(event);
    revokeSession(token);
    appendAudit("auth_logout", context.user.userId, {});
    return ok({ loggedOut: true });
  }

  if (method === "GET" && path === "auth/me") {
    const { user, session } = requireUser(event);
    return ok({
      mode: "mock",
      user: toAuthUserPayload(user),
      role: session.role,
      expiresAt: session.expiresAt,
    });
  }

  if (method === "GET" && path === "party-games/heart-open/word-bank") {
    requireUser(event);
    const category = normalizeHeartOpenCategory(query.category || query.categoryName || query.category_name);
    const difficultyRaw = asString(query.difficulty || query.level).toLowerCase();
    if (difficultyRaw && !HEART_OPEN_DIFFICULTY_SET.has(difficultyRaw as HeartOpenDifficulty)) {
      return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
    }
    const keyword = asString(query.keyword);
    const filtered = filterHeartOpenWords(store.partyGameHeartOpenWords, {
      category,
      difficulty: difficultyRaw,
      keyword,
      enabled: true,
    }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return ok({
      items: filtered.map((item) => toHeartOpenWordPayload(item)),
      total: filtered.length,
      options: buildHeartOpenOptions(store.partyGameHeartOpenWords.filter((item) => item.enabled)),
      fetchedAt: storeHelpers.nowIso(),
    });
  }

  if (method === "GET" && path === "party-games/rooms") {
    const { user } = requireUser(event);
    const gameKey = sanitizePartyGameKey(query.gameKey || query.game_key);
    const mineOnly = String(query.mine || "").trim() === "1" || String(query.mine || "").trim().toLowerCase() === "true";
    const statusFilter = asString(query.status).toLowerCase();
    const items = store.partyGameRooms
      .filter((room) => {
        if (room.status === "closed") {
          return false;
        }
        if (gameKey && room.gameKey !== gameKey) {
          return false;
        }
        if (statusFilter && statusFilter !== "all" && room.status !== statusFilter) {
          return false;
        }
        if (!mineOnly) {
          return true;
        }
        return store.partyGameMembers.some((member) => member.roomId === room.id && member.userId === user.userId);
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 100)
      .map((room) => toPartyGameRoomSummary(store, room, user.userId));
    return ok({
      items,
      total: items.length,
    });
  }

  if (method === "POST" && path === "party-games/rooms") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      gameKey?: string;
      title?: string;
      maxPlayers?: number;
      nickname?: string;
    }>(event);
    const gameKey = sanitizePartyGameKey(body.gameKey);
    if (!gameKey) {
      return toApiError(400, "PARTY_GAME_KEY_INVALID", "gameKey 不合法");
    }
    const maxPlayers = Math.max(2, Math.min(12, Number(body.maxPlayers || 10)));
    const room: PartyGameRoomRecord = {
      id: storeHelpers.createId("pg_room"),
      roomCode: storeHelpers.generateJoinCode(),
      gameKey,
      title: resolvePartyGameTitle(gameKey, body.title),
      status: "waiting",
      hostUserId: user.userId,
      maxPlayers,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    const member: PartyGameMemberRecord = {
      id: storeHelpers.createId("pg_member"),
      roomId: room.id,
      userId: user.userId,
      nickname: asString(body.nickname) || user.nickname || user.name || user.studentNo,
      ready: true,
      online: true,
      joinedAt: storeHelpers.nowIso(),
      lastHeartbeatAt: storeHelpers.nowIso(),
    };
    const state: PartyGameStateRecord = {
      roomId: room.id,
      version: 1,
      data: {},
      updatedByUserId: user.userId,
      updatedAt: storeHelpers.nowIso(),
    };
    store.partyGameRooms.unshift(room);
    store.partyGameMembers.push(member);
    store.partyGameStates.push(state);
    appendPartyGameEvent(store, {
      roomId: room.id,
      type: "room.created",
      actorUserId: user.userId,
      payload: { gameKey: room.gameKey, roomCode: room.roomCode },
    });
    appendAudit("party_game_room_create", user.userId, {
      roomId: room.id,
      gameKey: room.gameKey,
      maxPlayers: room.maxPlayers,
    });
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  if (method === "POST" && path === "party-games/rooms/join-by-code") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ roomCode?: string; nickname?: string }>(event);
    const roomCode = asString(body.roomCode).toUpperCase();
    if (!roomCode) {
      return toApiError(400, "PARTY_GAME_ROOM_CODE_REQUIRED", "roomCode 不能为空");
    }
    const room = store.partyGameRooms.find((item) => item.roomCode === roomCode) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    let member = store.partyGameMembers.find((item) => item.roomId === room.id && item.userId === user.userId) || null;
    if (!member) {
      const memberCount = store.partyGameMembers.filter((item) => item.roomId === room.id).length;
      if (memberCount >= room.maxPlayers) {
        return toApiError(400, "PARTY_GAME_ROOM_FULL", "房间已满");
      }
      member = {
        id: storeHelpers.createId("pg_member"),
        roomId: room.id,
        userId: user.userId,
        nickname: asString(body.nickname) || user.nickname || user.name || user.studentNo,
        ready: false,
        online: true,
        joinedAt: storeHelpers.nowIso(),
        lastHeartbeatAt: storeHelpers.nowIso(),
      };
      store.partyGameMembers.push(member);
      room.updatedAt = storeHelpers.nowIso();
      appendPartyGameEvent(store, {
        roomId: room.id,
        type: "room.member_joined",
        actorUserId: user.userId,
        payload: { userId: user.userId },
      });
      appendAudit("party_game_room_join", user.userId, { roomId: room.id });
    } else {
      member.online = true;
      member.lastHeartbeatAt = storeHelpers.nowIso();
      if (asString(body.nickname)) {
        member.nickname = asString(body.nickname);
      }
    }
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomMatch = path.match(/^party-games\/rooms\/([^/]+)$/);
  if (method === "GET" && partyRoomMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    member.online = true;
    member.lastHeartbeatAt = storeHelpers.nowIso();
    const afterSeq = Math.max(0, Number(query.afterSeq || query.after_seq || 0));
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId, afterSeq));
  }

  const partyRoomJoinMatch = path.match(/^party-games\/rooms\/([^/]+)\/join$/);
  if (method === "POST" && partyRoomJoinMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomJoinMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const body = await readJsonBody<{ nickname?: string }>(event);
    let member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      const memberCount = store.partyGameMembers.filter((item) => item.roomId === roomId).length;
      if (memberCount >= room.maxPlayers) {
        return toApiError(400, "PARTY_GAME_ROOM_FULL", "房间已满");
      }
      member = {
        id: storeHelpers.createId("pg_member"),
        roomId,
        userId: user.userId,
        nickname: asString(body.nickname) || user.nickname || user.name || user.studentNo,
        ready: false,
        online: true,
        joinedAt: storeHelpers.nowIso(),
        lastHeartbeatAt: storeHelpers.nowIso(),
      };
      store.partyGameMembers.push(member);
      room.updatedAt = storeHelpers.nowIso();
      appendPartyGameEvent(store, {
        roomId,
        type: "room.member_joined",
        actorUserId: user.userId,
        payload: { userId: user.userId },
      });
      appendAudit("party_game_room_join", user.userId, { roomId });
    } else {
      member.online = true;
      member.lastHeartbeatAt = storeHelpers.nowIso();
      if (asString(body.nickname)) {
        member.nickname = asString(body.nickname);
      }
    }
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomLeaveMatch = path.match(/^party-games\/rooms\/([^/]+)\/leave$/);
  if (method === "POST" && partyRoomLeaveMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomLeaveMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(400, "PARTY_GAME_MEMBER_NOT_FOUND", "当前用户不在该房间");
    }
    store.partyGameMembers = store.partyGameMembers.filter((item) => item.id !== member.id);
    const remainMembers = getPartyGameRoomMembers(store, roomId);
    let roomClosed = false;
    if (remainMembers.length === 0) {
      room.status = "closed";
      room.updatedAt = storeHelpers.nowIso();
      roomClosed = true;
    } else if (room.hostUserId === user.userId) {
      room.hostUserId = remainMembers[0].userId;
      room.updatedAt = storeHelpers.nowIso();
    }
    appendPartyGameEvent(store, {
      roomId,
      type: "room.member_left",
      actorUserId: user.userId,
      payload: { userId: user.userId, roomClosed },
    });
    appendAudit("party_game_room_leave", user.userId, { roomId, roomClosed });
    return ok({
      left: true,
      roomId,
      roomClosed,
      hostUserId: room.hostUserId,
    });
  }

  const partyRoomHeartbeatMatch = path.match(/^party-games\/rooms\/([^/]+)\/heartbeat$/);
  if (method === "POST" && partyRoomHeartbeatMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomHeartbeatMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    member.online = true;
    member.lastHeartbeatAt = storeHelpers.nowIso();
    const body = await readJsonBody<{ ready?: boolean; nickname?: string }>(event);
    if (typeof body.ready === "boolean") {
      member.ready = body.ready;
    }
    if (asString(body.nickname)) {
      member.nickname = asString(body.nickname);
    }
    room.updatedAt = storeHelpers.nowIso();
    return ok({
      roomId,
      memberId: member.id,
      online: member.online,
      ready: member.ready,
      lastHeartbeatAt: member.lastHeartbeatAt,
    });
  }

  const partyRoomStartMatch = path.match(/^party-games\/rooms\/([^/]+)\/start$/);
  if (method === "POST" && partyRoomStartMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomStartMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    if (room.hostUserId !== user.userId) {
      return toApiError(403, "PARTY_GAME_ROOM_HOST_ONLY", "仅房主可开始对局");
    }
    room.status = "playing";
    room.updatedAt = storeHelpers.nowIso();
    appendPartyGameEvent(store, {
      roomId,
      type: "room.started",
      actorUserId: user.userId,
      payload: {},
    });
    appendAudit("party_game_room_start", user.userId, { roomId });
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomFinishMatch = path.match(/^party-games\/rooms\/([^/]+)\/finish$/);
  if (method === "POST" && partyRoomFinishMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomFinishMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    if (room.hostUserId !== user.userId) {
      return toApiError(403, "PARTY_GAME_ROOM_HOST_ONLY", "仅房主可结束对局");
    }
    room.status = "finished";
    room.updatedAt = storeHelpers.nowIso();
    appendPartyGameEvent(store, {
      roomId,
      type: "room.finished",
      actorUserId: user.userId,
      payload: {},
    });
    appendAudit("party_game_room_finish", user.userId, { roomId });
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomSyncStateMatch = path.match(/^party-games\/rooms\/([^/]+)\/sync-state$/);
  if (method === "POST" && partyRoomSyncStateMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomSyncStateMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    const body = await readJsonBody<{
      state?: Record<string, unknown>;
      baseVersion?: number;
      roomStatus?: "waiting" | "playing" | "finished";
      eventType?: string;
      clientActionId?: string;
    }>(event);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
      return toApiError(400, "PARTY_GAME_STATE_INVALID", "state 必须为 JSON 对象");
    }
    let state = getPartyGameRoomState(store, roomId);
    if (!state) {
      state = {
        roomId,
        version: 1,
        data: {},
        updatedByUserId: room.hostUserId,
        updatedAt: storeHelpers.nowIso(),
      };
      store.partyGameStates.push(state);
    }
    const baseVersion = Number(body.baseVersion || 0);
    if (baseVersion > 0 && baseVersion !== state.version) {
      return toApiError(409, "PARTY_GAME_STATE_VERSION_CONFLICT", "房间状态版本冲突，请先拉取最新状态");
    }
    state.version += 1;
    state.data = { ...body.state };
    state.updatedAt = storeHelpers.nowIso();
    state.updatedByUserId = user.userId;
    if (body.roomStatus === "waiting" || body.roomStatus === "playing" || body.roomStatus === "finished") {
      room.status = body.roomStatus;
    }
    room.updatedAt = storeHelpers.nowIso();
    const nextEventType = asString(body.eventType) || "state.synced";
    const duplicatedEvent =
      body.clientActionId &&
      store.partyGameEvents.find(
        (item) =>
          item.roomId === roomId &&
          item.actorUserId === user.userId &&
          item.clientActionId === asString(body.clientActionId),
      );
    if (!duplicatedEvent) {
      appendPartyGameEvent(store, {
        roomId,
        type: nextEventType,
        actorUserId: user.userId,
        clientActionId: asString(body.clientActionId),
        payload: { version: state.version },
      });
    }
    return ok({
      roomId,
      version: state.version,
      updatedAt: state.updatedAt,
      updatedByUserId: state.updatedByUserId,
      roomStatus: room.status,
    });
  }

  const partyRoomActionMatch = path.match(/^party-games\/rooms\/([^/]+)\/actions$/);
  if (method === "POST" && partyRoomActionMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomActionMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    const body = await readJsonBody<{
      type?: string;
      payload?: Record<string, unknown>;
      clientActionId?: string;
    }>(event);
    const actionType = asString(body.type);
    if (!actionType) {
      return toApiError(400, "PARTY_GAME_ACTION_TYPE_REQUIRED", "type 不能为空");
    }
    const clientActionId = asString(body.clientActionId);
    const duplicatedEvent =
      clientActionId &&
      store.partyGameEvents.find(
        (item) => item.roomId === roomId && item.actorUserId === user.userId && item.clientActionId === clientActionId,
      );
    if (duplicatedEvent) {
      return ok({
        duplicated: true,
        event: {
          eventId: duplicatedEvent.id,
          seq: duplicatedEvent.seq,
          type: duplicatedEvent.type,
          actorUserId: duplicatedEvent.actorUserId,
          payload: duplicatedEvent.payload,
          createdAt: duplicatedEvent.createdAt,
          clientActionId: duplicatedEvent.clientActionId,
        },
      });
    }
    room.updatedAt = storeHelpers.nowIso();
    const eventRecord = appendPartyGameEvent(store, {
      roomId,
      type: actionType,
      actorUserId: user.userId,
      clientActionId,
      payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    });
    return ok({
      duplicated: false,
      event: {
        eventId: eventRecord.id,
        seq: eventRecord.seq,
        type: eventRecord.type,
        actorUserId: eventRecord.actorUserId,
        payload: eventRecord.payload,
        createdAt: eventRecord.createdAt,
        clientActionId: eventRecord.clientActionId,
      },
      roomUpdatedAt: room.updatedAt,
    });
  }

  if (method === "GET" && path === "admin/party-games/heart-open/word-bank") {
    requireAdmin(event);
    const category = normalizeHeartOpenCategory(query.category || query.categoryName || query.category_name);
    const difficultyRaw = asString(query.difficulty || query.level).toLowerCase();
    if (difficultyRaw && !HEART_OPEN_DIFFICULTY_SET.has(difficultyRaw as HeartOpenDifficulty)) {
      return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
    }
    const enabledRaw = asString(query.enabled).toLowerCase();
    const enabledFilter =
      enabledRaw === "1" || enabledRaw === "true"
        ? true
        : enabledRaw === "0" || enabledRaw === "false"
          ? false
          : undefined;
    const keyword = asString(query.keyword);
    const filtered = filterHeartOpenWords(store.partyGameHeartOpenWords, {
      category,
      difficulty: difficultyRaw,
      keyword,
      enabled: enabledFilter,
    }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return ok({
      items: filtered.map((item) => toHeartOpenWordPayload(item)),
      total: filtered.length,
      options: buildHeartOpenOptions(store.partyGameHeartOpenWords),
    });
  }

  if (method === "POST" && path === "admin/party-games/heart-open/word-bank") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      word?: string;
      punishment?: string;
      category?: string;
      difficulty?: HeartOpenDifficulty;
      enabled?: boolean;
    }>(event);
    const word = asString(body.word);
    const punishment = asString(body.punishment);
    if (!word) {
      return toApiError(400, "HEART_OPEN_WORD_REQUIRED", "word 不能为空");
    }
    if (!punishment) {
      return toApiError(400, "HEART_OPEN_PUNISHMENT_REQUIRED", "punishment 不能为空");
    }
    const difficultyRaw = asString(body.difficulty).toLowerCase();
    if (difficultyRaw && !HEART_OPEN_DIFFICULTY_SET.has(difficultyRaw as HeartOpenDifficulty)) {
      return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
    }
    const item: PartyGameHeartOpenWordRecord = {
      id: storeHelpers.createId("heart_open_word"),
      word,
      punishment,
      category: normalizeHeartOpenCategory(body.category) || "默认",
      difficulty: sanitizeHeartOpenDifficulty(body.difficulty, "medium"),
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.partyGameHeartOpenWords.unshift(item);
    appendAudit("heart_open_word_create", user.userId, {
      wordId: item.id,
      word: item.word,
      difficulty: item.difficulty,
      enabled: item.enabled,
    });
    return ok({
      item: toHeartOpenWordPayload(item),
    });
  }

  const adminHeartOpenWordUpdateMatch = path.match(/^admin\/party-games\/heart-open\/word-bank\/([^/]+)\/update$/);
  if (method === "POST" && adminHeartOpenWordUpdateMatch) {
    const { user } = requireAdmin(event);
    const wordId = decodeURIComponent(adminHeartOpenWordUpdateMatch[1]);
    const target = store.partyGameHeartOpenWords.find((item) => item.id === wordId) || null;
    if (!target) {
      return toApiError(404, "HEART_OPEN_WORD_NOT_FOUND", "词条不存在");
    }
    const body = await readJsonBody<{
      word?: string;
      punishment?: string;
      category?: string;
      difficulty?: HeartOpenDifficulty;
      enabled?: boolean;
    }>(event);
    if (Object.prototype.hasOwnProperty.call(body, "word")) {
      const word = asString(body.word);
      if (!word) {
        return toApiError(400, "HEART_OPEN_WORD_REQUIRED", "word 不能为空");
      }
      target.word = word;
    }
    if (Object.prototype.hasOwnProperty.call(body, "punishment")) {
      const punishment = asString(body.punishment);
      if (!punishment) {
        return toApiError(400, "HEART_OPEN_PUNISHMENT_REQUIRED", "punishment 不能为空");
      }
      target.punishment = punishment;
    }
    if (Object.prototype.hasOwnProperty.call(body, "category")) {
      target.category = normalizeHeartOpenCategory(body.category) || "默认";
    }
    if (Object.prototype.hasOwnProperty.call(body, "difficulty")) {
      const difficultyRaw = asString(body.difficulty).toLowerCase();
      if (difficultyRaw && !HEART_OPEN_DIFFICULTY_SET.has(difficultyRaw as HeartOpenDifficulty)) {
        return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
      }
      target.difficulty = sanitizeHeartOpenDifficulty(body.difficulty, target.difficulty);
    }
    if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
      target.enabled = Boolean(body.enabled);
    }
    target.updatedAt = storeHelpers.nowIso();
    appendAudit("heart_open_word_update", user.userId, {
      wordId: target.id,
      word: target.word,
      difficulty: target.difficulty,
      enabled: target.enabled,
    });
    return ok({
      item: toHeartOpenWordPayload(target),
    });
  }

  const adminHeartOpenWordDeleteMatch = path.match(/^admin\/party-games\/heart-open\/word-bank\/([^/]+)\/delete$/);
  if (method === "POST" && adminHeartOpenWordDeleteMatch) {
    const { user } = requireAdmin(event);
    const wordId = decodeURIComponent(adminHeartOpenWordDeleteMatch[1]);
    const target = store.partyGameHeartOpenWords.find((item) => item.id === wordId) || null;
    if (!target) {
      return toApiError(404, "HEART_OPEN_WORD_NOT_FOUND", "词条不存在");
    }
    store.partyGameHeartOpenWords = store.partyGameHeartOpenWords.filter((item) => item.id !== wordId);
    appendAudit("heart_open_word_delete", user.userId, {
      wordId,
      word: target.word,
    });
    return ok({
      deleted: true,
      wordId,
    });
  }

  if (method === "GET" && path === "admin/users") {
    requireAdmin(event);
    const { limit, offset } = parsePagination(query as Record<string, unknown>);
    const includeGhost = String(query.includeGhost || "").toLowerCase() === "true";
    const visibleUsers = includeGhost
      ? [...store.users]
      : store.users.filter((item) => !isGhostUserRecord(item, store.scheduleSubscriptions));
    const items = visibleUsers.slice(offset, offset + limit).map((item) => ({
      ...toUserPayload(item),
      classCount: item.classIds.length,
      subscriptionCount: store.scheduleSubscriptions.filter((sub) => sub.subscriberUserId === item.userId).length,
    }));
    return ok({
      items,
      total: visibleUsers.length,
      limit,
      offset,
    });
  }

  const adminUserUpdateMatch = path.match(/^admin\/users\/([^/]+)\/update$/);
  if (method === "POST" && adminUserUpdateMatch) {
    const { user: adminUser } = requireAdmin(event);
    const userId = decodeURIComponent(adminUserUpdateMatch[1]);
    const target = store.users.find((item) => item.userId === userId) || null;
    if (!target) {
      return toApiError(404, "ADMIN_USER_NOT_FOUND", "用户不存在");
    }
    const body = await readJsonBody<{
      name?: string;
      nickname?: string;
      classLabel?: string;
      studentId?: string;
      adminRole?: "none" | "operator" | "super_admin";
      reminderEnabled?: boolean;
      reminderWindowMinutes?: number[] | string;
    }>(event);
    const name = asString(body.name);
    const nickname = asString(body.nickname);
    const classLabel = asString(body.classLabel);
    const studentId = asString(body.studentId);
    if (name) {
      target.name = name;
    }
    if (nickname) {
      target.nickname = nickname;
    }
    if (classLabel) {
      target.classLabel = classLabel;
    }
    if (studentId) {
      target.studentId = studentId;
    }
    if (body.adminRole === "none" || body.adminRole === "operator" || body.adminRole === "super_admin") {
      target.adminRole = body.adminRole;
    }
    if (typeof body.reminderEnabled === "boolean") {
      target.reminderEnabled = body.reminderEnabled;
    }
    if (Array.isArray(body.reminderWindowMinutes)) {
      const minutes = body.reminderWindowMinutes
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
        .map((item) => Math.round(item));
      target.reminderWindowMinutes = Array.from(new Set(minutes)).sort((left, right) => left - right);
    } else if (typeof body.reminderWindowMinutes === "string") {
      const minutes = body.reminderWindowMinutes
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0)
        .map((item) => Math.round(item));
      if (minutes.length > 0) {
        target.reminderWindowMinutes = Array.from(new Set(minutes)).sort((left, right) => left - right);
      }
    }
    target.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_user_update", adminUser.userId, {
      targetUserId: target.userId,
      targetStudentNo: target.studentNo,
    });
    return ok({
      user: {
        ...toUserPayload(target),
        classCount: target.classIds.length,
        subscriptionCount: store.scheduleSubscriptions.filter((sub) => sub.subscriberUserId === target.userId).length,
      },
    });
  }

  if (method === "POST" && path === "admin/schedule-import/jobs") {
    const { user } = requireScheduleImportAccess(event);
    const result = await createScheduleImportJob(event, user.userId);
    appendAudit("admin_schedule_import_job_create", user.userId, {
      jobId: result.jobId,
      totalFiles: result.totalFiles,
    });
    return ok(result);
  }

  if (method === "GET" && path === "admin/schedule-import/jobs") {
    requireScheduleImportAccess(event);
    const parsedLimit = Number(query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.trunc(parsedLimit))) : 20;
    const ids = await listRecentScheduleImportJobIds(event, limit);
    return ok({
      items: ids.map((id) => ({ jobId: id })),
      total: ids.length,
      limit,
    });
  }

  const adminScheduleImportJobMatch = path.match(/^admin\/schedule-import\/jobs\/([^/]+)$/);
  if (method === "GET" && adminScheduleImportJobMatch) {
    requireScheduleImportAccess(event);
    const jobId = decodeURIComponent(adminScheduleImportJobMatch[1]);
    const status = await getScheduleImportJobStatus(event, jobId);
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在");
    }
    return ok(status);
  }

  if (method === "POST" && path === "schedule-import/jobs") {
    const { user } = requireUser(event);
    const result = await createScheduleImportJob(event, user.userId, { mode: "preview" });
    appendAudit("schedule_import_job_create", user.userId, {
      jobId: result.jobId,
      totalFiles: result.totalFiles,
    });
    return ok(result);
  }

  if (method === "GET" && path === "schedule-import/jobs") {
    const { user } = requireUser(event);
    const parsedLimit = Number(query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, Math.trunc(parsedLimit))) : 10;
    const items = await listRecentScheduleImportJobs(event, {
      actorUserId: user.userId,
      includeAll: isAdminRole(user) && query.scope === "all",
      limit,
    });
    return ok({
      items,
      total: items.length,
      limit,
    });
  }

  const scheduleImportJobConfirmMatch = path.match(/^schedule-import\/jobs\/([^/]+)\/confirm$/);
  if (method === "POST" && scheduleImportJobConfirmMatch) {
    const { user } = requireUser(event);
    const jobId = decodeURIComponent(scheduleImportJobConfirmMatch[1]);
    const status = await getScheduleImportJobStatus(event, jobId);
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在");
    }
    if (status.createdByUserId !== user.userId && !isAdminRole(user)) {
      return toApiError(403, "SCHEDULE_IMPORT_JOB_FORBIDDEN", "无权确认该导入任务");
    }
    const body = await readJsonBody<{ previewEntries?: unknown[]; entries?: unknown[] }>(event);
    const previewEntries = Array.isArray(body.previewEntries)
      ? body.previewEntries
      : Array.isArray(body.entries)
        ? body.entries
        : [];
    try {
      const result = await confirmScheduleImportJob(event, jobId, user.userId, previewEntries as ScheduleImportPreviewEntry[]);
      appendAudit("schedule_import_job_confirm", user.userId, {
        jobId,
        scheduleId: result.scheduleId,
        versionNo: result.versionNo,
        entryCount: result.entryCount,
      });
      return ok(result);
    } catch (error) {
      const payload = toScheduleImportErrorPayload(error);
      const code = payload.code || "SCHEDULE_IMPORT_CONFIRM_FAILED";
      const statusCode = code === "SCHEDULE_IMPORT_JOB_NOT_FOUND" ? 404 : 400;
      return toApiError(statusCode, code, payload.message || "确认导入失败", payload.details || undefined);
    }
  }

  const scheduleImportJobMatch = path.match(/^schedule-import\/jobs\/([^/]+)$/);
  if (method === "GET" && scheduleImportJobMatch) {
    const { user } = requireUser(event);
    const jobId = decodeURIComponent(scheduleImportJobMatch[1]);
    const status = await getScheduleImportJobStatus(event, jobId);
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在");
    }
    if (status.createdByUserId !== user.userId && user.adminRole !== "super_admin" && user.adminRole !== "operator") {
      return toApiError(403, "SCHEDULE_IMPORT_JOB_FORBIDDEN", "无权查看该导入任务");
    }
    return ok(status);
  }

  if (method === "GET" && path === "classes") {
    const { user } = requireUser(event);
    const items = store.classes.map((classItem) => {
      const memberRole = getClassMemberRole(user.userId, classItem.id);
      return {
        classId: classItem.id,
        className: classItem.name,
        timezone: classItem.timezone,
        status: classItem.status,
        role: memberRole || "",
        joined: Boolean(memberRole),
        ownerUserId: classItem.ownerUserId,
      };
    });
    return ok({ items });
  }

  if (method === "POST" && path === "classes") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ className?: string; timezone?: string }>(event);
    const className = asString(body.className);
    if (!className) {
      return toApiError(400, "CLASS_NAME_REQUIRED", "班级名称不能为空");
    }
    const classId = storeHelpers.createId("class");
    const classItem: ClassRecord = {
      id: classId,
      name: className,
      ownerUserId: user.userId,
      timezone: asString(body.timezone) || "Asia/Shanghai",
      status: "active",
      activeJoinCode: storeHelpers.generateJoinCode(),
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.classes.push(classItem);
    store.classMembers.push({
      id: storeHelpers.createId("class_member"),
      classId,
      userId: user.userId,
      classRole: "class_owner",
      joinedAt: storeHelpers.nowIso(),
    });
    ensureUniquePush(user.classIds, classId);
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("class_create", user.userId, { classId, className });
    return ok({
      classId,
      className,
      joinCode: classItem.activeJoinCode,
      timezone: classItem.timezone,
    });
  }

  const classJoinMatch = path.match(/^classes\/([^/]+)\/join$/);
  if (method === "POST" && classJoinMatch) {
    const classId = decodeURIComponent(classJoinMatch[1]);
    const { user } = requireUser(event);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem || classItem.status !== "active") {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在或已停用");
    }
    const body = await readJsonBody<{ joinCode?: string }>(event);
    const joinCode = asString(body.joinCode).toUpperCase();
    if (!joinCode || joinCode !== classItem.activeJoinCode) {
      return toApiError(400, "JOIN_CODE_INVALID", "班级加入码无效");
    }
    const existing = store.classMembers.find((item) => item.classId === classId && item.userId === user.userId);
    if (existing) {
      return ok({
        joined: true,
        classId,
        className: classItem.name,
        classRole: existing.classRole,
      });
    }
    const member: ClassMemberRecord = {
      id: storeHelpers.createId("class_member"),
      classId,
      userId: user.userId,
      classRole: "class_viewer",
      joinedAt: storeHelpers.nowIso(),
    };
    store.classMembers.push(member);
    ensureUniquePush(user.classIds, classId);
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("class_join", user.userId, { classId, className: classItem.name });
    return ok({
      joined: true,
      classId,
      className: classItem.name,
      classRole: member.classRole,
    });
  }

  const classRotateMatch = path.match(/^classes\/([^/]+)\/join-code\/rotate$/);
  if (method === "POST" && classRotateMatch) {
    const classId = decodeURIComponent(classRotateMatch[1]);
    const { user } = requireUser(event);
    ensureClassAccess(user, classId, ["class_owner", "class_admin"]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    classItem.activeJoinCode = storeHelpers.generateJoinCode();
    classItem.updatedAt = storeHelpers.nowIso();
    appendAudit("class_rotate_join_code", user.userId, { classId });
    return ok({
      classId,
      joinCode: classItem.activeJoinCode,
      updatedAt: classItem.updatedAt,
    });
  }

  const classSchedulesMatch = path.match(/^classes\/([^/]+)\/schedules$/);
  if (method === "POST" && classSchedulesMatch) {
    const classId = decodeURIComponent(classSchedulesMatch[1]);
    const { user } = requireUser(event);
    ensureClassAccess(user, classId, ["class_owner", "class_admin", "class_editor"]);
    const body = await readJsonBody<{
      title?: string;
      description?: string;
      entries?: unknown[];
      publishNow?: boolean;
    }>(event);
    const title = asString(body.title) || `课表-${new Date().toISOString().slice(0, 10)}`;
    const description = asString(body.description);
    const entries = normalizeEntries(body.entries);
    const scheduleId = storeHelpers.createId("schedule");
    const schedule: ScheduleRecord = {
      id: scheduleId,
      classId,
      title,
      description,
      publishedVersionNo: body.publishNow ? 1 : 0,
      createdByUserId: user.userId,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    const version: ScheduleVersionRecord = {
      id: storeHelpers.createId("schedule_version"),
      scheduleId,
      versionNo: 1,
      status: body.publishNow ? "published" : "draft",
      entries,
      createdByUserId: user.userId,
      createdAt: storeHelpers.nowIso(),
    };
    store.schedules.push(schedule);
    store.scheduleVersions.push(version);
    if (body.publishNow) {
      onSchedulePublished(schedule, 1);
    }
    appendAudit("schedule_create", user.userId, { classId, scheduleId, title, publishNow: Boolean(body.publishNow) });
    return ok({
      scheduleId,
      classId,
      title,
      publishedVersionNo: schedule.publishedVersionNo,
      versionNo: version.versionNo,
      status: version.status,
      entryCount: version.entries.length,
    });
  }

  if (method === "GET" && path === "admin/schedules") {
    requireAdmin(event);
    const items = store.schedules.map((schedule) => {
      const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
      const versions = store.scheduleVersions
        .filter((item) => item.scheduleId === schedule.id)
        .sort((left, right) => right.versionNo - left.versionNo);
      const publishedVersion =
        versions.find((item) => item.versionNo === schedule.publishedVersionNo && item.status === "published") || null;
      const latestVersion = versions[0] || null;
      return {
        scheduleId: schedule.id,
        classId: schedule.classId,
        classLabel: classItem?.name || "",
        title: schedule.title,
        description: schedule.description,
        publishedVersionNo: schedule.publishedVersionNo,
        latestVersionNo: latestVersion?.versionNo || 0,
        latestStatus: latestVersion?.status || "draft",
        latestEntryCount: latestVersion?.entries.length || 0,
        publishedEntryCount: publishedVersion?.entries.length || 0,
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt,
      };
    });
    return ok({ items });
  }

  const schedulePublishMatch = path.match(/^schedules\/([^/]+)\/publish$/);
  if (method === "POST" && schedulePublishMatch) {
    const scheduleId = decodeURIComponent(schedulePublishMatch[1]);
    const { user } = requireUser(event);
    const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
    if (!schedule) {
      return toApiError(404, "SCHEDULE_NOT_FOUND", "课表不存在");
    }
    ensureClassAccess(user, schedule.classId, ["class_owner", "class_admin", "class_editor"]);
    const body = await readJsonBody<{ entries?: unknown[] }>(event);
    const latestVersion = getLatestScheduleVersion(scheduleId);
    const nextVersionNo = (latestVersion?.versionNo || 0) + 1;
    const entries = Array.isArray(body.entries)
      ? normalizeEntries(body.entries)
      : [...(latestVersion?.entries || [])].map((entry) => ({ ...entry, id: storeHelpers.createId("entry") }));
    const version: ScheduleVersionRecord = {
      id: storeHelpers.createId("schedule_version"),
      scheduleId,
      versionNo: nextVersionNo,
      status: "published",
      entries,
      createdByUserId: user.userId,
      createdAt: storeHelpers.nowIso(),
    };
    store.scheduleVersions.push(version);
    schedule.publishedVersionNo = nextVersionNo;
    schedule.updatedAt = storeHelpers.nowIso();
    onSchedulePublished(schedule, nextVersionNo);
    appendAudit("schedule_publish", user.userId, { scheduleId, versionNo: nextVersionNo });
    return ok({
      scheduleId,
      versionNo: nextVersionNo,
      entryCount: entries.length,
      publishedVersionNo: schedule.publishedVersionNo,
    });
  }

  const scheduleSubscribeMatch = path.match(/^schedules\/([^/]+)\/subscribe$/);
  if (method === "POST" && scheduleSubscribeMatch) {
    const scheduleId = decodeURIComponent(scheduleSubscribeMatch[1]);
    const { user } = requireUser(event);
    const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
    if (!schedule) {
      return toApiError(404, "SCHEDULE_NOT_FOUND", "课表不存在");
    }
    const publishedVersion = getPublishedScheduleVersion(scheduleId, schedule.publishedVersionNo);
    if (!publishedVersion) {
      return toApiError(400, "SCHEDULE_NOT_PUBLISHED", "该课表尚未发布，暂不可订阅");
    }
    const existing = store.scheduleSubscriptions.find(
      (item) => item.subscriberUserId === user.userId && item.sourceScheduleId === scheduleId,
    );
    if (existing) {
      return ok({
        subscription: existing,
        duplicated: true,
      });
    }
    const subscription: ScheduleSubscription = {
      id: storeHelpers.createId("schedule_subscription"),
      subscriberUserId: user.userId,
      sourceScheduleId: scheduleId,
      baseVersionNo: publishedVersion.versionNo,
      followMode: "following",
      createdAt: storeHelpers.nowIso(),
    };
    store.scheduleSubscriptions.push(subscription);
    appendAudit("schedule_subscribe", user.userId, { scheduleId, subscriptionId: subscription.id });
    return ok({
      subscription,
    });
  }

  if (method === "GET" && path === "me/schedule-subscriptions") {
    const { user } = requireUser(event);
    const subscriptions = store.scheduleSubscriptions
      .filter((item) => item.subscriberUserId === user.userId)
      .map((item) => {
        const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
        const classItem = schedule ? store.classes.find((classRow) => classRow.id === schedule.classId) || null : null;
        return {
          ...item,
          scheduleTitle: schedule?.title || "",
          classId: classItem?.id || "",
          className: classItem?.name || "",
          patchCount: store.schedulePatches.filter((patch) => patch.subscriptionId === item.id).length,
          pendingConflictCount: store.scheduleConflicts.filter(
            (conflict) => conflict.subscriptionId === item.id && conflict.resolutionStatus === "pending",
          ).length,
        };
      });
    return ok({ items: subscriptions });
  }

  if (method === "POST" && path === "me/schedule-patches") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      subscriptionId?: string;
      entryId?: string;
      opType?: SchedulePatch["opType"];
      patchPayload?: Record<string, unknown>;
    }>(event);
    const subscriptionId = asString(body.subscriptionId);
    const entryId = asString(body.entryId);
    if (!subscriptionId || !entryId) {
      return toApiError(400, "PATCH_PARAM_INVALID", "subscriptionId 与 entryId 均不能为空");
    }
    const subscription = store.scheduleSubscriptions.find((item) => item.id === subscriptionId) || null;
    if (!subscription || subscription.subscriberUserId !== user.userId) {
      return toApiError(403, "PATCH_FORBIDDEN", "不能修改非本人订阅的课表补丁");
    }
    const patch: SchedulePatch = {
      id: storeHelpers.createId("schedule_patch"),
      subscriptionId,
      entryId,
      opType: body.opType === "add" || body.opType === "remove" ? body.opType : "update",
      patchPayload: body.patchPayload && typeof body.patchPayload === "object" ? body.patchPayload : {},
      createdAt: storeHelpers.nowIso(),
    };
    store.schedulePatches.push(patch);
    subscription.followMode = "patched";
    appendAudit("schedule_patch_create", user.userId, { subscriptionId, patchId: patch.id, entryId });
    return ok({ patch, followMode: subscription.followMode });
  }

  if (method === "GET" && path === "me/schedule-conflicts") {
    const { user } = requireUser(event);
    const subscriptionIdSet = new Set(
      store.scheduleSubscriptions.filter((item) => item.subscriberUserId === user.userId).map((item) => item.id),
    );
    const items = store.scheduleConflicts
      .filter((item) => subscriptionIdSet.has(item.subscriptionId))
      .map((item) => {
        const subscription = store.scheduleSubscriptions.find((sub) => sub.id === item.subscriptionId) || null;
        const schedule = subscription
          ? store.schedules.find((scheduleItem) => scheduleItem.id === subscription.sourceScheduleId) || null
          : null;
        return {
          ...item,
          scheduleId: subscription?.sourceScheduleId || "",
          scheduleTitle: schedule?.title || "",
        };
      });
    return ok({ items });
  }

  if (method === "GET" && path === "me/schedule-patches") {
    const { user } = requireUser(event);
    const subscriptionMap = new Map(
      store.scheduleSubscriptions
        .filter((item) => item.subscriberUserId === user.userId)
        .map((item) => [item.id, item] as const),
    );
    const items = store.schedulePatches
      .filter((item) => subscriptionMap.has(item.subscriptionId))
      .map((item) => {
        const subscription = subscriptionMap.get(item.subscriptionId) || null;
        const schedule = subscription
          ? store.schedules.find((scheduleItem) => scheduleItem.id === subscription.sourceScheduleId) || null
          : null;
        return {
          ...item,
          scheduleId: subscription?.sourceScheduleId || "",
          scheduleTitle: schedule?.title || "",
        };
      });
    return ok({ items });
  }

  const conflictResolveMatch = path.match(/^me\/schedule-conflicts\/([^/]+)\/resolve$/);
  if (method === "POST" && conflictResolveMatch) {
    const conflictId = decodeURIComponent(conflictResolveMatch[1]);
    const { user } = requireUser(event);
    const body = await readJsonBody<{ action?: "keep_patch" | "relink" }>(event);
    const conflict = store.scheduleConflicts.find((item) => item.id === conflictId) || null;
    if (!conflict) {
      return toApiError(404, "CONFLICT_NOT_FOUND", "冲突记录不存在");
    }
    const subscription = store.scheduleSubscriptions.find((item) => item.id === conflict.subscriptionId) || null;
    if (!subscription || subscription.subscriberUserId !== user.userId) {
      return toApiError(403, "CONFLICT_FORBIDDEN", "不能操作其他人的冲突记录");
    }
    const action = body.action === "relink" ? "relink" : "keep_patch";
    if (action === "relink") {
      conflict.resolutionStatus = "relinked";
      store.schedulePatches = store.schedulePatches.filter(
        (patch) => !(patch.subscriptionId === subscription.id && patch.entryId === conflict.entryId),
      );
      const pendingPatchCount = store.schedulePatches.filter((patch) => patch.subscriptionId === subscription.id).length;
      if (pendingPatchCount === 0) {
        subscription.followMode = "following";
      }
    } else {
      conflict.resolutionStatus = "kept_patch";
      subscription.followMode = "patched";
    }
    appendAudit("schedule_conflict_resolve", user.userId, {
      conflictId,
      action,
      subscriptionId: subscription.id,
    });
    return ok({ conflict, subscription });
  }

  const patchRelinkMatch = path.match(/^me\/schedule-patches\/([^/]+)\/relink$/);
  if (method === "POST" && patchRelinkMatch) {
    const patchId = decodeURIComponent(patchRelinkMatch[1]);
    const { user } = requireUser(event);
    const patch = store.schedulePatches.find((item) => item.id === patchId) || null;
    if (!patch) {
      return toApiError(404, "PATCH_NOT_FOUND", "课表补丁不存在");
    }
    const subscription = store.scheduleSubscriptions.find((item) => item.id === patch.subscriptionId) || null;
    if (!subscription || subscription.subscriberUserId !== user.userId) {
      return toApiError(403, "PATCH_FORBIDDEN", "不能操作其他人的补丁");
    }
    store.schedulePatches = store.schedulePatches.filter((item) => item.id !== patchId);
    store.scheduleConflicts.forEach((conflict) => {
      if (
        conflict.subscriptionId === subscription.id &&
        conflict.entryId === patch.entryId &&
        conflict.resolutionStatus === "pending"
      ) {
        conflict.resolutionStatus = "relinked";
      }
    });
    if (!store.schedulePatches.some((item) => item.subscriptionId === subscription.id)) {
      subscription.followMode = "following";
      const schedule = store.schedules.find((item) => item.id === subscription.sourceScheduleId) || null;
      if (schedule?.publishedVersionNo) {
        subscription.baseVersionNo = schedule.publishedVersionNo;
      }
    }
    appendAudit("schedule_patch_relink", user.userId, { patchId, subscriptionId: subscription.id });
    return ok({ relinked: true, subscription });
  }

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
    if (existing) {
      existing.gridId = approx.gridId;
      existing.latitudeApprox = approx.latitudeApprox;
      existing.longitudeApprox = approx.longitudeApprox;
      existing.updatedAt = storeHelpers.nowIso();
      existing.stale = false;
    } else {
      const nextGrid: LocationGridRecord = {
        userId: user.userId,
        gridId: approx.gridId,
        latitudeApprox: approx.latitudeApprox,
        longitudeApprox: approx.longitudeApprox,
        updatedAt: storeHelpers.nowIso(),
        stale: false,
      };
      store.locationGrids.push(nextGrid);
    }
    appendAudit("location_update_grid", user.userId, { gridId: approx.gridId });
    return ok({
      gridId: approx.gridId,
      latitudeApprox: approx.latitudeApprox,
      longitudeApprox: approx.longitudeApprox,
      updatedAt: storeHelpers.nowIso(),
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
          distanceLevel: distanceKm < 0 ? ("far" as DistanceLevel) : toDistanceLevel(distanceKm),
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
        const detail = serializeCampaignDetail(item, user.userId, "");
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
      deadlineAtIso: resolveCampaignDeadlineIsoV1(asString(body.deadlineAtIso)),
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
    return ok(serializeCampaignDetail(campaign, user.userId, shareToken));
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
    return ok(serializeCampaignDetail(campaign, user.userId, ""));
  }

  const foodCampaignCloseMatch = path.match(/^food-campaigns\/([^/]+)\/close$/);
  if (method === "POST" && foodCampaignCloseMatch) {
    const campaignId = decodeURIComponent(foodCampaignCloseMatch[1]);
    const context = requireUser(event);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "投票活动不存在");
    }
    if (campaign.createdByUserId !== context.user.userId && !isAdminRole(context.user)) {
      return toApiError(403, "FOOD_CAMPAIGN_CLOSE_FORBIDDEN", "仅创建者或管理员可以结束投票");
    }
    campaign.status = "closed";
    campaign.updatedAt = storeHelpers.nowIso();
    appendAudit("food_campaign_close", context.user.userId, { campaignId });
    return ok(serializeCampaignDetail(campaign, context.user.userId, campaign.shareToken));
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
      voteCount: resolveCampaignVotes(item.id).length,
    }));
    return ok({ items });
  }

  if (method === "GET" && path === "admin/classes") {
    requireAdmin(event);
    const items = store.classes.map((classItem) => {
      const members = store.classMembers.filter((member) => member.classId === classItem.id);
      return {
        classId: classItem.id,
        classLabel: classItem.name,
        currentCode: classItem.activeJoinCode,
        active: classItem.status === "active",
        memberCount: members.length,
        subscriberCount: store.scheduleSubscriptions.filter((subscription) => {
          const schedule = store.schedules.find((scheduleItem) => scheduleItem.id === subscription.sourceScheduleId) || null;
          return schedule?.classId === classItem.id;
        }).length,
      };
    });
    return ok({ items });
  }

  if (method === "POST" && path === "admin/classes") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ classLabel?: string; active?: boolean; ownerStudentNo?: string }>(event);
    const classLabel = asString(body.classLabel);
    if (!classLabel) {
      return toApiError(400, "CLASS_LABEL_REQUIRED", "classLabel 不能为空");
    }
    const ownerStudentNo = asString(body.ownerStudentNo);
    const owner = ownerStudentNo ? store.users.find((item) => item.studentNo === ownerStudentNo) || null : user;
    if (!owner) {
      return toApiError(400, "CLASS_OWNER_NOT_FOUND", "班级负责人不存在");
    }
    const classId = storeHelpers.createId("class");
    const classItem: ClassRecord = {
      id: classId,
      name: classLabel,
      ownerUserId: owner.userId,
      timezone: "Asia/Shanghai",
      status: body.active === false ? "inactive" : "active",
      activeJoinCode: storeHelpers.generateJoinCode(),
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.classes.push(classItem);
    store.classMembers.push({
      id: storeHelpers.createId("class_member"),
      classId,
      userId: owner.userId,
      classRole: "class_owner",
      joinedAt: storeHelpers.nowIso(),
    });
    ensureUniquePush(owner.classIds, classId);
    appendAudit("admin_class_create", user.userId, {
      classId,
      classLabel,
      ownerUserId: owner.userId,
    });
    return ok({
      classId,
      classLabel,
      currentCode: classItem.activeJoinCode,
      active: classItem.status === "active",
    });
  }

  const adminClassUpdateMatch = path.match(/^admin\/classes\/([^/]+)\/update$/);
  if (method === "POST" && adminClassUpdateMatch) {
    const { user } = requireAdmin(event);
    const classId = decodeURIComponent(adminClassUpdateMatch[1]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    const body = await readJsonBody<{
      classLabel?: string;
      timezone?: string;
      active?: boolean;
      ownerStudentNo?: string;
    }>(event);
    const classLabel = asString(body.classLabel);
    const timezone = asString(body.timezone);
    const ownerStudentNo = asString(body.ownerStudentNo);
    if (classLabel) {
      classItem.name = classLabel;
    }
    if (timezone) {
      classItem.timezone = timezone;
    }
    if (typeof body.active === "boolean") {
      classItem.status = body.active ? "active" : "inactive";
    }
    if (ownerStudentNo) {
      const owner = store.users.find((item) => item.studentNo === ownerStudentNo) || null;
      if (!owner) {
        return toApiError(400, "CLASS_OWNER_NOT_FOUND", "班级负责人不存在");
      }
      classItem.ownerUserId = owner.userId;
      const ownerMembership = store.classMembers.find((item) => item.classId === classId && item.userId === owner.userId);
      if (!ownerMembership) {
        store.classMembers.push({
          id: storeHelpers.createId("class_member"),
          classId,
          userId: owner.userId,
          classRole: "class_owner",
          joinedAt: storeHelpers.nowIso(),
        });
      } else {
        ownerMembership.classRole = "class_owner";
      }
      ensureUniquePush(owner.classIds, classId);
      owner.updatedAt = storeHelpers.nowIso();
    }
    classItem.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_class_update", user.userId, { classId });
    return ok({
      classId: classItem.id,
      classLabel: classItem.name,
      timezone: classItem.timezone,
      active: classItem.status === "active",
      ownerUserId: classItem.ownerUserId,
      currentCode: classItem.activeJoinCode,
      updatedAt: classItem.updatedAt,
    });
  }

  const adminClassRotateMatch = path.match(/^admin\/classes\/([^/]+)\/rotate-code$/);
  if (method === "POST" && adminClassRotateMatch) {
    const { user } = requireAdmin(event);
    const classId = decodeURIComponent(adminClassRotateMatch[1]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    classItem.activeJoinCode = storeHelpers.generateJoinCode();
    classItem.updatedAt = storeHelpers.nowIso();
    appendAudit("admin_class_rotate_code", user.userId, { classId });
    return ok({
      classId,
      currentCode: classItem.activeJoinCode,
      updatedAt: classItem.updatedAt,
    });
  }

  const adminClassMembersMatch = path.match(/^admin\/classes\/([^/]+)\/members$/);
  if (method === "GET" && adminClassMembersMatch) {
    requireAdmin(event);
    const classId = decodeURIComponent(adminClassMembersMatch[1]);
    const classItem = store.classes.find((item) => item.id === classId) || null;
    if (!classItem) {
      return toApiError(404, "CLASS_NOT_FOUND", "班级不存在");
    }
    const members = store.classMembers
      .filter((item) => item.classId === classId)
      .map((item) => {
        const user = store.users.find((userItem) => userItem.userId === item.userId) || null;
        return {
          memberId: item.id,
          classRole: item.classRole,
          joinedAt: item.joinedAt,
          studentId: user?.studentId || "",
          studentNo: user?.studentNo || "",
          name: user?.name || user?.nickname || item.userId,
          classLabel: user?.classLabel || classItem.name,
          userId: item.userId,
        };
      });
    const scheduleIds = store.schedules.filter((item) => item.classId === classId).map((item) => item.id);
    const subscribers = store.scheduleSubscriptions
      .filter((item) => scheduleIds.includes(item.sourceScheduleId))
      .map((item) => store.users.find((userItem) => userItem.userId === item.subscriberUserId) || null)
      .filter((item): item is UserRecord => Boolean(item))
      .map((item) => ({
        userId: item.userId,
        studentId: item.studentId || "",
        studentNo: item.studentNo,
        name: item.name || item.nickname,
        classLabel: item.classLabel || "",
      }));
    return ok({
      item: {
        classId: classItem.id,
        classLabel: classItem.name,
        currentCode: classItem.activeJoinCode,
        active: classItem.status === "active",
        memberCount: members.length,
        subscriberCount: subscribers.length,
        members,
      },
      subscribers,
    });
  }

  if (method === "GET" && path === "admin/media-assets") {
    requireAdmin(event);
    const ownerUserId = asString(query.ownerUserId || query.owner_user_id);
    const usage = asString(query.usage);
    const items = store.mediaAssets.filter((item) => {
      if (ownerUserId && item.ownerUserId !== ownerUserId) {
        return false;
      }
      if (usage && item.usage !== usage) {
        return false;
      }
      return true;
    });
    return ok({ items });
  }

  if (method === "POST" && path === "media/assets") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      usage?: "avatar" | "wallpaper" | "other";
      mime?: string;
      size?: number;
      fileName?: string;
    }>(event);
    const usage: "avatar" | "wallpaper" | "other" =
      body.usage === "avatar" || body.usage === "wallpaper" ? body.usage : "other";
    const fileName = asString(body.fileName) || `${storeHelpers.createId("upload")}.bin`;
    const mime = asString(body.mime) || "application/octet-stream";
    const size = Math.max(0, Number(body.size || 0));
    const id = storeHelpers.createId("media");
    const asset: MediaAssetRecord = {
      id,
      ownerUserId: user.userId,
      usage,
      objectKey: `${usage}/${id}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      url: `/media/${id}`,
      mime,
      size,
      referenced: false,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.mediaAssets.unshift(asset);
    appendAudit("media_asset_create", user.userId, { mediaId: id, usage });
    return ok({ asset });
  }

  if (method === "POST" && path === "me/profile/media") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ avatarAssetId?: string; wallpaperAssetId?: string }>(event);
    const avatarAssetId = asString(body.avatarAssetId);
    const wallpaperAssetId = asString(body.wallpaperAssetId);
    if (avatarAssetId) {
      const avatar = store.mediaAssets.find((item) => item.id === avatarAssetId) || null;
      if (!avatar) {
        return toApiError(404, "AVATAR_ASSET_NOT_FOUND", "头像资源不存在");
      }
      user.avatarUrl = avatar.url;
      avatar.referenced = true;
      avatar.updatedAt = storeHelpers.nowIso();
    }
    if (wallpaperAssetId) {
      const wallpaper = store.mediaAssets.find((item) => item.id === wallpaperAssetId) || null;
      if (!wallpaper) {
        return toApiError(404, "WALLPAPER_ASSET_NOT_FOUND", "壁纸资源不存在");
      }
      user.wallpaperUrl = wallpaper.url;
      wallpaper.referenced = true;
      wallpaper.updatedAt = storeHelpers.nowIso();
    }
    user.updatedAt = storeHelpers.nowIso();
    appendAudit("profile_media_update", user.userId, {
      avatarAssetId,
      wallpaperAssetId,
    });
    return ok({ user: toUserPayload(user) });
  }

  if (method === "POST" && path === "admin/media-assets/reconcile") {
    const { user } = requireAdmin(event);
    const referencedSet = new Set<string>();
    store.users.forEach((item) => {
      if (item.avatarUrl) {
        referencedSet.add(item.avatarUrl);
      }
      if (item.wallpaperUrl) {
        referencedSet.add(item.wallpaperUrl);
      }
    });
    let updated = 0;
    store.mediaAssets.forEach((asset) => {
      const next = referencedSet.has(asset.url);
      if (asset.referenced !== next) {
        asset.referenced = next;
        asset.updatedAt = storeHelpers.nowIso();
        updated += 1;
      }
    });
    appendAudit("admin_media_reconcile", user.userId, { updated });
    return ok({ updated });
  }

  if (method === "POST" && path === "admin/media-assets/cleanup") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ onlyOrphans?: boolean; olderThanHours?: number }>(event);
    const onlyOrphans = body.onlyOrphans !== false;
    const olderThanHours = Math.max(0, Number(body.olderThanHours || 24));
    const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
    const before = store.mediaAssets.length;
    const removedAssets = store.mediaAssets.filter((item) => {
      const createdAt = Date.parse(item.createdAt);
      const expired = Number.isFinite(createdAt) ? createdAt <= cutoff : true;
      if (!expired) {
        return false;
      }
      if (onlyOrphans) {
        return !item.referenced;
      }
      return true;
    });
    store.mediaAssets = store.mediaAssets.filter((item) => !removedAssets.includes(item));
    const removed = before - store.mediaAssets.length;
    appendAudit("admin_media_cleanup", user.userId, { removed, onlyOrphans, olderThanHours });
    return ok({ removed, removedAssets });
  }

  if (method === "GET" && path === "bot/templates") {
    requireAdmin(event);
    return ok({
      items: store.botTemplates.map((item) => ({ ...item })),
    });
  }

  if (method === "POST" && path === "bot/templates") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ id?: string; key?: string; title?: string; body?: string; enabled?: boolean }>(event);
    const id = asString(body.id);
    const key = asString(body.key);
    const title = asString(body.title);
    const content = asString(body.body);
    const enabled = body.enabled !== false;
    if (!key || !title || !content) {
      return toApiError(400, "BOT_TEMPLATE_INVALID", "模板需要 key/title/body");
    }
    let template = id ? store.botTemplates.find((item) => item.id === id) || null : null;
    if (!template) {
      template = {
        id: storeHelpers.createId("bot_tpl"),
        key,
        title,
        body: content,
        enabled,
        updatedAt: storeHelpers.nowIso(),
      };
      store.botTemplates.push(template);
    } else {
      template.key = key;
      template.title = title;
      template.body = content;
      template.enabled = enabled;
      template.updatedAt = storeHelpers.nowIso();
    }
    appendAudit("bot_template_save", user.userId, { templateId: template.id, key: template.key });
    return ok({ template });
  }

  if (method === "POST" && path === "bot/jobs/trigger-next-day") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ rainy?: boolean; date?: string }>(event);
    const targetDate = body.date ? new Date(body.date) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nextDay = collectNextDaySuggestions(store, {
      targetDate,
      rainy: body.rainy,
    });
    const job: BotJobRecord = {
      id: storeHelpers.createId("bot_job"),
      type: "next_day_broadcast",
      status: "done",
      createdBy: user.userId,
      createdAt: storeHelpers.nowIso(),
      finishedAt: storeHelpers.nowIso(),
      summary: `已生成 ${nextDay.userCount} 位用户的次日建议`,
      suggestions: nextDay.suggestions,
    };
    store.botJobs.unshift(job);
    appendAudit("bot_job_trigger_next_day", user.userId, { jobId: job.id, userCount: nextDay.userCount });
    return ok({ job });
  }

  if (method === "POST" && path === "bot/jobs/heartbeat") {
    const body = await readJsonBody<{
      timezone?: string;
      nowIso?: string;
      rainy?: boolean;
      force?: boolean;
      dryRun?: boolean;
      runNextDay?: boolean;
    }>(event);
    const config = useRuntimeConfig(event) as Record<string, unknown>;
    const heartbeatToken = asString(getHeader(event, HEARTBEAT_TOKEN_HEADER));
    const configuredHeartbeatToken = asString(config.heartbeatToken);
    const hasBearerAuth = Boolean(getBearerToken(event));
    const db = resolveReminderDbFromEvent(event);
    if (!db) {
      return toApiError(500, "REMINDER_DB_NOT_CONFIGURED", "提醒数据库未配置");
    }

    let caller: "cron" | "admin" = "cron";
    let actorUserId = store.users.find((item) => item.adminRole === "super_admin")?.userId || store.users[0]?.userId || "system_cron";
    if (configuredHeartbeatToken) {
      if (heartbeatToken === configuredHeartbeatToken) {
        caller = "cron";
      } else if (heartbeatToken && heartbeatToken !== configuredHeartbeatToken && !hasBearerAuth) {
        return toApiError(401, "HEARTBEAT_TOKEN_INVALID", "heartbeat token 无效");
      } else {
        const adminContext = requireAdmin(event);
        caller = "admin";
        actorUserId = adminContext.user.userId;
      }
    } else {
      const adminContext = requireAdmin(event);
      caller = "admin";
      actorUserId = adminContext.user.userId;
    }
    const timezone = asString(body.timezone || config.heartbeatTimezone || "Asia/Shanghai");
    let result;
    try {
      result = await runReminderHeartbeat(db, {
        nowIso: body.nowIso,
        timezone,
        rainy: body.rainy,
        force: body.force === true,
        dryRun: body.dryRun === true,
        runNextDay: body.runNextDay === true,
        actorUserId,
        caller,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "HEARTBEAT_NOW_INVALID") {
        return toApiError(400, "HEARTBEAT_NOW_INVALID", "nowIso 无效");
      }
      throw error;
    }

    if (!result.dryRun && !result.skipped) {
      appendAudit("bot_job_heartbeat", actorUserId, {
        triggerKey: result.triggerKey,
        caller,
        timezone: result.timezone,
        inWindow: result.inWindow,
        shouldRunNextDay: result.shouldRunNextDay,
        dryRun: result.dryRun,
        queuedCounts: result.queuedCounts,
      });
    }

    return ok({
      ...result,
      window: "08:00-23:59",
    });
  }

  if (method === "GET" && path === "bot/deliveries/pending") {
    const config = useRuntimeConfig(event) as Record<string, unknown>;
    const configuredToken = asString(config.botDeliveryToken);
    if (!configuredToken) {
      return toApiError(503, "BOT_DELIVERY_TOKEN_NOT_CONFIGURED", "机器人投递 token 未配置");
    }
    if (!requireBotDeliveryToken(event, configuredToken)) {
      return toApiError(401, "BOT_DELIVERY_TOKEN_INVALID", `${getBotDeliveryTokenHeader()} 无效`);
    }
    const db = resolveReminderDbFromEvent(event);
    if (!db) {
      return toApiError(500, "REMINDER_DB_NOT_CONFIGURED", "提醒数据库未配置");
    }
    const parsedLimit = Number(query.limit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.trunc(parsedLimit))) : 20;
    const items = await pullPendingReminderDeliveries(db, { limit });
    return ok({ items, total: items.length, limit });
  }

  const botDeliveryAckMatch = path.match(/^bot\/deliveries\/([^/]+)\/ack$/);
  if (method === "POST" && botDeliveryAckMatch) {
    const config = useRuntimeConfig(event) as Record<string, unknown>;
    const configuredToken = asString(config.botDeliveryToken);
    if (!configuredToken) {
      return toApiError(503, "BOT_DELIVERY_TOKEN_NOT_CONFIGURED", "机器人投递 token 未配置");
    }
    if (!requireBotDeliveryToken(event, configuredToken)) {
      return toApiError(401, "BOT_DELIVERY_TOKEN_INVALID", `${getBotDeliveryTokenHeader()} 无效`);
    }
    const db = resolveReminderDbFromEvent(event);
    if (!db) {
      return toApiError(500, "REMINDER_DB_NOT_CONFIGURED", "提醒数据库未配置");
    }
    const body = await readJsonBody<{
      success?: boolean;
      status?: "sent" | "failed";
      externalMessageId?: string;
      errorMessage?: string;
    }>(event);
    const deliveryId = decodeURIComponent(botDeliveryAckMatch[1]);
    const updated = await ackReminderDelivery(db, deliveryId, body);
    if (!updated) {
      return toApiError(404, "BOT_DELIVERY_NOT_FOUND", "待发送消息不存在");
    }
    return ok({ deliveryId, status: body.status || (body.success === false ? "failed" : "sent") });
  }

  if (method === "GET" && path === "bot/jobs/history") {
    requireAdmin(event);
    const { limit } = parsePagination(query as Record<string, unknown>);
    return ok({
      items: store.botJobs.slice(0, limit),
      total: store.botJobs.length,
    });
  }

  if (method === "GET" && path === "admin/preview/profile-card") {
    requireAdmin(event);
    const studentNo = asString(query.studentNo || query.student_no);
    const user = store.users.find((item) => item.studentNo === studentNo) || null;
    if (!user) {
      return toApiError(404, "PREVIEW_USER_NOT_FOUND", "未找到对应学号用户");
    }
    const classes = store.classMembers
      .filter((item) => item.userId === user.userId)
      .map((item) => {
        const classItem = store.classes.find((classRow) => classRow.id === item.classId) || null;
        return {
          classId: item.classId,
          classLabel: classItem?.name || "",
          classRole: item.classRole,
        };
      });
    return ok({
      studentNo: user.studentNo,
      studentId: user.studentId || "",
      name: toUserPayload(user).name,
      avatarUrl: user.avatarUrl,
      wallpaperUrl: user.wallpaperUrl,
      classLabel: user.classLabel || "",
      classes,
    });
  }

  if (method === "GET" && path === "admin/preview/class-subscriptions") {
    requireAdmin(event);
    const studentNo = asString(query.studentNo || query.student_no);
    const user = store.users.find((item) => item.studentNo === studentNo) || null;
    if (!user) {
      return toApiError(404, "PREVIEW_USER_NOT_FOUND", "未找到对应学号用户");
    }
    const { memberships, subscriptions } = summarizeClassSubscriptionsForUser(store, user);
    const repairableSubscriptionIds = findStaleOwnScheduleSubscriptionIds(store, user);
    return ok({
      studentNo,
      memberships,
      subscriptions,
      repairableSubscriptionIds,
    });
  }

  if (method === "POST" && path === "admin/preview/class-subscriptions/repair") {
    const { user: adminUser } = requireScheduleImportAccess(event);
    const body = await readJsonBody<{ studentNo?: string; student_no?: string; dryRun?: boolean }>(event);
    const studentNo = asString(body.studentNo || body.student_no);
    if (!studentNo) {
      return toApiError(400, "REPAIR_STUDENT_NO_REQUIRED", "studentNo 不能为空");
    }
    const user = store.users.find((item) => item.studentNo === studentNo) || null;
    if (!user) {
      return toApiError(404, "REPAIR_USER_NOT_FOUND", "未找到对应学号用户");
    }
    const removableSubscriptionIds = new Set(findStaleOwnScheduleSubscriptionIds(store, user));
    const before = summarizeClassSubscriptionsForUser(store, user);
    if (body.dryRun === false && removableSubscriptionIds.size > 0) {
      store.scheduleSubscriptions = store.scheduleSubscriptions.filter((item) => !removableSubscriptionIds.has(item.id));
      store.schedulePatches = store.schedulePatches.filter((item) => !removableSubscriptionIds.has(item.subscriptionId));
      store.scheduleConflicts = store.scheduleConflicts.filter((item) => !removableSubscriptionIds.has(item.subscriptionId));
      appendAudit("admin_repair_class_subscriptions", adminUser.userId, {
        studentNo,
        removedSubscriptionIds: Array.from(removableSubscriptionIds.values()),
      });
    }
    const after = summarizeClassSubscriptionsForUser(store, user);
    return ok({
      studentNo,
      dryRun: body.dryRun !== false,
      removedSubscriptionIds: Array.from(removableSubscriptionIds.values()),
      before,
      after,
    });
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
      detail: serializeCampaignDetail(campaign, user.userId, shareToken),
    });
  }

  if (method === "GET" && path === "admin/audit") {
    requireAdmin(event);
    const { limit, offset } = parsePagination(query as Record<string, unknown>);
    return ok({
      items: store.auditLogs.slice(offset, offset + limit),
      total: store.auditLogs.length,
      limit,
      offset,
    });
  }

  const scheduleIcsMatch = path.match(/^schedules\/([^/]+)\/ics$/);
  if (method === "GET" && scheduleIcsMatch) {
    requireUser(event);
    const scheduleId = decodeURIComponent(scheduleIcsMatch[1]);
    const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
    if (!schedule) {
      return toApiError(404, "SCHEDULE_NOT_FOUND", "课表不存在");
    }
    const publishedVersion = getPublishedScheduleVersion(schedule.id, schedule.publishedVersionNo);
    if (!publishedVersion) {
      return toApiError(400, "SCHEDULE_NOT_PUBLISHED", "课表尚未发布，无法导出 ICS");
    }
    const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
    const timezone = classItem?.timezone || "Asia/Shanghai";
    const content = toIcsContent(schedule, publishedVersion, timezone);
    setHeader(event, "content-type", "text/calendar; charset=utf-8");
    setHeader(event, "content-disposition", `attachment; filename=\"${encodeURIComponent(schedule.title)}.ics\"`);
    return content;
  }

  const meProfileMatch = path === "me/profile";
  if (method === "GET" && meProfileMatch) {
    const { user } = requireUser(event);
    return ok({
      user: toUserPayload(user),
    });
  }

  return toApiError(404, "API_ROUTE_NOT_FOUND", `未匹配 API 路由: ${method} ${path}`);
};

export const handleV1ApiWithErrorBoundary = async (event: H3Event) => {
  try {
    return await handleV1Api(event);
  } catch (error) {
    const candidate = error as {
      statusCode?: number;
      statusMessage?: string;
      message?: string;
      data?: { message?: string; detail?: string; error?: { message?: string } };
    };
    const statusCode = Number(candidate?.statusCode || 500);
    if (candidate?.data) {
      setResponseStatus(event, statusCode);
      return candidate.data;
    }
    const message =
      asString(candidate?.message) ||
      asString(candidate?.statusMessage) ||
      asString(candidate?.data?.message) ||
      asString(candidate?.data?.detail) ||
      asString(candidate?.data?.error?.message) ||
      "服务器内部错误";
    setResponseStatus(event, statusCode);
    return fail({
      code: statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED",
      message,
      details: {
        path: getRequestURL(event).pathname,
      },
    });
  }
};
