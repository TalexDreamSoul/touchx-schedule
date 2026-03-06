<template>
  <PageContainer title="今天吃什么">
    <view class="page">
      <!-- 顶部快捷操作 -->
      <view class="hero-card">
        <view class="hero-header">
          <view class="hero-title-group">
            <view class="hero-title">美食竞选</view>
            <view class="hero-subtitle">发起投票，一起决定今天吃什么</view>
          </view>
          <view class="hero-actions">
            <button class="icon-btn" @click="refreshStateSilently" :class="{ spinning: isRefreshing }">↻</button>
          </view>
        </view>
        <view class="hero-warning" v-if="myOpenCampaign">
          <view class="hero-warning-dot" />
          <view class="hero-warning-text">你有一场进行中的竞选：{{ myOpenCampaign.title || "今天吃什么" }}</view>
        </view>
        <view class="hero-btn-row">
          <button class="primary-btn" :disabled="Boolean(myOpenCampaign)" @click="openCreatePage">
            <text class="primary-btn-icon">+</text>
            发起竞选
          </button>
          <button class="outline-btn" @click="openCandidatePoolPage">食物候选池</button>
          <button class="outline-btn" @click="openHistoryPage">历史记录</button>
        </view>
      </view>

      <!-- 数据概览 -->
      <view class="stats-grid" v-if="campaignStats">
        <view class="stat-card">
          <view class="stat-icon-wrap active-icon">▶</view>
          <view class="stat-body">
            <view class="stat-value">{{ campaignStats?.activeCampaignCount || 0 }}</view>
            <view class="stat-label">进行中</view>
          </view>
        </view>
        <view class="stat-card">
          <view class="stat-icon-wrap total-icon">◉</view>
          <view class="stat-body">
            <view class="stat-value">{{ campaignStats?.campaignCount || 0 }}</view>
            <view class="stat-label">近{{ campaignStats?.recentDays || 30 }}天</view>
          </view>
        </view>
        <view class="stat-card wide" v-if="campaignStats?.mostSelectedFood">
          <view class="stat-icon-wrap fav-icon">♥</view>
          <view class="stat-body">
            <view class="stat-value">{{ campaignStats?.mostSelectedFood?.name || "--" }}</view>
            <view class="stat-label">
              {{ campaignStats?.mostSelectedCategory?.categoryName || campaignStats?.mostSelectedFood?.categoryName || "未分类" }}
              · 命中率 {{ formatRatio(campaignStats?.mostSelectedFood?.ratio || 0) }}
            </view>
          </view>
        </view>
      </view>

      <!-- 进行中的竞选 -->
      <view class="section-card" v-if="openCampaigns.length > 0">
        <view class="section-header">
          <view class="section-title">
            <view class="section-dot live" />
            进行中
          </view>
          <view class="section-badge">{{ openCampaigns.length }}</view>
        </view>
        <view
          v-for="item in openCampaigns"
          :key="`open-${item.campaignId}`"
          class="campaign-card"
          @click="openCampaign(item)"
        >
          <view class="campaign-body">
            <view class="campaign-name">{{ item.title || "今天吃什么" }}</view>
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
      </view>

      <!-- 空状态 -->
      <view class="empty-card" v-if="openCampaigns.length === 0 && campaigns.length > 0">
        <view class="empty-icon">📋</view>
        <view class="empty-text">当前没有进行中的竞选</view>
        <view class="empty-sub">点击上方「发起竞选」开始一场新的投票</view>
      </view>

      <!-- 最近动态 -->
      <view class="section-card" v-if="recentClosedCampaigns.length > 0">
        <view class="section-header">
          <view class="section-title">最近动态</view>
          <button class="text-btn" v-if="hasMoreHistory" @click="openHistoryPage">查看更多 ›</button>
        </view>
        <view
          v-for="item in recentClosedCampaigns"
          :key="`recent-${item.campaignId}`"
          class="campaign-card muted"
          @click="openCampaign(item)"
        >
          <view class="campaign-body">
            <view class="campaign-name">{{ item.title || "今天吃什么" }}</view>
            <view class="campaign-info">
              <view class="info-tag">{{ templateLabel(item.templateKey) }}</view>
              <view class="info-tag faded">{{ statusLabelText(item.status) }}</view>
              <view class="info-tag">{{ item.headcount || 0 }}人</view>
            </view>
            <view class="campaign-time">{{ formatTime(item.closedAt || item.deadlineAt) }}</view>
          </view>
          <view class="campaign-arrow">›</view>
        </view>
      </view>

      <!-- 加入竞选浮动按钮 -->
      <view class="fab-btn" @click="showJoinSheet = true">
        <text class="fab-icon">🔗</text>
      </view>

      <!-- 加入竞选弹窗 -->
      <view class="sheet-mask" v-if="showJoinSheet" @click.self="showJoinSheet = false">
        <view class="sheet-container" @click.stop>
          <view class="sheet-header">
            <view class="sheet-title">加入竞选</view>
            <view class="sheet-close" @click="showJoinSheet = false">✕</view>
          </view>
          <view class="sheet-body">
            <view class="sheet-desc">输入分享码即可加入他人发起的竞选</view>
            <view class="sheet-field">
              <view class="sheet-label">分享码</view>
              <input v-model.trim="joinShareToken" class="sheet-input" type="text" placeholder="请输入 6 位分享码" />
            </view>
            <view class="sheet-field">
              <view class="sheet-label">参与密码<text class="sheet-label-hint">（仅密码模式需填写）</text></view>
              <input v-model.trim="joinAccessPassword" class="sheet-input" type="text" password placeholder="无密码可留空" />
            </view>
            <button class="sheet-submit-btn" :class="{ pending: pendingJoin }" @click="joinCampaign">
              {{ pendingJoin ? "加入中..." : "加入竞选" }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
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

interface CampaignStatsItem {
  foodId?: number;
  name?: string;
  categoryKey?: string;
  categoryName?: string;
  selectedCount?: number;
  ratio?: number;
}

interface CampaignCategoryStatsItem {
  categoryKey?: string;
  categoryName?: string;
  selectedCount?: number;
  ratio?: number;
}

interface FoodCampaignStats {
  recentDays?: number;
  campaignCount?: number;
  activeCampaignCount?: number;
  voterCount?: number;
  selectionCount?: number;
  mostSelectedFood?: CampaignStatsItem | null;
  mostSelectedCategory?: CampaignCategoryStatsItem | null;
  topFoods?: CampaignStatsItem[];
  topCategories?: CampaignCategoryStatsItem[];
}

interface CampaignStatsResponse {
  ok?: boolean;
  stats?: FoodCampaignStats;
}

const FOOD_CAMPAIGN_CREATED_ID_STORAGE_KEY = "touchx_food_campaign_created_id";

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const campaigns = ref<FoodCampaignSummary[]>([]);
const joinShareToken = ref("");
const joinAccessPassword = ref("");
const pendingJoin = ref(false);
const routeShareToken = ref("");
const routeCampaignId = ref("");
const isRefreshing = ref(false);
const campaignStats = ref<FoodCampaignStats | null>(null);
const showJoinSheet = ref(false);

const joinModeLabelMap: Record<FoodCampaignJoinMode, string> = {
  all: "公开参与",
  invite: "邀请制",
  password: "密码参与",
};

const templateLabelMap: Record<string, string> = {
  daily: "日常档",
  party: "聚会档",
};

const currentStudentId = computed(() => String(authSession.value.user?.studentId || "").trim());

const openCampaigns = computed(() => {
  return [...campaigns.value]
    .filter((item) => String(item.status || "").trim().toLowerCase() === "open")
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
});

const myOpenCampaign = computed(() => {
  const studentId = currentStudentId.value;
  if (!studentId) {
    return null;
  }
  return openCampaigns.value.find((item) => String(item.initiatorStudentId || "").trim() === studentId) || null;
});

const recentClosedCampaigns = computed(() => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const threshold = nowSeconds - 3 * 24 * 60 * 60;
  return [...campaigns.value]
    .filter((item) => String(item.status || "").trim().toLowerCase() !== "open")
    .filter((item) => {
      const referenceTs = Number(item.closedAt || item.deadlineAt || item.createdAt || 0);
      return referenceTs >= threshold;
    })
    .sort((left, right) => {
      const leftTs = Number(left.closedAt || left.deadlineAt || left.createdAt || 0);
      const rightTs = Number(right.closedAt || right.deadlineAt || right.createdAt || 0);
      return rightTs - leftTs;
    })
    .slice(0, 3);
});

