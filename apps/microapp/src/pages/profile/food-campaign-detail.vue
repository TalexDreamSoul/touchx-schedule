<template>
  <PageContainer title="竞选详情">
    <view class="page">
      <!-- 竞选头部信息卡片 -->
      <view class="detail-hero">
        <view class="detail-hero-top">
          <view class="detail-hero-title">{{ previewCampaign?.title || "食物竞选" }}</view>
          <view class="status-badge" :class="statusBadgeClass">{{ statusLabel }}</view>
        </view>

        <template v-if="isAuthed">
          <view class="detail-meta-grid">
            <view class="meta-item">
              <view class="meta-label">参与方式</view>
              <view class="meta-value">{{ joinModeLabel(previewCampaign?.joinMode) }}</view>
            </view>
            <view class="meta-item">
              <view class="meta-label">投票模式</view>
              <view class="meta-value">{{ previewCampaign?.isAnonymous ? "匿名投票" : "实名投票" }}</view>
            </view>
            <view class="meta-item">
              <view class="meta-label">参与人数</view>
              <view class="meta-value">{{ previewCampaign?.headcount || 0 }} 人</view>
            </view>
            <view class="meta-item">
              <view class="meta-label">候选食物</view>
              <view class="meta-value">{{ previewCampaign?.candidateCount || 0 }} 个</view>
            </view>
            <view class="meta-item" v-if="previewCampaign?.closedAt || previewCampaign?.deadlineAt">
              <view class="meta-label">截止时间</view>
              <view class="meta-value">{{ formatTime(previewCampaign?.closedAt || previewCampaign?.deadlineAt) }}</view>
            </view>
          </view>
          <view class="share-bar" v-if="shareToken">
            <view class="share-code">
              <view class="share-code-label">分享码</view>
              <view class="share-code-value">{{ shareToken }}</view>
            </view>
            <button class="mini-action-btn" @click="copyShareLink">复制链接</button>
          </view>
        </template>
        <view v-else class="auth-hint">
          <view class="auth-hint-icon">🔒</view>
          <view class="auth-hint-text">登录后可查看候选食物与投票详情</view>
        </view>

        <view class="detail-hero-actions">
          <button class="icon-btn-sm" @click="refreshStateSilently">↻</button>
        </view>
      </view>

      <!-- 未授权 -->
      <view class="action-card" v-if="!isAuthed">
        <view class="action-card-title">需要授权</view>
        <view class="action-card-desc">登录后可查看完整候选食物与投票信息</view>
        <button class="action-btn accent" @click="goAuthorizePage">去登录授权</button>
      </view>

      <!-- 已授权但未加入 -->
      <view class="action-card" v-if="isAuthed && !campaignDetail && isCampaignOpen">
        <view class="action-card-title">加入竞选</view>
        <view class="action-card-desc">你尚未加入该竞选，加入后即可查看候选与投票</view>
        <view class="action-field" v-if="previewCampaign?.joinMode === 'password'">
          <view class="action-field-label">参与密码</view>
          <input v-model.trim="joinAccessPassword" class="action-input" type="text" password placeholder="请输入参与密码" />
        </view>
        <button class="action-btn accent" :class="{ pending: pending.join }" @click="joinAndLoadDetail">
          {{ pending.join ? "加入中..." : "加入并查看" }}
        </button>
      </view>

      <!-- 已结束且未加入 -->
      <view class="action-card muted" v-if="isAuthed && !campaignDetail && !isCampaignOpen">
        <view class="action-card-title">竞选已结束</view>
        <view class="action-card-desc">该竞选已结束，无法再加入参与</view>
      </view>

      <!-- 完整详情 -->
      <template v-if="campaignDetail">
        <!-- 操作栏 -->
        <view class="ops-bar" v-if="campaignDetail.canSupplement || campaignDetail.canApprove">
          <button
            class="ops-btn"
            :class="{ pending: pending.supplement }"
            :disabled="!campaignDetail.canSupplement"
            @click="supplementCandidate"
          >追加候选</button>
          <button
            class="ops-btn danger"
            :class="{ pending: pending.close }"
            :disabled="!campaignDetail.canApprove"
            @click="confirmCloseCampaign"
          >截止竞选</button>
          <button
            class="ops-btn ghost"
            @click="showParticipantSheet = true"
            v-if="campaignDetail.participants.length > 0"
          >参与者 ({{ campaignDetail.participants.length }})</button>
        </view>

        <!-- 候选食物投票 -->
        <view class="vote-section">
          <view class="vote-header">
            <view class="vote-title">候选食物</view>
            <view class="vote-hint" v-if="campaignDetail.canVote">
              可投 {{ campaignDetail.maxVotesPerUser }} 票，已选 {{ voteSelectionSet.size }} 项
            </view>
            <view class="vote-hint" v-else-if="!isCampaignOpen">投票已截止</view>
          </view>

          <view v-if="campaignDetail.candidates.length === 0" class="empty-block">
            <view class="empty-block-text">暂无候选食物</view>
          </view>

          <view v-for="item in campaignDetail.candidates" :key="item.id" class="food-card" :class="{ selected: voteSelectionSet.has(item.id) }">
            <view
              class="food-check"
              :class="{ checked: voteSelectionSet.has(item.id), disabled: !campaignDetail.canVote }"
              @click.stop="toggleVoteItem(item.id)"
            >
              <view class="food-check-inner" v-if="voteSelectionSet.has(item.id)">✓</view>
            </view>
            <view class="food-body" @click.stop="toggleVoteItem(item.id)">
              <view class="food-name-row">
                <view class="food-name">{{ item.name }}</view>
                <view class="food-votes">{{ item.voteCount }} 票</view>
              </view>
              <view class="food-details">
                <text class="food-detail-tag">{{ item.categoryKey }}</text>
                <text class="food-detail-sep">·</text>
                <text>{{ formatNumber(item.distanceKm) }}km</text>
                <text class="food-detail-sep">·</text>
                <text>¥{{ formatNumber(item.dynamicPriceMin) }}~{{ formatNumber(item.dynamicPriceMax) }}</text>
              </view>
            </view>
          </view>

          <button
            class="vote-submit-btn"
            :class="{ pending: pending.vote }"
            :disabled="!campaignDetail.canVote"
            @click="submitVote"
            v-if="campaignDetail.canVote"
          >
            {{ pending.vote ? "提交中..." : (voteSelectionSet.size > 0 ? "提交投票" : "请先选择候选") }}
          </button>
        </view>

        <!-- 投票明细 -->
        <view class="detail-section" v-if="campaignDetail.voteDetails.length > 0">
          <view class="detail-section-header">
            <view class="detail-section-title">投票明细</view>
            <view class="detail-section-badge">{{ visibilityLabel }}</view>
          </view>
          <view v-for="item in campaignDetail.voteDetails" :key="`vote-${item.voterStudentId}`" class="voter-row">
            <view class="voter-name">{{ item.voterName }}</view>
            <view class="voter-picks">{{ (item.selectedFoodNames || []).join("、") || "未投票" }}</view>
          </view>
        </view>

        <!-- 投票为空 -->
        <view class="detail-section" v-else-if="campaignDetail.voteDetailsVisibility !== 'none'">
          <view class="detail-section-header">
            <view class="detail-section-title">投票明细</view>
          </view>
          <view class="empty-block">
            <view class="empty-block-text">暂无可见的投票记录</view>
          </view>
        </view>
      </template>

      <!-- 参与者管理弹窗 -->
      <view class="sheet-mask" v-if="showParticipantSheet" @click.self="showParticipantSheet = false">
        <view class="sheet-container" @click.stop>
          <view class="sheet-header">
            <view class="sheet-title">参与者管理</view>
            <view class="sheet-close" @click="showParticipantSheet = false">✕</view>
          </view>
          <view class="sheet-body">
            <view v-if="!campaignDetail || campaignDetail.participants.length === 0" class="empty-block">
              <view class="empty-block-text">暂无参与者</view>
            </view>
            <scroll-view scroll-y class="participant-scroll">
              <view v-for="item in (campaignDetail?.participants || [])" :key="`p-${item.studentId}`" class="participant-row">
                <view class="participant-info">
                  <view class="participant-name">{{ item.name }}</view>
                  <view class="participant-meta">
                    <view class="participant-source-tag">{{ sourceLabel(item.source) }}</view>
                    <view class="participant-status-tag" :class="approvalStatusClass(item.approvalStatus)">
                      {{ approvalStatusLabel(item.approvalStatus) }}
                    </view>
                  </view>
                </view>
                <view class="participant-actions" v-if="campaignDetail?.canApprove && item.approvalStatus === 'pending'">
                  <button class="p-action-btn approve" :class="{ pending: pending.approve === item.studentId }" @click="approveParticipant(item.studentId)">通过</button>
                  <button class="p-action-btn reject" :class="{ pending: pending.reject === item.studentId }" @click="rejectParticipant(item.studentId)">拒绝</button>
                </view>
              </view>
            </scroll-view>
          </view>
        </view>
      </view>

      <!-- 截止确认弹窗 -->
      <view class="sheet-mask" v-if="showCloseConfirm" @click.self="showCloseConfirm = false">
        <view class="confirm-dialog" @click.stop>
          <view class="confirm-title">确认截止竞选？</view>
          <view class="confirm-desc">截止后参与者将无法继续投票，此操作不可撤销。</view>
          <view class="confirm-actions">
            <button class="confirm-btn cancel" @click="showCloseConfirm = false">再想想</button>
            <button class="confirm-btn danger" :class="{ pending: pending.close }" @click="closeCampaign">确认截止</button>
          </view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onShow, onShareAppMessage, onShareTimeline } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import {
  isAuthSessionInvalidError,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

type FoodCampaignJoinMode = "all" | "invite" | "password";

interface FoodCampaignPreview {
  campaignId: string;
  title: string;
  status: string;
  joinMode?: FoodCampaignJoinMode;
  isAnonymous?: boolean;
  shareToken?: string;
  candidateCount?: number;
  headcount?: number;
  deadlineAt?: number;
  closedAt?: number;
}

interface FoodCandidateItem {
  id: number;
  name: string;
  categoryKey: string;
  distanceKm: number;
  voteCount: number;
  dynamicPriceMin: number;
  dynamicPriceMax: number;
  slotIndex: number;
}

interface FoodParticipantItem {
  studentId: string;
  name: string;
  source: string;
  approvalStatus: string;
}

interface FoodVoteDetailItem {
  voterStudentId: string;
  voterName: string;
  selectedFoodNames: string[];
}

interface FoodCampaignDetail extends FoodCampaignPreview {
  canVote: boolean;
  canApprove: boolean;
  canSupplement: boolean;
  maxVotesPerUser: number;
  viewerVoteFoodIds: number[];
  voteDetailsVisibility: string;
  voteDetails: FoodVoteDetailItem[];
  candidates: FoodCandidateItem[];
  participants: FoodParticipantItem[];
}

interface CampaignPreviewResponse {
  ok?: boolean;
  campaign?: FoodCampaignPreview;
}

interface CampaignDetailResponse {
  ok?: boolean;
  campaign?: FoodCampaignDetail;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const previewCampaign = ref<FoodCampaignPreview | null>(null);
const campaignDetail = ref<FoodCampaignDetail | null>(null);
const joinAccessPassword = ref("");
const statusText = ref("准备就绪");
const routeShareToken = ref("");
const routeCampaignId = ref("");
const showParticipantSheet = ref(false);
const showCloseConfirm = ref(false);
const pending = ref({
  join: false,
  vote: false,
  supplement: false,
  close: false,
  approve: "",
  reject: "",
});

const joinModeLabelMap: Record<FoodCampaignJoinMode, string> = {
  all: "公开参与",
  invite: "邀请制",
  password: "密码参与",
};

const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));

