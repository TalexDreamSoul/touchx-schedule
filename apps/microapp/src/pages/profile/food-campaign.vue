<template>
  <PageContainer title="美食拼单">
    <view class="page">
      <!-- 顶部快捷操作 -->
      <view class="hero-card">
        <view class="hero-header">
          <view class="hero-title-group">
            <view class="hero-title">美食拼单</view>
          </view>
          <view class="hero-actions">
            <button class="icon-btn" @click="handleRefreshClick" :class="{ spinning: isRefreshing }">↻</button>
          </view>
        </view>
        <view class="hero-warning" v-if="myOpenCampaign">
          <view class="hero-warning-dot" />
          <view class="hero-warning-text">你有一场进行中的拼单：{{ resolveCampaignTitle(myOpenCampaign) }}</view>
        </view>
        <view class="hero-action-row">
          <button class="hero-row-card overview" @click="openCandidatePoolPage">
            <text class="hero-row-icon">▦</text>
            <text class="hero-row-title">全览</text>
          </button>
          <button class="hero-row-card join" @click="showJoinSheet = true">
            <text class="hero-row-icon">⌁</text>
            <text class="hero-row-title">加入</text>
          </button>
        </view>
      </view>

      <!-- 进行中的拼单 -->
      <view class="section-card">
        <view class="section-header">
          <view class="section-title">
            <view class="section-dot live" />
            当前进行
          </view>
          <view class="section-badge">{{ openCampaigns.length }}</view>
        </view>
        <template v-if="openCampaigns.length > 0">
          <view
            v-for="item in openCampaigns"
            :key="`open-${item.campaignId}`"
            class="campaign-card"
            @click="openCampaign(item)"
          >
            <view class="campaign-body">
              <view class="campaign-name">{{ resolveCampaignTitle(item) }}</view>
              <view class="campaign-info">
                <view class="info-tag">{{ templateLabel(item.templateKey) }}</view>
                <view class="info-tag">{{ joinModeLabel(item.joinMode) }}</view>
                <view class="info-tag">{{ item.candidateCount || 0 }}个候选</view>
                <view class="info-tag">{{ item.headcount || 0 }}人</view>
              </view>
              <view v-if="(item.categoryHighlights || []).length > 0" class="campaign-tags">
                <view v-for="tag in item.categoryHighlights || []" :key="`open-tag-${item.campaignId}-${tag.categoryKey}`" class="category-chip">
                  {{ tag.categoryName || tag.categoryKey || "分类" }}
                </view>
              </view>
              <view class="campaign-time">截止于 {{ formatTime(item.deadlineAt) }}</view>
            </view>
            <view class="campaign-arrow">›</view>
          </view>
        </template>
        <view v-else class="section-empty">
          <view class="section-empty-title">暂无进行中的拼单</view>
          <view class="section-empty-sub">点击底部「发起新拼单」即可快速发起</view>
        </view>
      </view>

      <!-- 最近动态 -->
      <view class="section-card">
        <view class="section-header">
          <view class="section-title">
            <view class="section-dot" />
            近期拼单
          </view>
          <view class="section-link" @click="openHistoryPage">查看全部 &gt;</view>
        </view>
        <template v-if="recentClosedCampaigns.length > 0">
          <view
            v-for="item in recentClosedCampaigns"
            :key="`recent-${item.campaignId}`"
            class="campaign-card muted"
            @click="openCampaign(item)"
          >
            <view class="campaign-body">
              <view class="campaign-name-row">
                <view class="campaign-name">{{ resolveCampaignTitle(item) }}</view>
                <view class="status-badge" :class="statusBadgeClass(resolveCampaignDisplayStatus(item))">
                  {{ statusLabelText(resolveCampaignDisplayStatus(item)) }}
                </view>
              </view>
              <view class="campaign-info">
                <view class="info-tag">{{ templateLabel(item.templateKey) }} · {{ formatRelativeTime(item.closedAt || item.deadlineAt || item.createdAt) }}</view>
                <view class="info-tag">{{ item.headcount || 0 }}人</view>
              </view>
              <view class="campaign-avatars" v-if="participantPreviewMap[item.campaignId]?.length">
                <view
                  v-for="(participant, index) in participantPreviewMap[item.campaignId] || []"
                  :key="`recent-avatar-${item.campaignId}-${participant.studentId}`"
                  class="avatar-chip"
                  :style="{ marginLeft: index === 0 ? '0rpx' : '-10rpx', zIndex: `${30 - index}` }"
                >
                  <image v-if="participant.avatarUrl" class="avatar-img" :src="participant.avatarUrl" mode="aspectFill" />
                  <view v-else class="avatar-fallback">{{ participant.shortName }}</view>
                </view>
              </view>
            </view>
            <view class="campaign-arrow">›</view>
          </view>
        </template>
        <view v-else class="section-empty">
          <view class="section-empty-title">近期暂无拼单记录</view>
          <view class="section-empty-sub">后续拼单结束后会在这里展示</view>
        </view>
      </view>

      <!-- 套餐精选 -->
      <view class="section-card">
        <view class="section-header">
          <view class="section-title">
            <view class="section-dot pick" />
            套餐精选
          </view>
          <view class="section-caption">按各套餐参与人数最高</view>
        </view>
        <template v-if="templatePicks.length > 0">
          <view class="template-pick-list">
            <view
              v-for="(item, index) in templatePicks"
              :key="`pick-${item.templateKey}`"
              class="template-pick-card"
              :class="`tone-${index % 4}`"
              @click="openCampaign(item.topCampaign)"
            >
              <view class="template-pick-main">
                <view class="template-pick-name">{{ item.templateLabel }}</view>
                <view class="template-pick-title">{{ resolveCampaignTitle(item.topCampaign) }}</view>
                <view class="template-pick-meta">
                  <view class="info-tag">{{ item.topCampaign.headcount || 0 }} 人</view>
                  <view class="info-tag">{{ item.campaignCount }} 场</view>
                  <view class="info-tag faded">{{ statusLabelText(resolveCampaignDisplayStatus(item.topCampaign)) }}</view>
                </view>
              </view>
              <view class="template-pick-side">
                <view class="template-pick-number">{{ item.topCampaign.headcount || 0 }}</view>
                <view class="template-pick-number-label">最高参与</view>
              </view>
            </view>
          </view>
        </template>
        <view v-else class="section-empty">
          <view class="section-empty-title">暂无可用精选数据</view>
          <view class="section-empty-sub">至少完成一场拼单后可生成套餐精选</view>
        </view>
      </view>

      <view class="bottom-sticky-wrap">
        <view class="bottom-sticky-inner">
          <button class="bottom-primary-btn" :disabled="Boolean(myOpenCampaign)" @click="openCreatePage">发起新拼单</button>
        </view>
      </view>

      <!-- 加入拼单弹窗 -->
      <view class="sheet-mask" v-if="showJoinSheet" @click.self="showJoinSheet = false">
        <view class="sheet-container" @click.stop>
          <view class="sheet-header">
            <view class="sheet-title">加入拼单</view>
            <view class="sheet-close" @click="showJoinSheet = false">✕</view>
          </view>
          <view class="sheet-body">
            <view class="sheet-field">
              <view class="sheet-label">分享码</view>
              <input v-model.trim="joinShareToken" class="sheet-input" type="text" maxlength="12" placeholder="请输入分享码" />
            </view>
            <view class="sheet-field">
              <view class="sheet-label">参与密码<text class="sheet-label-hint">（仅密码模式需填写）</text></view>
              <input v-model.trim="joinAccessPassword" class="sheet-input" type="text" password placeholder="无密码可留空" />
            </view>
            <button class="sheet-submit-btn" :class="{ pending: pendingJoin }" @click="joinCampaign">
              {{ pendingJoin ? "加入中..." : "加入拼单" }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import {
  guardProfilePageAccess,
  isAuthSessionInvalidError,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

type FoodCampaignJoinMode = "all" | "invite" | "password";
type FoodCampaignStatus = "open" | "closed" | "cancelled";

interface FoodCampaignSummary {
  campaignId: string;
  title: string;
  initiatorStudentId?: string;
  templateKey: string;
  status: FoodCampaignStatus | string;
  joinMode?: FoodCampaignJoinMode;
  shareToken?: string;
  candidateCount?: number;
  headcount?: number;
  deadlineAt?: number;
  createdAt?: number;
  closedAt?: number;
  categoryHighlights?: Array<{ categoryKey?: string; categoryName?: string; count?: number }>;
}

interface FoodCampaignDetail {
  campaignId: string;
  title: string;
  shareToken?: string;
}

interface CampaignListResponse {
  ok?: boolean;
  items?: FoodCampaignSummary[];
}

interface CampaignDetailResponse {
  ok?: boolean;
  campaign?: FoodCampaignDetail;
}

interface FoodCampaignParticipantPreviewItem {
  studentId: string;
  name: string;
  avatarUrl: string;
  shortName: string;
}

interface CampaignDetailWithParticipantsResponse {
  ok?: boolean;
  campaign?: {
    participants?: Array<{
      studentId?: string;
      name?: string;
      avatarUrl?: string;
    }>;
  };
}

interface FoodCampaignTemplatePick {
  templateKey: string;
  templateLabel: string;
  campaignCount: number;
  totalHeadcount: number;
  topCampaign: FoodCampaignSummary;
}

const FOOD_CAMPAIGN_CREATED_ID_STORAGE_KEY = "touchx_food_campaign_created_id";
const AUTO_REFRESH_INTERVAL_MS = 15 * 1000;
const DISPLAY_CLOCK_INTERVAL_MS = 1000;

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const campaigns = ref<FoodCampaignSummary[]>([]);
const joinShareToken = ref("");
const joinAccessPassword = ref("");
const pendingJoin = ref(false);
const routeShareToken = ref("");
const routeCampaignId = ref("");
const isRefreshing = ref(false);
const showJoinSheet = ref(false);
const participantPreviewMap = ref<Record<string, FoodCampaignParticipantPreviewItem[]>>({});
const nowUnixSeconds = ref(Math.floor(Date.now() / 1000));
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let displayClockTimer: ReturnType<typeof setInterval> | null = null;

const joinModeLabelMap: Record<FoodCampaignJoinMode, string> = {
  all: "公开参与",
  invite: "邀请制",
  password: "密码参与",
};

const templateLabelMap: Record<string, string> = {
  daily: "日常档",
  party: "聚会档",
};

const updateNowUnixSeconds = () => {
  nowUnixSeconds.value = Math.floor(Date.now() / 1000);
};

const normalizeUnixSeconds = (value: unknown) => {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  if (raw >= 1e12) {
    return Math.floor(raw / 1000);
  }
  return Math.floor(raw);
};

const resolveCampaignDisplayStatus = (item: FoodCampaignSummary | null | undefined): FoodCampaignStatus | string => {
  if (!item) {
    return "closed";
  }
  const normalized = normalizeCampaignStatus(item.status);
  if (normalized !== "open") {
    return normalized;
  }
  const closedAt = normalizeUnixSeconds(item.closedAt);
  if (closedAt > 0) {
    return "closed";
  }
  const deadlineAt = normalizeUnixSeconds(item.deadlineAt);
  if (deadlineAt > 0 && deadlineAt <= nowUnixSeconds.value) {
    return "closed";
  }
  return normalized;
};

const currentUserIdentity = computed(() => {
  return String(authSession.value.user?.studentId || authSession.value.user?.studentNo || "").trim();
});

const openCampaigns = computed(() => {
  return [...campaigns.value]
    .filter((item) => resolveCampaignDisplayStatus(item) === "open")
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
});

const myOpenCampaign = computed(() => {
  const userIdentity = currentUserIdentity.value;
  if (!userIdentity) {
    return null;
  }
  return openCampaigns.value.find((item) => String(item.initiatorStudentId || "").trim() === userIdentity) || null;
});

const recentClosedCampaigns = computed(() => {
  const nowSeconds = nowUnixSeconds.value;
  const threshold = nowSeconds - 3 * 24 * 60 * 60;
  return [...campaigns.value]
    .filter((item) => resolveCampaignDisplayStatus(item) !== "open")
    .filter((item) => {
      const referenceTs = normalizeUnixSeconds(item.closedAt || item.deadlineAt || item.createdAt);
      return referenceTs >= threshold;
    })
    .sort((left, right) => {
      const leftTs = normalizeUnixSeconds(left.closedAt || left.deadlineAt || left.createdAt);
      const rightTs = normalizeUnixSeconds(right.closedAt || right.deadlineAt || right.createdAt);
      return rightTs - leftTs;
    })
    .slice(0, 3);
});

const templatePicks = computed<FoodCampaignTemplatePick[]>(() => {
  const grouped = new Map<string, FoodCampaignTemplatePick>();
  campaigns.value.forEach((item) => {
    const templateKey = String(item.templateKey || "daily").trim().toLowerCase() || "daily";
    const headcount = Number(item.headcount || 0);
    const record = grouped.get(templateKey);
    if (!record) {
      grouped.set(templateKey, {
        templateKey,
        templateLabel: templateLabel(templateKey),
        campaignCount: 1,
        totalHeadcount: headcount,
        topCampaign: item,
      });
      return;
    }
    record.campaignCount += 1;
    record.totalHeadcount += headcount;
    if (headcount > Number(record.topCampaign.headcount || 0)) {
      record.topCampaign = item;
    }
  });
  return [...grouped.values()]
    .sort((left, right) => {
      const topDiff = Number(right.topCampaign.headcount || 0) - Number(left.topCampaign.headcount || 0);
      if (topDiff !== 0) {
        return topDiff;
      }
      const totalDiff = right.totalHeadcount - left.totalHeadcount;
      if (totalDiff !== 0) {
        return totalDiff;
      }
      return right.campaignCount - left.campaignCount;
    })
    .slice(0, 6);
});

const ensureAuthed = () => {
  if (!authSession.value.token || !authSession.value.user) {
    throw new Error("请先在账号页完成登录授权");
  }
};

const normalizeCampaignStatus = (value: unknown): FoodCampaignStatus | string => {
  const status = String(value || "").trim().toLowerCase();
  if (status === "open" || status === "closed" || status === "cancelled") {
    return status;
  }
  return "open";
};

const normalizeCampaignSummary = (item: FoodCampaignSummary): FoodCampaignSummary => {
  return {
    ...item,
    status: normalizeCampaignStatus(item.status),
    createdAt: normalizeUnixSeconds(item.createdAt),
    deadlineAt: normalizeUnixSeconds(item.deadlineAt),
    closedAt: normalizeUnixSeconds(item.closedAt),
    candidateCount: Number(item.candidateCount || 0),
    headcount: Number(item.headcount || 0),
  };
};

const normalizeRouteParam = (value: unknown) => {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
};

const joinModeLabel = (mode: unknown) => {
  const key = String(mode || "all").trim().toLowerCase() as FoodCampaignJoinMode;
  return joinModeLabelMap[key] || joinModeLabelMap.all;
};

const templateLabel = (key: unknown) => {
  const value = String(key || "").trim().toLowerCase();
  return templateLabelMap[value] || value || "日常档";
};

const statusLabelText = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "closed") return "已结束";
  if (value === "cancelled") return "已取消";
  if (value === "open") return "进行中";
  return value || "未知";
};

