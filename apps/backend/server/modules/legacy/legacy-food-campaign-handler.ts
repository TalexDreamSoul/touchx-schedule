import type { H3Event } from "h3";
import {
  FOOD_CAMPAIGN_OPTION_LIMIT,
  storeHelpers,
  type FoodCampaignRecord,
  type FoodCampaignVoteRecord,
  type FoodItemRecord,
  type FoodPricingRuleRecord,
  type NexusStore,
  type UserRecord,
} from "../../services/domain-store";
import { normalizeCaloriesKcal, resolveExerciseEquivalentMinutes } from "../../services/food-utils";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveBoundTargetUser = (store: NexusStore, accountUser: UserRecord) => UserRecord | null;
type FindUserByStudentId = (store: NexusStore, studentId: string) => UserRecord | null;
type IsAdminRole = (user: UserRecord) => boolean;
type ResolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => string;

type LegacyJoinMode = "all" | "invite" | "password";
type LegacyCandidateStatus = "approved" | "pending_eat" | "pending_review" | "rejected";
type LegacyFoodCandidateSubmissionMode = "raw_text" | "structured";
type FoodCampaignTemplateKey = "daily" | "party";

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

export interface LegacyFoodCampaignState {
  campaignMetaByCampaignId: Map<string, LegacyCampaignMeta>;
  campaignParticipantsByCampaignId: Map<string, Map<string, LegacyCampaignParticipant>>;
  foodCandidates: LegacyFoodCandidateRecord[];
  foodKeyBySourceFoodId: Map<string, string>;
  sourceFoodIdByFoodKey: Map<string, string>;
}

export interface LegacyFoodCampaignHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  state: LegacyFoodCampaignState;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  resolveBoundTargetUser: ResolveBoundTargetUser;
  findUserByStudentId: FindUserByStudentId;
  isAdminRole: IsAdminRole;
  resolveUserDisplayLabel: ResolveUserDisplayLabel;
}

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

const asString = (value: unknown) => String(value || "").trim();