const shareToken = computed(() => {
  return String(previewCampaign.value?.shareToken || routeShareToken.value || "").trim();
});

const voteSelectionSet = computed(() => {
  return new Set<number>((campaignDetail.value?.viewerVoteFoodIds || []).map((item) => Number(item)));
});

const statusLabel = computed(() => {
  const status = String(previewCampaign.value?.status || "").trim().toLowerCase();
  if (status === "open") return "进行中";
  if (status === "closed") return "已结束";
  if (status === "cancelled") return "已取消";
  return status || "--";
});

const statusBadgeClass = computed(() => {
  const status = String(previewCampaign.value?.status || "").trim().toLowerCase();
  if (status === "open") return "badge-live";
  if (status === "closed") return "badge-ended";
  return "badge-muted";
});

const isCampaignOpen = computed(() => {
  const status = String(campaignDetail.value?.status || previewCampaign.value?.status || "").trim().toLowerCase();
  return status === "open";
});

const visibilityLabel = computed(() => {
  const key = String(campaignDetail.value?.voteDetailsVisibility || "").trim().toLowerCase();
  if (key === "all") return "全量可见";
  if (key === "self") return "仅自己可见";
  return "不可见";
});

const normalizeRouteParam = (value: unknown) => {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
};

const ensureAuthed = () => {
  if (!authSession.value.token || !authSession.value.user) {
    throw new Error("请先登录授权");
  }
};