const statusBadgeClass = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "open") return "live";
  if (value === "closed") return "ended";
  if (value === "cancelled") return "cancelled";
  return "neutral";
};

const formatTime = (timestamp: unknown) => {
  const ts = normalizeUnixSeconds(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return "--";
  }
  const date = new Date(ts * 1000);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
};

const formatRelativeTime = (timestamp: unknown) => {
  const ts = normalizeUnixSeconds(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return "--";
  }
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) {
    return "刚刚";
  }
  if (diff < 60 * 60) {
    return `${Math.floor(diff / 60)}分钟前`;
  }
  if (diff < 24 * 60 * 60) {
    return `${Math.floor(diff / (60 * 60))}小时前`;
  }
  if (diff < 3 * 24 * 60 * 60) {
    return `${Math.floor(diff / (24 * 60 * 60))}天前`;
  }
  return formatTime(ts);
};

const resolveCampaignTitle = (item: FoodCampaignSummary | null | undefined) => {
  const explicitTitle = String(item?.title || "").trim();
  if (explicitTitle) {
    return explicitTitle;
  }
  const createdAt = normalizeUnixSeconds(item?.createdAt);
  if (createdAt > 0) {
    return `${formatTime(createdAt)} 发布的拼单`;
  }
  return "拼单";
};

