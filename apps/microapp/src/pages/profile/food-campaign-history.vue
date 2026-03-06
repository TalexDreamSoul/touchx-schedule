<template>
  <PageContainer title="历史记录">
    <view class="page">
      <!-- 筛选区 -->
      <view class="filter-card">
        <view class="filter-header">
          <view class="filter-title">筛选条件</view>
          <button class="refresh-btn" @click="refreshCampaigns">↻</button>
        </view>

        <view class="filter-row">
          <view class="filter-group">
            <view class="filter-label">状态</view>
            <view class="filter-chips">
              <view
                v-for="item in statusOptions"
                :key="item.value"
                class="filter-chip"
                :class="{ active: statusFilter === item.value }"
                @click="statusFilter = item.value as StatusFilter"
              >
                {{ item.label }}
              </view>
            </view>
          </view>
          <view class="filter-group">
            <view class="filter-label">时间</view>
            <view class="filter-chips">
              <view
                v-for="item in daysOptions"
                :key="item.value"
                class="filter-chip"
                :class="{ active: daysFilter === item.value }"
                @click="daysFilter = item.value as DaysFilter"
              >
                {{ item.label }}
              </view>
            </view>
          </view>
        </view>

        <view class="search-bar">
          <input v-model.trim="keyword" class="search-input" type="text" placeholder="搜索标题、模板或发起人…" />
        </view>
      </view>

      <!-- 结果列表 -->
      <view class="result-header">
        <view class="result-count">共 {{ filteredCampaigns.length }} 条记录</view>
      </view>

      <view v-if="filteredCampaigns.length === 0" class="empty-state">
        <view class="empty-icon">📂</view>
        <view class="empty-text">暂无符合条件的记录</view>
        <view class="empty-sub">调整筛选条件试试</view>
      </view>

      <view
        v-for="item in filteredCampaigns"
        :key="item.campaignId"
        class="history-card"
        @click="openCampaign(item.campaignId)"
      >
        <view class="history-body">
          <view class="history-top">
            <view class="history-name">{{ item.title || "今天吃什么" }}</view>
            <view class="history-status" :class="campaignStatusClass(item.status)">
              {{ campaignStatusLabel(item.status) }}
            </view>
          </view>
          <view class="history-info">
            <view class="history-tag">{{ templateLabel(item.templateKey) }}</view>
            <view class="history-tag">{{ joinModeLabel(item.joinMode) }}</view>
            <view class="history-tag">{{ item.headcount || 0 }}人</view>
          </view>
          <view v-if="(item.categoryHighlights || []).length > 0" class="history-categories">
            <view v-for="tag in item.categoryHighlights || []" :key="`his-tag-${item.campaignId}-${tag.categoryKey}`" class="category-tag">
              {{ tag.categoryName || tag.categoryKey || "分类" }}
            </view>
          </view>
          <view class="history-time">{{ formatTime(item.closedAt || item.deadlineAt) }}</view>
        </view>
        <view class="history-arrow">›</view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import { guardProfilePageAccess, readAuthSessionFromStorage, requestBackendGet, resolveBackendBaseUrlFromStorage, type AuthSessionState } from "@/utils/profile-service";

type FoodCampaignJoinMode = "all" | "invite" | "password";
type StatusFilter = "all" | "open" | "closed";
type DaysFilter = "all" | "3" | "7" | "30";

interface FoodCampaignSummary {
  campaignId: string;
  title: string;
  initiatorStudentId?: string;
  templateKey: string;
  status?: string;
  joinMode?: FoodCampaignJoinMode;
  headcount?: number;
  createdAt?: number;
  deadlineAt?: number;
  closedAt?: number;
  categoryHighlights?: Array<{ categoryKey?: string; categoryName?: string; count?: number }>;
}

interface CampaignListResponse {
  ok?: boolean;
  items?: FoodCampaignSummary[];
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const campaigns = ref<FoodCampaignSummary[]>([]);
const statusText = ref("准备就绪");
const statusFilter = ref<StatusFilter>("all");
const daysFilter = ref<DaysFilter>("all");
const keyword = ref("");

const statusOptions = [
  { value: "all", label: "全部" },
  { value: "open", label: "进行中" },
  { value: "closed", label: "已结束" },
] as const;

const daysOptions = [
  { value: "all", label: "全部" },
  { value: "3", label: "3天" },
  { value: "7", label: "7天" },
  { value: "30", label: "30天" },
] as const;

const joinModeLabelMap: Record<FoodCampaignJoinMode, string> = {
  all: "公开",
  invite: "邀请",
  password: "密码",
};

const templateLabelMap: Record<string, string> = {
  daily: "日常",
  party: "聚会",
};

const ensureAuthed = () => {
  if (!authSession.value.token || !authSession.value.user) {
    throw new Error("请先在账号页完成登录授权");
  }
};

const joinModeLabel = (mode: unknown) => {
  const key = String(mode || "all").trim().toLowerCase() as FoodCampaignJoinMode;
  return joinModeLabelMap[key] || joinModeLabelMap.all;
};

const templateLabel = (key: unknown) => {
  const value = String(key || "").trim().toLowerCase();
  return templateLabelMap[value] || value || "日常";
};

const campaignStatusLabel = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "open") return "进行中";
  if (value === "closed") return "已结束";
  if (value === "cancelled") return "已取消";
  return value || "未知";
};