const joinModeLabel = (mode: unknown) => {
  const key = String(mode || "all").trim().toLowerCase() as FoodCampaignJoinMode;
  return joinModeLabelMap[key] || joinModeLabelMap.all;
};

const sourceLabel = (source: unknown) => {
  const value = String(source || "").trim().toLowerCase();
  if (value === "initiator") return "发起人";
  if (value === "invite") return "受邀";
  if (value === "join") return "主动加入";
  return value || "未知";
};

const approvalStatusLabel = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "approved") return "已通过";
  if (value === "pending") return "待审批";
  if (value === "rejected") return "已拒绝";
  return value || "未知";
};

const approvalStatusClass = (status: unknown) => {
  const value = String(status || "").trim().toLowerCase();
  if (value === "approved") return "status-approved";
  if (value === "pending") return "status-pending";
  if (value === "rejected") return "status-rejected";
  return "";
};

const mergeDetailToPreview = (detail: FoodCampaignDetail) => {
  const previous = previewCampaign.value;
  const candidateCount = Array.isArray(detail.candidates) && detail.candidates.length > 0
    ? detail.candidates.length
    : Number(previous?.candidateCount || 0);
  previewCampaign.value = {
    campaignId: String(detail.campaignId || previous?.campaignId || ""),
    title: String(detail.title || previous?.title || ""),
    status: String(detail.status || previous?.status || "open"),
    joinMode: detail.joinMode || previous?.joinMode,
    isAnonymous: detail.isAnonymous ?? previous?.isAnonymous,
    shareToken: String(detail.shareToken || previous?.shareToken || ""),
    candidateCount,
    headcount: Number(detail.headcount || previous?.headcount || 0),
    deadlineAt: Number(detail.deadlineAt || previous?.deadlineAt || 0),
    closedAt: Number(detail.closedAt || previous?.closedAt || 0),
  };
};

