import { createError, getMethod, getQuery, getRequestURL, readMultipartFormData, setHeader, type H3Event } from "h3";
import {
  FOOD_CAMPAIGN_OPTION_LIMIT,
  getNexusStore,
  getNexusStoreRevision,
  storeHelpers,
  type FoodCampaignRecord,
  type FoodCampaignVoteRecord,
  type FoodItemRecord,
  type MediaAssetRecord,
  type FoodPricingRuleRecord,
  type ScheduleCorrectionRecord,
  type ScheduleEntryRecord,
  type SocialActivityInvitationRecord,
  type SocialActivityRecord,
  type SocialCircleMemberRecord,
  type SocialCircleRecord,
  type SocialNotificationRecord,
  type SocialSubscriptionEdgeRecord,
  type SocialSubscriptionRequestRecord,
  type UserScheduleEventRecord,
  type UserRecord,
} from "./domain-store";
import {
  getBearerToken,
  normalizeRoutePath,
  readJsonBody,
  resolveSessionWithUser,
} from "../utils/api-envelope";
import {
  buildR2MediaId,
  resolveImageExtension,
  resolveImageMimeType,
  resolveMediaBucket,
} from "../utils/media-storage";
import { createSignedSession } from "../utils/session-token";
import { estimateFoodCaloriesKcal, normalizeCaloriesKcal, resolveExerciseEquivalentMinutes } from "./food-utils";
import {
  addDaysToDateKey,
  getEffectiveScheduleEntriesForUser,
  getSectionTimeBySection,
  getUserReminderTimezone,
  isScheduleEntryInWeek,
  resolveCurrentWeekForDate,
  SCHEDULE_DEFAULT_TIMEZONE,
  SCHEDULE_SECTION_TIMES,
  SCHEDULE_TERM_HOLIDAYS,
  SCHEDULE_TERM_META,
  SCHEDULE_WEEKDAY_LABELS,
  toAcademicWeekDay,
  toDateTimeParts,
  zonedDateTimeToUtc,
} from "./schedule-calendar";
import {
  buildScheduleIntelligence,
  normalizeVisibilityScope,
  pickStrongerVisibilityScope,
  resolveNextActivityStatus,
  type SocialVisibilityScope,
} from "./social-collaboration-core";

type LegacyJoinMode = "all" | "invite" | "password";
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

interface LegacyCampaignMeta {
  templateKey: string;
  joinMode: LegacyJoinMode;
  joinPassword: string;
  maxVotesPerUser: number;
  closedAtUnix: number;
  inviteeUserIds: string[];
}

interface LegacyCampaignParticipant {
  userId: string;
  source: "creator" | "invitee" | "join";
  approvalStatus: "approved" | "pending" | "rejected";
}

interface LegacyCompatState {
  randomCodeByUserId: Map<string, string>;
  notifyBoundUserIds: Set<string>;
  practiceCourseKeysByUserId: Map<string, Set<string>>;
  subscriptionTargetsByUserId: Map<string, Set<string>>;
  bindingTargetUserIdByUserId: Map<string, string>;
  campaignMetaByCampaignId: Map<string, LegacyCampaignMeta>;
  campaignParticipantsByCampaignId: Map<string, Map<string, LegacyCampaignParticipant>>;
  foodCandidates: LegacyFoodCandidateRecord[];
  foodKeyBySourceFoodId: Map<string, string>;
  sourceFoodIdByFoodKey: Map<string, string>;
}

export interface LegacyCompatStateSnapshot {
  randomCodeByUserId: Record<string, string>;
  notifyBoundUserIds: string[];
  practiceCourseKeysByUserId: Record<string, string[]>;
  subscriptionTargetsByUserId: Record<string, string[]>;
  bindingTargetUserIdByUserId: Record<string, string>;
  campaignMetaByCampaignId: Record<string, LegacyCampaignMeta>;
  campaignParticipantsByCampaignId: Record<string, LegacyCampaignParticipant[]>;
  foodCandidates: LegacyFoodCandidateRecord[];
  foodKeyBySourceFoodId: Record<string, string>;
  sourceFoodIdByFoodKey: Record<string, string>;
}

type NexusStore = ReturnType<typeof getNexusStore>;

const legacyStateMap = new WeakMap<NexusStore, LegacyCompatState>();

const LEGACY_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const LEGACY_WALLPAPER_MAX_BYTES = 5 * 1024 * 1024;
const LEGACY_FOOD_CANDIDATE_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

const asString = (value: unknown) => String(value || "").trim();