const toShortName = (value: unknown) => {
  const text = String(value || "").trim();
  return text ? text.slice(0, 1).toUpperCase() : "?";
};

const fallbackAvatarUrl = (seed: string) => {
  const normalized = String(seed || "").trim() || "touchx";
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(normalized)}`;
};

const refreshRecentParticipantPreviews = async () => {
  if (!authSession.value.token || !authSession.value.user) {
    participantPreviewMap.value = {};
    return;
  }
  const targets = recentClosedCampaigns.value.slice(0, 6);
  if (targets.length === 0) {
    participantPreviewMap.value = {};
    return;
  }
  const entries = await Promise.all(
    targets.map(async (item): Promise<[string, FoodCampaignParticipantPreviewItem[]]> => {
      const campaignId = String(item.campaignId || "").trim();
      if (!campaignId) {
        return ["", []];
      }
      try {
        const query: Record<string, string> = {};
        const shareToken = String(item.shareToken || "").trim();
        if (shareToken) {
          query.shareToken = shareToken;
        }
        const response = await requestBackendGet<CampaignDetailWithParticipantsResponse>(
          backendBaseUrl.value,
          `/api/v1/social/food-campaigns/${encodeURIComponent(campaignId)}`,
          query,
          authSession.value.token,
        );
        const previews = (response.campaign?.participants || [])
          .slice(0, 6)
          .map((participant) => {
            const studentId = String(participant.studentId || "").trim();
            const name = String(participant.name || studentId || "用户").trim();
            const avatarUrl = String(participant.avatarUrl || "").trim() || fallbackAvatarUrl(studentId || name);
            return {
              studentId: studentId || name,
              name,
              avatarUrl,
              shortName: toShortName(name),
            };
          });
        return [campaignId, previews];
      } catch (error) {
        return [campaignId, []];
      }
    }),
  );
  const nextMap: Record<string, FoodCampaignParticipantPreviewItem[]> = {};
  entries.forEach(([campaignId, list]) => {
    if (campaignId) {
      nextMap[campaignId] = list;
    }
  });
  participantPreviewMap.value = nextMap;
};

const openCampaign = (item: FoodCampaignSummary) => {
  const campaignId = String(item.campaignId || "").trim();
  if (!campaignId) {
    return;
  }
  const shareToken = String(item.shareToken || "").trim();
  const params: string[] = [`campaignId=${encodeURIComponent(campaignId)}`];
  if (shareToken) {
    params.push(`shareToken=${encodeURIComponent(shareToken)}`);
  }
  uni.navigateTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
};

const openCreatePage = () => {
  if (myOpenCampaign.value) {
    uni.showToast({ title: "你已有进行中拼单，请先结束", icon: "none", duration: 1800 });
    return;
  }
  uni.navigateTo({ url: "/pages/profile/food-campaign-create" });
};

const openCandidatePoolPage = () => {
  uni.navigateTo({ url: "/pages/profile/food-candidate-pool" });
};

const openHistoryPage = () => {
  uni.navigateTo({ url: "/pages/profile/food-campaign-history" });
};

const refreshCampaigns = async () => {
  ensureAuthed();
  const response = await requestBackendGet<CampaignListResponse>(
    backendBaseUrl.value,
    "/api/v1/social/food-campaigns",
    { status: "all" },
    authSession.value.token,
  );
  campaigns.value = Array.isArray(response.items) ? response.items.map(normalizeCampaignSummary) : [];
};

const consumeCreatedCampaignId = () => {
  const raw = uni.getStorageSync(FOOD_CAMPAIGN_CREATED_ID_STORAGE_KEY);
  if (!raw) {
    return "";
  }
  uni.removeStorageSync(FOOD_CAMPAIGN_CREATED_ID_STORAGE_KEY);
  return String(raw || "").trim();
};

const joinCampaign = async () => {
  if (pendingJoin.value) {
    return;
  }
  pendingJoin.value = true;
  try {
    ensureAuthed();
    const token = String(joinShareToken.value || "").trim();
    if (!token) {
      throw new Error("请输入分享码");
    }
    const response = await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      "/api/v1/social/food-campaigns/join",
      {
        shareToken: token,
        accessPassword: String(joinAccessPassword.value || "").trim(),
      },
      authSession.value.token,
    );
    const detail = response.campaign;
    if (!detail?.campaignId) {
      throw new Error("加入成功但未获取到拼单详情");
    }
    showJoinSheet.value = false;
    uni.showToast({ title: "加入成功", icon: "none", duration: 1200 });
    const params: string[] = [`campaignId=${encodeURIComponent(detail.campaignId)}`, `shareToken=${encodeURIComponent(token)}`];
    uni.navigateTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加入失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pendingJoin.value = false;
  }
};

const refreshState = async () => {
  updateNowUnixSeconds();
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  const createdId = consumeCreatedCampaignId();
  if (createdId) {
    routeCampaignId.value = createdId;
  }
  if (!authSession.value.token || !authSession.value.user) {
    campaigns.value = [];
    participantPreviewMap.value = {};
    return;
  }
  await refreshCampaigns();
  if (routeShareToken.value || routeCampaignId.value) {
    const params: string[] = [];
    if (routeCampaignId.value) {
      params.push(`campaignId=${encodeURIComponent(routeCampaignId.value)}`);
    }
    if (routeShareToken.value) {
      params.push(`shareToken=${encodeURIComponent(routeShareToken.value)}`);
    }
    routeCampaignId.value = "";
    routeShareToken.value = "";
    uni.navigateTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
    return;
  }
  await refreshRecentParticipantPreviews();
};

const refreshStateSilently = async (options?: { suppressErrorToast?: boolean }) => {
  updateNowUnixSeconds();
  isRefreshing.value = true;
  try {
    await refreshState();
  } catch (error) {
    if (isAuthSessionInvalidError(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : "加载失败";
    if (!options?.suppressErrorToast) {
      uni.showToast({ title: message, icon: "none", duration: 1800 });
    }
  } finally {
    isRefreshing.value = false;
  }
};

const handleRefreshClick = () => {
  void refreshStateSilently();
};

const stopAutoRefreshTimer = () => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (!displayClockTimer) {
    return;
  }
  clearInterval(displayClockTimer);
  displayClockTimer = null;
};

const startAutoRefreshTimer = () => {
  stopAutoRefreshTimer();
  updateNowUnixSeconds();
  displayClockTimer = setInterval(() => {
    updateNowUnixSeconds();
  }, DISPLAY_CLOCK_INTERVAL_MS);
  autoRefreshTimer = setInterval(() => {
    void refreshStateSilently({ suppressErrorToast: true });
  }, AUTO_REFRESH_INTERVAL_MS);
};

onLoad((query) => {
  routeShareToken.value = normalizeRouteParam(query?.share_token || query?.shareToken || query?.share_id || query?.shareId || query?.token);
  routeCampaignId.value = normalizeRouteParam(query?.campaign_id || query?.campaignId || query?.id);
  if (routeShareToken.value || routeCampaignId.value) {
    const params: string[] = [];
    if (routeCampaignId.value) {
      params.push(`campaignId=${encodeURIComponent(routeCampaignId.value)}`);
    }
    if (routeShareToken.value) {
      params.push(`shareToken=${encodeURIComponent(routeShareToken.value)}`);
    }
    uni.redirectTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
    return;
  }
  if (routeShareToken.value) {
    joinShareToken.value = routeShareToken.value;
  }
});

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  startAutoRefreshTimer();
  void refreshStateSilently();
});

onHide(() => {
  stopAutoRefreshTimer();
});

onUnload(() => {
  stopAutoRefreshTimer();
});
</script>

<style scoped>
.page {
  position: relative;
  overflow: hidden;
  padding: 0;
  padding-bottom: calc(148rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  min-height: 100vh;
  background: color-mix(in srgb, var(--bg) 88%, #ffffff 12%);
}

.page::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(1240rpx 760rpx at -6% -8%, color-mix(in srgb, #ff9a3d 42%, transparent), transparent 68%),
    radial-gradient(980rpx 600rpx at 106% 2%, color-mix(in srgb, #ff4e9a 40%, transparent), transparent 70%),
    radial-gradient(900rpx 520rpx at 50% 12%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 76%);
}

.page::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  background:
    linear-gradient(180deg, rgba(249, 251, 255, 0.58) 0%, rgba(243, 247, 255, 0.66) 100%),
    radial-gradient(900rpx 560rpx at 50% 28%, rgba(255, 255, 255, 0.12), transparent 72%);
}

.hero-card,
.section-card,
.bottom-sticky-inner {
  width: calc(100% - 40rpx);
  max-width: 980rpx;
  margin-left: auto;
  margin-right: auto;
}

.hero-card,
.section-card,
.bottom-sticky-wrap {
  position: relative;
  z-index: 2;
}

.hero-card {
  position: relative;
  overflow: hidden;
  background: color-mix(in srgb, var(--card-bg) 82%, rgba(255, 255, 255, 0.18) 18%);
  border: 1rpx solid color-mix(in srgb, var(--line) 90%, #ffffff 10%);
  border-radius: 26rpx;
  padding: 26rpx 22rpx;
  margin-bottom: 18rpx;
  box-shadow: 0 4rpx 14rpx rgba(17, 26, 44, 0.04);
}

.hero-header {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12rpx;
}

.hero-title-group {
  flex: 1;
}

.hero-title {
  font-size: 34rpx;
  font-weight: 800;
  color: var(--text-main);
  letter-spacing: 1rpx;
}

.icon-btn {
  position: relative;
  width: 60rpx;
  height: 60rpx;
  border-radius: 999rpx;
  border: 1rpx solid color-mix(in srgb, var(--accent) 26%, var(--line) 74%);
  background: color-mix(in srgb, var(--card-bg) 70%, var(--muted-bg) 30%);
  color: var(--text-sub);
  font-size: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 0.3s;
}

.icon-btn.spinning {
  animation: spin 0.6s ease-in-out;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.hero-warning {
  position: relative;
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 10rpx 12rpx;
  border-radius: 12rpx;
  background: color-mix(in srgb, var(--card-bg) 74%, #ffffff 26%);
  border: 1rpx solid color-mix(in srgb, var(--line) 82%, var(--accent) 18%);
}

.hero-warning-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: var(--accent);
  flex-shrink: 0;
}

.hero-warning-text {
  font-size: 22rpx;
  color: var(--accent);
  font-weight: 500;
}

.hero-action-row {
  position: relative;
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.hero-row-card {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 92rpx;
  padding: 0 16rpx;
  border: 1rpx solid color-mix(in srgb, var(--line) 86%, #ffffff 14%);
  border-radius: 18rpx;
  box-sizing: border-box;
  color: #1f2a44;
  background: color-mix(in srgb, #ffffff 78%, var(--card-bg) 22%);
  box-shadow: 0 2rpx 6rpx rgba(17, 26, 44, 0.03);
}

.hero-row-card::after {
  border: none;
}

.hero-row-card.overview {
  border-color: color-mix(in srgb, #7a92d8 24%, var(--line) 76%);
  background: color-mix(in srgb, #f5f8ff 82%, #ffffff 18%);
}

.hero-row-card.join {
  border-color: color-mix(in srgb, #d296bf 24%, var(--line) 76%);
  background: color-mix(in srgb, #fff5fa 82%, #ffffff 18%);
}

.hero-row-icon {
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1;
  color: #2a3856;
}

.hero-row-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #1a2338;
  line-height: 1;
}

.section-card {
  background: color-mix(in srgb, var(--card-bg) 84%, rgba(255, 255, 255, 0.16) 16%);
  border: 1rpx solid color-mix(in srgb, var(--line) 88%, #ffffff 12%);
  border-radius: 22rpx;
  padding: 22rpx 18rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 4rpx 14rpx rgba(17, 26, 44, 0.035);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-bottom: 14rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.section-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: var(--accent);
}

.section-dot.live {
  background: #22c55e;
  box-shadow: 0 0 8rpx rgba(34, 197, 94, 0.5);
}

.section-dot.pick {
  background: #ef45a5;
  box-shadow: 0 0 8rpx rgba(239, 69, 165, 0.38);
}

.section-badge {
  min-width: 36rpx;
  height: 36rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, var(--accent) 12%, var(--muted-bg) 88%);
  color: var(--accent);
  font-size: 22rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-caption {
  font-size: 24rpx;
  color: var(--text-sub);
}

.section-link {
  color: color-mix(in srgb, var(--accent) 76%, #334155 24%);
  font-size: 24rpx;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.3rpx;
}

.campaign-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  border: 1rpx solid color-mix(in srgb, var(--line) 78%, var(--accent) 22%);
  border-radius: 16rpx;
  padding: 18rpx 16rpx;
  background: color-mix(in srgb, var(--muted-bg) 84%, #ffffff 16%);
  margin-bottom: 10rpx;
  box-shadow: 0 2rpx 6rpx rgba(23, 38, 70, 0.03);
}

.campaign-card:last-child {
  margin-bottom: 0;
}

.campaign-card.muted {
  background: color-mix(in srgb, var(--muted-bg) 88%, #ffffff 12%);
}

.campaign-body {
  flex: 1;
  min-width: 0;
}

.campaign-name {
  font-size: 28rpx;
  color: var(--text-main);
  font-weight: 700;
}

.campaign-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.status-badge {
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
  font-size: 20rpx;
  font-weight: 600;
  border: 1rpx solid transparent;
}

.status-badge.live {
  background: color-mix(in srgb, #22c55e 14%, #ffffff 86%);
  border-color: color-mix(in srgb, #22c55e 34%, #ffffff 66%);
  color: #159b57;
}

.status-badge.ended {
  background: color-mix(in srgb, #64748b 12%, #ffffff 88%);
  border-color: color-mix(in srgb, #64748b 32%, #ffffff 68%);
  color: #475569;
}

.status-badge.cancelled {
  background: color-mix(in srgb, #ef4444 10%, #ffffff 90%);
  border-color: color-mix(in srgb, #ef4444 32%, #ffffff 68%);
  color: #dc2626;
}

.status-badge.neutral {
  background: color-mix(in srgb, var(--accent) 10%, #ffffff 90%);
  border-color: color-mix(in srgb, var(--accent) 28%, #ffffff 72%);
  color: var(--accent);
}

.campaign-info {
  margin-top: 8rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.info-tag {
  font-size: 20rpx;
  color: var(--text-sub);
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, var(--card-bg) 70%, var(--muted-bg) 30%);
  border: 1rpx solid color-mix(in srgb, var(--line) 60%, transparent);
}

.info-tag.faded {
  opacity: 0.7;
}

.campaign-tags {
  margin-top: 8rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 6rpx;
}

.category-chip {
  border: 1rpx solid color-mix(in srgb, var(--accent) 25%, var(--line) 75%);
  border-radius: 999rpx;
  padding: 4rpx 12rpx;
  font-size: 20rpx;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--card-bg) 94%);
}

.campaign-time {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.campaign-avatars {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
}

.avatar-chip {
  width: 40rpx;
  height: 40rpx;
  border-radius: 999rpx;
  border: 2rpx solid #ffffff;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent) 18%, #ffffff 82%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-img {
  width: 100%;
  height: 100%;
}

.avatar-fallback {
  font-size: 20rpx;
  font-weight: 700;
  color: #1d2f55;
}

.campaign-arrow {
  font-size: 36rpx;
  color: var(--text-sub);
  opacity: 0.5;
  flex-shrink: 0;
}

.section-empty {
  border: 1rpx dashed color-mix(in srgb, var(--line) 70%, var(--accent) 30%);
  border-radius: 14rpx;
  background: color-mix(in srgb, var(--muted-bg) 80%, #ffffff 20%);
  padding: 20rpx 16rpx;
}

.section-empty-title {
  font-size: 26rpx;
  color: var(--text-main);
  font-weight: 600;
}

.section-empty-sub {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.template-pick-list {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.template-pick-card {
  border: 1rpx solid transparent;
  border-radius: 16rpx;
  padding: 18rpx 16rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  box-shadow: 0 8rpx 18rpx rgba(18, 32, 62, 0.05);
}

.template-pick-card.tone-0 {
  background: linear-gradient(145deg, #eaf1ff 0%, #fff6e9 100%);
  border-color: color-mix(in srgb, var(--accent) 28%, #ffffff 72%);
}

.template-pick-card.tone-1 {
  background: linear-gradient(145deg, #fff0f7 0%, #fff6eb 100%);
  border-color: color-mix(in srgb, #ff67ab 25%, #ffffff 75%);
}

.template-pick-card.tone-2 {
  background: linear-gradient(145deg, #f2fbff 0%, #eef8ff 100%);
  border-color: color-mix(in srgb, #2e9dff 25%, #ffffff 75%);
}

.template-pick-card.tone-3 {
  background: linear-gradient(145deg, #fffae8 0%, #fff3df 100%);
  border-color: color-mix(in srgb, #ffb84f 26%, #ffffff 74%);
}

.template-pick-main {
  flex: 1;
  min-width: 0;
}

.template-pick-name {
  font-size: 22rpx;
  color: var(--text-sub);
  letter-spacing: 1rpx;
  text-transform: uppercase;
}

.template-pick-title {
  margin-top: 4rpx;
  font-size: 30rpx;
  color: var(--text-main);
  font-weight: 700;
}

.template-pick-meta {
  margin-top: 10rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.template-pick-side {
  flex-shrink: 0;
  text-align: right;
}

.template-pick-number {
  font-size: 42rpx;
  line-height: 1;
  font-weight: 800;
  color: var(--text-main);
}

.template-pick-number-label {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.bottom-sticky-wrap {
  position: sticky;
  bottom: calc(18rpx + env(safe-area-inset-bottom));
  z-index: 35;
  pointer-events: none;
  padding-bottom: 8rpx;
}

.bottom-sticky-inner {
  pointer-events: auto;
}

.bottom-primary-btn {
  width: 100%;
  border: 1rpx solid color-mix(in srgb, var(--line) 70%, var(--accent) 30%);
  border-radius: 16rpx;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 700;
  color: #15203a;
  background: color-mix(in srgb, #ffffff 90%, var(--card-bg) 10%);
  box-shadow: 0 3rpx 8rpx rgba(21, 32, 58, 0.04);
}

.bottom-primary-btn[disabled] {
  opacity: 0.52;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  background: var(--mask-bg, rgba(0, 0, 0, 0.45));
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24rpx;
  box-sizing: border-box;
}

.sheet-container {
  width: 100%;
  max-width: 640rpx;
  background: linear-gradient(
    150deg,
    color-mix(in srgb, var(--card-bg) 86%, #ffffff 14%) 0%,
    color-mix(in srgb, var(--card-bg) 82%, #fff2e7 18%) 100%
  );
  border: 1rpx solid color-mix(in srgb, var(--accent) 22%, var(--line) 78%);
  border-radius: 24rpx;
  box-shadow: 0 24rpx 50rpx rgba(16, 28, 53, 0.2);
  animation: sheet-pop 0.22s ease-out;
}

@keyframes sheet-pop {
  from {
    opacity: 0;
    transform: translateY(20rpx) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 24rpx 14rpx;
  border-bottom: 1rpx solid color-mix(in srgb, var(--line) 80%, var(--accent) 20%);
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--text-main);
}

.sheet-close {
  width: 52rpx;
  height: 52rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, var(--muted-bg) 88%, #ffffff 12%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: var(--text-sub);
}

.sheet-body {
  padding: 20rpx 24rpx 24rpx;
}

.sheet-field {
  margin-bottom: 18rpx;
}

.sheet-label {
  font-size: 24rpx;
  color: var(--text-main);
  font-weight: 600;
  margin-bottom: 8rpx;
}

.sheet-label-hint {
  font-weight: 400;
  color: var(--text-sub);
}

.sheet-input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid color-mix(in srgb, var(--line) 76%, var(--accent) 24%);
  border-radius: 12rpx;
  background: color-mix(in srgb, var(--muted-bg) 88%, #ffffff 12%);
  color: var(--text-main);
  font-size: 28rpx;
  padding: 18rpx 16rpx;
}

.sheet-submit-btn {
  width: 100%;
  border: 1rpx solid color-mix(in srgb, var(--accent) 34%, #ffffff 66%);
  border-radius: 14rpx;
  padding: 20rpx;
  font-size: 30rpx;
  font-weight: 600;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 86%, #ffffff 14%) 0%,
    color-mix(in srgb, var(--accent) 72%, #ff9f43 28%) 100%
  );
  color: #fff;
  margin-top: 8rpx;
  box-shadow: 0 12rpx 24rpx color-mix(in srgb, var(--accent) 30%, transparent);
}

.sheet-submit-btn.pending {
  opacity: 0.7;
}

@media (max-width: 560rpx) {
  .hero-row-card {
    height: 82rpx;
    border-radius: 16rpx;
    gap: 6rpx;
    padding: 0 12rpx;
  }

  .hero-row-title {
    font-size: 28rpx;
  }

  .hero-row-icon {
    font-size: 26rpx;
  }

  .bottom-primary-btn {
    height: 78rpx;
    font-size: 28rpx;
  }

  .template-pick-card {
    align-items: flex-start;
  }

  .template-pick-side {
    min-width: 112rpx;
  }
}
</style>