const campaignStatusClass = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "open") return "status-live";
  if (value === "closed") return "status-ended";
  return "status-muted";
};

const normalizeCampaignStatus = (value: unknown) => {
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
    headcount: Number(item.headcount || 0),
  };
};

const resolveCampaignReferenceTs = (item: FoodCampaignSummary) => {
  return Number(item.closedAt || item.deadlineAt || item.createdAt || 0);
};

const filteredCampaigns = computed(() => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const daysWindow = Number(daysFilter.value || 0);
  const keywordText = String(keyword.value || "").trim().toLowerCase();
  return [...campaigns.value]
    .filter((item) => {
      const status = String(item.status || "open").toLowerCase();
      if (statusFilter.value === "open") {
        return status === "open";
      }
      if (statusFilter.value === "closed") {
        return status !== "open";
      }
      return true;
    })
    .filter((item) => {
      if (!daysWindow || daysFilter.value === "all") {
        return true;
      }
      const threshold = nowSeconds - daysWindow * 24 * 60 * 60;
      return resolveCampaignReferenceTs(item) >= threshold;
    })
    .filter((item) => {
      if (!keywordText) {
        return true;
      }
      const title = String(item.title || "").toLowerCase();
      const templateKey = String(item.templateKey || "").toLowerCase();
      const initiator = String(item.initiatorStudentId || "").toLowerCase();
      return title.includes(keywordText) || templateKey.includes(keywordText) || initiator.includes(keywordText);
    })
    .sort((left, right) => resolveCampaignReferenceTs(right) - resolveCampaignReferenceTs(left));
});

const refreshCampaigns = async () => {
  ensureAuthed();
  const response = await requestBackendGet<CampaignListResponse>(
    backendBaseUrl.value,
    "/api/social/food-campaigns",
    { status: "all" },
    authSession.value.token,
  );
  campaigns.value = Array.isArray(response.items) ? response.items.map(normalizeCampaignSummary) : [];
  statusText.value = `共加载 ${campaigns.value.length} 条记录`;
};

const openCampaign = (campaignId: string) => {
  const targetId = String(campaignId || "").trim();
  if (!targetId) {
    return;
  }
  uni.navigateTo({ url: `/pages/profile/food-campaign-detail?campaign_id=${encodeURIComponent(targetId)}` });
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

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token || !authSession.value.user) {
    campaigns.value = [];
    statusText.value = "请先登录授权";
    return;
  }
  void refreshCampaigns().catch((error) => {
    const message = error instanceof Error ? error.message : "加载失败";
    statusText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  });
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  box-sizing: border-box;
}

/* Filter Card */
.filter-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 20rpx 18rpx;
  margin-bottom: 16rpx;
}

.filter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 14rpx;
}

.filter-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.refresh-btn {
  width: 48rpx;
  height: 48rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-sub);
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.filter-row {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.filter-label {
  font-size: 24rpx;
  color: var(--text-sub);
  flex-shrink: 0;
  min-width: 60rpx;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.filter-chip {
  border: 1rpx solid var(--line);
  border-radius: 999rpx;
  padding: 8rpx 18rpx;
  font-size: 24rpx;
  color: var(--text-sub);
  background: var(--muted-bg);
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.filter-chip.active {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line) 50%);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
  font-weight: 600;
}

.search-bar {
  margin-top: 14rpx;
}

.search-input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 26rpx;
  padding: 14rpx 16rpx;
}

/* Result Header */
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
  padding: 0 4rpx;
}

.result-count {
  font-size: 24rpx;
  color: var(--text-sub);
}

/* Empty State */
.empty-state {
  padding: 60rpx 20rpx;
  text-align: center;
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

/* History Card */
.history-card {
  display: flex;
  align-items: center;
  gap: 12rpx;
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  padding: 16rpx 14rpx;
  margin-bottom: 10rpx;
}

.history-body {
  flex: 1;
  min-width: 0;
}

.history-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.history-name {
  font-size: 28rpx;
  color: var(--text-main);
  font-weight: 700;
  flex: 1;
  min-width: 0;
}

.history-status {
  flex-shrink: 0;
  font-size: 20rpx;
  font-weight: 600;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
}

.history-status.status-live {
  background: color-mix(in srgb, #22c55e 12%, var(--muted-bg) 88%);
  color: #16a34a;
  border: 1rpx solid color-mix(in srgb, #22c55e 20%, var(--line) 80%);
}

.history-status.status-ended {
  background: var(--muted-bg);
  color: var(--text-sub);
  border: 1rpx solid var(--line);
}

.history-status.status-muted {
  background: var(--muted-bg);
  color: var(--text-sub);
  border: 1rpx solid var(--line);
}

.history-info {
  margin-top: 8rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 6rpx;
}

.history-tag {
  font-size: 20rpx;
  color: var(--text-sub);
  padding: 3rpx 10rpx;
  border-radius: 999rpx;
  background: var(--muted-bg);
  border: 1rpx solid color-mix(in srgb, var(--line) 60%, transparent);
}

.history-categories {
  margin-top: 8rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 6rpx;
}

.category-tag {
  border: 1rpx solid color-mix(in srgb, var(--accent) 20%, var(--line) 80%);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
  font-size: 20rpx;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, var(--card-bg) 95%);
}

.history-time {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.history-arrow {
  font-size: 36rpx;
  color: var(--text-sub);
  opacity: 0.4;
  flex-shrink: 0;
}
</style>