const normalizeProfileAvatarUrl = (value: unknown) => {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  if (!/^https?:\/\//i.test(raw)) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const hostname = parsed.hostname.toLowerCase();
    const isWechatAvatarHost = hostname === "thirdwx.qlogo.cn" || hostname === "wx.qlogo.cn" || hostname.endsWith(".qlogo.cn");
    if (parsed.protocol === "http:" && isWechatAvatarHost) {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch (error) {
    return "";
  }
};

const randomSuffix = () => {
  return Math.random().toString(36).slice(2, 8);
};

const sanitizeStoragePart = (value: string) => {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
};

const readLegacyUploadFile = async (event: H3Event, maxBytes: number) => {
  const parts = await readMultipartFormData(event);
  const filePart = ensureValue(
    (parts || []).find((part) => part?.name === "file" && part.data instanceof Uint8Array) || null,
    400,
    "UPLOAD_FILE_REQUIRED",
    "请上传图片文件",
  );
  const fileData = filePart.data;
  if (fileData.length <= 0) {
    createLegacyError(400, "UPLOAD_FILE_EMPTY", "上传文件为空");
  }
  if (fileData.length > maxBytes) {
    createLegacyError(400, "UPLOAD_FILE_TOO_LARGE", `文件过大，限制 ${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }
  const fileName = asString(filePart.filename) || `upload_${Date.now()}.jpg`;
  const extension = resolveImageExtension(fileName, asString(filePart.type), fileData);
  const mimeType = resolveImageMimeType(extension, asString(filePart.type) || "application/octet-stream");
  return {
    fileData,
    fileName,
    extension,
    mimeType,
    size: fileData.length,
  };
};

const persistLegacyMediaUpload = async (
  event: H3Event,
  store: NexusStore,
  user: UserRecord,
  options: {
    usage: MediaAssetRecord["usage"];
    maxBytes: number;
    objectPrefix: string;
  },
) => {
  const bucket = ensureValue(resolveMediaBucket(event), 500, "MEDIA_BUCKET_MISSING", "媒体存储未配置，请联系管理员");
  const upload = await readLegacyUploadFile(event, options.maxBytes);
  const owner = sanitizeStoragePart(user.studentNo || user.studentId || user.userId || "anonymous");
  const objectKey = `${options.objectPrefix}/${owner}/${Date.now()}_${randomSuffix()}.${upload.extension}`;
  await bucket.put(objectKey, upload.fileData, {
    httpMetadata: {
      contentType: upload.mimeType,
    },
  });
  const mediaId = buildR2MediaId(objectKey, upload.extension);
  const mediaUrl = `/media/${mediaId}`;
  const existed = store.mediaAssets.find((item) => item.id === mediaId) || null;
  const nowIso = storeHelpers.nowIso();
  if (existed) {
    existed.ownerUserId = user.userId;
    existed.usage = options.usage;
    existed.objectKey = objectKey;
    existed.url = mediaUrl;
    existed.mime = upload.mimeType;
    existed.size = upload.size;
    existed.referenced = true;
    existed.updatedAt = nowIso;
  } else {
    const asset: MediaAssetRecord = {
      id: mediaId,
      ownerUserId: user.userId,
      usage: options.usage,
      objectKey,
      url: mediaUrl,
      mime: upload.mimeType,
      size: upload.size,
      referenced: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.mediaAssets.unshift(asset);
  }
  return {
    assetId: mediaId,
    url: mediaUrl,
  };
};

const persistLegacyUserMediaUpload = async (
  event: H3Event,
  store: NexusStore,
  user: UserRecord,
  usage: "avatar" | "wallpaper",
  maxBytes: number,
) => {
  const upload = await persistLegacyMediaUpload(event, store, user, {
    usage,
    maxBytes,
    objectPrefix: `touchx/social/${usage}`,
  });
  return upload.url;
};

type FoodCampaignTemplateKey = "daily" | "party";

interface FoodTierRange {
  min: number;
  max: number;
}

const FOOD_TIER_RANGE_MAP: Record<FoodCampaignTemplateKey, Record<string, FoodTierRange>> = {
  daily: {
    daily_under_8: { min: 0, max: 7.9999 },
    daily_8_12: { min: 8, max: 12 },
    daily_12_15: { min: 12, max: 15 },
    daily_15_18: { min: 15, max: 18 },
    daily_18_plus: { min: 18, max: Number.POSITIVE_INFINITY },
  },
  party: {
    party_25_35: { min: 25, max: 35 },
    party_35_45: { min: 35, max: 45 },
    party_45_65: { min: 45, max: 65 },
    party_65_plus: { min: 65, max: Number.POSITIVE_INFINITY },
  },
};

const normalizeFoodCampaignTemplateKey = (value: unknown): FoodCampaignTemplateKey => {
  return asString(value).toLowerCase() === "party" ? "party" : "daily";
};

const normalizeFoodFilterKeys = (value: unknown) => {
  const normalized: string[] = [];
  if (!Array.isArray(value)) {
    return normalized;
  }
  value.forEach((item) => {
    const key = asString(item).toLowerCase();
    if (!key || normalized.includes(key)) {
      return;
    }
    normalized.push(key);
  });
  return normalized;
};

const normalizeSelectedFoodTierIds = (templateKey: FoodCampaignTemplateKey, value: unknown) => {
  const allowSet = new Set(Object.keys(FOOD_TIER_RANGE_MAP[templateKey] || {}));
  const normalized: string[] = [];
  if (!Array.isArray(value)) {
    return normalized;
  }
  value.forEach((item) => {
    const tierId = asString(item);
    if (!tierId || !allowSet.has(tierId) || normalized.includes(tierId)) {
      return;
    }
    normalized.push(tierId);
  });
  return normalized;
};

const resolveLegacyCandidateTemplatePriceRange = (
  candidate: LegacyFoodCandidateRecord,
  templateKey: FoodCampaignTemplateKey,
): FoodTierRange => {
  const rawMin = templateKey === "party" ? Number(candidate.partyPriceMin || 0) : Number(candidate.dailyPriceMin || 0);
  const rawMax =
    templateKey === "party" ? Number(candidate.partyPriceMax || rawMin) : Number(candidate.dailyPriceMax || rawMin);
  const min = Math.max(0, rawMin);
  const max = Math.max(min, rawMax);
  return {
    min,
    max,
  };
};

const isFoodTierRangeMatched = (
  candidate: LegacyFoodCandidateRecord,
  templateKey: FoodCampaignTemplateKey,
  selectedTierIds: string[],
) => {
  if (selectedTierIds.length === 0) {
    return true;
  }
  const candidateRange = resolveLegacyCandidateTemplatePriceRange(candidate, templateKey);
  return selectedTierIds.some((tierId) => {
    const tierRange = FOOD_TIER_RANGE_MAP[templateKey][tierId];
    if (!tierRange) {
      return false;
    }
    return candidateRange.min <= tierRange.max && tierRange.min <= candidateRange.max;
  });
};

const pickRandomItems = <T>(items: T[], limit: number, random = Math.random) => {
  const rest = [...items];
  const picked: T[] = [];
  while (rest.length > 0 && picked.length < limit) {
    const randomValue = Number(random());
    const normalized = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999999999) : 0;
    const index = Math.floor(normalized * rest.length);
    const [item] = rest.splice(index, 1);
    if (item !== undefined) {
      picked.push(item);
    }
  }
  return picked;
};

const resolveLegacyCampaignOptionIds = (
  store: NexusStore,
  state: LegacyCompatState,
  options: {
    templateKey?: string;
    selectedTierIds?: string[];
    categoryKeys?: string[];
    brandKeys?: string[];
    random?: () => number;
  },
) => {
  const templateKey = normalizeFoodCampaignTemplateKey(options.templateKey);
  const selectedTierIds = normalizeSelectedFoodTierIds(templateKey, options.selectedTierIds);
  const categoryKeys = normalizeFoodFilterKeys(options.categoryKeys);
  const brandKeys = normalizeFoodFilterKeys(options.brandKeys);
  const random = typeof options.random === "function" ? options.random : Math.random;
  const approvedCandidates = resolveApprovedFoodCandidates(store, state);
  const matchesCategory = (candidate: LegacyFoodCandidateRecord) => {
    return categoryKeys.length === 0 || categoryKeys.includes(asString(candidate.categoryKey).toLowerCase());
  };
  const matchesBrand = (candidate: LegacyFoodCandidateRecord) => {
    return brandKeys.length === 0 || brandKeys.includes(asString(candidate.brandKey).toLowerCase());
  };
  const selectionPools = [
    approvedCandidates.filter((candidate) => {
      return isFoodTierRangeMatched(candidate, templateKey, selectedTierIds) && matchesCategory(candidate) && matchesBrand(candidate);
    }),
    approvedCandidates.filter((candidate) => {
      return isFoodTierRangeMatched(candidate, templateKey, selectedTierIds) && matchesCategory(candidate);
    }),
    approvedCandidates.filter((candidate) => {
      return isFoodTierRangeMatched(candidate, templateKey, selectedTierIds);
    }),
    approvedCandidates,
  ];
  const selectedFoodIds: string[] = [];
  const selectedSet = new Set<string>();
  selectionPools.forEach((pool) => {
    if (selectedFoodIds.length >= FOOD_CAMPAIGN_OPTION_LIMIT) {
      return;
    }
    const uniqueIds: string[] = [];
    pool.forEach((candidate) => {
      const foodId = asString(candidate.sourceFoodId);
      if (!foodId || selectedSet.has(foodId) || uniqueIds.includes(foodId)) {
        return;
      }
      uniqueIds.push(foodId);
    });
    const picked = pickRandomItems(uniqueIds, FOOD_CAMPAIGN_OPTION_LIMIT - selectedFoodIds.length, random);
    picked.forEach((foodId) => {
      if (selectedSet.has(foodId)) {
        return;
      }
      selectedSet.add(foodId);
      selectedFoodIds.push(foodId);
    });
  });
  return selectedFoodIds;
};

const toUnixSeconds = (value: string | number | Date) => {
  const timestamp =
    value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return Math.floor(timestamp / 1000);
};

const resolveCampaignDeadlineIso = (inputIso: string) => {
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
    createLegacyError(400, "DEADLINE_TOO_SOON", `竞选持续时间至少 ${minMinutes} 分钟`);
  }
  if (diffMinutes > maxMinutes) {
    return new Date(now + maxMinutes * 60 * 1000).toISOString();
  }
  return new Date(parsed).toISOString();
};

const createLegacyError = (statusCode: number, code: string, message: string): never => {
  throw createError({
    statusCode,
    statusMessage: message,
    data: {
      ok: false,
      code,
      message,
      detail: message,
    },
  });
};

const ensureValue = <T>(value: T | null | undefined, statusCode: number, code: string, message: string): T => {
  if (value === null || value === undefined) {
    createLegacyError(statusCode, code, message);
  }
  return value as T;
};

const isAdminRole = (user: UserRecord) => {
  return user.adminRole === "super_admin" || user.adminRole === "operator";
};

const createSession = (event: H3Event, user: UserRecord, role: "admin" | "user", ttlHours = 24 * 14) => {
  const session = createSignedSession(event, user, role, ttlHours);
  return session;
};

const revokeSession = (token: string) => {
  void token;
};

const resolveLegacyAuthContext = (event: H3Event) => {
  const token = getBearerToken(event);
  if (!token) {
    createLegacyError(401, "AUTH_MISSING", "未登录或登录已失效");
  }
  const resolved = ensureValue(
    resolveSessionWithUser(event),
    401,
    "AUTH_INVALID",
    "未登录或登录已失效",
  );
  return {
    token,
    session: resolved.session,
    user: resolved.user,
  };
};

const ensureSet = <K, V>(map: Map<K, Set<V>>, key: K) => {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created = new Set<V>();
  map.set(key, created);
  return created;
};

const mapToRecord = <T>(map: Map<string, T>) => {
  const record: Record<string, T> = {};
  map.forEach((value, key) => {
    record[String(key)] = value;
  });
  return record;
};

const mapSetToRecord = (map: Map<string, Set<string>>) => {
  const record: Record<string, string[]> = {};
  map.forEach((value, key) => {
    record[String(key)] = Array.from(value.values());
  });
  return record;
};

const sanitizeLegacyJoinMode = (value: unknown): LegacyJoinMode => {
  const mode = String(value || "").trim();
  if (mode === "invite" || mode === "password" || mode === "all") {
    return mode;
  }
  return "all";
};

const sanitizeLegacyCandidateStatus = (value: unknown): LegacyCandidateStatus => {
  const status = String(value || "").trim();
  if (status === "approved" || status === "pending_eat" || status === "pending_review" || status === "rejected") {
    return status;
  }
  return "pending_review";
};

const sanitizeLegacyCampaignParticipant = (raw: unknown): LegacyCampaignParticipant | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as Partial<LegacyCampaignParticipant>;
  const userId = asString(data.userId);
  if (!userId) {
    return null;
  }
  const source = String(data.source || "").trim();
  const approvalStatus = String(data.approvalStatus || "").trim();
  const normalizedSource: LegacyCampaignParticipant["source"] =
    source === "creator" || source === "invitee" || source === "join" ? source : "join";
  const normalizedApproval: LegacyCampaignParticipant["approvalStatus"] =
    approvalStatus === "approved" || approvalStatus === "pending" || approvalStatus === "rejected"
      ? approvalStatus
      : "approved";
  return {
    userId,
    source: normalizedSource,
    approvalStatus: normalizedApproval,
  };
};

const sanitizeLegacyCampaignMeta = (raw: unknown): LegacyCampaignMeta => {
  if (!raw || typeof raw !== "object") {
    return {
      templateKey: "daily",
      joinMode: "all",
      joinPassword: "",
      maxVotesPerUser: 1,
      closedAtUnix: 0,
      inviteeUserIds: [],
    };
  }
  const data = raw as Partial<LegacyCampaignMeta>;
  const maxVotes = Number(data.maxVotesPerUser || 1);
  return {
    templateKey: asString(data.templateKey) || "daily",
    joinMode: sanitizeLegacyJoinMode(data.joinMode),
    joinPassword: asString(data.joinPassword),
    maxVotesPerUser: Number.isFinite(maxVotes) ? Math.max(1, Math.min(3, Math.floor(maxVotes))) : 1,
    closedAtUnix: Number(data.closedAtUnix || 0),
    inviteeUserIds: Array.isArray(data.inviteeUserIds)
      ? data.inviteeUserIds.map((item) => asString(item)).filter((item) => item)
      : [],
  };
};

const sanitizeLegacyFoodCandidate = (raw: unknown): LegacyFoodCandidateRecord | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as Partial<LegacyFoodCandidateRecord>;
  const foodKey = asString(data.foodKey);
  const name = asString(data.name);
  if (!foodKey || !name) {
    return null;
  }
  return {
    foodKey,
    sourceFoodId: asString(data.sourceFoodId),
    name,
    categoryKey: asString(data.categoryKey),
    categoryName: asString(data.categoryName),
    brandKey: asString(data.brandKey),
    brandName: asString(data.brandName),
    brandCombo: asString(data.brandCombo),
    candidateStatus: sanitizeLegacyCandidateStatus(data.candidateStatus),
    note: asString(data.note),
    createdByUserId: asString(data.createdByUserId),
    createdByStudentId: asString(data.createdByStudentId),
    distanceKm: Number(data.distanceKm || 0),
    dailyPriceMin: Number(data.dailyPriceMin || 0),
    dailyPriceMax: Number(data.dailyPriceMax || 0),
    partyPriceMin: Number(data.partyPriceMin || 0),
    partyPriceMax: Number(data.partyPriceMax || 0),
    caloriesKcal: Number(data.caloriesKcal || 0),
    submissionMode: normalizeLegacyFoodCandidateSubmissionMode(data.submissionMode),
    rawText: asString(data.rawText),
    evidenceAssetIds: normalizeStringArray(data.evidenceAssetIds),
    extractionWarnings: normalizeStringArray(data.extractionWarnings),
    reviewNote: asString(data.reviewNote),
    isCaloriesEstimated: Boolean(data.isCaloriesEstimated),
  };
};

const randomCodeByStudentNo = (studentNo: string) => {
  const digits = studentNo.replace(/\D+/g, "");
  if (digits.length > 0) {
    return digits.slice(-4).padStart(4, "0").slice(0, 4);
  }
  return `${Math.floor(Math.random() * 9000 + 1000)}`;
};

const normalizeBrandKey = (text: string) => {
  const value = asString(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return value || "general";
};

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asString(item)).filter((item) => item);
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

const resolveApprovedFoodCandidates = (store: NexusStore, state: LegacyCompatState) => {
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

const findFoodCandidateByKey = (state: LegacyCompatState, foodKey: string) => {
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
  state: LegacyCompatState,
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

const resolvePricingFactor = (rule: FoodPricingRuleRecord, headcount: number) => {
  const clamp = (value: number, min: number, max: number) => {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  };
  const anchor = Math.max(1, Number(rule.anchorHeadcount || 1));
  const delta = (headcount - anchor) / anchor;
  const trendBase = rule.trendMode === "down" ? 1 - rule.slope * delta : 1 + rule.slope * delta;
  return clamp(trendBase, rule.minFactor, rule.maxFactor);
};

const getLegacyState = (store: NexusStore) => {
  const existing = legacyStateMap.get(store);
  if (existing) {
    return existing;
  }

  const randomCodeByUserId = new Map<string, string>();
  const notifyBoundUserIds = new Set<string>();
  const practiceCourseKeysByUserId = new Map<string, Set<string>>();
  const subscriptionTargetsByUserId = new Map<string, Set<string>>();
  const bindingTargetUserIdByUserId = new Map<string, string>();
  const campaignMetaByCampaignId = new Map<string, LegacyCampaignMeta>();
  const campaignParticipantsByCampaignId = new Map<string, Map<string, LegacyCampaignParticipant>>();
  const foodCandidates: LegacyFoodCandidateRecord[] = [];
  const foodKeyBySourceFoodId = new Map<string, string>();
  const sourceFoodIdByFoodKey = new Map<string, string>();

  store.users.forEach((user) => {
    randomCodeByUserId.set(user.userId, randomCodeByStudentNo(user.studentNo));
    if (user.studentId) {
      notifyBoundUserIds.add(user.userId);
    }
    bindingTargetUserIdByUserId.set(user.userId, user.userId);
    practiceCourseKeysByUserId.set(user.userId, new Set<string>());
    subscriptionTargetsByUserId.set(user.userId, new Set<string>());
  });

  store.scheduleSubscriptions.forEach((subscription) => {
    const schedule = store.schedules.find((item) => item.id === subscription.sourceScheduleId) || null;
    if (!schedule) {
      return;
    }
    const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
    const targetUserId = classItem?.ownerUserId || "";
    if (!targetUserId || targetUserId === subscription.subscriberUserId) {
      return;
    }
    ensureSet(subscriptionTargetsByUserId, subscription.subscriberUserId).add(targetUserId);
  });

  store.foodItems.forEach((item, index) => {
    const foodKey = `${index + 1}`;
    const brandKey = normalizeBrandKey(item.merchantName);
    const candidate: LegacyFoodCandidateRecord = {
      foodKey,
      sourceFoodId: item.id,
      name: item.name,
      categoryKey: item.categoryKey,
      categoryName: item.categoryName,
      brandKey,
      brandName: item.merchantName,
      brandCombo: `${item.merchantName}-${item.name}`,
      candidateStatus: "approved",
      note: "",
      createdByUserId: store.users[0]?.userId || "",
      createdByStudentId: store.users[0]?.studentId || "",
      distanceKm: Number((0.8 + index * 0.45).toFixed(2)),
      dailyPriceMin: item.priceMin,
      dailyPriceMax: item.priceMax,
      partyPriceMin: Number((item.priceMin * 1.2).toFixed(2)),
      partyPriceMax: Number((item.priceMax * 1.3).toFixed(2)),
      caloriesKcal: normalizeCaloriesKcal(item.caloriesKcal, 0),
      submissionMode: "structured",
      rawText: "",
      evidenceAssetIds: [],
      extractionWarnings: [],
      reviewNote: "",
      isCaloriesEstimated: false,
    };
    foodCandidates.push(candidate);
    foodKeyBySourceFoodId.set(item.id, foodKey);
    sourceFoodIdByFoodKey.set(foodKey, item.id);
  });

  store.foodCampaigns.forEach((campaign) => {
    campaignMetaByCampaignId.set(campaign.id, {
      templateKey: "daily",
      joinMode: "all",
      joinPassword: "",
      maxVotesPerUser: 1,
      closedAtUnix: campaign.status === "closed" ? toUnixSeconds(campaign.updatedAt || campaign.deadlineAtIso) : 0,
      inviteeUserIds: [],
    });
    const participants = new Map<string, LegacyCampaignParticipant>();
    participants.set(campaign.createdByUserId, {
      userId: campaign.createdByUserId,
      source: "creator",
      approvalStatus: "approved",
    });
    campaignParticipantsByCampaignId.set(campaign.id, participants);
  });

  const state: LegacyCompatState = {
    randomCodeByUserId,
    notifyBoundUserIds,
    practiceCourseKeysByUserId,
    subscriptionTargetsByUserId,
    bindingTargetUserIdByUserId,
    campaignMetaByCampaignId,
    campaignParticipantsByCampaignId,
    foodCandidates,
    foodKeyBySourceFoodId,
    sourceFoodIdByFoodKey,
  };
  legacyStateMap.set(store, state);
  return state;
};

export const isLegacyNotifyBoundUser = (store: NexusStore, userId: string) => {
  return getLegacyState(store).notifyBoundUserIds.has(asString(userId));
};

export const serializeLegacyCompatState = (store: NexusStore): LegacyCompatStateSnapshot => {
  const state = getLegacyState(store);
  const campaignParticipantsByCampaignId: Record<string, LegacyCampaignParticipant[]> = {};
  state.campaignParticipantsByCampaignId.forEach((participants, campaignId) => {
    campaignParticipantsByCampaignId[campaignId] = Array.from(participants.values()).map((item) => ({
      userId: item.userId,
      source: item.source,
      approvalStatus: item.approvalStatus,
    }));
  });
  return {
    randomCodeByUserId: mapToRecord(state.randomCodeByUserId),
    notifyBoundUserIds: Array.from(state.notifyBoundUserIds.values()),
    practiceCourseKeysByUserId: mapSetToRecord(state.practiceCourseKeysByUserId),
    subscriptionTargetsByUserId: mapSetToRecord(state.subscriptionTargetsByUserId),
    bindingTargetUserIdByUserId: mapToRecord(state.bindingTargetUserIdByUserId),
    campaignMetaByCampaignId: mapToRecord(state.campaignMetaByCampaignId),
    campaignParticipantsByCampaignId,
    foodCandidates: state.foodCandidates.map((item) => ({ ...item })),
    foodKeyBySourceFoodId: mapToRecord(state.foodKeyBySourceFoodId),
    sourceFoodIdByFoodKey: mapToRecord(state.sourceFoodIdByFoodKey),
  };
};

export const hydrateLegacyCompatState = (store: NexusStore, snapshot: LegacyCompatStateSnapshot | null | undefined) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const randomCodeByUserId = new Map<string, string>();
  Object.entries(snapshot.randomCodeByUserId || {}).forEach(([userId, code]) => {
    const normalizedUserId = asString(userId);
    const normalizedCode = asString(code);
    if (!normalizedUserId || !normalizedCode) {
      return;
    }
    randomCodeByUserId.set(normalizedUserId, normalizedCode);
  });
  const notifyBoundUserIds = new Set(
    Array.isArray(snapshot.notifyBoundUserIds)
      ? snapshot.notifyBoundUserIds.map((item) => asString(item)).filter((item) => item)
      : [],
  );
  const practiceCourseKeysByUserId = new Map<string, Set<string>>();
  Object.entries(snapshot.practiceCourseKeysByUserId || {}).forEach(([userId, keys]) => {
    const normalizedUserId = asString(userId);
    if (!normalizedUserId) {
      return;
    }
    const values = Array.isArray(keys) ? keys.map((item) => asString(item)).filter((item) => item) : [];
    practiceCourseKeysByUserId.set(normalizedUserId, new Set(values));
  });
  const subscriptionTargetsByUserId = new Map<string, Set<string>>();
  Object.entries(snapshot.subscriptionTargetsByUserId || {}).forEach(([userId, targets]) => {
    const normalizedUserId = asString(userId);
    if (!normalizedUserId) {
      return;
    }
    const values = Array.isArray(targets) ? targets.map((item) => asString(item)).filter((item) => item) : [];
    subscriptionTargetsByUserId.set(normalizedUserId, new Set(values));
  });
  const bindingTargetUserIdByUserId = new Map<string, string>();
  Object.entries(snapshot.bindingTargetUserIdByUserId || {}).forEach(([userId, targetUserId]) => {
    const normalizedUserId = asString(userId);
    const normalizedTargetUserId = asString(targetUserId);
    if (!normalizedUserId || !normalizedTargetUserId) {
      return;
    }
    bindingTargetUserIdByUserId.set(normalizedUserId, normalizedTargetUserId);
  });
  const campaignMetaByCampaignId = new Map<string, LegacyCampaignMeta>();
  Object.entries(snapshot.campaignMetaByCampaignId || {}).forEach(([campaignId, meta]) => {
    const normalizedCampaignId = asString(campaignId);
    if (!normalizedCampaignId) {
      return;
    }
    campaignMetaByCampaignId.set(normalizedCampaignId, sanitizeLegacyCampaignMeta(meta));
  });
  const campaignParticipantsByCampaignId = new Map<string, Map<string, LegacyCampaignParticipant>>();
  Object.entries(snapshot.campaignParticipantsByCampaignId || {}).forEach(([campaignId, participants]) => {
    const normalizedCampaignId = asString(campaignId);
    if (!normalizedCampaignId) {
      return;
    }
    const participantMap = new Map<string, LegacyCampaignParticipant>();
    const rows = Array.isArray(participants) ? participants : [];
    rows.forEach((raw) => {
      const participant = sanitizeLegacyCampaignParticipant(raw);
      if (!participant) {
        return;
      }
      participantMap.set(participant.userId, participant);
    });
    campaignParticipantsByCampaignId.set(normalizedCampaignId, participantMap);
  });
  const foodCandidates = Array.isArray(snapshot.foodCandidates)
    ? snapshot.foodCandidates
      .map((item) => sanitizeLegacyFoodCandidate(item))
      .filter((item): item is LegacyFoodCandidateRecord => Boolean(item))
    : [];
  const foodKeyBySourceFoodId = new Map<string, string>();
  Object.entries(snapshot.foodKeyBySourceFoodId || {}).forEach(([sourceFoodId, foodKey]) => {
    const normalizedSourceFoodId = asString(sourceFoodId);
    const normalizedFoodKey = asString(foodKey);
    if (!normalizedSourceFoodId || !normalizedFoodKey) {
      return;
    }
    foodKeyBySourceFoodId.set(normalizedSourceFoodId, normalizedFoodKey);
  });
  const sourceFoodIdByFoodKey = new Map<string, string>();
  Object.entries(snapshot.sourceFoodIdByFoodKey || {}).forEach(([foodKey, sourceFoodId]) => {
    const normalizedFoodKey = asString(foodKey);
    const normalizedSourceFoodId = asString(sourceFoodId);
    if (!normalizedFoodKey || !normalizedSourceFoodId) {
      return;
    }
    sourceFoodIdByFoodKey.set(normalizedFoodKey, normalizedSourceFoodId);
  });
  const nextState: LegacyCompatState = {
    randomCodeByUserId,
    notifyBoundUserIds,
    practiceCourseKeysByUserId,
    subscriptionTargetsByUserId,
    bindingTargetUserIdByUserId,
    campaignMetaByCampaignId,
    campaignParticipantsByCampaignId,
    foodCandidates,
    foodKeyBySourceFoodId,
    sourceFoodIdByFoodKey,
  };
  legacyStateMap.set(store, nextState);
};

const resolveBoundTargetUser = (
  store: NexusStore,
  state: LegacyCompatState,
  accountUser: UserRecord,
) => {
  const targetUserId = state.bindingTargetUserIdByUserId.get(accountUser.userId) || "";
  if (!targetUserId) {
    return null;
  }
  return store.users.find((item) => item.userId === targetUserId) || null;
};

const findUserByStudentId = (store: NexusStore, studentId: string) => {
  const normalized = asString(studentId);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.studentId === normalized) || null;
};

const findUserByStudentNo = (store: NexusStore, studentNo: string) => {
  const normalized = asString(studentNo);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.studentNo === normalized) || null;
};

const isPlaceholderIdentityText = (user: Pick<UserRecord, "studentNo" | "studentId">, value: unknown) => {
  const normalized = asString(value);
  if (!normalized) {
    return false;
  }
  if (normalized === asString(user.studentNo) || normalized === asString(user.studentId)) {
    return true;
  }
  return /^\d{6,32}$/.test(normalized);
};

const resolveMeaningfulUserName = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  const name = asString(user.name);
  if (name && !isPlaceholderIdentityText(user, name)) {
    return name;
  }
  const nickname = asString(user.nickname);
  if (nickname && !isPlaceholderIdentityText(user, nickname)) {
    return nickname;
  }
  return "";
};

const resolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  return resolveMeaningfulUserName(user) || asString(user.studentNo) || asString(user.studentId) || "未命名用户";
};

const toLegacyAuthUser = (
  accountUser: UserRecord,
  boundTarget: UserRecord | null,
  state: LegacyCompatState,
) => {
  const source = boundTarget || accountUser;
  return {
    openId: `wx_${accountUser.userId}`,
    studentId: source.studentId || "",
    studentNo: source.studentNo || "",
    studentName: resolveMeaningfulUserName(source),
    classLabel: source.classLabel || "",
    nickname: resolveMeaningfulUserName(accountUser) || resolveUserDisplayLabel(accountUser),
    avatarUrl: accountUser.avatarUrl || source.avatarUrl || "",
    randomCode: state.randomCodeByUserId.get(source.userId) || "",
  };
};

const toLegacySocialUser = (
  user: UserRecord,
  state: LegacyCompatState,
  options?: { accountUser?: UserRecord; randomCodeOwnerUserId?: string },
) => {
  const accountUser = options?.accountUser || user;
  const randomCodeOwnerUserId = options?.randomCodeOwnerUserId || user.userId;
  const practiceCourseKeys = Array.from(state.practiceCourseKeysByUserId.get(accountUser.userId) || []);
  return {
    studentId: user.studentId || "",
    studentNo: user.studentNo || "",
    name: resolveUserDisplayLabel(user),
    classLabel: user.classLabel || "",
    avatarUrl: accountUser.avatarUrl || user.avatarUrl || "",
    wallpaperUrl: accountUser.wallpaperUrl || user.wallpaperUrl || "",
    randomCode: state.randomCodeByUserId.get(randomCodeOwnerUserId) || "",
    isAdmin: isAdminRole(accountUser),
    notifyBound: state.notifyBoundUserIds.has(accountUser.userId),
    practiceCourseKeys,
  };
};

const ensureCampaignParticipants = (state: LegacyCompatState, campaign: FoodCampaignRecord) => {
  const existing = state.campaignParticipantsByCampaignId.get(campaign.id);
  if (existing) {
    existing.forEach((participant) => {
      participant.approvalStatus = "approved";
    });
    return existing;
  }
  const created = new Map<string, LegacyCampaignParticipant>();
  created.set(campaign.createdByUserId, {
    userId: campaign.createdByUserId,
    source: "creator",
    approvalStatus: "approved",
  });
  state.campaignParticipantsByCampaignId.set(campaign.id, created);
  return created;
};

const ensureCampaignMeta = (state: LegacyCompatState, campaign: FoodCampaignRecord) => {
  const existing = state.campaignMetaByCampaignId.get(campaign.id);
  if (existing) {
    existing.joinMode = "all";
    existing.joinPassword = "";
    existing.inviteeUserIds = [];
    return existing;
  }
  const created: LegacyCampaignMeta = {
    templateKey: "daily",
    joinMode: "all",
    joinPassword: "",
    maxVotesPerUser: 1,
    closedAtUnix: campaign.status === "closed" ? toUnixSeconds(campaign.updatedAt || campaign.deadlineAtIso) : 0,
    inviteeUserIds: [],
  };
  state.campaignMetaByCampaignId.set(campaign.id, created);
  return created;
};

const syncCampaignStatusByDeadline = (store: NexusStore, state: LegacyCompatState) => {
  const nowMs = Date.now();
  store.foodCampaigns.forEach((campaign) => {
    const meta = ensureCampaignMeta(state, campaign);
    if (campaign.status === "closed") {
      if (!Number(meta.closedAtUnix || 0)) {
        meta.closedAtUnix = toUnixSeconds(campaign.updatedAt || campaign.deadlineAtIso);
      }
      return;
    }
    if (campaign.status !== "open") {
      return;
    }
    const deadlineMs = Date.parse(campaign.deadlineAtIso || "");
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > nowMs) {
      return;
    }
    campaign.status = "closed";
    campaign.updatedAt = storeHelpers.nowIso();
    meta.closedAtUnix = toUnixSeconds(deadlineMs);
  });
};

const resolveCampaignVotes = (store: ReturnType<typeof getNexusStore>, campaignId: string) => {
  return store.foodCampaignVotes.filter((item) => item.campaignId === campaignId);
};

const resolveCampaignRuntimeStatus = (campaign: FoodCampaignRecord): FoodCampaignRecord["status"] => {
  if (campaign.status !== "open") {
    return campaign.status;
  }
  const deadlineMs = Date.parse(campaign.deadlineAtIso || "");
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return campaign.status;
  }
  if (deadlineMs <= Date.now()) {
    return "closed";
  }
  return campaign.status;
};

const getCampaignMetaReadonly = (state: LegacyCompatState, campaign: FoodCampaignRecord): LegacyCampaignMeta => {
  const existing = state.campaignMetaByCampaignId.get(campaign.id);
  if (existing) {
    return {
      ...existing,
      inviteeUserIds: Array.isArray(existing.inviteeUserIds) ? [...existing.inviteeUserIds] : [],
    };
  }
  return {
    templateKey: "daily",
    joinMode: "all",
    joinPassword: "",
    maxVotesPerUser: 1,
    closedAtUnix: campaign.status === "closed" ? toUnixSeconds(campaign.updatedAt || campaign.deadlineAtIso) : 0,
    inviteeUserIds: [],
  };
};

const getCampaignParticipantsReadonly = (state: LegacyCompatState, campaign: FoodCampaignRecord) => {
  const existing = state.campaignParticipantsByCampaignId.get(campaign.id);
  if (existing) {
    return new Map(
      Array.from(existing.entries()).map(([userId, participant]) => [userId, { ...participant } as LegacyCampaignParticipant]),
    );
  }
  const created = new Map<string, LegacyCampaignParticipant>();
  created.set(campaign.createdByUserId, {
    userId: campaign.createdByUserId,
    source: "creator",
    approvalStatus: "approved",
  });
  return created;
};

const resolveCampaignClosedAtUnix = (
  campaign: FoodCampaignRecord,
  meta: LegacyCampaignMeta,
  runtimeStatus: FoodCampaignRecord["status"],
) => {
  if (Number(meta.closedAtUnix || 0) > 0) {
    return Number(meta.closedAtUnix || 0);
  }
  if (runtimeStatus !== "closed") {
    return 0;
  }
  return toUnixSeconds(campaign.updatedAt || campaign.deadlineAtIso);
};

const toLegacyCampaignSummary = (
  store: NexusStore,
  state: LegacyCompatState,
  campaign: FoodCampaignRecord,
) => {
  const meta = getCampaignMetaReadonly(state, campaign);
  const participants = getCampaignParticipantsReadonly(state, campaign);
  const runtimeStatus = resolveCampaignRuntimeStatus(campaign);
  const approvedHeadcount = Array.from(participants.values()).filter((item) => item.approvalStatus === "approved").length;
  const creator = store.users.find((item) => item.userId === campaign.createdByUserId) || null;
  const categoryCounter = new Map<string, { categoryName: string; count: number }>();
  campaign.optionFoodIds.forEach((foodId) => {
    const food = store.foodItems.find((item) => item.id === foodId) || null;
    if (!food) {
      return;
    }
    const existing = categoryCounter.get(food.categoryKey);
    if (!existing) {
      categoryCounter.set(food.categoryKey, {
        categoryName: food.categoryName,
        count: 1,
      });
      return;
    }
    existing.count += 1;
  });
  const categoryHighlights = Array.from(categoryCounter.entries())
    .map(([categoryKey, payload]) => ({
      categoryKey,
      categoryName: payload.categoryName,
      count: payload.count,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
  return {
    campaignId: campaign.id,
    title: campaign.title,
    initiatorStudentId: creator?.studentId || creator?.studentNo || creator?.userId || "",
    templateKey: meta.templateKey,
    status: runtimeStatus,
    joinMode: meta.joinMode,
    shareToken: campaign.shareToken,
    candidateCount: campaign.optionFoodIds.length,
    headcount: approvedHeadcount,
    deadlineAt: toUnixSeconds(campaign.deadlineAtIso),
    createdAt: toUnixSeconds(campaign.createdAt),
    closedAt: resolveCampaignClosedAtUnix(campaign, meta, runtimeStatus),
    isAnonymous: campaign.isAnonymous,
    categoryHighlights,
  };
};

const toLegacyCampaignDetail = (
  store: NexusStore,
  state: LegacyCompatState,
  campaign: FoodCampaignRecord,
  viewerUser: UserRecord,
  shareToken: string,
) => {
  const meta = getCampaignMetaReadonly(state, campaign);
  const participants = getCampaignParticipantsReadonly(state, campaign);
  const runtimeStatus = resolveCampaignRuntimeStatus(campaign);
  const canApprove = campaign.createdByUserId === viewerUser.userId || isAdminRole(viewerUser);
  const candidateRows = campaign.optionFoodIds
    .map((foodId, index) => {
      const food = store.foodItems.find((item) => item.id === foodId) || null;
      if (!food) {
        return null;
      }
      const legacyFoodKey = state.foodKeyBySourceFoodId.get(food.id) || `${index + 1}`;
      const numericId = Number(legacyFoodKey);
      const votes = resolveCampaignVotes(store, campaign.id).filter((vote) => vote.foodId === food.id);
      const approvedHeadcount = Array.from(participants.values()).filter((item) => item.approvalStatus === "approved").length;
      const rule = store.foodPricingRules.find((item) => item.categoryKey === food.categoryKey) || null;
      const factor = rule ? resolvePricingFactor(rule, Math.max(1, approvedHeadcount)) : 1;
      const caloriesKcal = normalizeCaloriesKcal(food.caloriesKcal, 0);
      return {
        id: Number.isFinite(numericId) && numericId > 0 ? numericId : index + 1,
        sourceFoodId: food.id,
        name: food.name,
        categoryKey: food.categoryKey,
        distanceKm: Number((0.8 + index * 0.45).toFixed(2)),
        voteCount: votes.length,
        dynamicPriceMin: Number((food.priceMin * factor).toFixed(2)),
        dynamicPriceMax: Number((food.priceMax * factor).toFixed(2)),
        caloriesKcal,
        exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(caloriesKcal),
        slotIndex: index + 1,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const candidateNameBySourceId = new Map(candidateRows.map((item) => [item.sourceFoodId, item.name]));
  const votes = resolveCampaignVotes(store, campaign.id);
  const viewerSelectedFoodIds = votes
    .filter((item) => item.userId === viewerUser.userId)
    .map((item) => {
      const key = state.foodKeyBySourceFoodId.get(item.foodId) || "";
      const numeric = Number(key);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    })
    .filter((item) => item > 0);

  let voteDetailsVisibility = "none";
  if (!campaign.isAnonymous) {
    voteDetailsVisibility = "all";
  } else if (runtimeStatus === "open") {
    voteDetailsVisibility = "self";
  } else if (shareToken && shareToken === campaign.shareToken) {
    voteDetailsVisibility = "all";
  } else if (canApprove) {
    voteDetailsVisibility = "all";
  }

  const voteDetailsSource = new Map<string, Set<string>>();
  votes.forEach((vote) => {
    if (voteDetailsVisibility === "none") {
      return;
    }
    if (voteDetailsVisibility === "self" && vote.userId !== viewerUser.userId) {
      return;
    }
    const selectedNames = voteDetailsSource.get(vote.userId) || new Set<string>();
    const name = candidateNameBySourceId.get(vote.foodId) || vote.foodId;
    selectedNames.add(name);
    voteDetailsSource.set(vote.userId, selectedNames);
  });
  const voteDetails = Array.from(voteDetailsSource.entries()).map(([voterUserId, selected]) => {
    const voter = store.users.find((item) => item.userId === voterUserId) || null;
    return {
      voterStudentId: voter?.studentId || voter?.studentNo || voterUserId,
      voterName: voter ? resolveUserDisplayLabel(voter) : voterUserId,
      selectedFoodNames: Array.from(selected.values()),
    };
  });

  const participantItems = Array.from(participants.values()).map((participant) => {
    const user = store.users.find((item) => item.userId === participant.userId) || null;
    return {
      studentId: user?.studentId || user?.studentNo || participant.userId,
      name: user ? resolveUserDisplayLabel(user) : participant.userId,
      source: participant.source,
      approvalStatus: participant.approvalStatus,
    };
  });

  const canVote = runtimeStatus === "open";
  return {
    ...toLegacyCampaignSummary(store, state, campaign),
    canVote,
    canApprove,
    canSupplement: canApprove && runtimeStatus === "open" && candidateRows.length < FOOD_CAMPAIGN_OPTION_LIMIT,
    maxVotesPerUser: Math.max(1, Math.min(3, Number(meta.maxVotesPerUser || 1))),
    viewerVoteFoodIds: viewerSelectedFoodIds,
    voteDetailsVisibility,
    voteDetails,
    candidates: candidateRows.map(({ sourceFoodId, ...item }) => item),
    participants: participantItems,
  };
};

const appendCampaignVotes = (
  store: NexusStore,
  campaign: FoodCampaignRecord,
  userId: string,
  sourceFoodIds: string[],
) => {
  store.foodCampaignVotes = store.foodCampaignVotes.filter(
    (item) => !(item.campaignId === campaign.id && item.userId === userId),
  );
  sourceFoodIds.forEach((sourceFoodId) => {
    const vote: FoodCampaignVoteRecord = {
      id: storeHelpers.createId("campaign_vote"),
      campaignId: campaign.id,
      userId,
      foodId: sourceFoodId,
      score: 1,
      createdAt: storeHelpers.nowIso(),
    };
    store.foodCampaignVotes.push(vote);
  });
};

const resolvePublishedEntriesByUser = (store: NexusStore, user: UserRecord) => {
  const versionEntries = getEffectiveScheduleEntriesForUser(store, user);
  const dedup = new Map<string, ScheduleEntryRecord>();
  versionEntries.forEach((entry) => {
    const key = `${entry.day}_${entry.startSection}_${entry.endSection}_${entry.courseName}_${entry.weekExpr}_${entry.parity}`;
    if (dedup.has(key)) {
      return;
    }
    dedup.set(key, {
      ...entry,
      id: entry.id || storeHelpers.createId("entry"),
    });
  });
  return Array.from(dedup.values()).sort((left, right) => {
    if (left.day !== right.day) {
      return left.day - right.day;
    }
    return left.startSection - right.startSection;
  });
};

const toLegacyScheduleStudentPayload = (
  store: NexusStore,
  targetUser: UserRecord,
  accountUser: UserRecord,
) => {
  const entries = resolvePublishedEntriesByUser(store, targetUser);
  return {
    id: targetUser.studentId || targetUser.userId,
    name: resolveUserDisplayLabel(targetUser),
    studentNo: targetUser.studentNo,
    classLabel: targetUser.classLabel,
    courses: entries.map((entry) => ({
      id: entry.id,
      name: entry.courseName,
      day: entry.day,
      startSection: entry.startSection,
      endSection: entry.endSection,
      weekExpr: entry.weekExpr,
      parity: entry.parity,
      classroom: entry.classroom || null,
      teacher: entry.teacher || null,
      teachingClasses: targetUser.classLabel || null,
      practiceCourseKey: `${targetUser.studentId || targetUser.userId}:${entry.day}:${entry.startSection}:${entry.endSection}:${entry.courseName}`,
    })),
    avatarUrl: accountUser.avatarUrl,
    wallpaperUrl: accountUser.wallpaperUrl,
  };
};

const ensureTargetRandomCode = (state: LegacyCompatState, targetUserId: string, providedCode: string) => {
  const expectedCode = state.randomCodeByUserId.get(targetUserId) || "";
  if (!expectedCode) {
    return;
  }
  if (!providedCode || providedCode !== expectedCode) {
    createLegacyError(400, "RANDOM_CODE_REQUIRED", "订阅或绑定他人课表需要验证码");
  }
};

const removeScheduleSubscriptionsByTarget = (
  store: NexusStore,
  subscriberUserId: string,
  targetUser: UserRecord,
) => {
  const targetClassIds = new Set(targetUser.classIds);
  const targetScheduleIds = store.schedules.filter((item) => targetClassIds.has(item.classId)).map((item) => item.id);
  if (targetScheduleIds.length === 0) {
    return;
  }
  store.scheduleSubscriptions = store.scheduleSubscriptions.filter((item) => {
    if (item.subscriberUserId !== subscriberUserId) {
      return true;
    }
    return !targetScheduleIds.includes(item.sourceScheduleId);
  });
};

const ensureScheduleSubscriptionsByTarget = (
  store: NexusStore,
  subscriberUserId: string,
  targetUser: UserRecord,
) => {
  const targetClassIds = new Set(targetUser.classIds);
  const targetScheduleIds = store.schedules.filter((item) => targetClassIds.has(item.classId)).map((item) => item.id);
  targetScheduleIds.forEach((scheduleId) => {
    const existing = store.scheduleSubscriptions.find(
      (item) => item.subscriberUserId === subscriberUserId && item.sourceScheduleId === scheduleId,
    );
    if (existing) {
      return;
    }
    store.scheduleSubscriptions.push({
      id: storeHelpers.createId("schedule_sub"),
      subscriberUserId,
      sourceScheduleId: scheduleId,
      baseVersionNo: 1,
      followMode: "following",
      createdAt: storeHelpers.nowIso(),
    });
  });
};

const findUserByUserId = (store: NexusStore, userId: string) => {
  const normalized = asString(userId);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.userId === normalized) || null;
};

const createSocialNotification = (
  store: NexusStore,
  input: {
    type: SocialNotificationRecord["type"];
    recipientUserId: string;
    actorUserId: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  },
) => {
  const existing = store.socialNotifications.find((item) => {
    return (
      item.type === input.type &&
      item.recipientUserId === input.recipientUserId &&
      item.actorUserId === input.actorUserId &&
      JSON.stringify(item.payload || {}) === JSON.stringify(input.payload || {}) &&
      item.status === "unread"
    );
  });
  if (existing) {
    return existing;
  }
  const notification: SocialNotificationRecord = {
    id: storeHelpers.createId("notify"),
    type: input.type,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    title: input.title,
    body: input.body,
    payload: input.payload || {},
    status: "unread",
    createdAt: storeHelpers.nowIso(),
    readAt: "",
  };
  store.socialNotifications.unshift(notification);
  return notification;
};

const toSocialNotificationPayload = (store: NexusStore, item: SocialNotificationRecord) => {
  const actor = findUserByUserId(store, item.actorUserId);
  return {
    notificationId: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    status: item.status,
    actorUserId: item.actorUserId,
    actorName: actor ? resolveUserDisplayLabel(actor) : "",
    recipientUserId: item.recipientUserId,
    payload: item.payload || {},
    createdAt: item.createdAt,
    readAt: item.readAt || "",
  };
};

const toSocialUserBrief = (user: UserRecord | null) => {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    studentId: user.studentId || "",
    studentNo: user.studentNo || "",
    name: resolveUserDisplayLabel(user),
    classLabel: user.classLabel || "",
    avatarUrl: user.avatarUrl || "",
  };
};

const findActiveSocialEdge = (
  store: NexusStore,
  subscriberUserId: string,
  targetUserId: string,
) => {
  return (
    store.socialSubscriptionEdges.find((item) => {
      return (
        item.subscriberUserId === subscriberUserId &&
        item.targetUserId === targetUserId &&
        item.status === "active"
      );
    }) || null
  );
};

const upsertSocialSubscriptionEdge = (
  store: NexusStore,
  state: LegacyCompatState,
  input: {
    subscriberUserId: string;
    targetUser: UserRecord;
    visibilityScope: SocialVisibilityScope;
    source: SocialSubscriptionEdgeRecord["source"];
    circleId?: string;
  },
) => {
  const visibilityScope = normalizeVisibilityScope(input.visibilityScope);
  const existing = findActiveSocialEdge(store, input.subscriberUserId, input.targetUser.userId);
  if (existing) {
    existing.visibilityScope = pickStrongerVisibilityScope(existing.visibilityScope, visibilityScope);
    existing.source = existing.source === "request" ? existing.source : input.source;
    existing.circleId = existing.circleId || input.circleId || "";
    existing.updatedAt = storeHelpers.nowIso();
  } else {
    const edge: SocialSubscriptionEdgeRecord = {
      id: storeHelpers.createId("social_edge"),
      subscriberUserId: input.subscriberUserId,
      targetUserId: input.targetUser.userId,
      visibilityScope,
      source: input.source,
      circleId: input.circleId || "",
      status: "active",
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
      revokedAt: "",
    };
    store.socialSubscriptionEdges.push(edge);
  }
  if (visibilityScope === "busy_free" || visibilityScope === "detail") {
    ensureSet(state.subscriptionTargetsByUserId, input.subscriberUserId).add(input.targetUser.userId);
    ensureScheduleSubscriptionsByTarget(store, input.subscriberUserId, input.targetUser);
  }
};

const upsertBlockedSocialEdge = (
  store: NexusStore,
  subscriberUserId: string,
  targetUserId: string,
) => {
  const existing = findActiveSocialEdge(store, subscriberUserId, targetUserId);
  if (existing) {
    existing.visibilityScope = "blocked";
    existing.source = "legacy";
    existing.updatedAt = storeHelpers.nowIso();
    return existing;
  }
  const edge: SocialSubscriptionEdgeRecord = {
    id: storeHelpers.createId("social_edge"),
    subscriberUserId,
    targetUserId,
    visibilityScope: "blocked",
    source: "legacy",
    circleId: "",
    status: "active",
    createdAt: storeHelpers.nowIso(),
    updatedAt: storeHelpers.nowIso(),
    revokedAt: "",
  };
  store.socialSubscriptionEdges.push(edge);
  return edge;
};

const blockSocialSubscriptionBetweenUsers = (
  store: NexusStore,
  state: LegacyCompatState,
  leftUser: UserRecord,
  rightUser: UserRecord,
) => {
  const leftEdge = upsertBlockedSocialEdge(store, leftUser.userId, rightUser.userId);
  const rightEdge = upsertBlockedSocialEdge(store, rightUser.userId, leftUser.userId);
  ensureSet(state.subscriptionTargetsByUserId, leftUser.userId).delete(rightUser.userId);
  ensureSet(state.subscriptionTargetsByUserId, rightUser.userId).delete(leftUser.userId);
  removeScheduleSubscriptionsByTarget(store, leftUser.userId, rightUser);
  removeScheduleSubscriptionsByTarget(store, rightUser.userId, leftUser);
  return [leftEdge, rightEdge];
};

const revokeSocialSubscriptionBetweenUsers = (
  store: NexusStore,
  state: LegacyCompatState,
  leftUser: UserRecord,
  rightUser: UserRecord,
) => {
  let removed = false;
  store.socialSubscriptionEdges.forEach((edge) => {
    const matches =
      (edge.subscriberUserId === leftUser.userId && edge.targetUserId === rightUser.userId) ||
      (edge.subscriberUserId === rightUser.userId && edge.targetUserId === leftUser.userId);
    if (!matches || edge.status !== "active") {
      return;
    }
    edge.status = "revoked";
    edge.revokedAt = storeHelpers.nowIso();
    edge.updatedAt = edge.revokedAt;
    removed = true;
  });
  ensureSet(state.subscriptionTargetsByUserId, leftUser.userId).delete(rightUser.userId);
  ensureSet(state.subscriptionTargetsByUserId, rightUser.userId).delete(leftUser.userId);
  removeScheduleSubscriptionsByTarget(store, leftUser.userId, rightUser);
  removeScheduleSubscriptionsByTarget(store, rightUser.userId, leftUser);
  return removed;
};

const resolveViewerVisibilityScope = (
  store: NexusStore,
  viewer: UserRecord,
  target: UserRecord,
): SocialVisibilityScope => {
  if (viewer.userId === target.userId || isAdminRole(viewer)) {
    return "detail";
  }
  const directEdge = findActiveSocialEdge(store, viewer.userId, target.userId);
  if (directEdge?.visibilityScope === "blocked") {
    return "blocked";
  }
  let scope = directEdge ? normalizeVisibilityScope(directEdge.visibilityScope, "hidden") : "hidden";
  const viewerCircleIds = new Set(
    store.socialCircleMembers
      .filter((item) => item.userId === viewer.userId && item.status === "active")
      .map((item) => item.circleId),
  );
  store.socialCircleMembers
    .filter((item) => item.userId === target.userId && item.status === "active" && viewerCircleIds.has(item.circleId))
    .forEach((item) => {
      scope = pickStrongerVisibilityScope(scope, normalizeVisibilityScope(item.visibilityScope, "hidden"));
    });
  return scope;
};

const toSubscriptionRequestPayload = (store: NexusStore, state: LegacyCompatState, item: SocialSubscriptionRequestRecord) => {
  const requester = findUserByUserId(store, item.requesterUserId);
  const target = findUserByUserId(store, item.targetUserId);
  return {
    requestId: item.id,
    status: item.status,
    requestedVisibility: item.requestedVisibility,
    decidedVisibility: item.decidedVisibility,
    requester: requester ? toLegacySocialUser(requester, state) : null,
    target: target ? toLegacySocialUser(target, state) : null,
    decidedAt: item.decidedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const toCirclePayload = (store: NexusStore, item: SocialCircleRecord) => {
  const members = store.socialCircleMembers.filter((member) => member.circleId === item.id && member.status === "active");
  return {
    circleId: item.id,
    name: item.name,
    circleType: item.circleType,
    inviteToken: item.inviteToken,
    status: item.status,
    memberCount: members.length,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const buildActivityTimeLabel = (activity: Pick<SocialActivityRecord, "week" | "day" | "startSection" | "endSection">) => {
  const startSlot = getSectionTimeBySection(activity.startSection);
  const endSlot = getSectionTimeBySection(activity.endSection);
  const weekday = SCHEDULE_WEEKDAY_LABELS[Math.max(1, activity.day) - 1] || "一";
  const timeRange = startSlot && endSlot ? `${startSlot.start}-${endSlot.end}` : `第 ${activity.startSection}-${activity.endSection} 节`;
  return `第 ${activity.week} 周 周${weekday} ${timeRange}`;
};

const toActivityPayload = (store: NexusStore, item: SocialActivityRecord, viewerUserId = "") => {
  const invitations = store.socialActivityInvitations.filter((invite) => invite.activityId === item.id);
  const viewerInvitation = invitations.find((invite) => invite.inviteeUserId === viewerUserId) || null;
  const creator = findUserByUserId(store, item.createdByUserId);
  return {
    activityId: item.id,
    title: item.title,
    activityType: item.activityType,
    status: item.status,
    createdBy: toSocialUserBrief(creator),
    week: item.week,
    day: item.day,
    startSection: item.startSection,
    endSection: item.endSection,
    timeLabel: buildActivityTimeLabel(item),
    participantStudentIds: item.participantUserIds
      .map((userId) => findUserByUserId(store, userId)?.studentId || "")
      .filter((studentId) => studentId),
    participants: item.participantUserIds
      .map((userId) => toSocialUserBrief(findUserByUserId(store, userId)))
      .filter((user): user is NonNullable<typeof user> => Boolean(user)),
    invitations: invitations.map((invite) => ({
      invitationId: invite.id,
      status: invite.status,
      invitee: toSocialUserBrief(findUserByUserId(store, invite.inviteeUserId)),
      inviter: toSocialUserBrief(findUserByUserId(store, invite.inviterUserId)),
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      respondedAt: invite.respondedAt,
    })),
    viewerInvitation: viewerInvitation
      ? {
          invitationId: viewerInvitation.id,
          status: viewerInvitation.status,
          respondedAt: viewerInvitation.respondedAt,
        }
      : null,
    invitationStats: {
      pending: invitations.filter((invite) => invite.status === "pending").length,
      accepted: invitations.filter((invite) => invite.status === "accepted").length,
      declined: invitations.filter((invite) => invite.status === "declined").length,
    },
    calendarPath: `/api/v1/social/activities/calendar.ics?activityId=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.calendarToken)}`,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const normalizeStudentIdList = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  value.forEach((item) => {
    const studentId = asString(item);
    if (!studentId || seen.has(studentId)) {
      return;
    }
    seen.add(studentId);
    result.push(studentId);
  });
  return result;
};

const toIcsDateTime = (iso: string) => {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

const buildActivityIcs = (activity: SocialActivityRecord) => {
  const startSlot = getSectionTimeBySection(activity.startSection) || SCHEDULE_SECTION_TIMES[0];
  const endSlot = getSectionTimeBySection(activity.endSection) || startSlot;
  const dateKey = addDaysToDateKey(SCHEDULE_TERM_META.week1Monday, (Math.max(1, activity.week) - 1) * 7 + Math.max(0, activity.day - 1));
  const startIso = zonedDateTimeToUtc(dateKey, startSlot.start, SCHEDULE_DEFAULT_TIMEZONE).toISOString();
  const endIso = zonedDateTimeToUtc(dateKey, endSlot.end, SCHEDULE_DEFAULT_TIMEZONE).toISOString();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TouchX//Schedule Activity//CN",
    "BEGIN:VEVENT",
    `UID:${activity.id}@touchx-schedule`,
    `DTSTAMP:${toIcsDateTime(activity.createdAt)}`,
    `DTSTART:${toIcsDateTime(startIso)}`,
    `DTEND:${toIcsDateTime(endIso)}`,
    `SUMMARY:${activity.title}`,
    `DESCRIPTION:${asString(activity.metadata?.description) || "简程组局活动"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

const normalizeMoneyAmount = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Number(amount.toFixed(2));
};

const buildEqualActivitySplit = (activity: SocialActivityRecord, participantUsers: UserRecord[], totalAmount: number, currency: string) => {
  const normalizedTotal = normalizeMoneyAmount(totalAmount);
  const members = participantUsers.length > 0 ? participantUsers : [];
  if (normalizedTotal <= 0 || members.length <= 0) {
    return {
      totalAmount: 0,
      currency,
      perPerson: [],
      updatedAt: storeHelpers.nowIso(),
    };
  }
  const cents = Math.round(normalizedTotal * 100);
  const baseCents = Math.floor(cents / members.length);
  let remainder = cents - baseCents * members.length;
  return {
    totalAmount: Number((cents / 100).toFixed(2)),
    currency,
    perPerson: members.map((user) => {
      const extra = remainder > 0 ? 1 : 0;
      remainder = Math.max(0, remainder - 1);
      return {
        userId: user.userId,
        studentId: user.studentId || "",
        name: resolveUserDisplayLabel(user),
        amount: Number(((baseCents + extra) / 100).toFixed(2)),
      };
    }),
    activityId: activity.id,
    updatedAt: storeHelpers.nowIso(),
  };
};

const eventMatchesWeekAndCell = (
  event: Pick<UserScheduleEventRecord, "weekExpr" | "parity" | "day" | "startSection" | "endSection">,
  week: number,
  day: number,
  section: number,
) => {
  return (
    event.day === day &&
    event.startSection <= section &&
    event.endSection >= section &&
    isScheduleEntryInWeek({ weekExpr: event.weekExpr, parity: event.parity }, week)
  );
};

const isUserBusyAtCell = (store: NexusStore, user: UserRecord, week: number, day: number, section: number) => {
  const courseBusy = getEffectiveScheduleEntriesForUser(store, user).some((entry) => {
    return (
      entry.day === day &&
      entry.startSection <= section &&
      entry.endSection >= section &&
      isScheduleEntryInWeek(entry, week)
    );
  });
  if (courseBusy) {
    return true;
  }
  return store.userScheduleEvents
    .filter((item) => item.userId === user.userId)
    .some((item) => eventMatchesWeekAndCell(item, week, day, section));
};

const resolveHeatmapUsers = (
  store: NexusStore,
  viewer: UserRecord,
  query: Record<string, unknown>,
) => {
  const circleId = asString(query.circleId || query.circle_id);
  if (circleId) {
    const circle = ensureValue(
      store.socialCircles.find((item) => item.id === circleId || item.inviteToken === circleId) || null,
      404,
      "CIRCLE_NOT_FOUND",
      "圈子不存在",
    );
    const viewerMember = store.socialCircleMembers.find(
      (item) => item.circleId === circle.id && item.userId === viewer.userId && item.status === "active",
    );
    if (!viewerMember && !isAdminRole(viewer)) {
      createLegacyError(403, "CIRCLE_FORBIDDEN", "无权查看该圈子热力图");
    }
    return store.socialCircleMembers
      .filter((item) => item.circleId === circle.id && item.status === "active")
      .map((item) => findUserByUserId(store, item.userId))
      .filter((item): item is UserRecord => Boolean(item))
      .slice(0, 80);
  }

  const studentIds = asString(query.studentIds || query.student_ids)
    .split(",")
    .map((item) => asString(item))
    .filter((item) => item);
  const users = [viewer, ...studentIds.map((studentId) => findUserByStudentId(store, studentId)).filter((item): item is UserRecord => Boolean(item))];
  const seen = new Set<string>();
  return users
    .filter((target) => {
      if (seen.has(target.userId)) {
        return false;
      }
      seen.add(target.userId);
      const scope = resolveViewerVisibilityScope(store, viewer, target);
      return scope === "busy_free" || scope === "detail";
    })
    .slice(0, 40);
};

const buildFreeHeatmapPayload = (store: NexusStore, users: UserRecord[], week: number) => {
  const cells = SCHEDULE_SECTION_TIMES.flatMap((slot) => {
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const day = dayIndex + 1;
      const busyUsers = users.filter((user) => isUserBusyAtCell(store, user, week, day, slot.section));
      const totalCount = users.length;
      const busyCount = busyUsers.length;
      const freeCount = Math.max(0, totalCount - busyCount);
      return {
        week,
        day,
        dayLabel: `周${SCHEDULE_WEEKDAY_LABELS[day - 1] || "一"}`,
        section: slot.section,
        startTime: slot.start,
        endTime: slot.end,
        totalCount,
        busyCount,
        freeCount,
        freeRatio: totalCount > 0 ? Number((freeCount / totalCount).toFixed(4)) : 0,
      };
    });
  });
  return {
    week,
    participantCount: users.length,
    participants: users.map((user) => toSocialUserBrief(user)),
    cells,
  };
};

const estimateActivitySuccess = (
  store: NexusStore,
  input: {
    activityType: string;
    day: number;
    startSection: number;
    participantUserIds: string[];
  },
) => {
  const sameTypeActivities = store.socialActivities.filter((item) => item.activityType === input.activityType);
  const historical = sameTypeActivities.filter((item) => {
    const participantSet = new Set(item.participantUserIds);
    return input.participantUserIds.some((userId) => participantSet.has(userId));
  });
  const confirmedCount = historical.filter((item) => item.status === "confirmed").length;
  const historicalRate = historical.length > 0 ? confirmedCount / historical.length : 0;
  let score = historical.length >= 3 ? historicalRate : 0.68;
  if (input.day >= 1 && input.day <= 5 && input.startSection >= 9) {
    score += 0.08;
  }
  if (input.startSection <= 2 || input.day >= 6) {
    score -= 0.08;
  }
  if (input.participantUserIds.length >= 6) {
    score -= 0.06;
  }
  const successRate = Math.max(0.2, Math.min(0.95, score));
  const suggestions: string[] = [];
  if (input.startSection <= 2) {
    suggestions.push("避开早八时段，改到晚间通常确认率更高");
  }
  if (input.participantUserIds.length >= 6) {
    suggestions.push("参与人数较多，建议先确认核心成员再扩散邀请");
  }
  if (input.day >= 6) {
    suggestions.push("周末安排建议提前一天提醒，降低临时爽约");
  }
  if (suggestions.length === 0) {
    suggestions.push("当前时间段适合直接发起，确认后可同步日历");
  }
  return {
    successRate: Number(successRate.toFixed(2)),
    confidence: historical.length >= 5 ? "medium" : "low",
    sampleCount: historical.length,
    suggestions,
  };
};

const buildSmartReminderLead = (input: { distanceMeters: number; activityType: string; locationLabel: string }) => {
  const walkingMinutes = Math.ceil(Math.max(0, input.distanceMeters) / 80);
  const lowerType = input.activityType.toLowerCase();
  const isExam = /exam|考试|期末|期中/.test(lowerType);
  const isMeal = /meal|food|聚餐|吃饭/.test(lowerType);
  const location = input.locationLabel;
  let bufferMinutes = 5;
  if (isExam) {
    bufferMinutes = 15;
  } else if (/教室|教学楼|实验室|library|图书馆/.test(location)) {
    bufferMinutes = 8;
  } else if (isMeal) {
    bufferMinutes = 3;
  }
  const leadMinutes = Math.max(5, Math.min(90, walkingMinutes + bufferMinutes));
  return {
    leadMinutes,
    walkingMinutes,
    bufferMinutes,
    reason: `按步行 ${walkingMinutes} 分钟 + 预留 ${bufferMinutes} 分钟计算`,
  };
};

const maskScheduleStudentPayloadByVisibility = <T extends { courses?: Array<Record<string, unknown>> }>(
  payload: T,
  visibilityScope: SocialVisibilityScope,
) => {
  if (visibilityScope === "detail") {
    return payload;
  }
  return {
    ...payload,
    courses: (payload.courses || []).map((course) => ({
      ...course,
      name: "忙碌",
      classroom: null,
      teacher: null,
      teachingClasses: null,
      practiceCourseKey: null,
    })),
  };
};

const toGreeting = (now = new Date(), timeZone = SCHEDULE_DEFAULT_TIMEZONE) => {
  const hour = toDateTimeParts(now, timeZone).hour;
  if (hour < 6) {
    return "夜深了，注意休息";
  }
  if (hour < 12) {
    return "早上好，开启高效学习";
  }
  if (hour < 18) {
    return "下午好，继续保持状态";
  }
  return "晚上好，记得规划明天";
};

const toLegacyPath = (event: H3Event) => {
  return normalizeRoutePath(event).replace(/^\/+/, "");
};

const toTodayBriefPayload = (store: NexusStore, studentId: string) => {
  const user = findUserByStudentId(store, studentId) || store.users[0] || null;
  const serverNow = new Date();
  const serverTimezone = user ? getUserReminderTimezone(store, user) : SCHEDULE_DEFAULT_TIMEZONE;
  const currentWeek = resolveCurrentWeekForDate(serverNow, serverTimezone);
  if (!user) {
    return {
      studentId: "",
      studentName: "",
      weekNo: currentWeek,
      dayNo: 1,
      dayLabel: "周一",
      greeting: toGreeting(serverNow, serverTimezone),
      tips: ["暂无可用课表数据"],
      serverNowIso: serverNow.toISOString(),
      serverTimezone,
      termMeta: SCHEDULE_TERM_META,
      currentWeek,
      generatedAt: storeHelpers.nowIso(),
    };
  }
  const now = serverNow;
  const nowParts = toDateTimeParts(now, serverTimezone);
  const dayNo = toAcademicWeekDay(now, serverTimezone);
  const dayLabel = `周${SCHEDULE_WEEKDAY_LABELS[dayNo - 1] || "一"}`;
  const entries = getEffectiveScheduleEntriesForUser(store, user).filter((item) => {
    return item.day === dayNo && isScheduleEntryInWeek(item, currentWeek);
  });
  const sorted = [...entries].sort((left, right) => left.startSection - right.startSection);
  const nowTs = now.getTime();
  const nextCandidate = sorted
    .map((entry) => {
      const entryTimezone = entry.timezone || serverTimezone;
      const startSlot = getSectionTimeBySection(entry.startSection) || null;
      const endSlot = getSectionTimeBySection(entry.endSection) || null;
      if (!startSlot || !endSlot) {
        return null;
      }
      const startTs = zonedDateTimeToUtc(nowParts.dateKey, startSlot.start, entryTimezone).getTime();
      const endTs = zonedDateTimeToUtc(nowParts.dateKey, endSlot.end, entryTimezone).getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
        return null;
      }
      return {
        entry,
        startSlot,
        endSlot,
        startTs,
        endTs,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.endTs > nowTs)
    .sort((left, right) => left.startTs - right.startTs)[0] || null;
  const tips: string[] = [];
  if (sorted.length === 0) {
    tips.push("今日无课，可安排复习或运动");
  } else if (sorted.length >= 4) {
    tips.push("今日课量较多，建议提前准备水和充电设备");
  } else {
    tips.push("按节奏推进，保持专注");
  }
  const payload = {
    studentId: user.studentId || user.userId,
    studentName: resolveMeaningfulUserName(user) || resolveUserDisplayLabel(user),
    weekNo: currentWeek,
    dayNo,
    dayLabel,
    greeting: toGreeting(now, serverTimezone),
    weather: {
      status: "cloudy",
      summary: "天气平稳，适合出行",
      temperature: "18℃~24℃",
      advice: "建议携带水杯",
    },
    nextCourse: nextCandidate
      ? {
          name: nextCandidate.entry.courseName,
          startSection: nextCandidate.entry.startSection,
          endSection: nextCandidate.entry.endSection,
          startTime: nextCandidate.startSlot.start,
          endTime: nextCandidate.endSlot.end,
          minutesToStart: Math.max(1, Math.ceil((nextCandidate.startTs - nowTs) / (60 * 1000))),
          classroom: nextCandidate.entry.classroom || null,
          teacher: nextCandidate.entry.teacher || null,
          buildingLabel: "教学区",
          commuteMinutes: dayNo === 5 && nextCandidate.startSlot.start === "14:30" ? 60 : 12,
          prepMinutes: 10,
          leaveInMinutes: Math.max(
            0,
            Math.ceil((nextCandidate.startTs - nowTs) / (60 * 1000)) - (dayNo === 5 && nextCandidate.startSlot.start === "14:30" ? 60 : 12),
          ),
          prepareItems: ["学生卡", "水杯"],
          from: "cloud",
        }
      : null,
    tips,
    serverNowIso: now.toISOString(),
    serverTimezone,
    termMeta: SCHEDULE_TERM_META,
    currentWeek,
    generatedAt: storeHelpers.nowIso(),
  };
  return payload;
};

const buildCampaignStats = (store: NexusStore, state: LegacyCompatState, recentDays: number) => {
  const now = Date.now();
  const threshold = now - Math.max(1, recentDays) * 24 * 60 * 60 * 1000;
  const scopedCampaigns = store.foodCampaigns.filter((item) => {
    const createdAt = Date.parse(item.createdAt);
    return Number.isFinite(createdAt) ? createdAt >= threshold : true;
  });
  const scopedCampaignIdSet = new Set(scopedCampaigns.map((item) => item.id));
  const scopedVotes = store.foodCampaignVotes.filter((item) => scopedCampaignIdSet.has(item.campaignId));
  const voterSet = new Set(scopedVotes.map((item) => item.userId));
  const foodCounter = new Map<string, number>();
  scopedVotes.forEach((vote) => {
    const current = foodCounter.get(vote.foodId) || 0;
    foodCounter.set(vote.foodId, current + 1);
  });
  const selectionCount = scopedVotes.length;
  const topFoods = Array.from(foodCounter.entries())
    .map(([foodId, selectedCount]) => {
      const food = store.foodItems.find((item) => item.id === foodId) || null;
      return {
        foodId: Number(state.foodKeyBySourceFoodId.get(foodId) || 0),
        name: food?.name || foodId,
        categoryKey: food?.categoryKey || "",
        categoryName: food?.categoryName || "",
        selectedCount,
        ratio: selectionCount > 0 ? Number((selectedCount / selectionCount).toFixed(4)) : 0,
      };
    })
    .sort((left, right) => right.selectedCount - left.selectedCount);

  const categoryCounter = new Map<string, { categoryName: string; selectedCount: number }>();
  topFoods.forEach((item) => {
    const key = item.categoryKey || "other";
    const existing = categoryCounter.get(key);
    if (!existing) {
      categoryCounter.set(key, {
        categoryName: item.categoryName || item.categoryKey || "其他",
        selectedCount: item.selectedCount || 0,
      });
      return;
    }
    existing.selectedCount += item.selectedCount || 0;
  });
  const topCategories = Array.from(categoryCounter.entries())
    .map(([categoryKey, payload]) => ({
      categoryKey,
      categoryName: payload.categoryName,
      selectedCount: payload.selectedCount,
      ratio: selectionCount > 0 ? Number((payload.selectedCount / selectionCount).toFixed(4)) : 0,
    }))
    .sort((left, right) => right.selectedCount - left.selectedCount);

  return {
    recentDays,
    campaignCount: scopedCampaigns.length,
    activeCampaignCount: scopedCampaigns.filter((item) => resolveCampaignRuntimeStatus(item) === "open").length,
    voterCount: voterSet.size,
    selectionCount,
    mostSelectedFood: topFoods[0] || null,
    mostSelectedCategory: topCategories[0] || null,
    topFoods: topFoods.slice(0, 5),
    topCategories: topCategories.slice(0, 5),
  };
};

export const handleSocialV1Api = async (event: H3Event) => {
  const store = getNexusStore();
  const state = getLegacyState(store);
  const method = getMethod(event).toUpperCase();
  const query = getQuery(event) as Record<string, unknown>;
  const path = toLegacyPath(event);
  if (method !== "GET" && path.startsWith("social/food-campaigns")) {
    syncCampaignStatusByDeadline(store, state);
  }
  const pickFoodTemplate = () => {
    return (
      store.foodItems[store.foodItems.length - 1] ||
      store.foodItems[0] ||
      ({
        id: "",
        name: "临时加菜",
        categoryKey: "other",
        categoryName: "其他",
        merchantName: "临时商家",
        latitude: 31.23,
        longitude: 121.47,
        priceMin: 18,
        priceMax: 30,
        caloriesKcal: 520,
      } as FoodItemRecord)
    );
  };

  if (path === "auth/wechat-login" && method !== "POST") {
    createLegacyError(405, "AUTH_WECHAT_LOGIN_METHOD_NOT_ALLOWED", "auth/wechat-login 仅支持 POST");
  }

  if (method === "POST" && path === "auth/wechat-login") {
    const body = await readJsonBody<{
      code?: string;
      studentId?: string;
      student_id?: string;
      studentNo?: string;
      student_no?: string;
      nickname?: string;
      avatarUrl?: string;
      avatar_url?: string;
      clientPlatform?: string;
      client_platform?: string;
      mode?: "wechat" | "mock";
    }>(event);
    const code = asString(body.code);
    const studentId = asString(body.studentId || body.student_id);
    const studentNo = asString(body.studentNo || body.student_no);
    const nickname = asString(body.nickname);
    const avatarUrl = normalizeProfileAvatarUrl(body.avatarUrl || body.avatar_url);
    if (!code) {
      createLegacyError(400, "WECHAT_CODE_REQUIRED", "请先完成微信授权");
    }
    if (!studentNo) {
      createLegacyError(400, "STUDENT_NO_REQUIRED", "请先填写学号");
    }
    if (!/^\d{6,32}$/.test(studentNo)) {
      createLegacyError(400, "STUDENT_NO_INVALID", "学号格式不正确，请检查后重试");
    }

    let accountUser =
      findUserByStudentNo(store, studentNo) ||
      findUserByStudentId(store, studentId) ||
      null;
    if (!accountUser) {
      accountUser = {
        userId: storeHelpers.createId("user"),
        studentNo: studentNo || `${Date.now()}`.slice(-8),
        studentId: "",
        name: "",
        classLabel: "",
        nickname: nickname || "",
        avatarUrl: avatarUrl || "",
        wallpaperUrl: "",
        classIds: [],
        adminRole: "none",
        reminderEnabled: true,
        reminderWindowMinutes: [30, 15],
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      };
      store.users.push(accountUser);
      state.randomCodeByUserId.set(accountUser.userId, randomCodeByStudentNo(accountUser.studentNo));
      state.notifyBoundUserIds.delete(accountUser.userId);
      state.practiceCourseKeysByUserId.set(accountUser.userId, new Set<string>());
      state.subscriptionTargetsByUserId.set(accountUser.userId, new Set<string>());
      state.bindingTargetUserIdByUserId.set(accountUser.userId, accountUser.userId);
    }

    if (nickname) {
      accountUser.nickname = nickname;
    }
    if (avatarUrl) {
      accountUser.avatarUrl = avatarUrl;
    }
    accountUser.updatedAt = storeHelpers.nowIso();

    const bindTarget = findUserByStudentId(store, studentId) || findUserByStudentNo(store, studentNo) || accountUser;
    if (avatarUrl && bindTarget.userId !== accountUser.userId) {
      bindTarget.avatarUrl = avatarUrl;
      bindTarget.updatedAt = storeHelpers.nowIso();
    }
    state.bindingTargetUserIdByUserId.set(accountUser.userId, bindTarget.userId);
    if (bindTarget.studentId) {
      state.notifyBoundUserIds.add(accountUser.userId);
    }
    const session = createSession(event, accountUser, "user", 24 * 14);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      mode: "mock",
      user: toLegacyAuthUser(accountUser, bindTarget, state),
    };
  }

  if (method === "GET" && path === "auth/me") {
    const { session, user } = resolveLegacyAuthContext(event);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    return {
      ok: true,
      mode: "mock",
      expiresAt: session.expiresAt,
      user: toLegacyAuthUser(user, bindTarget, state),
    };
  }

  if (method === "POST" && path === "auth/logout") {
    const { token } = resolveLegacyAuthContext(event);
    revokeSession(token);
    return { ok: true };
  }

  if (method === "POST" && path === "auth/unbind") {
    const { token, user } = resolveLegacyAuthContext(event);
    state.bindingTargetUserIdByUserId.set(user.userId, user.userId);
    state.notifyBoundUserIds.delete(user.userId);
    revokeSession(token);
    return { ok: true, unbound: true };
  }

  if (method === "GET" && path === "notifications") {
    const { user } = resolveLegacyAuthContext(event);
    const limit = Math.max(1, Math.min(100, Number(query.limit || 50)));
    const items = store.socialNotifications
      .filter((item) => item.recipientUserId === user.userId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit)
      .map((item) => toSocialNotificationPayload(store, item));
    return {
      ok: true,
      unreadCount: items.filter((item) => item.status === "unread").length,
      items,
      stateRevision: getNexusStoreRevision(),
    };
  }

  const notificationReadMatch = path.match(/^notifications\/([^/]+)\/read$/);
  if (method === "POST" && notificationReadMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const notificationId = decodeURIComponent(notificationReadMatch[1]);
    const notification = ensureValue(
      store.socialNotifications.find((item) => item.id === notificationId && item.recipientUserId === user.userId) || null,
      404,
      "NOTIFICATION_NOT_FOUND",
      "通知不存在",
    );
    notification.status = "read";
    notification.readAt = storeHelpers.nowIso();
    return { ok: true, notification: toSocialNotificationPayload(store, notification) };
  }

  if (method === "GET" && path === "social/me") {
    const { user } = resolveLegacyAuthContext(event);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    const me = toLegacySocialUser(bindTarget, state, {
      accountUser: user,
      randomCodeOwnerUserId: bindTarget.userId,
    });
    const targets = state.subscriptionTargetsByUserId.get(user.userId) || new Set<string>();
    const subscriptions = Array.from(targets.values())
      .map((targetUserId) => store.users.find((item) => item.userId === targetUserId) || null)
      .filter((item): item is UserRecord => Boolean(item))
      .filter((item) => item.studentId !== "")
      .map((item) => toLegacySocialUser(item, state));
    const subscribers = store.users
      .filter((candidate) => {
        const set = state.subscriptionTargetsByUserId.get(candidate.userId);
        return Boolean(set && set.has(bindTarget.userId));
      })
      .filter((item) => item.studentId !== "")
      .map((item) => toLegacySocialUser(item, state));
    const subscribedStudentIds = new Set(subscriptions.map((item) => item.studentId));
    const candidates = store.users
      .filter((item) => item.studentId !== "")
      .filter((item) => item.userId !== bindTarget.userId)
      .filter((item) => !subscribedStudentIds.has(item.studentId || ""))
      .map((item) => toLegacySocialUser(item, state));
    return {
      ok: true,
      me,
      subscriptions,
      subscribers,
      candidates,
      subscriptionRequests: store.socialSubscriptionRequests
        .filter((item) => item.requesterUserId === user.userId || item.targetUserId === bindTarget.userId)
        .map((item) => toSubscriptionRequestPayload(store, state, item)),
      circles: store.socialCircleMembers
        .filter((item) => item.userId === user.userId && item.status === "active")
        .map((item) => store.socialCircles.find((circle) => circle.id === item.circleId) || null)
        .filter((item): item is SocialCircleRecord => Boolean(item))
        .map((item) => toCirclePayload(store, item)),
      unreadNotificationCount: store.socialNotifications.filter(
        (item) => item.recipientUserId === user.userId && item.status === "unread",
      ).length,
      bound: Boolean(bindTarget.studentId),
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "GET" && path === "social/subscription-requests") {
    const { user } = resolveLegacyAuthContext(event);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    const items = store.socialSubscriptionRequests
      .filter((item) => item.requesterUserId === user.userId || item.targetUserId === bindTarget.userId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((item) => toSubscriptionRequestPayload(store, state, item));
    return { ok: true, items, stateRevision: getNexusStoreRevision() };
  }

  if (method === "POST" && path === "social/subscription-requests") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      targetStudentId?: string;
      target_student_id?: string;
      visibilityScope?: string;
      visibility_scope?: string;
    }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      createLegacyError(400, "SUBSCRIBE_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = ensureValue(
      findUserByStudentId(store, targetStudentId),
      404,
      "SUBSCRIBE_TARGET_NOT_FOUND",
      "目标课表不存在",
    );
    if (targetUser.userId === user.userId) {
      createLegacyError(400, "SUBSCRIBE_SELF_NOT_ALLOWED", "不能订阅自己");
    }
    const visibilityScope = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, "busy_free");
    const activeEdge = findActiveSocialEdge(store, user.userId, targetUser.userId);
    if (activeEdge) {
      return {
        ok: true,
        alreadySubscribed: true,
        visibilityScope: activeEdge.visibilityScope,
        stateRevision: getNexusStoreRevision(),
      };
    }
    const existing = store.socialSubscriptionRequests.find((item) => {
      return item.requesterUserId === user.userId && item.targetUserId === targetUser.userId && item.status === "pending";
    });
    const request =
      existing ||
      ({
        id: storeHelpers.createId("sub_req"),
        requesterUserId: user.userId,
        targetUserId: targetUser.userId,
        requestedVisibility: visibilityScope,
        status: "pending",
        decidedVisibility: "hidden",
        decidedAt: "",
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      } satisfies SocialSubscriptionRequestRecord);
    if (!existing) {
      store.socialSubscriptionRequests.push(request);
      createSocialNotification(store, {
        type: "subscription_request",
        recipientUserId: targetUser.userId,
        actorUserId: user.userId,
        title: "新的订阅请求",
        body: `${resolveUserDisplayLabel(user)} 想查看你的日程空闲状态`,
        payload: { requestId: request.id, visibilityScope },
      });
    }
    return {
      ok: true,
      pending: true,
      request: toSubscriptionRequestPayload(store, state, request),
      stateRevision: getNexusStoreRevision(),
    };
  }

  const subscriptionRequestDecisionMatch = path.match(/^social\/subscription-requests\/([^/]+)\/decision$/);
  if (method === "POST" && subscriptionRequestDecisionMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const requestId = decodeURIComponent(subscriptionRequestDecisionMatch[1]);
    const request = ensureValue(
      store.socialSubscriptionRequests.find((item) => item.id === requestId) || null,
      404,
      "SUBSCRIPTION_REQUEST_NOT_FOUND",
      "订阅请求不存在",
    );
    if (request.targetUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "SUBSCRIPTION_REQUEST_FORBIDDEN", "仅被请求人可处理订阅请求");
    }
    if (request.status !== "pending") {
      return {
        ok: true,
        request: toSubscriptionRequestPayload(store, state, request),
        stateRevision: getNexusStoreRevision(),
      };
    }
    const body = await readJsonBody<{ decision?: string; visibilityScope?: string; visibility_scope?: string }>(event);
    const decision = asString(body.decision);
    const requester = ensureValue(findUserByUserId(store, request.requesterUserId), 404, "REQUESTER_NOT_FOUND", "请求人不存在");
    const target = ensureValue(findUserByUserId(store, request.targetUserId), 404, "TARGET_NOT_FOUND", "被请求人不存在");
    request.updatedAt = storeHelpers.nowIso();
    request.decidedAt = request.updatedAt;
    if (decision === "reject" || decision === "rejected") {
      request.status = "rejected";
      request.decidedVisibility = "hidden";
      createSocialNotification(store, {
        type: "subscription_rejected",
        recipientUserId: requester.userId,
        actorUserId: target.userId,
        title: "订阅请求已拒绝",
        body: `${resolveUserDisplayLabel(target)} 拒绝了你的订阅请求`,
        payload: { requestId: request.id },
      });
      return {
        ok: true,
        request: toSubscriptionRequestPayload(store, state, request),
        stateRevision: getNexusStoreRevision(),
      };
    }
    const decidedVisibility = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, request.requestedVisibility);
    if (decidedVisibility === "hidden" || decidedVisibility === "blocked") {
      request.status = "rejected";
      request.decidedVisibility = decidedVisibility;
    } else {
      request.status = "accepted";
      request.decidedVisibility = decidedVisibility;
      upsertSocialSubscriptionEdge(store, state, {
        subscriberUserId: requester.userId,
        targetUser: target,
        visibilityScope: decidedVisibility,
        source: "request",
      });
      upsertSocialSubscriptionEdge(store, state, {
        subscriberUserId: target.userId,
        targetUser: requester,
        visibilityScope: "busy_free",
        source: "request",
      });
      createSocialNotification(store, {
        type: "subscription_accepted",
        recipientUserId: requester.userId,
        actorUserId: target.userId,
        title: "订阅请求已通过",
        body: `${resolveUserDisplayLabel(target)} 已同意你的订阅请求`,
        payload: { requestId: request.id, visibilityScope: decidedVisibility },
      });
    }
    return {
      ok: true,
      request: toSubscriptionRequestPayload(store, state, request),
      stateRevision: getNexusStoreRevision(),
    };
  }

  const socialSubscriptionDeleteMatch = path.match(/^social\/subscriptions\/([^/]+)$/);
  if (method === "DELETE" && socialSubscriptionDeleteMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const subscriptionId = decodeURIComponent(socialSubscriptionDeleteMatch[1]);
    const edge = ensureValue(
      store.socialSubscriptionEdges.find((item) => item.id === subscriptionId && item.status === "active") || null,
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "订阅关系不存在",
    );
    if (edge.subscriberUserId !== user.userId && edge.targetUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "SUBSCRIPTION_DELETE_FORBIDDEN", "无权解除该订阅关系");
    }
    const left = ensureValue(findUserByUserId(store, edge.subscriberUserId), 404, "SUBSCRIBER_NOT_FOUND", "订阅人不存在");
    const right = ensureValue(findUserByUserId(store, edge.targetUserId), 404, "TARGET_NOT_FOUND", "被订阅人不存在");
    const removed = revokeSocialSubscriptionBetweenUsers(store, state, left, right);
    createSocialNotification(store, {
      type: "subscription_revoked",
      recipientUserId: user.userId === left.userId ? right.userId : left.userId,
      actorUserId: user.userId,
      title: "订阅关系已解除",
      body: `${resolveUserDisplayLabel(user)} 解除了订阅关系`,
      payload: { subscriptionId },
    });
    return { ok: true, removed, stateRevision: getNexusStoreRevision() };
  }

  if (method === "POST" && path === "social/subscriptions/block") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      createLegacyError(400, "BLOCK_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = ensureValue(
      findUserByStudentId(store, targetStudentId),
      404,
      "BLOCK_TARGET_NOT_FOUND",
      "目标用户不存在",
    );
    if (targetUser.userId === user.userId) {
      createLegacyError(400, "BLOCK_SELF_NOT_ALLOWED", "不能屏蔽自己");
    }
    const edges = blockSocialSubscriptionBetweenUsers(store, state, user, targetUser);
    createSocialNotification(store, {
      type: "subscription_revoked",
      recipientUserId: targetUser.userId,
      actorUserId: user.userId,
      title: "订阅可见性已变更",
      body: `${resolveUserDisplayLabel(user)} 已将订阅可见性设为不可见`,
      payload: { targetStudentId, visibilityScope: "blocked" },
    });
    return {
      ok: true,
      blocked: true,
      edges,
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "GET" && path === "social/circles") {
    const { user } = resolveLegacyAuthContext(event);
    const circles = store.socialCircleMembers
      .filter((item) => item.userId === user.userId && item.status === "active")
      .map((item) => store.socialCircles.find((circle) => circle.id === item.circleId) || null)
      .filter((item): item is SocialCircleRecord => Boolean(item))
      .map((item) => toCirclePayload(store, item));
    return { ok: true, items: circles, stateRevision: getNexusStoreRevision() };
  }

  if (method === "POST" && path === "social/circles") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ name?: string; circleType?: "class" | "club" | "custom"; circle_type?: "class" | "club" | "custom" }>(event);
    const name = asString(body.name);
    if (!name) {
      createLegacyError(400, "CIRCLE_NAME_REQUIRED", "圈子名称不能为空");
    }
    const circleType = body.circleType || body.circle_type || "custom";
    const circle: SocialCircleRecord = {
      id: storeHelpers.createId("circle"),
      name,
      circleType: circleType === "class" || circleType === "club" ? circleType : "custom",
      ownerUserId: user.userId,
      inviteToken: storeHelpers.generateShareToken(),
      status: "active",
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    const member: SocialCircleMemberRecord = {
      id: storeHelpers.createId("circle_member"),
      circleId: circle.id,
      userId: user.userId,
      role: "owner",
      visibilityScope: "detail",
      status: "active",
      joinedAt: circle.createdAt,
      leftAt: "",
      updatedAt: circle.createdAt,
    };
    store.socialCircles.push(circle);
    store.socialCircleMembers.push(member);
    return { ok: true, circle: toCirclePayload(store, circle), stateRevision: getNexusStoreRevision() };
  }

  const circleJoinMatch = path.match(/^social\/circles\/([^/]+)\/join$/);
  if (method === "POST" && circleJoinMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const circleKey = decodeURIComponent(circleJoinMatch[1]);
    const body = await readJsonBody<{ inviteToken?: string; invite_token?: string; visibilityScope?: string; visibility_scope?: string }>(event);
    const inviteToken = asString(body.inviteToken || body.invite_token || circleKey);
    const circle = ensureValue(
      store.socialCircles.find((item) => item.id === circleKey || item.inviteToken === inviteToken) || null,
      404,
      "CIRCLE_NOT_FOUND",
      "圈子不存在",
    );
    if (circle.status !== "active") {
      createLegacyError(400, "CIRCLE_INACTIVE", "圈子已停用");
    }
    if (circle.inviteToken !== inviteToken && circle.id !== circleKey) {
      createLegacyError(400, "CIRCLE_INVITE_INVALID", "邀请链接无效");
    }
    const visibilityScope = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, "busy_free");
    let member = store.socialCircleMembers.find((item) => item.circleId === circle.id && item.userId === user.userId) || null;
    if (member) {
      member.status = "active";
      member.leftAt = "";
      member.visibilityScope = visibilityScope;
      member.updatedAt = storeHelpers.nowIso();
    } else {
      member = {
        id: storeHelpers.createId("circle_member"),
        circleId: circle.id,
        userId: user.userId,
        role: "member",
        visibilityScope,
        status: "active",
        joinedAt: storeHelpers.nowIso(),
        leftAt: "",
        updatedAt: storeHelpers.nowIso(),
      };
      store.socialCircleMembers.push(member);
    }
    store.socialCircleMembers
      .filter((item) => item.circleId === circle.id && item.status === "active" && item.userId !== user.userId)
      .forEach((item) => {
        const targetUser = findUserByUserId(store, item.userId);
        if (!targetUser) {
          return;
        }
        upsertSocialSubscriptionEdge(store, state, {
          subscriberUserId: user.userId,
          targetUser,
          visibilityScope: item.visibilityScope,
          source: "circle",
          circleId: circle.id,
        });
        upsertSocialSubscriptionEdge(store, state, {
          subscriberUserId: targetUser.userId,
          targetUser: user,
          visibilityScope,
          source: "circle",
          circleId: circle.id,
        });
      });
    createSocialNotification(store, {
      type: "circle_joined",
      recipientUserId: circle.ownerUserId,
      actorUserId: user.userId,
      title: "圈子有新成员加入",
      body: `${resolveUserDisplayLabel(user)} 加入了 ${circle.name}`,
      payload: { circleId: circle.id },
    });
    return { ok: true, circle: toCirclePayload(store, circle), member, stateRevision: getNexusStoreRevision() };
  }

  const circleLeaveMatch = path.match(/^social\/circles\/([^/]+)\/leave$/);
  if (method === "POST" && circleLeaveMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const circleId = decodeURIComponent(circleLeaveMatch[1]);
    const circle = ensureValue(
      store.socialCircles.find((item) => item.id === circleId || item.inviteToken === circleId) || null,
      404,
      "CIRCLE_NOT_FOUND",
      "圈子不存在",
    );
    const member = ensureValue(
      store.socialCircleMembers.find((item) => item.circleId === circle.id && item.userId === user.userId && item.status === "active") || null,
      404,
      "CIRCLE_MEMBER_NOT_FOUND",
      "你尚未加入该圈子",
    );
    member.status = "left";
    member.leftAt = storeHelpers.nowIso();
    member.updatedAt = member.leftAt;
    store.socialSubscriptionEdges.forEach((edge) => {
      if (edge.circleId !== circle.id || edge.status !== "active") {
        return;
      }
      if (edge.subscriberUserId !== user.userId && edge.targetUserId !== user.userId) {
        return;
      }
      edge.status = "revoked";
      edge.revokedAt = storeHelpers.nowIso();
      edge.updatedAt = edge.revokedAt;
      ensureSet(state.subscriptionTargetsByUserId, edge.subscriberUserId).delete(edge.targetUserId);
      const targetUser = findUserByUserId(store, edge.targetUserId);
      if (targetUser) {
        removeScheduleSubscriptionsByTarget(store, edge.subscriberUserId, targetUser);
      }
    });
    createSocialNotification(store, {
      type: "circle_left",
      recipientUserId: circle.ownerUserId,
      actorUserId: user.userId,
      title: "圈子成员已退出",
      body: `${resolveUserDisplayLabel(user)} 已退出 ${circle.name}`,
      payload: { circleId: circle.id },
    });
    return { ok: true, left: true, circleId: circle.id, stateRevision: getNexusStoreRevision() };
  }

  if (method === "GET" && path === "social/free-heatmap") {
    const { user } = resolveLegacyAuthContext(event);
    const week = Math.max(1, Math.min(SCHEDULE_TERM_META.maxWeek, Math.trunc(Number(query.week || 1))));
    const users = resolveHeatmapUsers(store, user, query);
    return {
      ok: true,
      heatmap: buildFreeHeatmapPayload(store, users, week),
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/activities/predict") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      activityType?: string;
      activity_type?: string;
      day?: number;
      startSection?: number;
      start_section?: number;
      participantStudentIds?: string[];
      participant_student_ids?: string[];
    }>(event);
    const participantUsers = normalizeStudentIdList(body.participantStudentIds || body.participant_student_ids)
      .map((studentId) => findUserByStudentId(store, studentId))
      .filter((item): item is UserRecord => Boolean(item));
    const participantUserIds = Array.from(new Set([user.userId, ...participantUsers.map((item) => item.userId)]));
    const prediction = estimateActivitySuccess(store, {
      activityType: asString(body.activityType || body.activity_type) || "study",
      day: Math.max(1, Math.min(7, Math.trunc(Number(body.day || 1)))),
      startSection: Math.max(1, Math.trunc(Number(body.startSection || body.start_section || 1))),
      participantUserIds,
    });
    return {
      ok: true,
      prediction,
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/reminders/smart-lead") {
    resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      distanceMeters?: number;
      distance_meters?: number;
      activityType?: string;
      activity_type?: string;
      locationLabel?: string;
      location_label?: string;
    }>(event);
    const reminder = buildSmartReminderLead({
      distanceMeters: Number(body.distanceMeters || body.distance_meters || 0),
      activityType: asString(body.activityType || body.activity_type),
      locationLabel: asString(body.locationLabel || body.location_label),
    });
    return {
      ok: true,
      reminder,
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "GET" && path === "social/activities") {
    const { user } = resolveLegacyAuthContext(event);
    const items = store.socialActivities
      .filter((item) => item.createdByUserId === user.userId || item.participantUserIds.includes(user.userId))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((item) => toActivityPayload(store, item, user.userId));
    return { ok: true, items, stateRevision: getNexusStoreRevision() };
  }

  if (method === "GET" && path === "social/activities/calendar.ics") {
    const activityId = asString(query.activityId || query.activity_id);
    const calendarToken = asString(query.token || query.calendarToken || query.calendar_token);
    const activity = ensureValue(
      store.socialActivities.find((item) => item.id === activityId) || null,
      404,
      "ACTIVITY_NOT_FOUND",
      "活动不存在",
    );
    if (calendarToken !== activity.calendarToken) {
      const { user } = resolveLegacyAuthContext(event);
      if (activity.createdByUserId !== user.userId && !activity.participantUserIds.includes(user.userId) && !isAdminRole(user)) {
        createLegacyError(403, "ACTIVITY_FORBIDDEN", "无权导出该活动");
      }
    }
    setHeader(event, "content-type", "text/calendar; charset=utf-8");
    setHeader(event, "content-disposition", `attachment; filename=\"${encodeURIComponent(activity.title)}.ics\"`);
    return buildActivityIcs(activity);
  }

  const activitySnapshotMatch = path.match(/^social\/activities\/([^/]+)\/snapshot$/);
  if (method === "GET" && activitySnapshotMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const activityId = decodeURIComponent(activitySnapshotMatch[1]);
    const activity = ensureValue(
      store.socialActivities.find((item) => item.id === activityId) || null,
      404,
      "ACTIVITY_NOT_FOUND",
      "活动不存在",
    );
    if (activity.createdByUserId !== user.userId && !activity.participantUserIds.includes(user.userId) && !isAdminRole(user)) {
      createLegacyError(403, "ACTIVITY_FORBIDDEN", "无权查看该活动");
    }
    const participants = activity.participantUserIds
      .map((userId) => findUserByUserId(store, userId))
      .filter((item): item is UserRecord => Boolean(item));
    const card = {
      title: activity.title,
      status: activity.status,
      statusLabel: activity.status === "confirmed" ? "已确认" : activity.status === "inviting" ? "邀请中" : "待发送",
      timeLabel: buildActivityTimeLabel(activity),
      participants: participants.map((item) => resolveUserDisplayLabel(item)),
      shareText: `「${activity.title}」${buildActivityTimeLabel(activity)}，参与人：${participants
        .map((item) => resolveUserDisplayLabel(item))
        .join("、")}`,
      calendarPath: `/api/v1/social/activities/calendar.ics?activityId=${encodeURIComponent(activity.id)}&token=${encodeURIComponent(activity.calendarToken)}`,
    };
    return {
      ok: true,
      card,
      stateRevision: getNexusStoreRevision(),
    };
  }

  const activitySplitMatch = path.match(/^social\/activities\/([^/]+)\/splits$/);
  if (method === "POST" && activitySplitMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const activityId = decodeURIComponent(activitySplitMatch[1]);
    const activity = ensureValue(
      store.socialActivities.find((item) => item.id === activityId) || null,
      404,
      "ACTIVITY_NOT_FOUND",
      "活动不存在",
    );
    if (activity.createdByUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "ACTIVITY_SPLIT_FORBIDDEN", "仅发起人可编辑分摊");
    }
    const body = await readJsonBody<{ totalAmount?: number; total_amount?: number; currency?: string }>(event);
    const participantUsers = activity.participantUserIds
      .map((userId) => findUserByUserId(store, userId))
      .filter((item): item is UserRecord => Boolean(item));
    const split = buildEqualActivitySplit(
      activity,
      participantUsers,
      normalizeMoneyAmount(body.totalAmount || body.total_amount),
      asString(body.currency) || "CNY",
    );
    activity.metadata = {
      ...(activity.metadata || {}),
      split,
    };
    activity.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      split,
      activity: toActivityPayload(store, activity, user.userId),
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/activities") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      title?: string;
      activityType?: string;
      activity_type?: string;
      week?: number;
      day?: number;
      startSection?: number;
      start_section?: number;
      endSection?: number;
      end_section?: number;
      participantStudentIds?: string[];
      participant_student_ids?: string[];
      description?: string;
      sendNow?: boolean;
    }>(event);
    const title = asString(body.title) || "新的组局";
    const activityType = asString(body.activityType || body.activity_type) || "study";
    const week = Math.max(1, Math.min(SCHEDULE_TERM_META.maxWeek, Math.trunc(Number(body.week || 1))));
    const day = Math.max(1, Math.min(7, Math.trunc(Number(body.day || 1))));
    const startSection = Math.max(1, Math.trunc(Number(body.startSection || body.start_section || 1)));
    const endSection = Math.max(startSection, Math.trunc(Number(body.endSection || body.end_section || startSection)));
    const participantUsers = normalizeStudentIdList(body.participantStudentIds || body.participant_student_ids)
      .map((studentId) => findUserByStudentId(store, studentId))
      .filter((item): item is UserRecord => Boolean(item));
    const participantUserIds = Array.from(new Set([user.userId, ...participantUsers.map((item) => item.userId)]));
    const status = body.sendNow === false ? "draft" : resolveNextActivityStatus("draft", "send");
    const activity: SocialActivityRecord = {
      id: storeHelpers.createId("activity"),
      title,
      activityType,
      status,
      createdByUserId: user.userId,
      participantUserIds,
      week,
      day,
      startSection,
      endSection,
      calendarToken: storeHelpers.generateShareToken(),
      metadata: { description: asString(body.description) },
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.socialActivities.push(activity);
    participantUsers.forEach((targetUser) => {
      const invitation: SocialActivityInvitationRecord = {
        id: storeHelpers.createId("activity_invite"),
        activityId: activity.id,
        inviterUserId: user.userId,
        inviteeUserId: targetUser.userId,
        status: "pending",
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
        respondedAt: "",
      };
      store.socialActivityInvitations.push(invitation);
      createSocialNotification(store, {
        type: "activity_invite",
        recipientUserId: targetUser.userId,
        actorUserId: user.userId,
        title: "新的组局邀请",
        body: `${resolveUserDisplayLabel(user)} 邀请你参加「${title}」`,
        payload: { activityId: activity.id, invitationId: invitation.id },
      });
    });
    return { ok: true, activity: toActivityPayload(store, activity, user.userId), stateRevision: getNexusStoreRevision() };
  }

  const activityInvitationRespondMatch = path.match(/^social\/activities\/([^/]+)\/invitations\/([^/]+)\/respond$/);
  if (method === "POST" && activityInvitationRespondMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const activityId = decodeURIComponent(activityInvitationRespondMatch[1]);
    const invitationId = decodeURIComponent(activityInvitationRespondMatch[2]);
    const activity = ensureValue(
      store.socialActivities.find((item) => item.id === activityId) || null,
      404,
      "ACTIVITY_NOT_FOUND",
      "活动不存在",
    );
    const invitation = ensureValue(
      store.socialActivityInvitations.find((item) => item.id === invitationId && item.activityId === activity.id) || null,
      404,
      "ACTIVITY_INVITATION_NOT_FOUND",
      "活动邀请不存在",
    );
    if (invitation.inviteeUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "ACTIVITY_INVITATION_FORBIDDEN", "无权处理该活动邀请");
    }
    const body = await readJsonBody<{ action?: string }>(event);
    const action = asString(body.action);
    invitation.status = action === "decline" || action === "declined" ? "declined" : "accepted";
    invitation.respondedAt = storeHelpers.nowIso();
    invitation.updatedAt = invitation.respondedAt;
    activity.updatedAt = invitation.updatedAt;
    const invitations = store.socialActivityInvitations.filter((item) => item.activityId === activity.id);
    if (invitations.length > 0 && invitations.every((item) => item.status === "accepted")) {
      activity.status = resolveNextActivityStatus(activity.status, "confirm");
      activity.participantUserIds = Array.from(new Set([activity.createdByUserId, ...invitations.map((item) => item.inviteeUserId)]));
      activity.participantUserIds.forEach((recipientUserId) => {
        createSocialNotification(store, {
          type: "activity_confirmed",
          recipientUserId,
          actorUserId: user.userId,
          title: "组局已确认",
          body: `「${activity.title}」已确认，可导出日历`,
          payload: { activityId: activity.id },
        });
      });
    }
    return {
      ok: true,
      invitation,
      activity: toActivityPayload(store, activity, user.userId),
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "POST" && path === "ai/schedule/parse") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ text?: string }>(event);
    const text = asString(body.text);
    if (!text) {
      createLegacyError(400, "AI_SCHEDULE_TEXT_REQUIRED", "请输入需要解析的日程文本");
    }
    const intelligence = buildScheduleIntelligence(text);
    return {
      ok: true,
      provider: "rules",
      candidates: [
        {
          title: text.slice(0, 48),
          description: text,
          tags: intelligence.tags,
          priorityLabel: intelligence.priorityLabel,
          priorityScore: intelligence.priorityScore,
          repeatWeekdays: intelligence.repeatWeekdays,
          day: intelligence.suggestedDay,
          startSection: intelligence.suggestedStartSection,
          endSection: intelligence.suggestedEndSection,
          weekExpr: "1-20",
          parity: "all",
          examLike: intelligence.examLike,
          confidence: intelligence.confidence,
        },
      ],
      userId: user.userId,
    };
  }

  if (method === "POST" && path === "ai/schedule/commit") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      title?: string;
      description?: string;
      day?: number;
      startSection?: number;
      start_section?: number;
      endSection?: number;
      end_section?: number;
      weekExpr?: string;
      week_expr?: string;
      parity?: "all" | "odd" | "even";
      tags?: string[];
    }>(event);
    const title = asString(body.title);
    if (!title) {
      createLegacyError(400, "SCHEDULE_EVENT_TITLE_REQUIRED", "日程标题不能为空");
    }
    const intelligence = buildScheduleIntelligence(`${title} ${asString(body.description)}`);
    const eventRecord: UserScheduleEventRecord = {
      id: storeHelpers.createId("user_event"),
      userId: user.userId,
      title,
      description: asString(body.description),
      source: intelligence.examLike ? "exam" : "ai",
      day: Math.max(1, Math.min(7, Math.trunc(Number(body.day || intelligence.repeatWeekdays[0] || 1)))),
      startSection: Math.max(1, Math.trunc(Number(body.startSection || body.start_section || intelligence.suggestedStartSection || 1))),
      endSection: Math.max(
        1,
        Math.trunc(Number(body.endSection || body.end_section || body.startSection || body.start_section || intelligence.suggestedEndSection || 1)),
      ),
      weekExpr: asString(body.weekExpr || body.week_expr) || "1-20",
      parity: body.parity === "odd" || body.parity === "even" ? body.parity : "all",
      tags: Array.isArray(body.tags) && body.tags.length > 0 ? body.tags.map((item) => asString(item)).filter((item) => item) : intelligence.tags,
      priorityScore: intelligence.priorityScore,
      priorityLabel: intelligence.priorityLabel,
      examDate: "",
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    eventRecord.endSection = Math.max(eventRecord.startSection, eventRecord.endSection);
    store.userScheduleEvents.push(eventRecord);
    return { ok: true, event: eventRecord, stateRevision: getNexusStoreRevision() };
  }

  if (method === "GET" && path === "exams/companion") {
    const { user } = resolveLegacyAuthContext(event);
    const examEvents = store.userScheduleEvents
      .filter((item) => item.userId === user.userId && (item.source === "exam" || /考试|期末|期中|补考/.test(item.title)))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    return {
      ok: true,
      countdowns: examEvents.map((item) => ({
        eventId: item.id,
        title: item.title,
        examDate: item.examDate,
        priorityLabel: item.priorityLabel,
      })),
      studyRoomRecommendations: [
        { label: "图书馆 3F 东区", timeRange: "08:30-10:00", reason: "历史低峰时段，适合早复习" },
        { label: "教学楼 B 区自习室", timeRange: "19:00-21:00", reason: "晚间稳定开放，距离教学区近" },
      ],
      precreatedActivities: store.socialActivities
        .filter((item) => item.createdByUserId === user.userId && item.activityType === "exam-after")
        .map((item) => toActivityPayload(store, item, user.userId)),
    };
  }

  if (method === "POST" && path === "schedule-import/corrections") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ jobId?: string; originalPayload?: Record<string, unknown>; correctedPayload?: Record<string, unknown> }>(event);
    const correction: ScheduleCorrectionRecord = {
      id: storeHelpers.createId("schedule_correction"),
      userId: user.userId,
      jobId: asString(body.jobId),
      originalPayload: body.originalPayload && typeof body.originalPayload === "object" ? body.originalPayload : {},
      correctedPayload: body.correctedPayload && typeof body.correctedPayload === "object" ? body.correctedPayload : {},
      createdAt: storeHelpers.nowIso(),
    };
    store.scheduleCorrections.push(correction);
    return { ok: true, correction, stateRevision: getNexusStoreRevision() };
  }

  if (method === "POST" && path === "social/profile") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      studentNo?: string;
      student_no?: string;
      nickname?: string;
      name?: string;
      classLabel?: string;
      class_label?: string;
      wallpaperUrl?: string;
      wallpaper_url?: string;
      avatarUrl?: string;
      avatar_url?: string;
    }>(event);
    const hasStudentNoField =
      Object.prototype.hasOwnProperty.call(body, "studentNo") || Object.prototype.hasOwnProperty.call(body, "student_no");
    const studentNo = asString(body.studentNo || body.student_no);
    if (hasStudentNoField) {
      if (!studentNo) {
        createLegacyError(400, "STUDENT_NO_REQUIRED", "学号不能为空");
      }
      if (!/^\d{6,32}$/.test(studentNo)) {
        createLegacyError(400, "STUDENT_NO_INVALID", "学号格式不正确，请检查后重试");
      }
      const duplicated = store.users.find((item) => item.studentNo === studentNo && item.userId !== user.userId) || null;
      if (duplicated) {
        createLegacyError(409, "STUDENT_NO_CONFLICT", "学号已被其他账号占用");
      }
      user.studentNo = studentNo;
      state.randomCodeByUserId.set(user.userId, randomCodeByStudentNo(studentNo));
    }
    const nickname = asString(body.nickname);
    const name = asString(body.name);
    const classLabel = asString(body.classLabel || body.class_label);
    if (nickname) {
      user.nickname = nickname;
    }
    if (name) {
      user.name = name;
    }
    if (classLabel) {
      user.classLabel = classLabel;
    }
    if (Object.prototype.hasOwnProperty.call(body, "wallpaperUrl") || Object.prototype.hasOwnProperty.call(body, "wallpaper_url")) {
      user.wallpaperUrl = asString(body.wallpaperUrl ?? body.wallpaper_url);
    }
    if (Object.prototype.hasOwnProperty.call(body, "avatarUrl") || Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
      const nextAvatarUrl = normalizeProfileAvatarUrl(body.avatarUrl ?? body.avatar_url);
      user.avatarUrl = nextAvatarUrl;
      const boundTarget = resolveBoundTargetUser(store, state, user) || user;
      if (nextAvatarUrl && boundTarget.userId !== user.userId) {
        boundTarget.avatarUrl = nextAvatarUrl;
        boundTarget.updatedAt = storeHelpers.nowIso();
      }
    }
    user.updatedAt = storeHelpers.nowIso();
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    return {
      ok: true,
      me: toLegacySocialUser(bindTarget, state, {
        accountUser: user,
        randomCodeOwnerUserId: bindTarget.userId,
      }),
    };
  }

  if (method === "POST" && path === "social/bind-student") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string; targetRandomCode?: string; target_random_code?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      createLegacyError(400, "BIND_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = ensureValue(
      findUserByStudentId(store, targetStudentId),
      404,
      "BIND_TARGET_NOT_FOUND",
      "目标课表不存在",
    );
    if (!isAdminRole(user) && targetUser.userId !== user.userId) {
      ensureTargetRandomCode(state, targetUser.userId, asString(body.targetRandomCode || body.target_random_code));
    }
    state.bindingTargetUserIdByUserId.set(user.userId, targetUser.userId);
    state.notifyBoundUserIds.add(user.userId);
    return {
      ok: true,
      me: toLegacySocialUser(targetUser, state, {
        accountUser: user,
        randomCodeOwnerUserId: targetUser.userId,
      }),
    };
  }

  if (method === "POST" && path === "social/subscribe") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string; visibilityScope?: string; visibility_scope?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      createLegacyError(400, "SUBSCRIBE_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = ensureValue(
      findUserByStudentId(store, targetStudentId),
      404,
      "SUBSCRIBE_TARGET_NOT_FOUND",
      "目标课表不存在",
    );
    if (targetUser.userId === user.userId) {
      createLegacyError(400, "SUBSCRIBE_SELF_NOT_ALLOWED", "不能订阅自己");
    }
    const visibilityScope = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, "busy_free");
    if (isAdminRole(user)) {
      upsertSocialSubscriptionEdge(store, state, {
        subscriberUserId: user.userId,
        targetUser,
        visibilityScope: "detail",
        source: "legacy",
      });
      return { ok: true, subscribed: true, visibilityScope: "detail", stateRevision: getNexusStoreRevision() };
    }
    const existing = store.socialSubscriptionRequests.find((item) => {
      return item.requesterUserId === user.userId && item.targetUserId === targetUser.userId && item.status === "pending";
    });
    const request =
      existing ||
      ({
        id: storeHelpers.createId("sub_req"),
        requesterUserId: user.userId,
        targetUserId: targetUser.userId,
        requestedVisibility: visibilityScope,
        status: "pending",
        decidedVisibility: "hidden",
        decidedAt: "",
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      } satisfies SocialSubscriptionRequestRecord);
    if (!existing) {
      store.socialSubscriptionRequests.push(request);
      createSocialNotification(store, {
        type: "subscription_request",
        recipientUserId: targetUser.userId,
        actorUserId: user.userId,
        title: "新的订阅请求",
        body: `${resolveUserDisplayLabel(user)} 想查看你的日程空闲状态`,
        payload: { requestId: request.id, visibilityScope },
      });
    }
    return {
      ok: true,
      subscribed: false,
      pending: true,
      request: toSubscriptionRequestPayload(store, state, request),
      stateRevision: getNexusStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/subscribe/remove") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      createLegacyError(400, "UNSUBSCRIBE_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = findUserByStudentId(store, targetStudentId);
    if (!targetUser) {
      return { ok: true, removed: false, stateRevision: getNexusStoreRevision() };
    }
    const removed = revokeSocialSubscriptionBetweenUsers(store, state, user, targetUser);
    createSocialNotification(store, {
      type: "subscription_revoked",
      recipientUserId: targetUser.userId,
      actorUserId: user.userId,
      title: "订阅关系已解除",
      body: `${resolveUserDisplayLabel(user)} 解除了订阅关系`,
      payload: { targetStudentId },
    });
    return { ok: true, removed, stateRevision: getNexusStoreRevision() };
  }

  if (method === "POST" && path === "social/random-code") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ randomCode?: string; random_code?: string }>(event);
    const nextCode = asString(body.randomCode || body.random_code).replace(/\D+/g, "").slice(0, 4);
    if (nextCode.length !== 4) {
      createLegacyError(400, "RANDOM_CODE_INVALID", "验证码必须是 4 位数字");
    }
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    state.randomCodeByUserId.set(bindTarget.userId, nextCode);
    let removed = 0;
    state.subscriptionTargetsByUserId.forEach((targets, subscriberUserId) => {
      if (!targets.has(bindTarget.userId)) {
        return;
      }
      const subscriber = store.users.find((item) => item.userId === subscriberUserId) || null;
      if (!subscriber || isAdminRole(subscriber)) {
        return;
      }
      targets.delete(bindTarget.userId);
      removeScheduleSubscriptionsByTarget(store, subscriber.userId, bindTarget);
      removed += 1;
    });
    return { ok: true, removedSubscriberCount: removed };
  }

  if (method === "POST" && path === "social/notify/unbind") {
    const { user } = resolveLegacyAuthContext(event);
    state.notifyBoundUserIds.delete(user.userId);
    return { ok: true, notifyBound: false };
  }

  if (method === "POST" && path === "social/practice-course") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{ courseKey?: string; course_key?: string; enabled?: boolean }>(event);
    const courseKey = asString(body.courseKey || body.course_key);
    if (!courseKey) {
      createLegacyError(400, "COURSE_KEY_REQUIRED", "courseKey 不能为空");
    }
    const enabled = body.enabled !== false;
    const set = ensureSet(state.practiceCourseKeysByUserId, user.userId);
    if (enabled) {
      set.add(courseKey);
    } else {
      set.delete(courseKey);
    }
    return {
      ok: true,
      courseKey,
      enabled,
      practiceCourseKeys: Array.from(set.values()),
    };
  }

  if (method === "POST" && path === "social/upload/avatar") {
    const { user } = resolveLegacyAuthContext(event);
    user.avatarUrl = await persistLegacyUserMediaUpload(event, store, user, "avatar", LEGACY_AVATAR_MAX_BYTES);
    user.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      avatarUrl: user.avatarUrl,
      me: {
        avatarUrl: user.avatarUrl,
      },
    };
  }

  if (method === "POST" && path === "social/upload/wallpaper") {
    const { user } = resolveLegacyAuthContext(event);
    user.wallpaperUrl = await persistLegacyUserMediaUpload(event, store, user, "wallpaper", LEGACY_WALLPAPER_MAX_BYTES);
    user.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      wallpaperUrl: user.wallpaperUrl,
      me: {
        wallpaperUrl: user.wallpaperUrl,
      },
    };
  }

  if (method === "POST" && path === "social/food-candidates/extract") {
    resolveLegacyAuthContext(event);
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
      createLegacyError(400, "FOOD_CANDIDATE_RAW_TEXT_REQUIRED", "rawText 不能为空");
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

  if (method === "POST" && path === "social/food-candidates/evidence") {
    const { user } = resolveLegacyAuthContext(event);
    const upload = await persistLegacyMediaUpload(event, store, user, {
      usage: "other",
      maxBytes: LEGACY_FOOD_CANDIDATE_EVIDENCE_MAX_BYTES,
      objectPrefix: "touchx/social/food-candidate",
    });
    return {
      ok: true,
      asset: upload,
    };
  }

  if (method === "GET" && path === "social/foods") {
    resolveLegacyAuthContext(event);
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
    const { user } = resolveLegacyAuthContext(event);
    const status = asString(query.status).toLowerCase();
    const categoryKey = asString(query.categoryKey || query.category_key).toLowerCase();
    const brandKey = asString(query.brandKey || query.brand_key).toLowerCase();
    const keyword = asString(query.keyword).toLowerCase();
    const mineOnly = asString(query.mineOnly || query.mine_only) === "1";
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
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
    const { user } = resolveLegacyAuthContext(event);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
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
      createLegacyError(400, "FOOD_CANDIDATE_RAW_TEXT_REQUIRED", "文案抽取模式必须填写原始文案");
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
      createLegacyError(400, "FOOD_CANDIDATE_INVALID", "name 与 category_key 不能为空");
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
    const { user } = resolveLegacyAuthContext(event);
    if (!isAdminRole(user)) {
      createLegacyError(403, "ADMIN_FOOD_CANDIDATE_FORBIDDEN", "仅管理员可查看候选审核列表");
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
    const { user } = resolveLegacyAuthContext(event);
    if (!isAdminRole(user)) {
      createLegacyError(403, "ADMIN_FOOD_CANDIDATE_FORBIDDEN", "仅管理员可审核候选食物");
    }
    const foodKey = decodeURIComponent(adminFoodCandidateReviewMatch[1]);
    const candidate = ensureValue(
      findFoodCandidateByKey(state, foodKey),
      404,
      "FOOD_CANDIDATE_NOT_FOUND",
      "候选食物不存在",
    );
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
      createLegacyError(400, "FOOD_CANDIDATE_REVIEW_ACTION_INVALID", "action 仅支持 approve/reject");
    }
    if (action === "reject") {
      if (candidate.candidateStatus === "approved") {
        createLegacyError(400, "FOOD_CANDIDATE_APPROVED_REJECT_FORBIDDEN", "已通过候选不可直接拒绝");
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
      createLegacyError(400, "FOOD_CANDIDATE_INVALID", "审核通过前必须确认店铺名称与分类");
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

  if (method === "GET" && path === "social/food-campaigns") {
    const { user } = resolveLegacyAuthContext(event);
    const status = asString(query.status).toLowerCase();
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    const items = store.foodCampaigns
      .filter((campaign) => {
        if (!status || status === "all") {
          return true;
        }
        return resolveCampaignRuntimeStatus(campaign) === status;
      })
      .map((campaign) => toLegacyCampaignSummary(store, state, campaign))
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
    const normalized = items.map((item) => ({
      ...item,
      initiatorStudentId: item.initiatorStudentId || bindTarget.studentId || bindTarget.studentNo || bindTarget.userId,
    }));
    return { ok: true, items: normalized };
  }

  if (method === "GET" && path === "social/food-campaigns/stats") {
    resolveLegacyAuthContext(event);
    const recentDays = Math.max(1, Number(query.recentDays || query.recent_days || 30));
    return {
      ok: true,
      stats: buildCampaignStats(store, state, recentDays),
    };
  }

  if (method === "GET" && path === "social/food-campaigns/preview") {
    const shareToken = asString(query.share_token || query.shareToken);
    const campaignId = asString(query.campaign_id || query.campaignId);
    const campaign = ensureValue(
      (shareToken ? store.foodCampaigns.find((item) => item.shareToken === shareToken) : null) ||
      (campaignId ? store.foodCampaigns.find((item) => item.id === campaignId) : null) ||
      null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "竞选不存在或分享码失效",
    );
    return {
      ok: true,
      campaign: toLegacyCampaignSummary(store, state, campaign),
    };
  }

  if (method === "POST" && path === "social/food-campaigns") {
    const { user } = resolveLegacyAuthContext(event);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    const body = await readJsonBody<{
      title?: string;
      templateKey?: string;
      template_key?: string;
      selectedTierIds?: string[];
      selected_tier_ids?: string[];
      joinMode?: LegacyJoinMode;
      join_mode?: LegacyJoinMode;
      joinPassword?: string;
      join_password?: string;
      isAnonymous?: boolean;
      is_anonymous?: boolean;
      categoryKeys?: string[];
      category_keys?: string[];
      brandKeys?: string[];
      brand_keys?: string[];
      maxVotesPerUser?: number;
      max_votes_per_user?: number;
      deadlineAt?: string;
      deadline_at?: string;
      inviteeStudentIds?: string[];
      invitee_student_ids?: string[];
    }>(event);
    const now = new Date();
    const pad2 = (value: number) => `${value}`.padStart(2, "0");
    const fallbackTitle = `${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())} 发布的拼单`;
    const title = asString(body.title) || fallbackTitle;
    const templateKey = asString(body.templateKey || body.template_key) || "daily";
    const joinMode: LegacyJoinMode = "all";
    const joinPassword = "";
    const optionFoodIds = resolveLegacyCampaignOptionIds(
      store,
      state,
      {
        templateKey,
        selectedTierIds: body.selectedTierIds ?? body.selected_tier_ids,
        categoryKeys: body.categoryKeys ?? body.category_keys,
        brandKeys: body.brandKeys ?? body.brand_keys,
      },
    );
    if (optionFoodIds.length === 0) {
      const fallback = store.foodItems.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.id);
      optionFoodIds.push(...fallback);
    }
    const campaign: FoodCampaignRecord = {
      id: storeHelpers.createId("campaign"),
      title,
      status: "open",
      classId: bindTarget.classIds[0] || undefined,
      createdByUserId: user.userId,
      deadlineAtIso: resolveCampaignDeadlineIso(asString(body.deadlineAt || body.deadline_at)),
      shareToken: storeHelpers.generateShareToken(),
      isAnonymous: (body.isAnonymous ?? body.is_anonymous) !== false,
      revealAfterClose: true,
      revealScope: "share_token",
      optionFoodIds,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.foodCampaigns.unshift(campaign);
    const inviteeUserIds: string[] = [];
    state.campaignMetaByCampaignId.set(campaign.id, {
      templateKey,
      joinMode,
      joinPassword,
      maxVotesPerUser: Math.max(1, Math.min(3, Number(body.maxVotesPerUser ?? body.max_votes_per_user ?? 1))),
      closedAtUnix: 0,
      inviteeUserIds,
    });
    const participants = new Map<string, LegacyCampaignParticipant>();
    participants.set(user.userId, {
      userId: user.userId,
      source: "creator",
      approvalStatus: "approved",
    });
    state.campaignParticipantsByCampaignId.set(campaign.id, participants);
    return {
      ok: true,
      campaign: toLegacyCampaignSummary(store, state, campaign),
    };
  }

  if (method === "POST" && path === "social/food-campaigns/join") {
    const { user } = resolveLegacyAuthContext(event);
    const body = await readJsonBody<{
      shareToken?: string;
      share_token?: string;
      campaignId?: string;
      campaign_id?: string;
      accessPassword?: string;
      access_password?: string;
    }>(event);
    const shareToken = asString(body.shareToken || body.share_token);
    const campaignId = asString(body.campaignId || body.campaign_id);
    if (!shareToken && !campaignId) {
      createLegacyError(400, "SHARE_TOKEN_OR_CAMPAIGN_ID_REQUIRED", "分享码或拼单ID不能为空");
    }
    const campaign = ensureValue(
      (shareToken ? store.foodCampaigns.find((item) => item.shareToken === shareToken) : null) ||
      (campaignId ? store.foodCampaigns.find((item) => item.id === campaignId) : null) ||
      null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "拼单不存在或分享码失效",
    );
    if (resolveCampaignRuntimeStatus(campaign) !== "open") {
      createLegacyError(400, "FOOD_CAMPAIGN_CLOSED", "拼单已结束，无法加入");
    }
    ensureCampaignMeta(state, campaign);
    const participants = ensureCampaignParticipants(state, campaign);
    const existing = participants.get(user.userId);
    if (!existing) {
      participants.set(user.userId, {
        userId: user.userId,
        source: "join",
        approvalStatus: "approved",
      });
    } else if (existing.approvalStatus === "rejected") {
      existing.approvalStatus = "approved";
    }
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, shareToken || campaign.shareToken),
    };
  }

  const campaignDetailMatch = path.match(/^social\/food-campaigns\/([^/]+)$/);
  if (method === "GET" && campaignDetailMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const campaignId = decodeURIComponent(campaignDetailMatch[1]);
    const campaign = ensureValue(
      store.foodCampaigns.find((item) => item.id === campaignId) || null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "竞选不存在",
    );
    const shareToken = asString(query.share_token || query.shareToken);
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, shareToken),
    };
  }

  const campaignVoteMatch = path.match(/^social\/food-campaigns\/([^/]+)\/vote$/);
  if (method === "POST" && campaignVoteMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const campaignId = decodeURIComponent(campaignVoteMatch[1]);
    const campaign = ensureValue(
      store.foodCampaigns.find((item) => item.id === campaignId) || null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "竞选不存在",
    );
    const participants = ensureCampaignParticipants(state, campaign);
    const meParticipant = participants.get(user.userId);
    if (!meParticipant) {
      participants.set(user.userId, {
        userId: user.userId,
        source: "join",
        approvalStatus: "approved",
      });
    } else if (meParticipant.approvalStatus !== "approved") {
      meParticipant.approvalStatus = "approved";
    }
    if (resolveCampaignRuntimeStatus(campaign) !== "open") {
      createLegacyError(400, "FOOD_CAMPAIGN_CLOSED", "竞选已截止");
    }
    const body = await readJsonBody<{ selectedFoodIds?: number[]; selected_food_ids?: number[] }>(event);
    const selectedFoodIds = Array.isArray(body.selectedFoodIds ?? body.selected_food_ids) ? (body.selectedFoodIds ?? body.selected_food_ids ?? []) : [];
    if (selectedFoodIds.length === 0) {
      createLegacyError(400, "CAMPAIGN_VOTE_EMPTY", "请至少选择一个候选");
    }
    const meta = ensureCampaignMeta(state, campaign);
    const maxVotes = Math.max(1, Math.min(3, Number(meta.maxVotesPerUser || 1)));
    if (selectedFoodIds.length > maxVotes) {
      createLegacyError(400, "CAMPAIGN_VOTE_EXCEED", `最多可投 ${maxVotes} 票`);
    }
    const sourceFoodIds = selectedFoodIds
      .map((item) => state.sourceFoodIdByFoodKey.get(String(item)) || "")
      .filter((item) => item !== "")
      .filter((item) => campaign.optionFoodIds.includes(item));
    if (sourceFoodIds.length === 0) {
      createLegacyError(400, "CAMPAIGN_VOTE_INVALID", "候选项无效");
    }
    appendCampaignVotes(store, campaign, user.userId, sourceFoodIds);
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, ""),
    };
  }

  const campaignSupplementMatch = path.match(/^social\/food-campaigns\/([^/]+)\/supplement$/);
  if (method === "POST" && campaignSupplementMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const campaignId = decodeURIComponent(campaignSupplementMatch[1]);
    const campaign = ensureValue(
      store.foodCampaigns.find((item) => item.id === campaignId) || null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "竞选不存在",
    );
    if (campaign.createdByUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "CAMPAIGN_SUPPLEMENT_FORBIDDEN", "仅创建者或管理员可追加候选");
    }
    if (resolveCampaignRuntimeStatus(campaign) !== "open") {
      createLegacyError(400, "FOOD_CAMPAIGN_CLOSED", "竞选已截止");
    }
    if (campaign.optionFoodIds.length >= FOOD_CAMPAIGN_OPTION_LIMIT) {
      createLegacyError(400, "CAMPAIGN_CANDIDATE_LIMIT", `每个竞选最多 ${FOOD_CAMPAIGN_OPTION_LIMIT} 个候选`);
    }
    let next = store.foodItems.find((item) => !campaign.optionFoodIds.includes(item.id)) || null;
    if (!next) {
      const template = pickFoodTemplate();
      const nextFoodKey = `${state.foodCandidates.length + 1}`;
      const sourceFoodId = storeHelpers.createId("food");
      const aliasName = `${template.name}-加菜${nextFoodKey}`;
      next = {
        id: sourceFoodId,
        name: aliasName,
        categoryKey: template.categoryKey || "other",
        categoryName: template.categoryName || template.categoryKey || "其他",
        merchantName: template.merchantName || "临时商家",
        latitude: Number(template.latitude || 31.23),
        longitude: Number(template.longitude || 121.47),
        priceMin: Math.max(0.01, Number(template.priceMin || 18)),
        priceMax: Math.max(Number(template.priceMin || 18), Number(template.priceMax || template.priceMin || 30)),
        caloriesKcal: normalizeCaloriesKcal(template.caloriesKcal, 520),
      };
      store.foodItems.push(next);
      const brandName = asString(next.merchantName) || "临时商家";
      const candidate: LegacyFoodCandidateRecord = {
        foodKey: nextFoodKey,
        sourceFoodId: next.id,
        name: next.name,
        categoryKey: next.categoryKey,
        categoryName: next.categoryName,
        brandKey: normalizeBrandKey(brandName),
        brandName,
        brandCombo: `${brandName}-${next.name}`,
        candidateStatus: "approved",
        note: "supplement-auto-generated",
        createdByUserId: user.userId,
        createdByStudentId: user.studentId || "",
        distanceKm: Number((0.8 + state.foodCandidates.length * 0.2).toFixed(2)),
        dailyPriceMin: next.priceMin,
        dailyPriceMax: next.priceMax,
        partyPriceMin: Number((next.priceMin * 1.2).toFixed(2)),
        partyPriceMax: Number((next.priceMax * 1.3).toFixed(2)),
        caloriesKcal: normalizeCaloriesKcal(next.caloriesKcal, 0),
        submissionMode: "structured",
        rawText: "",
        evidenceAssetIds: [],
        extractionWarnings: [],
        reviewNote: "",
        isCaloriesEstimated: false,
      };
      state.foodCandidates.unshift(candidate);
      state.foodKeyBySourceFoodId.set(next.id, nextFoodKey);
      state.sourceFoodIdByFoodKey.set(nextFoodKey, next.id);
    }
    campaign.optionFoodIds.push(next.id);
    campaign.optionFoodIds = campaign.optionFoodIds.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT);
    campaign.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, ""),
    };
  }

  const campaignCloseMatch = path.match(/^social\/food-campaigns\/([^/]+)\/close$/);
  if (method === "POST" && campaignCloseMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const campaignId = decodeURIComponent(campaignCloseMatch[1]);
    const campaign = ensureValue(
      store.foodCampaigns.find((item) => item.id === campaignId) || null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "竞选不存在",
    );
    if (campaign.createdByUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "CAMPAIGN_CLOSE_FORBIDDEN", "仅创建者或管理员可截止竞选");
    }
    campaign.status = "closed";
    campaign.updatedAt = storeHelpers.nowIso();
    const meta = ensureCampaignMeta(state, campaign);
    meta.closedAtUnix = toUnixSeconds(Date.now());
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, campaign.shareToken),
    };
  }

  const campaignParticipantReviewMatch = path.match(
    /^social\/food-campaigns\/([^/]+)\/participants\/([^/]+)\/(approve|reject)$/,
  );
  if (method === "POST" && campaignParticipantReviewMatch) {
    const { user } = resolveLegacyAuthContext(event);
    const campaignId = decodeURIComponent(campaignParticipantReviewMatch[1]);
    const studentId = decodeURIComponent(campaignParticipantReviewMatch[2]);
    const campaign = ensureValue(
      store.foodCampaigns.find((item) => item.id === campaignId) || null,
      404,
      "FOOD_CAMPAIGN_NOT_FOUND",
      "竞选不存在",
    );
    if (campaign.createdByUserId !== user.userId && !isAdminRole(user)) {
      createLegacyError(403, "CAMPAIGN_APPROVE_FORBIDDEN", "仅创建者或管理员可审批参与者");
    }
    const targetUser = ensureValue(
      findUserByStudentId(store, studentId),
      404,
      "CAMPAIGN_PARTICIPANT_NOT_FOUND",
      "参与者不存在",
    );
    const participants = ensureCampaignParticipants(state, campaign);
    const participant = ensureValue(
      participants.get(targetUser.userId),
      404,
      "CAMPAIGN_PARTICIPANT_NOT_FOUND",
      "参与者不存在",
    );
    participant.approvalStatus = "approved";
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, campaign.shareToken),
    };
  }

  if (method === "GET" && path === "schedules/student") {
    const { user } = resolveLegacyAuthContext(event);
    const hasRequestedStudentId =
      Object.prototype.hasOwnProperty.call(query, "studentId") ||
      Object.prototype.hasOwnProperty.call(query, "student_id");
    const requestedStudentId = asString(query.studentId || query.student_id);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    if (hasRequestedStudentId && !requestedStudentId) {
      createLegacyError(400, "SCHEDULE_TARGET_REQUIRED", "studentId 不能为空");
    }
    const resolvedTargetUser = hasRequestedStudentId
      ? findUserByStudentId(store, requestedStudentId)
      : bindTarget;
    const targetUser = ensureValue(resolvedTargetUser, 404, "SCHEDULE_TARGET_NOT_FOUND", "目标课表不存在");
    if (!(targetUser.studentId || targetUser.userId)) {
      createLegacyError(404, "SCHEDULE_TARGET_NOT_FOUND", "目标课表不存在");
    }
    const visibilityScope = hasRequestedStudentId ? resolveViewerVisibilityScope(store, user, targetUser) : "detail";
    if (visibilityScope === "hidden" || visibilityScope === "blocked") {
      createLegacyError(403, "SCHEDULE_VISIBILITY_FORBIDDEN", "对方尚未授权你查看日程");
    }
    const serverNow = new Date();
    const serverTimezone = getUserReminderTimezone(store, targetUser);
    const studentPayload = maskScheduleStudentPayloadByVisibility(
      toLegacyScheduleStudentPayload(store, targetUser, user),
      visibilityScope,
    );
    return {
      ok: true,
      term: SCHEDULE_TERM_META,
      termMeta: SCHEDULE_TERM_META,
      sectionTimes: SCHEDULE_SECTION_TIMES,
      weekdayLabels: SCHEDULE_WEEKDAY_LABELS,
      holidays: SCHEDULE_TERM_HOLIDAYS,
      visibilityScope,
      student: studentPayload,
      serverNowIso: serverNow.toISOString(),
      serverTimezone,
      generatedAt: Date.now(),
    };
  }

  if (method === "GET" && path === "today-brief") {
    const studentId = asString(query.studentId || query.student_id);
    return toTodayBriefPayload(store, studentId);
  }

  if (method === "GET" && path === "theme-images") {
    return {
      ok: true,
      images: {},
      updatedAt: Date.now(),
    };
  }

  return null;
};
