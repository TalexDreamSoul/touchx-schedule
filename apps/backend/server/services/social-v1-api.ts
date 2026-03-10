import { createError, getMethod, getQuery, getRequestURL, readMultipartFormData, type H3Event } from "h3";
import {
  FOOD_CAMPAIGN_OPTION_LIMIT,
  getNexusStore,
  storeHelpers,
  type FoodCampaignRecord,
  type FoodCampaignVoteRecord,
  type FoodItemRecord,
  type MediaAssetRecord,
  type FoodPricingRuleRecord,
  type ScheduleEntryRecord,
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

type LegacyJoinMode = "all" | "invite" | "password";
type LegacyCandidateStatus = "approved" | "pending_eat" | "pending_review" | "rejected";

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

type NexusStore = ReturnType<typeof getNexusStore>;

const legacyStateMap = new WeakMap<NexusStore, LegacyCompatState>();

const SECTION_TIMES: Array<{
  section: number;
  start: string;
  end: string;
  part: "上午" | "下午" | "晚上";
}> = [
  { section: 1, start: "08:30", end: "09:15", part: "上午" },
  { section: 2, start: "09:20", end: "10:05", part: "上午" },
  { section: 3, start: "10:25", end: "11:10", part: "上午" },
  { section: 4, start: "11:15", end: "12:00", part: "上午" },
  { section: 5, start: "14:30", end: "15:15", part: "下午" },
  { section: 6, start: "15:20", end: "16:05", part: "下午" },
  { section: 7, start: "16:25", end: "17:10", part: "下午" },
  { section: 8, start: "17:15", end: "18:00", part: "下午" },
  { section: 9, start: "19:00", end: "19:45", part: "晚上" },
  { section: 10, start: "19:50", end: "20:35", part: "晚上" },
  { section: 11, start: "20:40", end: "21:25", part: "晚上" },
];

const LEGACY_TERM_META = {
  name: "2025-2026-2",
  week1Monday: "2026-03-02",
  maxWeek: 25,
};

const LEGACY_TERM_HOLIDAYS = [
  { date: "2026-04-04", label: "休" },
  { date: "2026-04-05", label: "休" },
  { date: "2026-04-06", label: "休" },
  { date: "2026-05-01", label: "休" },
  { date: "2026-05-02", label: "休" },
  { date: "2026-05-03", label: "休" },
  { date: "2026-05-04", label: "休" },
  { date: "2026-05-05", label: "休" },
  { date: "2026-06-19", label: "休" },
  { date: "2026-06-20", label: "休" },
  { date: "2026-06-21", label: "休" },
];

const LEGACY_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const LEGACY_WALLPAPER_MAX_BYTES = 5 * 1024 * 1024;

const asString = (value: unknown) => String(value || "").trim();

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

const persistLegacyUserMediaUpload = async (
  event: H3Event,
  store: NexusStore,
  user: UserRecord,
  usage: "avatar" | "wallpaper",
  maxBytes: number,
) => {
  const bucket = ensureValue(resolveMediaBucket(event), 500, "MEDIA_BUCKET_MISSING", "媒体存储未配置，请联系管理员");
  const upload = await readLegacyUploadFile(event, maxBytes);
  const owner = sanitizeStoragePart(user.studentNo || user.studentId || user.userId || "anonymous");
  const objectKey = `touchx/social/${usage}/${owner}/${Date.now()}_${randomSuffix()}.${upload.extension}`;
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
    existed.usage = usage;
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
      usage,
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
  return mediaUrl;
};

const resolveLegacyCampaignOptionIds = (
  store: NexusStore,
  state: LegacyCompatState,
  rawSourceFoodIds: string[],
) => {
  const foodIdSet = new Set(store.foodItems.map((item) => item.id));
  const normalized: string[] = [];
  rawSourceFoodIds.forEach((sourceFoodId) => {
    const foodId = asString(sourceFoodId);
    if (!foodId || !foodIdSet.has(foodId) || normalized.includes(foodId)) {
      return;
    }
    normalized.push(foodId);
  });
  const limited = normalized.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT);
  if (limited.length > 0) {
    return limited;
  }
  const approvedCandidates = state.foodCandidates.filter((item) => item.candidateStatus === "approved");
  return approvedCandidates.slice(0, FOOD_CAMPAIGN_OPTION_LIMIT).map((item) => item.sourceFoodId);
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

const normalizeCaloriesKcal = (raw: unknown, fallback = 0) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.round(parsed);
};