const buildSharePath = () => {
  const token = shareToken.value;
  if (token) {
    return `/pages/profile/food-campaign-detail?share_token=${encodeURIComponent(token)}`;
  }
  const campaignId = String(previewCampaign.value?.campaignId || routeCampaignId.value || "").trim();
  if (campaignId) {
    return `/pages/profile/food-campaign-detail?campaign_id=${encodeURIComponent(campaignId)}`;
  }
  return "/pages/profile/food-campaign";
};

const copyShareLink = () => {
  const path = buildSharePath();
  uni.setClipboardData({
    data: path,
    success: () => {
      uni.showToast({ title: "已复制链接", icon: "none", duration: 1200 });
    },
  });
};

const goAuthorizePage = () => {
  uni.navigateTo({ url: "/pages/profile/account" });
};

const loadPreview = async () => {
  const params: Record<string, string> = {};
  if (routeShareToken.value) {
    params.share_token = routeShareToken.value;
  } else if (routeCampaignId.value) {
    params.campaign_id = routeCampaignId.value;
  } else {
    throw new Error("竞选参数缺失");
  }
  const response = await requestBackendGet<CampaignPreviewResponse>(backendBaseUrl.value, "/api/social/food-campaigns/preview", params);
  previewCampaign.value = response.campaign || null;
  if (previewCampaign.value?.campaignId) {
    routeCampaignId.value = String(previewCampaign.value.campaignId || "").trim();
  }
  if (previewCampaign.value?.shareToken) {
    routeShareToken.value = String(previewCampaign.value.shareToken || "").trim();
  }
};