const hasMoreHistory = computed(() => {
  const closedAllCount = campaigns.value.filter((item) => String(item.status || "").trim().toLowerCase() !== "open").length;
  return closedAllCount > recentClosedCampaigns.value.length;
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
    createdAt: Number(item.createdAt || 0),
    deadlineAt: Number(item.deadlineAt || 0),
    closedAt: Number(item.closedAt || 0),
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

const formatTime = (timestamp: unknown) => {
  const ts = Number(timestamp || 0);
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

const formatRatio = (value: unknown) => {
  const ratio = Number(value || 0);
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return "0%";
  }
  const rounded = Math.round(ratio * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.01) {
    return `${Math.round(rounded)}%`;
  }
  return `${rounded.toFixed(1)}%`;
};

const openCampaign = (item: FoodCampaignSummary) => {
  const campaignId = String(item.campaignId || "").trim();
  if (!campaignId) {
    return;
  }
  const shareToken = String(item.shareToken || "").trim();
  const params: string[] = [`campaign_id=${encodeURIComponent(campaignId)}`];
  if (shareToken) {
    params.push(`share_token=${encodeURIComponent(shareToken)}`);
  }
  uni.navigateTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
};

const openCreatePage = () => {
  if (myOpenCampaign.value) {
    uni.showToast({ title: "你已有进行中竞选，请先截止", icon: "none", duration: 1800 });
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
    "/api/social/food-campaigns",
    { status: "all" },
    authSession.value.token,
  );
  campaigns.value = Array.isArray(response.items) ? response.items.map(normalizeCampaignSummary) : [];
};

const refreshCampaignStats = async () => {
  ensureAuthed();
  const response = await requestBackendGet<CampaignStatsResponse>(
    backendBaseUrl.value,
    "/api/social/food-campaigns/stats",
    { recent_days: "30" },
    authSession.value.token,
  );
  campaignStats.value = response.stats || null;
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
      "/api/social/food-campaigns/join",
      {
        share_token: token,
        access_password: String(joinAccessPassword.value || "").trim(),
      },
      authSession.value.token,
    );
    const detail = response.campaign;
    if (!detail?.campaignId) {
      throw new Error("加入成功但未获取到竞选详情");
    }
    showJoinSheet.value = false;
    uni.showToast({ title: "加入成功", icon: "none", duration: 1200 });
    const params: string[] = [`campaign_id=${encodeURIComponent(detail.campaignId)}`, `share_token=${encodeURIComponent(token)}`];
    uni.navigateTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加入失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pendingJoin.value = false;
  }
};

