import { computed, ref } from "vue";
import { resolveBackendMediaUrl } from "@/utils/profile-service";

export interface SocialUserItem {
  studentId: string;
  name: string;
  studentNo?: string;
  classLabel?: string;
  avatarUrl?: string;
  wallpaperUrl?: string;
  randomCode?: string;
  isAdmin?: boolean;
  notifyBound?: boolean;
  practiceCourseKeys?: string[];
}

export interface SocialDashboardResponse {
  ok?: boolean;
  me?: SocialUserItem | null;
  subscriptions?: SocialUserItem[];
  candidates?: SocialUserItem[];
  subscribers?: SocialUserItem[];
  bound?: boolean;
  stateRevision?: number;
}

const STORAGE_SOCIAL_DASHBOARD_SNAPSHOT_KEY = "touchx_v2_social_dashboard_snapshot";
const sharedDashboard = ref<SocialDashboardResponse | null>(null);
let sharedRefreshRequestSeq = 0;
let sharedLatestAppliedRequestSeq = 0;

const normalizePracticeCourseKeys = (raw: unknown) => {
  if (!Array.isArray(raw)) {
    return [] as string[];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
};

const normalizeSocialUserItem = (raw: unknown, backendBaseUrl = ""): SocialUserItem | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as Partial<SocialUserItem>;
  const studentId = String(data.studentId || "").trim();
  if (!studentId) {
    return null;
  }
  return {
    studentId,
    name: String(data.name || studentId).trim(),
    studentNo: String(data.studentNo || "").trim(),
    classLabel: String(data.classLabel || "").trim(),
    avatarUrl: resolveBackendMediaUrl(backendBaseUrl, String(data.avatarUrl || "").trim()),
    wallpaperUrl: resolveBackendMediaUrl(backendBaseUrl, String(data.wallpaperUrl || "").trim()),
    randomCode: String(data.randomCode || "").trim(),
    isAdmin: Boolean(data.isAdmin),
    notifyBound: Boolean(data.notifyBound),
    practiceCourseKeys: normalizePracticeCourseKeys(data.practiceCourseKeys),
  };
};

const normalizeSocialUserList = (raw: unknown, backendBaseUrl = "") => {
  if (!Array.isArray(raw)) {
    return [] as SocialUserItem[];
  }
  const items: SocialUserItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of raw) {
    const item = normalizeSocialUserItem(rawItem, backendBaseUrl);
    if (!item || seen.has(item.studentId)) {
      continue;
    }
    seen.add(item.studentId);
    items.push(item);
  }
  return items;
};

const normalizeSocialDashboardResponse = (raw: unknown, backendBaseUrl = ""): SocialDashboardResponse | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const data = raw as SocialDashboardResponse;
  const normalizedMe = data.me === null ? null : normalizeSocialUserItem(data.me, backendBaseUrl);
  return {
    ok: Boolean(data.ok),
    me: normalizedMe,
    subscriptions: normalizeSocialUserList(data.subscriptions, backendBaseUrl),
    candidates: normalizeSocialUserList(data.candidates, backendBaseUrl),
    subscribers: normalizeSocialUserList(data.subscribers, backendBaseUrl),
    bound: Boolean(data.bound),
    stateRevision: Number(data.stateRevision || 0),
  };
};

const persistSocialDashboardSnapshot = (data: SocialDashboardResponse) => {
  uni.setStorageSync(STORAGE_SOCIAL_DASHBOARD_SNAPSHOT_KEY, JSON.stringify(data));
};

const clearSocialDashboardSnapshot = () => {
  uni.removeStorageSync(STORAGE_SOCIAL_DASHBOARD_SNAPSHOT_KEY);
};

const readSocialDashboardSnapshot = (backendBaseUrl = "") => {
  const raw = uni.getStorageSync(STORAGE_SOCIAL_DASHBOARD_SNAPSHOT_KEY);
  let parsed: unknown = null;
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = null;
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }
  return normalizeSocialDashboardResponse(parsed, backendBaseUrl);
};

