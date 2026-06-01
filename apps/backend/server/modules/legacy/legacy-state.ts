import type { NexusStore } from "../../services/domain-store";
import { normalizeCaloriesKcal } from "../../services/food-utils";

export type LegacyJoinMode = "all" | "invite" | "password";
export type LegacyCandidateStatus = "approved" | "pending_eat" | "pending_review" | "rejected";
export type LegacyFoodCandidateSubmissionMode = "raw_text" | "structured";

export interface LegacyFoodCandidateRecord {
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

export interface LegacyCampaignMeta {
  templateKey: string;
  joinMode: LegacyJoinMode;
  joinPassword: string;
  maxVotesPerUser: number;
  closedAtUnix: number;
  inviteeUserIds: string[];
}

export interface LegacyCampaignParticipant {
  userId: string;
  source: "creator" | "invitee" | "join";
  approvalStatus: "approved" | "pending" | "rejected";
}

export interface LegacyCompatState {
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

const legacyStateMap = new WeakMap<NexusStore, LegacyCompatState>();

const asString = (value: unknown) => String(value || "").trim();

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

const toUnixSeconds = (value: string | number | Date) => {
  const timestamp =
    value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return Math.floor(timestamp / 1000);
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

const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asString(item)).filter((item) => item);
};

const normalizeLegacyFoodCandidateSubmissionMode = (value: unknown): LegacyFoodCandidateSubmissionMode => {
  return asString(value).toLowerCase() === "raw_text" ? "raw_text" : "structured";
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

export const randomCodeByStudentNo = (studentNo: string) => {
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

export const getLegacyState = (store: NexusStore) => {
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