const refreshState = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  const createdId = consumeCreatedCampaignId();
  if (createdId) {
    routeCampaignId.value = createdId;
  }
  if (!authSession.value.token || !authSession.value.user) {
    campaigns.value = [];
    campaignStats.value = null;
    return;
  }
  await refreshCampaigns();
  try {
    await refreshCampaignStats();
  } catch (error) {
    campaignStats.value = null;
  }
  if (routeShareToken.value || routeCampaignId.value) {
    const params: string[] = [];
    if (routeCampaignId.value) {
      params.push(`campaign_id=${encodeURIComponent(routeCampaignId.value)}`);
    }
    if (routeShareToken.value) {
      params.push(`share_token=${encodeURIComponent(routeShareToken.value)}`);
    }
    routeCampaignId.value = "";
    routeShareToken.value = "";
    uni.navigateTo({ url: `/pages/profile/food-campaign-detail?${params.join("&")}` });
  }
};

const refreshStateSilently = async () => {
  isRefreshing.value = true;
  try {
    await refreshState();
  } catch (error) {
    if (isAuthSessionInvalidError(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : "加载失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    isRefreshing.value = false;
  }
};

onLoad((query) => {
  routeShareToken.value = normalizeRouteParam(query?.share_token || query?.shareToken || query?.share_id || query?.shareId || query?.token);
  routeCampaignId.value = normalizeRouteParam(query?.campaign_id || query?.campaignId || query?.id);
  if (routeShareToken.value || routeCampaignId.value) {
    const params: string[] = [];
    if (routeCampaignId.value) {
      params.push(`campaign_id=${encodeURIComponent(routeCampaignId.value)}`);
    }
    if (routeShareToken.value) {
      params.push(`share_token=${encodeURIComponent(routeShareToken.value)}`);
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
  void refreshStateSilently();
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  padding-bottom: 120rpx;
  box-sizing: border-box;
}

/* Hero Card */
.hero-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 20rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 16rpx;
}

.hero-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12rpx;
}

.hero-title-group {
  flex: 1;
}

.hero-title {
  font-size: 36rpx;
  font-weight: 800;
  color: var(--text-main);
  letter-spacing: 1rpx;
}

.hero-subtitle {
  margin-top: 6rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.icon-btn {
  width: 60rpx;
  height: 60rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
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
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.hero-warning {
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: color-mix(in srgb, var(--accent) 8%, var(--muted-bg) 92%);
  border: 1rpx solid color-mix(in srgb, var(--accent) 20%, var(--line) 80%);
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

.hero-btn-row {
  margin-top: 18rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.primary-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  border: none;
  border-radius: 12rpx;
  padding: 16rpx 0;
  font-size: 26rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
}

.primary-btn:disabled {
  opacity: 0.5;
}

.primary-btn-icon {
  font-size: 30rpx;
  font-weight: 700;
}

.outline-btn {
  flex: 0 0 auto;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 14rpx 18rpx;
  font-size: 24rpx;
  color: var(--text-main);
  background: var(--muted-bg);
  white-space: nowrap;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.stat-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  padding: 18rpx 16rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.stat-card.wide {
  grid-column: 1 / -1;
}

.stat-icon-wrap {
  width: 56rpx;
  height: 56rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  flex-shrink: 0;
}

.stat-icon-wrap.active-icon {
  background: color-mix(in srgb, var(--accent) 12%, var(--muted-bg) 88%);
  color: var(--accent);
}

.stat-icon-wrap.total-icon {
  background: color-mix(in srgb, var(--text-sub) 10%, var(--muted-bg) 90%);
  color: var(--text-sub);
}

.stat-icon-wrap.fav-icon {
  background: color-mix(in srgb, var(--danger, #d94848) 10%, var(--muted-bg) 90%);
  color: var(--danger, #d94848);
}

.stat-body {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 32rpx;
  color: var(--text-main);
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

/* Section Card */
.section-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 20rpx 16rpx;
  margin-bottom: 16rpx;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
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
  background: var(--text-sub);
}

.section-dot.live {
  background: #22c55e;
  box-shadow: 0 0 6rpx rgba(34, 197, 94, 0.5);
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

.text-btn {
  border: none;
  background: none;
  padding: 0;
  font-size: 24rpx;
  color: var(--accent);
  font-weight: 500;
}

/* Campaign Card */
.campaign-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  padding: 16rpx 14rpx;
  background: var(--muted-bg);
  margin-bottom: 10rpx;
  transition: background 0.15s;
}

.campaign-card:last-child {
  margin-bottom: 0;
}

.campaign-card.muted {
  opacity: 0.85;
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

.campaign-arrow {
  font-size: 36rpx;
  color: var(--text-sub);
  opacity: 0.5;
  flex-shrink: 0;
}

/* Empty State */
.empty-card {
  padding: 48rpx 20rpx;
  text-align: center;
  margin-bottom: 16rpx;
}

.empty-icon {
  font-size: 56rpx;
  margin-bottom: 12rpx;
}

.empty-text {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text-main);
}

.empty-sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

/* FAB */
.fab-btn {
  position: fixed;
  right: 32rpx;
  bottom: calc(32rpx + env(safe-area-inset-bottom));
  width: 96rpx;
  height: 96rpx;
  border-radius: 999rpx;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx color-mix(in srgb, var(--accent) 35%, transparent);
  z-index: 100;
}

.fab-icon {
  font-size: 40rpx;
}

/* Bottom Sheet */
.sheet-mask {
  position: fixed;
  inset: 0;
  background: var(--mask-bg, rgba(0, 0, 0, 0.45));
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet-container {
  width: 100%;
  max-width: 750rpx;
  background: var(--card-bg);
  border-radius: 28rpx 28rpx 0 0;
  padding: 0 0 calc(24rpx + env(safe-area-inset-bottom));
  animation: sheet-slide-up 0.25s ease-out;
}

@keyframes sheet-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 28rpx 16rpx;
  border-bottom: 1rpx solid var(--line);
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
  background: var(--muted-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: var(--text-sub);
}

.sheet-body {
  padding: 20rpx 28rpx;
}

.sheet-desc {
  font-size: 24rpx;
  color: var(--text-sub);
  margin-bottom: 20rpx;
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
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 28rpx;
  padding: 18rpx 16rpx;
}

.sheet-submit-btn {
  width: 100%;
  border: none;
  border-radius: 14rpx;
  padding: 20rpx;
  font-size: 30rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
  margin-top: 8rpx;
}

.sheet-submit-btn.pending {
  opacity: 0.7;
}

@media (max-width: 700rpx) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .stat-card.wide {
    grid-column: 1;
  }
}
</style>
