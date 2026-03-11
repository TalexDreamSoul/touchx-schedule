import type {
  AdminRole,
  ClassRole,
  FollowMode,
  LocationGrid,
  ScheduleConflict,
  SchedulePatch,
  ScheduleSubscription,
  SmartSuggestionItem,
  StudentIdentity,
} from "@touchx/shared";
import legacyUsersData from "../data/legacy/users.normalized.json";
import legacyCoursesData from "../data/legacy/courses.normalized.json";
import legacyFoodsSeedData from "../data/legacy/foods.seed.json";

export interface UserRecord extends StudentIdentity {
  nickname: string;
  avatarUrl: string;
  wallpaperUrl: string;
  classIds: string[];
  adminRole: AdminRole;
  reminderEnabled: boolean;
  reminderWindowMinutes: number[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionRecord {
  token: string;
  userId: string;
  role: "admin" | "user";
  expiresAt: number;
  createdAt: string;
}

export interface ClassRecord {
  id: string;
  name: string;
  ownerUserId: string;
  timezone: string;
  status: "active" | "inactive";
  activeJoinCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassMemberRecord {
  id: string;
  classId: string;
  userId: string;
  classRole: ClassRole;
  joinedAt: string;
}

export interface ScheduleEntryRecord {
  id: string;
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity: "all" | "odd" | "even";
  courseName: string;
  classroom: string;
  teacher: string;
}

export interface ScheduleVersionRecord {
  id: string;
  scheduleId: string;
  versionNo: number;
  status: "draft" | "published";
  entries: ScheduleEntryRecord[];
  createdByUserId: string;
  createdAt: string;
}

export interface ScheduleRecord {
  id: string;
  classId: string;
  title: string;
  description: string;
  publishedVersionNo: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationGridRecord extends LocationGrid {
  userId: string;
}

export interface FoodItemRecord {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  merchantName: string;
  latitude: number;
  longitude: number;
  priceMin: number;
  priceMax: number;
  caloriesKcal: number;
}

export interface FoodCampaignRecord {
  id: string;
  title: string;
  status: "open" | "closed";
  classId?: string;
  createdByUserId: string;
  deadlineAtIso: string;
  shareToken: string;
  isAnonymous: boolean;
  revealAfterClose: boolean;
  revealScope: "share_token" | "public";
  optionFoodIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FoodCampaignVoteRecord {
  id: string;
  campaignId: string;
  userId: string;
  foodId: string;
  score: number;
  createdAt: string;
}

export interface FoodPricingRuleRecord {
  categoryKey: string;
  categoryName: string;
  trendMode: "down" | "up";
  anchorHeadcount: number;
  slope: number;
  minFactor: number;
  maxFactor: number;
  updatedAt: string;
}

export interface FoodPricingRuleVersionRecord {
  versionId: string;
  categoryKey: string;
  categoryName: string;
  trendMode: "down" | "up";
  anchorHeadcount: number;
  slope: number;
  minFactor: number;
  maxFactor: number;
  createdAt: string;
}

export interface FoodPricingOverrideVersionRecord {
  versionId: string;
  foodId: string;
  categoryKey: string;
  priceMin: number;
  priceMax: number;
  reason: string;
  createdAt: string;
}

export interface MediaAssetRecord {
  id: string;
  ownerUserId: string;
  usage: "avatar" | "wallpaper" | "other";
  objectKey: string;
  url: string;
  mime: string;
  size: number;
  referenced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotTemplateRecord {
  id: string;
  key: string;
  title: string;
  body: string;
  enabled: boolean;
  updatedAt: string;
}

export interface BotJobRecord {
  id: string;
  type: "next_day_broadcast" | "manual_trigger" | "heartbeat_tick";
  status: "pending" | "done" | "failed";
  createdBy: string;
  createdAt: string;
  finishedAt?: string;
  summary: string;
  suggestions: SmartSuggestionItem[];
}

export interface AuditLogRecord {
  id: string;
  action: string;
  actorUserId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PartyGameRoomRecord {
  id: string;
  roomCode: string;
  gameKey: string;
  title: string;
  status: "waiting" | "playing" | "finished" | "closed";
  hostUserId: string;
  maxPlayers: number;
  createdAt: string;
  updatedAt: string;
}

export interface PartyGameMemberRecord {
  id: string;
  roomId: string;
  userId: string;
  nickname: string;
  ready: boolean;
  online: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
}

export interface PartyGameStateRecord {
  roomId: string;
  version: number;
  data: Record<string, unknown>;
  updatedByUserId: string;
  updatedAt: string;
}

export interface PartyGameEventRecord {
  id: string;
  roomId: string;
  seq: number;
  type: string;
  actorUserId: string;
  clientActionId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const FOOD_CAMPAIGN_OPTION_LIMIT = 3;
export const DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO = "2305100613";

export interface NexusStore {
  users: UserRecord[];
  classes: ClassRecord[];
  classMembers: ClassMemberRecord[];
  schedules: ScheduleRecord[];
  scheduleVersions: ScheduleVersionRecord[];
  scheduleSubscriptions: ScheduleSubscription[];
  schedulePatches: SchedulePatch[];
  scheduleConflicts: ScheduleConflict[];
  sessions: AuthSessionRecord[];
  locationGrids: LocationGridRecord[];
  foodItems: FoodItemRecord[];
  foodCampaigns: FoodCampaignRecord[];
  foodCampaignVotes: FoodCampaignVoteRecord[];
  foodPricingRules: FoodPricingRuleRecord[];
  foodPricingRuleVersions: FoodPricingRuleVersionRecord[];
  foodPricingOverrideVersions: FoodPricingOverrideVersionRecord[];
  mediaAssets: MediaAssetRecord[];
  botTemplates: BotTemplateRecord[];
  botJobs: BotJobRecord[];
  auditLogs: AuditLogRecord[];
  partyGameRooms: PartyGameRoomRecord[];
  partyGameMembers: PartyGameMemberRecord[];
  partyGameStates: PartyGameStateRecord[];
  partyGameEvents: PartyGameEventRecord[];
}

interface LegacyUserRow {
  student_id?: string;
  name?: string;
  student_no?: string;
  class_label?: string;
  course_source_student_id?: string;
  built_in?: string;
}

interface LegacyCourseRow {
  term?: string;
  student_id?: string;
  student_name?: string;
  student_no?: string;
  course_id?: string;
  course_name?: string;
  day?: string;
  day_label?: string;
  start_section?: string;
  end_section?: string;
  start_time?: string;
  end_time?: string;
  week_expr?: string;
  parity?: string;
  classroom?: string;
  teacher?: string;
  teaching_classes?: string;
}

interface LegacyFoodSeedRow {
  food_key?: string;
  name?: string;
  category_key?: string;
  brand_key?: string;
  brand_name?: string;
  daily_price_min?: number;
  daily_price_max?: number;
  distance_km?: number;
}

const GLOBAL_KEY = "__touchx_schedule_nexus_store__";

const nowIso = () => new Date().toISOString();

const createId = (prefix: string) => {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
};

const generateJoinCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let index = 0; index < 8; index += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
};

const generateShareToken = () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 10; index += 1) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
};

const cloneRuleAsVersion = (rule: FoodPricingRuleRecord): FoodPricingRuleVersionRecord => {
  return {
    versionId: createId("pricing_rule_ver"),
    categoryKey: rule.categoryKey,
    categoryName: rule.categoryName,
    trendMode: rule.trendMode,
    anchorHeadcount: rule.anchorHeadcount,
    slope: rule.slope,
    minFactor: rule.minFactor,
    maxFactor: rule.maxFactor,
    createdAt: nowIso(),
  };
};

const asText = (value: unknown) => String(value ?? "").trim();

const toInteger = (value: unknown, fallback = 0) => {
  const parsed = Number(asText(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const toParity = (value: unknown): "all" | "odd" | "even" => {
  const text = asText(value).toLowerCase();
  if (text === "odd" || text === "even" || text === "all") {
    return text;
  }
  return "all";
};

const splitTeachingClasses = (value: unknown) => {
  return asText(value)
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
};

const legacyUsers = (Array.isArray(legacyUsersData) ? legacyUsersData : []) as LegacyUserRow[];
const legacyCourses = (Array.isArray(legacyCoursesData) ? legacyCoursesData : []) as LegacyCourseRow[];
const legacyFoodSeeds = (Array.isArray(legacyFoodsSeedData) ? legacyFoodsSeedData : []) as LegacyFoodSeedRow[];

const LEGACY_CATEGORY_NAME_MAP: Record<string, string> = {
  stir_fry: "炒菜",
  maocai: "冒菜",
  hotpot: "火锅",
  grill: "烧烤",
  noodle: "面食",
  rice: "米饭",
  breakfast: "早餐",
  afternoon_tea: "下午茶",
  drink: "饮品",
  midnight_snack: "夜宵",
  takeout: "外卖",
};

const LEGACY_CATEGORY_CALORIES_BASE: Record<string, number> = {
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

const clampNumber = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const stableHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const mapDistanceToCoordinates = (foodKey: string, distanceKm: number) => {
  const baseLatitude = 31.2304;
  const baseLongitude = 121.4737;
  const normalizedDistanceKm = clampNumber(distanceKm, 0.1, 6);
  const angle = (stableHash(foodKey) % 360) * (Math.PI / 180);
  const latitudeOffset = (normalizedDistanceKm / 111) * Math.cos(angle);
  const longitudeOffset =
    (normalizedDistanceKm / (111 * Math.max(0.1, Math.cos((baseLatitude * Math.PI) / 180)))) * Math.sin(angle);
  return {
    latitude: Number((baseLatitude + latitudeOffset).toFixed(6)),
    longitude: Number((baseLongitude + longitudeOffset).toFixed(6)),
  };
};

const estimateCaloriesKcal = (categoryKey: string, priceMin: number, priceMax: number) => {
  const categoryBase = LEGACY_CATEGORY_CALORIES_BASE[categoryKey] ?? 560;
  const normalizedMin = Math.max(0, priceMin);
  const normalizedMax = Math.max(normalizedMin, priceMax);
  const averagePrice = (normalizedMin + normalizedMax) / 2;
  const estimated = categoryBase + Math.round((averagePrice - 14) * 16);
  return Math.round(clampNumber(estimated, 120, 1500));
};

const buildLegacyFoodSeeds = (): FoodItemRecord[] => {
  return legacyFoodSeeds
    .map((item) => {
      const foodKey = asText(item.food_key) || createId("legacy_food_key");
      const name = asText(item.name);
      const categoryKey = asText(item.category_key) || "uncategorized";
      if (!name) {
        return null;
      }
      const categoryName = LEGACY_CATEGORY_NAME_MAP[categoryKey] || categoryKey;
      const merchantName = asText(item.brand_name) || `${categoryName}档口`;
      const priceMin = Math.max(0, Number(item.daily_price_min) || 0);
      const priceMax = Math.max(priceMin, Number(item.daily_price_max) || priceMin);
      const distanceKm = Math.max(0.1, Number(item.distance_km) || 0.6);
      const coordinates = mapDistanceToCoordinates(foodKey, distanceKm);
      return {
        id: createId("food"),
        name,
        categoryKey,
        categoryName,
        merchantName,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        priceMin,
        priceMax,
        caloriesKcal: estimateCaloriesKcal(categoryKey, priceMin, priceMax),
      } satisfies FoodItemRecord;
    })
    .filter((item): item is FoodItemRecord => item !== null);
};

const mergeWithLegacyFoodSeeds = (foodItems: FoodItemRecord[]) => {
  const merged = [...foodItems];
  const dedupSet = new Set(
    foodItems.map((item) => `${item.name.trim().toLowerCase()}|${item.categoryKey.trim().toLowerCase()}`),
  );
  buildLegacyFoodSeeds().forEach((item) => {
    const dedupKey = `${item.name.trim().toLowerCase()}|${item.categoryKey.trim().toLowerCase()}`;
    if (dedupSet.has(dedupKey)) {
      return;
    }
    dedupSet.add(dedupKey);
    merged.push(item);
  });
  return merged;
};

const resolveLimitedCampaignOptionIds = (foodItems: FoodItemRecord[], rawOptionFoodIds: string[]) => {
  const fallbackOptionIds = foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id);
  if (fallbackOptionIds.length === 0) {
    return [] as string[];
  }
  const foodIdSet = new Set(foodItems.map((item) => item.id));
  const normalized: string[] = [];
  rawOptionFoodIds.forEach((value) => {
    const foodId = asText(value);
    if (!foodId || !foodIdSet.has(foodId) || normalized.includes(foodId)) {
      return;
    }
    normalized.push(foodId);
  });
  const picked = normalized.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT);
  if (picked.length > 0) {
    return picked;
  }
  return fallbackOptionIds;
};

const normalizeCampaignOptions = (store: NexusStore) => {
  const optionSetByCampaignId = new Map<string, Set<string>>();
  store.foodCampaigns.forEach((campaign) => {
    const normalized = resolveLimitedCampaignOptionIds(store.foodItems, campaign.optionFoodIds || []);
    campaign.optionFoodIds = normalized;
    optionSetByCampaignId.set(campaign.id, new Set(normalized));
  });
  store.foodCampaignVotes = store.foodCampaignVotes.filter((vote) => {
    const optionSet = optionSetByCampaignId.get(vote.campaignId);
    if (!optionSet) {
      return false;
    }
    return optionSet.has(vote.foodId);
  });
};

const buildStoreFromLegacyNormalized = (): NexusStore | null => {
  if (legacyUsers.length === 0) {
    return null;
  }

  const createdAt = nowIso();
  const normalizedUsers = legacyUsers
    .map((item) => ({
      studentId: asText(item.student_id),
      studentNo: asText(item.student_no),
      name: asText(item.name),
      classLabel: asText(item.class_label),
      courseSourceStudentId: asText(item.course_source_student_id),
    }))
    .filter((item) => item.studentId && item.studentNo && item.classLabel);

  if (normalizedUsers.length === 0) {
    return null;
  }

  const classLabels = Array.from(new Set(normalizedUsers.map((item) => item.classLabel)));
  if (classLabels.length === 0) {
    return null;
  }

  const userIdByStudentId = new Map<string, string>();
  const classIdByLabel = new Map<string, string>();
  const classOwnerStudentIdByLabel = new Map<string, string>();

  classLabels.forEach((label) => {
    const ownerRow =
      normalizedUsers.find((item) => item.classLabel === label && item.studentId === item.courseSourceStudentId) ||
      normalizedUsers.find((item) => item.classLabel === label) ||
      null;
    if (ownerRow) {
      classOwnerStudentIdByLabel.set(label, ownerRow.studentId);
    }
  });

  const sourceOwnerStudentIds = new Set(
    normalizedUsers.map((item) => item.courseSourceStudentId).filter((item) => item !== ""),
  );

  const hasConfiguredBootstrapAdmin = normalizedUsers.some(
    (item) => item.studentNo === DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO,
  );

  const users: UserRecord[] = normalizedUsers.map((item, index) => {
    const userId = createId("user");
    userIdByStudentId.set(item.studentId, userId);
    const adminRole: AdminRole =
      item.studentNo === DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO
        ? "super_admin"
        : !hasConfiguredBootstrapAdmin && index === 0
          ? "super_admin"
          : sourceOwnerStudentIds.has(item.studentId)
            ? "operator"
            : "none";
    return {
      userId,
      studentNo: item.studentNo,
      studentId: item.studentId,
      name: item.name || item.studentNo,
      classLabel: item.classLabel,
      nickname: item.name || item.studentNo,
      avatarUrl: "",
      wallpaperUrl: "",
      classIds: [],
      adminRole,
      reminderEnabled: true,
      reminderWindowMinutes: [30, 15],
      createdAt,
      updatedAt: createdAt,
    };
  });

  const classes: ClassRecord[] = classLabels.map((label) => {
    const classId = createId("class");
    classIdByLabel.set(label, classId);
    const ownerStudentId = classOwnerStudentIdByLabel.get(label) || "";
    const ownerUserId =
      (ownerStudentId ? userIdByStudentId.get(ownerStudentId) : undefined) ||
      users.find((item) => item.classLabel === label)?.userId ||
      users[0].userId;
    return {
      id: classId,
      name: label,
      ownerUserId,
      timezone: "Asia/Shanghai",
      status: "active",
      activeJoinCode: generateJoinCode(),
      createdAt,
      updatedAt: createdAt,
    };
  });

  users.forEach((user) => {
    const classId = classIdByLabel.get(user.classLabel || "");
    if (classId) {
      user.classIds = [classId];
    }
  });

  const classMembers: ClassMemberRecord[] = [];
  classes.forEach((classItem) => {
    users
      .filter((user) => user.classIds.includes(classItem.id))
      .forEach((user) => {
        classMembers.push({
          id: createId("class_member"),
          classId: classItem.id,
          userId: user.userId,
          classRole: user.userId === classItem.ownerUserId ? "class_owner" : "class_viewer",
          joinedAt: createdAt,
        });
      });
  });

  const normalizedCourses = legacyCourses
    .map((item) => ({
      studentId: asText(item.student_id),
      term: asText(item.term),
      courseId: asText(item.course_id),
      courseName: asText(item.course_name),
      day: toInteger(item.day, 0),
      startSection: toInteger(item.start_section, 0),
      endSection: toInteger(item.end_section, 0),
      weekExpr: asText(item.week_expr) || "1-20",
      parity: toParity(item.parity),
      classroom: asText(item.classroom),
      teacher: asText(item.teacher),
      teachingClasses: splitTeachingClasses(item.teaching_classes),
    }))
    .filter((item) => item.courseName && item.day > 0 && item.startSection > 0 && item.endSection >= item.startSection);

  const schedules: ScheduleRecord[] = [];
  const scheduleVersions: ScheduleVersionRecord[] = [];
  const scheduleSubscriptions: ScheduleSubscription[] = [];

  classes.forEach((classItem) => {
    const ownerStudentId = classOwnerStudentIdByLabel.get(classItem.name) || "";
    const matchedCourses = normalizedCourses.filter((item) => {
      if (item.teachingClasses.includes(classItem.name)) {
        return true;
      }
      return ownerStudentId ? item.studentId === ownerStudentId : false;
    });
    if (matchedCourses.length === 0) {
      return;
    }
    const uniqueMap = new Map<string, ScheduleEntryRecord>();
    matchedCourses.forEach((course) => {
      const key = [
        course.courseId,
        course.courseName,
        course.day,
        course.startSection,
        course.endSection,
        course.weekExpr,
        course.parity,
        course.classroom,
        course.teacher,
      ].join("|");
      if (uniqueMap.has(key)) {
        return;
      }
      uniqueMap.set(key, {
        id: createId("entry"),
        day: course.day,
        startSection: course.startSection,
        endSection: course.endSection,
        weekExpr: course.weekExpr,
        parity: course.parity,
        courseName: course.courseName,
        classroom: course.classroom,
        teacher: course.teacher,
      });
    });

    const entries = Array.from(uniqueMap.values()).sort((left, right) => {
      if (left.day !== right.day) {
        return left.day - right.day;
      }
      return left.startSection - right.startSection;
    });
    if (entries.length === 0) {
      return;
    }

    const scheduleId = createId("schedule");
    schedules.push({
      id: scheduleId,
      classId: classItem.id,
      title: `${classItem.name}课表`,
      description: `${matchedCourses[0]?.term || "标准学期"} 导入`,
      publishedVersionNo: 1,
      createdByUserId: classItem.ownerUserId,
      createdAt,
      updatedAt: createdAt,
    });

    scheduleVersions.push({
      id: createId("schedule_version"),
      scheduleId,
      versionNo: 1,
      status: "published",
      entries,
      createdByUserId: classItem.ownerUserId,
      createdAt,
    });

    classMembers
      .filter((member) => member.classId === classItem.id)
      .forEach((member) => {
        scheduleSubscriptions.push({
          id: createId("schedule_sub"),
          subscriberUserId: member.userId,
          sourceScheduleId: scheduleId,
          baseVersionNo: 1,
          followMode: "following",
          createdAt,
        });
      });
  });

  const foodItems: FoodItemRecord[] = mergeWithLegacyFoodSeeds([
    {
      id: createId("food"),
      name: "轻食鸡胸沙拉",
      categoryKey: "light-meal",
      categoryName: "轻食",
      merchantName: "轻食工坊",
      latitude: 31.2304,
      longitude: 121.4737,
      priceMin: 22,
      priceMax: 34,
      caloriesKcal: 420,
    },
    {
      id: createId("food"),
      name: "奶茶双拼",
      categoryKey: "drink",
      categoryName: "饮品",
      merchantName: "茶饮集合店",
      latitude: 31.2286,
      longitude: 121.4812,
      priceMin: 16,
      priceMax: 24,
      caloriesKcal: 340,
    },
    {
      id: createId("food"),
      name: "麻辣香锅",
      categoryKey: "main-meal",
      categoryName: "正餐",
      merchantName: "川味坊",
      latitude: 31.2248,
      longitude: 121.4699,
      priceMin: 28,
      priceMax: 48,
      caloriesKcal: 780,
    },
  ]);

  const baseRules: FoodPricingRuleRecord[] = [
    { categoryKey: "light-meal", categoryName: "轻食", trendMode: "down", anchorHeadcount: 8, slope: 0.05, minFactor: 0.82, maxFactor: 1.2, updatedAt: createdAt },
    { categoryKey: "drink", categoryName: "饮品", trendMode: "down", anchorHeadcount: 10, slope: 0.04, minFactor: 0.78, maxFactor: 1.18, updatedAt: createdAt },
    { categoryKey: "main-meal", categoryName: "正餐", trendMode: "down", anchorHeadcount: 12, slope: 0.03, minFactor: 0.8, maxFactor: 1.16, updatedAt: createdAt },
  ];

  const primaryClass = classes[0] || null;
  const primaryOperator = users.find((item) => item.adminRole !== "none") || users[0];
  const secondaryUser = users[1] || users[0];
  const defaultCampaign: FoodCampaignRecord = {
    id: createId("campaign"),
    title: "周五晚餐拼单",
    status: "open",
    classId: primaryClass?.id,
    createdByUserId: primaryOperator.userId,
    deadlineAtIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    shareToken: generateShareToken(),
    isAnonymous: true,
    revealAfterClose: true,
    revealScope: "share_token",
    optionFoodIds: foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id),
    createdAt,
    updatedAt: createdAt,
  };
  const closedCampaign: FoodCampaignRecord = {
    id: createId("campaign"),
    title: "上周末聚餐回顾",
    status: "closed",
    classId: primaryClass?.id,
    createdByUserId: primaryOperator.userId,
    deadlineAtIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    shareToken: generateShareToken(),
    isAnonymous: false,
    revealAfterClose: true,
    revealScope: "share_token",
    optionFoodIds: foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id),
    createdAt,
    updatedAt: createdAt,
  };

  const mediaAvatarId = createId("media");
  const mediaWallpaperId = createId("media");
  users[0].avatarUrl = `/media/${mediaAvatarId}`;
  users[0].wallpaperUrl = `/media/${mediaWallpaperId}`;

  return {
    users,
    classes,
    classMembers,
    schedules,
    scheduleVersions,
    scheduleSubscriptions,
    schedulePatches: [],
    scheduleConflicts: [],
    sessions: [],
    locationGrids: [
      {
        userId: primaryOperator.userId,
        gridId: "grid_31.23_121.47",
        latitudeApprox: 31.23,
        longitudeApprox: 121.47,
        updatedAt: createdAt,
        stale: false,
      },
    ],
    foodItems,
    foodCampaigns: [defaultCampaign, closedCampaign],
    foodCampaignVotes: [
      {
        id: createId("campaign_vote"),
        campaignId: closedCampaign.id,
        userId: primaryOperator.userId,
        foodId: foodItems[0].id,
        score: 1,
        createdAt,
      },
      {
        id: createId("campaign_vote"),
        campaignId: closedCampaign.id,
        userId: secondaryUser.userId,
        foodId: foodItems[2].id,
        score: 1,
        createdAt,
      },
    ],
    foodPricingRules: baseRules,
    foodPricingRuleVersions: baseRules.map((rule) => cloneRuleAsVersion(rule)),
    foodPricingOverrideVersions: [],
    mediaAssets: [
      {
        id: mediaAvatarId,
        ownerUserId: users[0].userId,
        usage: "avatar",
        objectKey: `avatars/${mediaAvatarId}.png`,
        url: `/media/${mediaAvatarId}`,
        mime: "image/png",
        size: 102400,
        referenced: true,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: mediaWallpaperId,
        ownerUserId: users[0].userId,
        usage: "wallpaper",
        objectKey: `wallpapers/${mediaWallpaperId}.jpg`,
        url: `/media/${mediaWallpaperId}`,
        mime: "image/jpeg",
        size: 504120,
        referenced: true,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    botTemplates: [
      { id: createId("bot_tpl"), key: "next_day_brief", title: "次日课表播报", body: "{{name}}，你明天共有 {{courseCount}} 节课，第一节在 {{firstCourseTime}}。", enabled: true, updatedAt: createdAt },
      { id: createId("bot_tpl"), key: "schedule_conflict", title: "课表冲突提醒", body: "你订阅的课表有更新，但你已修改部分课程，需确认是否继续跟随。", enabled: true, updatedAt: createdAt },
      { id: createId("bot_tpl"), key: "next_day_no_class", title: "无课日建议", body: "明日无课，可安排复习/运动/社团活动。", enabled: true, updatedAt: createdAt },
    ],
    botJobs: [],
    auditLogs: [],
    partyGameRooms: [],
    partyGameMembers: [],
    partyGameStates: [],
    partyGameEvents: [],
  };
};

const bootstrapStore = (): NexusStore => {
  const legacyStore = buildStoreFromLegacyNormalized();
  if (legacyStore) {
    return legacyStore;
  }
  const createdAt = nowIso();
  const adminUserId = createId("user");
  const ownerUserId = createId("user");
  const normalUserId = createId("user");
  const classId = createId("class");
  const classIdB = createId("class");
  const scheduleId = createId("schedule");
  const scheduleVersionId = createId("schedule_version");
  const activeJoinCode = generateJoinCode();

  const foodItems: FoodItemRecord[] = mergeWithLegacyFoodSeeds([
    {
      id: createId("food"),
      name: "轻食鸡胸沙拉",
      categoryKey: "light-meal",
      categoryName: "轻食",
      merchantName: "轻食工坊",
      latitude: 31.2304,
      longitude: 121.4737,
      priceMin: 22,
      priceMax: 34,
      caloriesKcal: 420,
    },
    {
      id: createId("food"),
      name: "奶茶双拼",
      categoryKey: "drink",
      categoryName: "饮品",
      merchantName: "茶饮集合店",
      latitude: 31.2286,
      longitude: 121.4812,
      priceMin: 16,
      priceMax: 24,
      caloriesKcal: 340,
    },
    {
      id: createId("food"),
      name: "麻辣香锅",
      categoryKey: "main-meal",
      categoryName: "正餐",
      merchantName: "川味坊",
      latitude: 31.2248,
      longitude: 121.4699,
      priceMin: 28,
      priceMax: 48,
      caloriesKcal: 780,
    },
  ]);

  const baseRules: FoodPricingRuleRecord[] = [
    {
      categoryKey: "light-meal",
      categoryName: "轻食",
      trendMode: "down",
      anchorHeadcount: 8,
      slope: 0.05,
      minFactor: 0.82,
      maxFactor: 1.2,
      updatedAt: createdAt,
    },
    {
      categoryKey: "drink",
      categoryName: "饮品",
      trendMode: "down",
      anchorHeadcount: 10,
      slope: 0.04,
      minFactor: 0.78,
      maxFactor: 1.18,
      updatedAt: createdAt,
    },
    {
      categoryKey: "main-meal",
      categoryName: "正餐",
      trendMode: "down",
      anchorHeadcount: 12,
      slope: 0.03,
      minFactor: 0.8,
      maxFactor: 1.16,
      updatedAt: createdAt,
    },
  ];

  const defaultCampaign: FoodCampaignRecord = {
    id: createId("campaign"),
    title: "周五晚餐拼单",
    status: "open",
    classId,
    createdByUserId: ownerUserId,
    deadlineAtIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    shareToken: generateShareToken(),
    isAnonymous: true,
    revealAfterClose: true,
    revealScope: "share_token",
    optionFoodIds: foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id),
    createdAt,
    updatedAt: createdAt,
  };

  const closedCampaign: FoodCampaignRecord = {
    id: createId("campaign"),
    title: "上周末聚餐回顾",
    status: "closed",
    classId,
    createdByUserId: ownerUserId,
    deadlineAtIso: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    shareToken: generateShareToken(),
    isAnonymous: false,
    revealAfterClose: true,
    revealScope: "share_token",
    optionFoodIds: foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id),
    createdAt,
    updatedAt: createdAt,
  };

  const mediaAvatarId = createId("media");
  const mediaWallpaperId = createId("media");

  return {
    users: [
      {
        userId: adminUserId,
        studentNo: DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO,
        studentId: "admin001",
        name: "系统管理员",
        classLabel: "运营中心",
        nickname: "NexusAdmin",
        avatarUrl: `/media/${mediaAvatarId}`,
        wallpaperUrl: `/media/${mediaWallpaperId}`,
        classIds: [],
        adminRole: "super_admin",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt,
        updatedAt: createdAt,
      },
      {
        userId: ownerUserId,
        studentNo: "2305200101",
        studentId: "owner001",
        name: "班级创建者",
        classLabel: "软件工程23(5)班",
        nickname: "ClassOwner",
        avatarUrl: "",
        wallpaperUrl: "",
        classIds: [classId],
        adminRole: "operator",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt,
        updatedAt: createdAt,
      },
      {
        userId: normalUserId,
        studentNo: "2305200123",
        studentId: "user001",
        name: "普通同学",
        classLabel: "软件工程23(5)班",
        nickname: "StudentOne",
        avatarUrl: "",
        wallpaperUrl: "",
        classIds: [classId],
        adminRole: "none",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt,
        updatedAt: createdAt,
      },
    ],
    classes: [
      {
        id: classId,
        name: "软件工程23(5)班",
        ownerUserId,
        timezone: "Asia/Shanghai",
        status: "active",
        activeJoinCode,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: classIdB,
        name: "人工智能24(2)班",
        ownerUserId,
        timezone: "Asia/Shanghai",
        status: "active",
        activeJoinCode: generateJoinCode(),
        createdAt,
        updatedAt: createdAt,
      },
    ],
    classMembers: [
      {
        id: createId("class_member"),
        classId,
        userId: ownerUserId,
        classRole: "class_owner",
        joinedAt: createdAt,
      },
      {
        id: createId("class_member"),
        classId,
        userId: normalUserId,
        classRole: "class_viewer",
        joinedAt: createdAt,
      },
      {
        id: createId("class_member"),
        classId: classIdB,
        userId: ownerUserId,
        classRole: "class_owner",
        joinedAt: createdAt,
      },
    ],
    schedules: [
      {
        id: scheduleId,
        classId,
        title: "2026春季学期课表",
        description: "默认发布版本",
        publishedVersionNo: 1,
        createdByUserId: ownerUserId,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    scheduleVersions: [
      {
        id: scheduleVersionId,
        scheduleId,
        versionNo: 1,
        status: "published",
        createdByUserId: ownerUserId,
        createdAt,
        entries: [
          {
            id: createId("entry"),
            day: 1,
            startSection: 1,
            endSection: 2,
            weekExpr: "1-18",
            parity: "all",
            courseName: "软件工程导论",
            classroom: "A101",
            teacher: "王老师",
          },
          {
            id: createId("entry"),
            day: 3,
            startSection: 3,
            endSection: 4,
            weekExpr: "1-18",
            parity: "all",
            courseName: "数据库原理",
            classroom: "B203",
            teacher: "李老师",
          },
          {
            id: createId("entry"),
            day: 5,
            startSection: 1,
            endSection: 2,
            weekExpr: "1-18",
            parity: "all",
            courseName: "计算机网络",
            classroom: "C301",
            teacher: "陈老师",
          },
        ],
      },
    ],
    scheduleSubscriptions: [],
    schedulePatches: [],
    scheduleConflicts: [],
    sessions: [],
    locationGrids: [
      {
        userId: ownerUserId,
        gridId: "grid_31.23_121.47",
        latitudeApprox: 31.23,
        longitudeApprox: 121.47,
        updatedAt: createdAt,
        stale: false,
      },
    ],
    foodItems,
    foodCampaigns: [defaultCampaign, closedCampaign],
    foodCampaignVotes: [
      {
        id: createId("campaign_vote"),
        campaignId: closedCampaign.id,
        userId: ownerUserId,
        foodId: foodItems[0].id,
        score: 1,
        createdAt,
      },
      {
        id: createId("campaign_vote"),
        campaignId: closedCampaign.id,
        userId: normalUserId,
        foodId: foodItems[2].id,
        score: 1,
        createdAt,
      },
    ],
    foodPricingRules: baseRules,
    foodPricingRuleVersions: baseRules.map((rule) => cloneRuleAsVersion(rule)),
    foodPricingOverrideVersions: [],
    mediaAssets: [
      {
        id: mediaAvatarId,
        ownerUserId: adminUserId,
        usage: "avatar",
        objectKey: `avatars/${mediaAvatarId}.png`,
        url: `/media/${mediaAvatarId}`,
        mime: "image/png",
        size: 102400,
        referenced: true,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: mediaWallpaperId,
        ownerUserId: adminUserId,
        usage: "wallpaper",
        objectKey: `wallpapers/${mediaWallpaperId}.jpg`,
        url: `/media/${mediaWallpaperId}`,
        mime: "image/jpeg",
        size: 504120,
        referenced: true,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    botTemplates: [
      {
        id: createId("bot_tpl"),
        key: "next_day_brief",
        title: "次日课表播报",
        body: "{{name}}，你明天共有 {{courseCount}} 节课，第一节在 {{firstCourseTime}}。",
        enabled: true,
        updatedAt: createdAt,
      },
      {
        id: createId("bot_tpl"),
        key: "schedule_conflict",
        title: "课表冲突提醒",
        body: "你订阅的课表有更新，但你已修改部分课程，需确认是否继续跟随。",
        enabled: true,
        updatedAt: createdAt,
      },
      {
        id: createId("bot_tpl"),
        key: "next_day_no_class",
        title: "无课日建议",
        body: "明日无课，可安排复习/运动/社团活动。",
        enabled: true,
        updatedAt: createdAt,
      },
    ],
    botJobs: [],
    auditLogs: [],
    partyGameRooms: [],
    partyGameMembers: [],
    partyGameStates: [],
    partyGameEvents: [],
  };
};

const getGlobalContext = () => globalThis as typeof globalThis & Record<string, unknown>;

export const getNexusStore = () => {
  const context = getGlobalContext();
  if (!context[GLOBAL_KEY]) {
    context[GLOBAL_KEY] = bootstrapStore();
  }
  const store = context[GLOBAL_KEY] as NexusStore;
  normalizeCampaignOptions(store);
  return store;
};

export const resetNexusStore = () => {
  const context = getGlobalContext();
  context[GLOBAL_KEY] = bootstrapStore();
  const store = context[GLOBAL_KEY] as NexusStore;
  normalizeCampaignOptions(store);
  return store;
};

export const storeHelpers = {
  nowIso,
  createId,
  generateJoinCode,
  generateShareToken,
};