const resolveExerciseEquivalentMinutes = (caloriesKcal: number) => {
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
    studentName: source.name || source.nickname || source.studentNo,
    classLabel: source.classLabel || "",
    nickname: accountUser.nickname || accountUser.name || source.name || source.studentNo,
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
    name: user.name || user.nickname || user.studentNo,
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

const toLegacyCampaignSummary = (
  store: NexusStore,
  state: LegacyCompatState,
  campaign: FoodCampaignRecord,
) => {
  const meta = ensureCampaignMeta(state, campaign);
  const participants = ensureCampaignParticipants(state, campaign);
  const approvedHeadcount = participants.size;
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
    status: campaign.status,
    joinMode: meta.joinMode,
    shareToken: campaign.shareToken,
    candidateCount: campaign.optionFoodIds.length,
    headcount: approvedHeadcount,
    deadlineAt: toUnixSeconds(campaign.deadlineAtIso),
    createdAt: toUnixSeconds(campaign.createdAt),
    closedAt: meta.closedAtUnix,
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
  const meta = ensureCampaignMeta(state, campaign);
  const participants = ensureCampaignParticipants(state, campaign);
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
  } else if (campaign.status === "open") {
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
      voterName: voter?.name || voter?.nickname || voter?.studentNo || voterUserId,
      selectedFoodNames: Array.from(selected.values()),
    };
  });

  const participantItems = Array.from(participants.values()).map((participant) => {
    const user = store.users.find((item) => item.userId === participant.userId) || null;
    return {
      studentId: user?.studentId || user?.studentNo || participant.userId,
      name: user?.name || user?.nickname || user?.studentNo || participant.userId,
      source: participant.source,
      approvalStatus: participant.approvalStatus,
    };
  });

  const canVote = campaign.status === "open";
  return {
    ...toLegacyCampaignSummary(store, state, campaign),
    canVote,
    canApprove,
    canSupplement: canApprove && campaign.status === "open" && candidateRows.length < FOOD_CAMPAIGN_OPTION_LIMIT,
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
  const classIdSet = new Set(user.classIds);
  if (classIdSet.size === 0) {
    const matchedClass = store.classes.find((item) => item.name === user.classLabel) || null;
    if (matchedClass) {
      classIdSet.add(matchedClass.id);
    }
  }
  const scheduleIds = store.schedules.filter((item) => classIdSet.has(item.classId)).map((item) => item.id);
  const versionEntries = store.scheduleVersions
    .filter((item) => scheduleIds.includes(item.scheduleId) && item.status === "published")
    .flatMap((item) => item.entries.map((entry) => ({ ...entry, scheduleId: item.scheduleId })));
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
    name: targetUser.name || targetUser.nickname || targetUser.studentNo,
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

const toGreeting = () => {
  const hour = new Date().getHours();
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
  if (!user) {
    return {
      studentId: "",
      studentName: "",
      weekNo: 1,
      dayNo: 1,
      dayLabel: "周一",
      greeting: toGreeting(),
      tips: ["暂无可用课表数据"],
      generatedAt: storeHelpers.nowIso(),
    };
  }
  const now = new Date();
  const dayNo = now.getDay() === 0 ? 7 : now.getDay();
  const dayLabel = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][dayNo - 1] || "周一";
  const entries = resolvePublishedEntriesByUser(store, user).filter((item) => item.day === dayNo);
  const sorted = [...entries].sort((left, right) => left.startSection - right.startSection);
  const sectionMap = new Map(SECTION_TIMES.map((item) => [item.section, item] as const));
  const toTodayTimestamp = (timeText: string) => {
    const [hour, minute] = String(timeText || "").split(":").map((item) => Number(item));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return NaN;
    }
    const clone = new Date(now);
    clone.setHours(hour, minute, 0, 0);
    return clone.getTime();
  };
  const nowTs = now.getTime();
  const nextCandidate = sorted
    .map((entry) => {
      const startSlot = sectionMap.get(entry.startSection) || null;
      const endSlot = sectionMap.get(entry.endSection) || null;
      if (!startSlot || !endSlot) {
        return null;
      }
      const startTs = toTodayTimestamp(startSlot.start);
      const endTs = toTodayTimestamp(endSlot.end);
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
    studentName: user.name || user.nickname || user.studentNo,
    weekNo: 1,
    dayNo,
    dayLabel,
    greeting: toGreeting(),
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
    activeCampaignCount: scopedCampaigns.filter((item) => item.status === "open").length,
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
  if (path.startsWith("social/food-campaigns")) {
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
    const avatarUrl = asString(body.avatarUrl || body.avatar_url);
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
        studentId: studentId || "",
        name: studentNo || studentId || "新用户",
        classLabel: "",
        nickname: nickname || studentNo || studentId || "新用户",
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
      bound: Boolean(bindTarget.studentId),
    };
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
      user.avatarUrl = asString(body.avatarUrl ?? body.avatar_url);
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
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string; targetRandomCode?: string; target_random_code?: string }>(event);
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
    if (!isAdminRole(user)) {
      ensureTargetRandomCode(state, targetUser.userId, asString(body.targetRandomCode || body.target_random_code));
    }
    ensureSet(state.subscriptionTargetsByUserId, user.userId).add(targetUser.userId);
    ensureScheduleSubscriptionsByTarget(store, user.userId, targetUser);
    return { ok: true, subscribed: true };
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
      return { ok: true, removed: false };
    }
    ensureSet(state.subscriptionTargetsByUserId, user.userId).delete(targetUser.userId);
    removeScheduleSubscriptionsByTarget(store, user.userId, targetUser);
    return { ok: true, removed: true };
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

  if (method === "GET" && path === "social/foods") {
    resolveLegacyAuthContext(event);
    const categoryKey = asString(query.categoryKey || query.category_key).toLowerCase();
    const approved = state.foodCandidates.filter((item) => item.candidateStatus !== "rejected");
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
      .filter((item) => !keyword || `${item.name} ${item.note} ${item.brandName}`.toLowerCase().includes(keyword))
      .filter((item) => !mineOnly || item.createdByUserId === bindTarget.userId)
      .map((item) => ({
        foodKey: item.foodKey,
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
        caloriesKcal: normalizeCaloriesKcal(item.caloriesKcal, 0),
        exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(item.caloriesKcal),
      }));
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
      note?: string;
    }>(event);
    const name = asString(body.name);
    const categoryKey = asString(body.categoryKey || body.category_key).toLowerCase();
    if (!name || !categoryKey) {
      createLegacyError(400, "FOOD_CANDIDATE_INVALID", "name 与 category_key 不能为空");
    }
    const nextFoodKey = `${state.foodCandidates.length + 1}`;
    const sourceFoodId = storeHelpers.createId("food");
    const brandName = asString(body.brandName || body.brand_name) || "未命名品牌";
    const caloriesKcal = normalizeCaloriesKcal(body.caloriesKcal ?? body.calories_kcal, 0);
    const foodItem: FoodItemRecord = {
      id: sourceFoodId,
      name,
      categoryKey,
      categoryName: categoryKey,
      merchantName: brandName,
      latitude: 31.23,
      longitude: 121.47,
      priceMin: Math.max(0, Number(body.dailyPriceMin ?? body.daily_price_min ?? 0)),
      priceMax: Math.max(0, Number(body.dailyPriceMax ?? body.daily_price_max ?? body.dailyPriceMin ?? body.daily_price_min ?? 0)),
      caloriesKcal,
    };
    store.foodItems.push(foodItem);
    const candidate: LegacyFoodCandidateRecord = {
      foodKey: nextFoodKey,
      sourceFoodId,
      name,
      categoryKey,
      categoryName: categoryKey,
      brandKey: asString(body.brandKey || body.brand_key) || normalizeBrandKey(brandName),
      brandName,
      brandCombo: asString(body.brandCombo || body.brand_combo),
      candidateStatus: "pending_review",
      note: asString(body.note),
      createdByUserId: bindTarget.userId,
      createdByStudentId: bindTarget.studentId || "",
      distanceKm: Math.max(0, Number(body.distanceKm ?? body.distance_km ?? 0)),
      dailyPriceMin: Math.max(0, Number(body.dailyPriceMin ?? body.daily_price_min ?? 0)),
      dailyPriceMax: Math.max(0, Number(body.dailyPriceMax ?? body.daily_price_max ?? 0)),
      partyPriceMin: Math.max(0, Number(body.partyPriceMin ?? body.party_price_min ?? 0)),
      partyPriceMax: Math.max(0, Number(body.partyPriceMax ?? body.party_price_max ?? 0)),
      caloriesKcal,
    };
    state.foodCandidates.unshift(candidate);
    state.foodKeyBySourceFoodId.set(sourceFoodId, nextFoodKey);
    state.sourceFoodIdByFoodKey.set(nextFoodKey, sourceFoodId);
    return {
      ok: true,
      item: {
        foodKey: candidate.foodKey,
        name: candidate.name,
        categoryKey: candidate.categoryKey,
        categoryName: candidate.categoryName,
        brandKey: candidate.brandKey,
        brandName: candidate.brandName,
        brandCombo: candidate.brandCombo,
        candidateStatus: candidate.candidateStatus,
        candidateStatusLabel: buildLegacyCandidateStatusLabel(candidate.candidateStatus),
        note: candidate.note,
        createdByStudentId: candidate.createdByStudentId,
        distanceKm: candidate.distanceKm,
        dailyPriceMin: candidate.dailyPriceMin,
        dailyPriceMax: candidate.dailyPriceMax,
        partyPriceMin: candidate.partyPriceMin,
        partyPriceMax: candidate.partyPriceMax,
        caloriesKcal: candidate.caloriesKcal,
        exerciseEquivalentMinutes: resolveExerciseEquivalentMinutes(candidate.caloriesKcal),
      },
    };
  }

  if (method === "GET" && path === "social/food-campaigns") {
    const { user } = resolveLegacyAuthContext(event);
    const status = asString(query.status).toLowerCase();
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    const items = store.foodCampaigns
      .filter((campaign) => !status || status === "all" || campaign.status === status)
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
    const categoryKeys = Array.isArray(body.categoryKeys ?? body.category_keys)
      ? (body.categoryKeys ?? body.category_keys ?? []).map((item) => asString(item).toLowerCase()).filter((item) => item !== "")
      : [];
    const brandKeys = Array.isArray(body.brandKeys ?? body.brand_keys)
      ? (body.brandKeys ?? body.brand_keys ?? []).map((item) => asString(item).toLowerCase()).filter((item) => item !== "")
      : [];
    const approvedCandidates = state.foodCandidates.filter((item) => item.candidateStatus === "approved");
    const matchedCandidates = approvedCandidates
      .filter((item) => categoryKeys.length === 0 || categoryKeys.includes(item.categoryKey.toLowerCase()))
      .filter((item) => brandKeys.length === 0 || brandKeys.includes(item.brandKey.toLowerCase()));
    const optionFoodIds = resolveLegacyCampaignOptionIds(
      store,
      state,
      (matchedCandidates.length > 0 ? matchedCandidates : approvedCandidates).map((item) => item.sourceFoodId),
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
    if (campaign.status !== "open") {
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
    if (campaign.status !== "open") {
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
    if (campaign.status !== "open") {
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
    const requestedStudentId = asString(query.studentId || query.student_id);
    const bindTarget = resolveBoundTargetUser(store, state, user) || user;
    const targetUser = findUserByStudentId(store, requestedStudentId) || bindTarget;
    if (!targetUser || !(targetUser.studentId || targetUser.userId)) {
      createLegacyError(404, "SCHEDULE_TARGET_NOT_FOUND", "目标课表不存在");
    }
    return {
      ok: true,
      term: LEGACY_TERM_META,
      sectionTimes: SECTION_TIMES,
      weekdayLabels: ["一", "二", "三", "四", "五", "六", "日"],
      holidays: LEGACY_TERM_HOLIDAYS,
      student: toLegacyScheduleStudentPayload(store, targetUser, user),
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