export const buildRegisteredUsersFromDashboard = (dashboard: SocialDashboardResponse | null) => {
  const users: SocialUserItem[] = [];
  const pushUnique = (item?: SocialUserItem | null) => {
    if (!item || !item.studentId) {
      return;
    }
    if (users.some((user) => user.studentId === item.studentId)) {
      return;
    }
    users.push(item);
  };
  pushUnique(dashboard?.me);
  for (const item of dashboard?.subscriptions || []) {
    pushUnique(item);
  }
  for (const item of dashboard?.subscribers || []) {
    pushUnique(item);
  }
  for (const item of dashboard?.candidates || []) {
    pushUnique(item);
  }
  return users;
};

export const useSocialDashboard = () => {
  const dashboard = sharedDashboard;
  const subscriptions = computed(() => dashboard.value?.subscriptions || []);
  const candidates = computed(() => dashboard.value?.candidates || []);
  const subscribedStudentIdSet = computed(() => {
    return new Set(subscriptions.value.map((item) => item.studentId));
  });

  const resolveRevision = (payload: SocialDashboardResponse | null) => {
    return Number(payload?.stateRevision || 0);
  };

  const mergeMissingFields = (payload: SocialDashboardResponse): SocialDashboardResponse => {
    return {
      ok: payload.ok,
      me: payload.me ?? null,
      subscriptions: payload.subscriptions || [],
      candidates: payload.candidates || [],
      subscribers: payload.subscribers || [],
      bound: Boolean(payload.bound),
      stateRevision: Number(payload.stateRevision || 0),
    };
  };

  const commitDashboard = (nextPayload: SocialDashboardResponse, requestSeq = 0) => {
    const normalizedNext = mergeMissingFields(nextPayload);
    const current = dashboard.value;
    const persisted = readSocialDashboardSnapshot();
    const currentRevision = resolveRevision(current);
    const persistedRevision = resolveRevision(persisted);
    const nextRevision = resolveRevision(normalizedNext);
    if (current && nextRevision > 0 && currentRevision > nextRevision) {
      return false;
    }
    if (persisted && persistedRevision > nextRevision) {
      return false;
    }
    if (requestSeq > 0 && requestSeq < sharedLatestAppliedRequestSeq) {
      return false;
    }
    dashboard.value = normalizedNext;
    persistSocialDashboardSnapshot(normalizedNext);
    if (requestSeq > 0 && requestSeq > sharedLatestAppliedRequestSeq) {
      sharedLatestAppliedRequestSeq = requestSeq;
    }
    return true;
  };

  const refreshDashboard = async (loader: () => Promise<SocialDashboardResponse>, backendBaseUrl = "") => {
    const requestSeq = ++sharedRefreshRequestSeq;
    const data = await loader();
    const normalized = normalizeSocialDashboardResponse(data, backendBaseUrl) || {
      ok: Boolean(data?.ok),
      me: null,
      subscriptions: [],
      candidates: [],
      subscribers: [],
      bound: false,
      stateRevision: 0,
    };
    commitDashboard(normalized, requestSeq);
    return dashboard.value || normalized;
  };

  const hydrateDashboardFromStorage = (backendBaseUrl = "") => {
    const snapshot = readSocialDashboardSnapshot(backendBaseUrl);
    if (!snapshot) {
      return false;
    }
    commitDashboard(snapshot);
    return true;
  };

  const patchDashboard = (
    updater: (current: SocialDashboardResponse | null) => SocialDashboardResponse | null,
    options?: { requestSeq?: number },
  ) => {
    const next = updater(dashboard.value);
    if (!next) {
      return false;
    }
    const patchRequestSeq = Number(options?.requestSeq || ++sharedRefreshRequestSeq);
    return commitDashboard(next, patchRequestSeq);
  };

  const clearDashboard = (purgeStorage = false) => {
    dashboard.value = null;
    sharedRefreshRequestSeq = 0;
    sharedLatestAppliedRequestSeq = 0;
    if (purgeStorage) {
      clearSocialDashboardSnapshot();
    }
  };

  return {
    dashboard,
    subscriptions,
    candidates,
    subscribedStudentIdSet,
    refreshDashboard,
    hydrateDashboardFromStorage,
    patchDashboard,
    clearDashboard,
  };
};