const normalizeBrandKey = (text: string) => {
  const value = asString(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return value || "general";
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
  return { min, max };
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

const resolveApprovedFoodCandidates = (store: NexusStore, state: LegacyFoodCampaignState) => {
  const foodIdSet = new Set(store.foodItems.map((item) => item.id));
  return state.foodCandidates.filter((item) => {
    if (item.candidateStatus !== "approved") {
      return false;
    }
    const foodId = asString(item.sourceFoodId);
    return Boolean(foodId) && foodIdSet.has(foodId);
  });
};

const resolveLegacyCampaignOptionIds = (
  store: NexusStore,
  state: LegacyFoodCampaignState,
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

const resolveCampaignDeadlineIso = (inputIso: string, toApiError: ApiError) => {
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

const ensureCampaignParticipants = (state: LegacyFoodCampaignState, campaign: FoodCampaignRecord) => {
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

const ensureCampaignMeta = (state: LegacyFoodCampaignState, campaign: FoodCampaignRecord) => {
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

export const syncLegacyFoodCampaignStatusByDeadline = (store: NexusStore, state: LegacyFoodCampaignState) => {
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

const resolveCampaignVotes = (store: NexusStore, campaignId: string) => {
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

const getCampaignMetaReadonly = (state: LegacyFoodCampaignState, campaign: FoodCampaignRecord): LegacyCampaignMeta => {
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

const getCampaignParticipantsReadonly = (state: LegacyFoodCampaignState, campaign: FoodCampaignRecord) => {
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
  state: LegacyFoodCampaignState,
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
  state: LegacyFoodCampaignState,
  campaign: FoodCampaignRecord,
  viewerUser: UserRecord,
  shareToken: string,
  isAdminRole: IsAdminRole,
  resolveUserDisplayLabel: ResolveUserDisplayLabel,
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

const buildCampaignStats = (store: NexusStore, state: LegacyFoodCampaignState, recentDays: number) => {
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

const pickFoodTemplate = (store: NexusStore): FoodItemRecord => {
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

export const isLegacyFoodCampaignPath = (path: string) => {
  return path === "social/food-campaigns" || path.startsWith("social/food-campaigns/");
};

export const handleLegacyFoodCampaignApi = async (context: LegacyFoodCampaignHandlerContext) => {
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
    findUserByStudentId,
    isAdminRole,
    resolveUserDisplayLabel,
  } = context;

  if (!isLegacyFoodCampaignPath(path)) {
    return null;
  }
  if (method !== "GET") {
    syncLegacyFoodCampaignStatusByDeadline(store, state);
  }

  if (method === "GET" && path === "social/food-campaigns") {
    const { user } = requireLegacyAuth(event);
    const status = asString(query.status).toLowerCase();
    const bindTarget = resolveBoundTargetUser(store, user) || user;
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
    requireLegacyAuth(event);
    const recentDays = Math.max(1, Number(query.recentDays || query.recent_days || 30));
    return {
      ok: true,
      stats: buildCampaignStats(store, state, recentDays),
    };
  }

  if (method === "GET" && path === "social/food-campaigns/preview") {
    const shareToken = asString(query.share_token || query.shareToken);
    const campaignId = asString(query.campaign_id || query.campaignId);
    const campaign =
      (shareToken ? store.foodCampaigns.find((item) => item.shareToken === shareToken) : null) ||
      (campaignId ? store.foodCampaigns.find((item) => item.id === campaignId) : null) ||
      null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "竞选不存在或分享码失效");
    }
    return {
      ok: true,
      campaign: toLegacyCampaignSummary(store, state, campaign),
    };
  }

  if (method === "POST" && path === "social/food-campaigns") {
    const { user } = requireLegacyAuth(event);
    const bindTarget = resolveBoundTargetUser(store, user) || user;
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
      deadlineAtIso: resolveCampaignDeadlineIso(asString(body.deadlineAt || body.deadline_at), toApiError),
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
    const { user } = requireLegacyAuth(event);
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
      return toApiError(400, "SHARE_TOKEN_OR_CAMPAIGN_ID_REQUIRED", "分享码或拼单ID不能为空");
    }
    const campaign =
      (shareToken ? store.foodCampaigns.find((item) => item.shareToken === shareToken) : null) ||
      (campaignId ? store.foodCampaigns.find((item) => item.id === campaignId) : null) ||
      null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "拼单不存在或分享码失效");
    }
    if (resolveCampaignRuntimeStatus(campaign) !== "open") {
      return toApiError(400, "FOOD_CAMPAIGN_CLOSED", "拼单已结束，无法加入");
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
      campaign: toLegacyCampaignDetail(store, state, campaign, user, shareToken || campaign.shareToken, isAdminRole, resolveUserDisplayLabel),
    };
  }

  const campaignDetailMatch = path.match(/^social\/food-campaigns\/([^/]+)$/);
  if (method === "GET" && campaignDetailMatch) {
    const { user } = requireLegacyAuth(event);
    const campaignId = decodeURIComponent(campaignDetailMatch[1]);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "竞选不存在");
    }
    const shareToken = asString(query.share_token || query.shareToken);
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, shareToken, isAdminRole, resolveUserDisplayLabel),
    };
  }

  const campaignVoteMatch = path.match(/^social\/food-campaigns\/([^/]+)\/vote$/);
  if (method === "POST" && campaignVoteMatch) {
    const { user } = requireLegacyAuth(event);
    const campaignId = decodeURIComponent(campaignVoteMatch[1]);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "竞选不存在");
    }
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
      return toApiError(400, "FOOD_CAMPAIGN_CLOSED", "竞选已截止");
    }
    const body = await readJsonBody<{ selectedFoodIds?: number[]; selected_food_ids?: number[] }>(event);
    const selectedFoodIds = Array.isArray(body.selectedFoodIds ?? body.selected_food_ids) ? (body.selectedFoodIds ?? body.selected_food_ids ?? []) : [];
    if (selectedFoodIds.length === 0) {
      return toApiError(400, "CAMPAIGN_VOTE_EMPTY", "请至少选择一个候选");
    }
    const meta = ensureCampaignMeta(state, campaign);
    const maxVotes = Math.max(1, Math.min(3, Number(meta.maxVotesPerUser || 1)));
    if (selectedFoodIds.length > maxVotes) {
      return toApiError(400, "CAMPAIGN_VOTE_EXCEED", `最多可投 ${maxVotes} 票`);
    }
    const sourceFoodIds = selectedFoodIds
      .map((item) => state.sourceFoodIdByFoodKey.get(String(item)) || "")
      .filter((item) => item !== "")
      .filter((item) => campaign.optionFoodIds.includes(item));
    if (sourceFoodIds.length === 0) {
      return toApiError(400, "CAMPAIGN_VOTE_INVALID", "候选项无效");
    }
    appendCampaignVotes(store, campaign, user.userId, sourceFoodIds);
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, "", isAdminRole, resolveUserDisplayLabel),
    };
  }

  const campaignSupplementMatch = path.match(/^social\/food-campaigns\/([^/]+)\/supplement$/);
  if (method === "POST" && campaignSupplementMatch) {
    const { user } = requireLegacyAuth(event);
    const campaignId = decodeURIComponent(campaignSupplementMatch[1]);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "竞选不存在");
    }
    if (campaign.createdByUserId !== user.userId && !isAdminRole(user)) {
      return toApiError(403, "CAMPAIGN_SUPPLEMENT_FORBIDDEN", "仅创建者或管理员可追加候选");
    }
    if (resolveCampaignRuntimeStatus(campaign) !== "open") {
      return toApiError(400, "FOOD_CAMPAIGN_CLOSED", "竞选已截止");
    }
    if (campaign.optionFoodIds.length >= FOOD_CAMPAIGN_OPTION_LIMIT) {
      return toApiError(400, "CAMPAIGN_CANDIDATE_LIMIT", `每个竞选最多 ${FOOD_CAMPAIGN_OPTION_LIMIT} 个候选`);
    }
    let next = store.foodItems.find((item) => !campaign.optionFoodIds.includes(item.id)) || null;
    if (!next) {
      const template = pickFoodTemplate(store);
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
      campaign: toLegacyCampaignDetail(store, state, campaign, user, "", isAdminRole, resolveUserDisplayLabel),
    };
  }

  const campaignCloseMatch = path.match(/^social\/food-campaigns\/([^/]+)\/close$/);
  if (method === "POST" && campaignCloseMatch) {
    const { user } = requireLegacyAuth(event);
    const campaignId = decodeURIComponent(campaignCloseMatch[1]);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "竞选不存在");
    }
    if (campaign.createdByUserId !== user.userId && !isAdminRole(user)) {
      return toApiError(403, "CAMPAIGN_CLOSE_FORBIDDEN", "仅创建者或管理员可截止竞选");
    }
    campaign.status = "closed";
    campaign.updatedAt = storeHelpers.nowIso();
    const meta = ensureCampaignMeta(state, campaign);
    meta.closedAtUnix = toUnixSeconds(Date.now());
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, campaign.shareToken, isAdminRole, resolveUserDisplayLabel),
    };
  }

  const campaignParticipantReviewMatch = path.match(
    /^social\/food-campaigns\/([^/]+)\/participants\/([^/]+)\/(approve|reject)$/,
  );
  if (method === "POST" && campaignParticipantReviewMatch) {
    const { user } = requireLegacyAuth(event);
    const campaignId = decodeURIComponent(campaignParticipantReviewMatch[1]);
    const studentId = decodeURIComponent(campaignParticipantReviewMatch[2]);
    const campaign = store.foodCampaigns.find((item) => item.id === campaignId) || null;
    if (!campaign) {
      return toApiError(404, "FOOD_CAMPAIGN_NOT_FOUND", "竞选不存在");
    }
    if (campaign.createdByUserId !== user.userId && !isAdminRole(user)) {
      return toApiError(403, "CAMPAIGN_APPROVE_FORBIDDEN", "仅创建者或管理员可审批参与者");
    }
    const targetUser = findUserByStudentId(store, studentId);
    if (!targetUser) {
      return toApiError(404, "CAMPAIGN_PARTICIPANT_NOT_FOUND", "参与者不存在");
    }
    const participants = ensureCampaignParticipants(state, campaign);
    const participant = participants.get(targetUser.userId);
    if (!participant) {
      return toApiError(404, "CAMPAIGN_PARTICIPANT_NOT_FOUND", "参与者不存在");
    }
    participant.approvalStatus = "approved";
    return {
      ok: true,
      campaign: toLegacyCampaignDetail(store, state, campaign, user, campaign.shareToken, isAdminRole, resolveUserDisplayLabel),
    };
  }

  return null;
};