const loadDetailByCampaignId = async () => {
  ensureAuthed();
  const campaignId = String(routeCampaignId.value || "").trim();
  if (!campaignId) {
    throw new Error("竞选ID缺失");
  }
  const query: Record<string, string> = {};
  const token = String(routeShareToken.value || "").trim();
  if (token) {
    query.share_token = token;
  }
  const response = await requestBackendGet<CampaignDetailResponse>(
    backendBaseUrl.value,
    `/api/social/food-campaigns/${encodeURIComponent(campaignId)}`,
    query,
    authSession.value.token,
  );
  campaignDetail.value = response.campaign || null;
  if (campaignDetail.value) {
    mergeDetailToPreview(campaignDetail.value);
  }
};

const joinAndLoadDetail = async (silentOrEvent: boolean | unknown = false) => {
  const silent = typeof silentOrEvent === "boolean" ? silentOrEvent : false;
  if (pending.value.join) {
    return;
  }
  pending.value.join = true;
  try {
    ensureAuthed();
    if (!isCampaignOpen.value) {
      throw new Error("该竞选已结束");
    }
    const token = String(routeShareToken.value || previewCampaign.value?.shareToken || "").trim();
    if (!token) {
      throw new Error("分享码缺失，无法加入");
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
    campaignDetail.value = response.campaign || null;
    if (campaignDetail.value?.campaignId) {
      routeCampaignId.value = String(campaignDetail.value.campaignId || "");
    }
    if (campaignDetail.value) {
      mergeDetailToPreview(campaignDetail.value);
    }
    statusText.value = "已加入并加载详情";
    if (!silent) {
      uni.showToast({ title: "已成功加入", icon: "none", duration: 1200 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "加入失败";
    statusText.value = message;
    if (silent) {
      throw error;
    }
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.join = false;
  }
};

const refreshState = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  campaignDetail.value = null;
  try {
    await loadPreview();
  } catch (error) {
    const fallbackMessage = "加载失败，请返回重试";
    const message = isAuthSessionInvalidError(error)
      ? fallbackMessage
      : (error instanceof Error ? error.message : fallbackMessage);
    statusText.value = String(message || fallbackMessage);
    return;
  }
  if (!isAuthed.value) {
    statusText.value = "未登录";
    return;
  }
  try {
    if (routeCampaignId.value) {
      await loadDetailByCampaignId();
      statusText.value = "已加载完整详情";
      return;
    }
    if (routeShareToken.value && isCampaignOpen.value) {
      await joinAndLoadDetail(true);
      statusText.value = campaignDetail.value ? "已加载完整详情" : "可加入后查看";
      return;
    }
    statusText.value = isCampaignOpen.value ? "可加入后查看" : "竞选已结束";
  } catch (error) {
    if (isAuthSessionInvalidError(error)) {
      authSession.value = { token: "", expiresAt: 0, mode: "none", user: null };
      campaignDetail.value = null;
      statusText.value = "登录已失效";
      return;
    }
    campaignDetail.value = null;
    statusText.value = isCampaignOpen.value ? "可加入后查看" : "竞选已结束";
  }
};

const refreshStateSilently = async () => {
  try {
    await refreshState();
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载失败";
    statusText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  }
};

const toggleVoteItem = (foodId: number) => {
  const detail = campaignDetail.value;
  if (!detail?.canVote) {
    return;
  }
  const current = new Set<number>((detail.viewerVoteFoodIds || []).map((item) => Number(item)));
  if (current.has(foodId)) {
    current.delete(foodId);
  } else {
    if (current.size >= Number(detail.maxVotesPerUser || 1)) {
      uni.showToast({ title: `最多可投 ${detail.maxVotesPerUser} 票`, icon: "none", duration: 1400 });
      return;
    }
    current.add(foodId);
  }
  detail.viewerVoteFoodIds = Array.from(current);
  campaignDetail.value = { ...detail };
};

const submitVote = async () => {
  const detail = campaignDetail.value;
  if (!detail || !detail.canVote || pending.value.vote) {
    return;
  }
  pending.value.vote = true;
  try {
    const selectedIds = (detail.viewerVoteFoodIds || []).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0);
    if (selectedIds.length === 0) {
      throw new Error("请至少选择一个候选");
    }
    if (selectedIds.length > detail.maxVotesPerUser) {
      throw new Error(`最多可投 ${detail.maxVotesPerUser} 票`);
    }
    await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      `/api/social/food-campaigns/${encodeURIComponent(detail.campaignId)}/vote`,
      { selected_food_ids: selectedIds },
      authSession.value.token,
    );
    await loadDetailByCampaignId();
    uni.showToast({ title: "投票成功", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.vote = false;
  }
};

const supplementCandidate = async () => {
  const detail = campaignDetail.value;
  if (!detail || !detail.canSupplement || pending.value.supplement) {
    return;
  }
  pending.value.supplement = true;
  try {
    await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      `/api/social/food-campaigns/${encodeURIComponent(detail.campaignId)}/supplement`,
      {},
      authSession.value.token,
    );
    await loadDetailByCampaignId();
    uni.showToast({ title: "已追加候选食物", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "追加失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.supplement = false;
  }
};

const confirmCloseCampaign = () => {
  showCloseConfirm.value = true;
};

const closeCampaign = async () => {
  const detail = campaignDetail.value;
  if (!detail || !detail.canApprove || pending.value.close) {
    return;
  }
  pending.value.close = true;
  try {
    await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      `/api/social/food-campaigns/${encodeURIComponent(detail.campaignId)}/close`,
      {},
      authSession.value.token,
    );
    showCloseConfirm.value = false;
    await loadDetailByCampaignId();
    uni.showToast({ title: "竞选已截止", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "截止失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.close = false;
  }
};

const approveParticipant = async (studentId: string) => {
  const detail = campaignDetail.value;
  if (!detail || !detail.canApprove || !studentId || pending.value.approve === studentId) {
    return;
  }
  pending.value.approve = studentId;
  try {
    await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      `/api/social/food-campaigns/${encodeURIComponent(detail.campaignId)}/participants/${encodeURIComponent(studentId)}/approve`,
      {},
      authSession.value.token,
    );
    await loadDetailByCampaignId();
    uni.showToast({ title: "已通过", icon: "none", duration: 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.approve = "";
  }
};

const rejectParticipant = async (studentId: string) => {
  const detail = campaignDetail.value;
  if (!detail || !detail.canApprove || !studentId || pending.value.reject === studentId) {
    return;
  }
  pending.value.reject = studentId;
  try {
    await requestBackendPost<CampaignDetailResponse>(
      backendBaseUrl.value,
      `/api/social/food-campaigns/${encodeURIComponent(detail.campaignId)}/participants/${encodeURIComponent(studentId)}/reject`,
      {},
      authSession.value.token,
    );
    await loadDetailByCampaignId();
    uni.showToast({ title: "已拒绝", icon: "none", duration: 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pending.value.reject = "";
  }
};

const formatNumber = (value: unknown) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) {
    return "0";
  }
  if (num === Math.floor(num)) {
    return `${num}`;
  }
  return num.toFixed(1);
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

onLoad((query) => {
  routeShareToken.value = normalizeRouteParam(query?.share_token || query?.shareToken || query?.share_id || query?.shareId || query?.token);
  routeCampaignId.value = normalizeRouteParam(query?.campaign_id || query?.campaignId || query?.id);
});

onShareAppMessage(() => {
  const title = String(previewCampaign.value?.title || "今天吃什么").trim() || "今天吃什么";
  return {
    title,
    path: buildSharePath(),
  };
});

onShareTimeline(() => {
  const title = String(previewCampaign.value?.title || "今天吃什么").trim() || "今天吃什么";
  const token = shareToken.value;
  return {
    title,
    query: token ? `share_token=${encodeURIComponent(token)}` : "",
  };
});

onShow(() => {
  void refreshStateSilently();
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  box-sizing: border-box;
}

/* Hero */
.detail-hero {
  position: relative;
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 20rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 16rpx;
}

.detail-hero-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14rpx;
}

.detail-hero-title {
  font-size: 36rpx;
  font-weight: 800;
  color: var(--text-main);
  flex: 1;
}

.status-badge {
  flex-shrink: 0;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 600;
}

.badge-live {
  background: color-mix(in srgb, #22c55e 14%, var(--muted-bg) 86%);
  color: #16a34a;
  border: 1rpx solid color-mix(in srgb, #22c55e 25%, var(--line) 75%);
}

.badge-ended {
  background: var(--muted-bg);
  color: var(--text-sub);
  border: 1rpx solid var(--line);
}

.badge-muted {
  background: var(--muted-bg);
  color: var(--text-sub);
  border: 1rpx solid var(--line);
}

.detail-meta-grid {
  margin-top: 18rpx;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12rpx 16rpx;
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.meta-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

.meta-value {
  font-size: 26rpx;
  color: var(--text-main);
  font-weight: 600;
}

.share-bar {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 12rpx 14rpx;
  border-radius: 12rpx;
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
}

.share-code {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.share-code-label {
  font-size: 22rpx;
  color: var(--text-sub);
}

.share-code-value {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 2rpx;
}

.mini-action-btn {
  border: 1rpx solid color-mix(in srgb, var(--accent) 30%, var(--line) 70%);
  border-radius: 10rpx;
  padding: 8rpx 16rpx;
  font-size: 22rpx;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--card-bg) 94%);
}

.auth-hint {
  margin-top: 18rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 14rpx;
  border-radius: 12rpx;
  background: var(--muted-bg);
}

.auth-hint-icon {
  font-size: 28rpx;
}

.auth-hint-text {
  font-size: 24rpx;
  color: var(--text-sub);
}

.detail-hero-actions {
  position: absolute;
  right: 20rpx;
  bottom: 20rpx;
}

.icon-btn-sm {
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

/* Action Card */
.action-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 16rpx;
}

.action-card.muted {
  opacity: 0.7;
}

.action-card-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.action-card-desc {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.action-field {
  margin-top: 16rpx;
}

.action-field-label {
  font-size: 24rpx;
  color: var(--text-sub);
  margin-bottom: 8rpx;
}

.action-input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 28rpx;
  padding: 16rpx;
}

.action-btn {
  margin-top: 16rpx;
  width: 100%;
  border: none;
  border-radius: 14rpx;
  padding: 18rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.action-btn.accent {
  background: var(--accent);
  color: #fff;
}

.action-btn.pending {
  opacity: 0.7;
}

/* Ops Bar */
.ops-bar {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 16rpx;
  flex-wrap: wrap;
}

.ops-btn {
  flex: 0 0 auto;
  border: none;
  border-radius: 12rpx;
  padding: 14rpx 20rpx;
  font-size: 24rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
}

.ops-btn.danger {
  background: var(--danger, #d94848);
}

.ops-btn.ghost {
  background: var(--muted-bg);
  color: var(--text-main);
  border: 1rpx solid var(--line);
}

.ops-btn:disabled {
  opacity: 0.5;
}

.ops-btn.pending {
  opacity: 0.7;
}

/* Vote Section */
.vote-section {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 20rpx 16rpx;
  margin-bottom: 16rpx;
}

.vote-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 16rpx;
}

.vote-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.vote-hint {
  font-size: 22rpx;
  color: var(--text-sub);
}

/* Food Card */
.food-card {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding: 16rpx 14rpx;
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  background: var(--muted-bg);
  margin-bottom: 10rpx;
  transition: border-color 0.15s, background 0.15s;
}

.food-card.selected {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line) 55%);
  background: color-mix(in srgb, var(--accent) 5%, var(--muted-bg) 95%);
}

.food-card:last-child {
  margin-bottom: 0;
}

.food-check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 10rpx;
  border: 2rpx solid var(--line);
  background: var(--card-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 4rpx;
  transition: border-color 0.15s, background 0.15s;
}

.food-check.checked {
  border-color: var(--accent);
  background: var(--accent);
}

.food-check.disabled {
  opacity: 0.45;
}

.food-check-inner {
  font-size: 22rpx;
  color: #fff;
  font-weight: 700;
}

.food-body {
  flex: 1;
  min-width: 0;
}

.food-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.food-name {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.food-votes {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
}

.food-details {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.food-detail-tag {
  color: var(--text-sub);
}

.food-detail-sep {
  margin: 0 4rpx;
  opacity: 0.5;
}

.vote-submit-btn {
  margin-top: 16rpx;
  width: 100%;
  border: none;
  border-radius: 14rpx;
  padding: 18rpx;
  font-size: 28rpx;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
}

.vote-submit-btn:disabled {
  opacity: 0.5;
}

.vote-submit-btn.pending {
  opacity: 0.7;
}

/* Detail Section */
.detail-section {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 18rpx;
  padding: 20rpx 16rpx;
  margin-bottom: 16rpx;
}

.detail-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  margin-bottom: 14rpx;
}

.detail-section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.detail-section-badge {
  font-size: 20rpx;
  color: var(--text-sub);
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
}

.voter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 12rpx 0;
  border-bottom: 1rpx solid color-mix(in srgb, var(--line) 50%, transparent);
}

.voter-row:last-child {
  border-bottom: none;
}

.voter-name {
  font-size: 26rpx;
  color: var(--text-main);
  font-weight: 600;
  flex-shrink: 0;
}

.voter-picks {
  font-size: 24rpx;
  color: var(--text-sub);
  text-align: right;
  flex: 1;
  min-width: 0;
}

/* Empty */
.empty-block {
  padding: 24rpx 0;
  text-align: center;
}

.empty-block-text {
  font-size: 24rpx;
  color: var(--text-sub);
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

.participant-scroll {
  max-height: 600rpx;
}

.participant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid color-mix(in srgb, var(--line) 50%, transparent);
}

.participant-row:last-child {
  border-bottom: none;
}

.participant-info {
  flex: 1;
  min-width: 0;
}

.participant-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text-main);
}

.participant-meta {
  margin-top: 6rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.participant-source-tag,
.participant-status-tag {
  font-size: 20rpx;
  padding: 3rpx 10rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-sub);
}

.participant-status-tag.status-approved {
  border-color: color-mix(in srgb, #22c55e 25%, var(--line) 75%);
  color: #16a34a;
  background: color-mix(in srgb, #22c55e 8%, var(--muted-bg) 92%);
}

.participant-status-tag.status-pending {
  border-color: color-mix(in srgb, #eab308 25%, var(--line) 75%);
  color: #a16207;
  background: color-mix(in srgb, #eab308 8%, var(--muted-bg) 92%);
}

.participant-status-tag.status-rejected {
  border-color: color-mix(in srgb, #ef4444 25%, var(--line) 75%);
  color: #dc2626;
  background: color-mix(in srgb, #ef4444 8%, var(--muted-bg) 92%);
}

.participant-actions {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
}

.p-action-btn {
  border: none;
  border-radius: 10rpx;
  padding: 10rpx 18rpx;
  font-size: 22rpx;
  font-weight: 600;
}

.p-action-btn.approve {
  background: var(--accent);
  color: #fff;
}

.p-action-btn.reject {
  background: var(--muted-bg);
  color: var(--danger, #d94848);
  border: 1rpx solid color-mix(in srgb, var(--danger, #d94848) 25%, var(--line) 75%);
}

.p-action-btn.pending {
  opacity: 0.7;
}

/* Confirm Dialog */
.confirm-dialog {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 560rpx;
  background: var(--card-bg);
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
  animation: dialog-pop 0.2s ease-out;
}

@keyframes dialog-pop {
  from { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}

.confirm-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--text-main);
  text-align: center;
}

.confirm-desc {
  margin-top: 12rpx;
  font-size: 26rpx;
  color: var(--text-sub);
  text-align: center;
  line-height: 1.5;
}

.confirm-actions {
  margin-top: 28rpx;
  display: flex;
  gap: 14rpx;
}

.confirm-btn {
  flex: 1;
  border: none;
  border-radius: 14rpx;
  padding: 18rpx;
  font-size: 28rpx;
  font-weight: 600;
}

.confirm-btn.cancel {
  background: var(--muted-bg);
  color: var(--text-main);
  border: 1rpx solid var(--line);
}

.confirm-btn.danger {
  background: var(--danger, #d94848);
  color: #fff;
}

.confirm-btn.pending {
  opacity: 0.7;
}
</style>
