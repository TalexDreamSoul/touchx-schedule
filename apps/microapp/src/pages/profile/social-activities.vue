<template>
  <PageViewContainer title="组局与活动">
    <view class="card">
      <view class="title">活动闭环</view>
      <view class="sub">处理邀请、导出日历、AA 分摊、分享快照和成功率预测都在这里完成。</view>
    </view>

    <view v-if="pageError" class="card">
      <view class="empty">{{ pageError }}</view>
    </view>

    <view v-if="!pageError && activities.length === 0" class="card">
      <view class="empty">暂无活动，可在首页共同空闲格上发起组局。</view>
    </view>

    <view v-for="item in activities" :key="item.activityId" class="card">
      <view class="activity-head">
        <view>
          <view class="title small">{{ item.title }}</view>
          <view class="sub">{{ formatActivityStatus(item.status) }} · {{ item.timeLabel }}</view>
        </view>
        <view class="badge">{{ item.activityType || "activity" }}</view>
      </view>
      <view class="meta-line">参与：{{ formatParticipants(item.participants) }}</view>
      <view class="meta-line">
        邀请：待处理 {{ item.invitationStats?.pending || 0 }} · 已同意 {{ item.invitationStats?.accepted || 0 }} · 已拒绝 {{ item.invitationStats?.declined || 0 }}
      </view>
      <view v-if="item.metadata?.split" class="meta-line">
        AA：{{ formatSplit(item.metadata.split) }}
      </view>
      <view v-if="predictionByActivityId[item.activityId]" class="meta-line">
        成功率：{{ Math.round((predictionByActivityId[item.activityId].successRate || 0) * 100) }}% · {{ predictionByActivityId[item.activityId].suggestions?.[0] || "" }}
      </view>

      <view v-if="item.viewerInvitation?.status === 'pending'" class="action-row">
        <view class="btn" @click="respondInvitation(item, 'accept')">同意</view>
        <view class="btn ghost" @click="respondInvitation(item, 'decline')">拒绝</view>
      </view>
      <view class="action-row">
        <view class="btn ghost" @click="copyCalendarUrl(item)">复制日历</view>
        <view class="btn ghost" @click="createSplit(item)">AA 分摊</view>
        <view class="btn ghost" @click="copySnapshot(item)">分享文本</view>
      </view>
      <view class="action-row">
        <view class="btn ghost" @click="predictActivity(item)">成功率</view>
        <view class="btn ghost" @click="calcSmartReminder(item)">提醒时机</view>
      </view>
    </view>
  </PageViewContainer>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageViewContainer from "@/components/PageViewContainer.vue";
import {
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

interface ActivityUserBrief {
  studentId: string;
  name: string;
}

interface ActivityPrediction {
  successRate: number;
  confidence: string;
  sampleCount: number;
  suggestions: string[];
}

interface SocialActivityItem {
  activityId: string;
  title: string;
  activityType: string;
  status: string;
  week: number;
  day: number;
  startSection: number;
  endSection: number;
  timeLabel: string;
  participantStudentIds: string[];
  participants: ActivityUserBrief[];
  invitationStats?: { pending: number; accepted: number; declined: number };
  viewerInvitation?: { invitationId: string; status: string } | null;
  calendarPath: string;
  metadata?: Record<string, unknown>;
}

interface ActivitiesResponse {
  items: SocialActivityItem[];
}

interface SnapshotResponse {
  card: {
    shareText: string;
  };
}

interface PredictionResponse {
  prediction: ActivityPrediction;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const activities = ref<SocialActivityItem[]>([]);
const predictionByActivityId = ref<Record<string, ActivityPrediction>>({});
const pageError = ref("");

const formatActivityStatus = (status: string) => {
  if (status === "confirmed") {
    return "已确认";
  }
  if (status === "inviting") {
    return "邀请中";
  }
  if (status === "cancelled") {
    return "已取消";
  }
  if (status === "expired") {
    return "已过期";
  }
  return "草稿";
};

const formatParticipants = (items: ActivityUserBrief[] = []) => {
  const names = items.map((item) => item.name || item.studentId).filter((item) => item);
  return names.length > 0 ? names.join("、") : "暂无参与人";
};

const formatSplit = (value: unknown) => {
  const data = value as { totalAmount?: number; currency?: string; perPerson?: Array<{ name?: string; amount?: number }> };
  const totalAmount = Number(data?.totalAmount || 0);
  const first = data?.perPerson?.[0];
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return "未设置金额";
  }
  return `${data.currency || "CNY"} ${totalAmount.toFixed(2)}，人均 ${Number(first?.amount || 0).toFixed(2)}`;
};

const loadActivities = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token) {
    pageError.value = "请先登录后查看活动。";
    return;
  }
  try {
    const payload = await requestBackendGet<ActivitiesResponse>(
      backendBaseUrl.value,
      "/api/v1/social/activities",
      {},
      authSession.value.token,
    );
    activities.value = payload.items || [];
    pageError.value = "";
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "活动加载失败";
  }
};

const respondInvitation = async (activity: SocialActivityItem, action: "accept" | "decline") => {
  const invitationId = activity.viewerInvitation?.invitationId || "";
  if (!invitationId) {
    return;
  }
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      `/api/v1/social/activities/${encodeURIComponent(activity.activityId)}/invitations/${encodeURIComponent(invitationId)}/respond`,
      { action },
      authSession.value.token,
    );
    await loadActivities();
    uni.showToast({ title: action === "accept" ? "已同意" : "已拒绝", icon: "none", duration: 1200 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "处理失败", icon: "none", duration: 1800 });
  }
};

const copyText = (text: string, title: string) => {
  uni.setClipboardData({ data: text, success: () => uni.showToast({ title, icon: "none" }) });
};

const copyCalendarUrl = (activity: SocialActivityItem) => {
  copyText(`${backendBaseUrl.value}${activity.calendarPath}`, "日历地址已复制");
};

const createSplit = (activity: SocialActivityItem) => {
  uni.showModal({
    title: "AA 分摊金额",
    editable: true,
    placeholderText: "输入总金额，例如 88",
    success: async (result) => {
      if (!result.confirm) {
        return;
      }
      const totalAmount = Number((result as { content?: string }).content || 0);
      if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        uni.showToast({ title: "请输入有效金额", icon: "none", duration: 1600 });
        return;
      }
      try {
        await requestBackendPost(
          backendBaseUrl.value,
          `/api/v1/social/activities/${encodeURIComponent(activity.activityId)}/splits`,
          { totalAmount, currency: "CNY" },
          authSession.value.token,
        );
        await loadActivities();
        uni.showToast({ title: "分摊已生成", icon: "none", duration: 1200 });
      } catch (error) {
        uni.showToast({ title: error instanceof Error ? error.message : "分摊失败", icon: "none", duration: 1800 });
      }
    },
  });
};

const copySnapshot = async (activity: SocialActivityItem) => {
  try {
    const payload = await requestBackendGet<SnapshotResponse>(
      backendBaseUrl.value,
      `/api/v1/social/activities/${encodeURIComponent(activity.activityId)}/snapshot`,
      {},
      authSession.value.token,
    );
    copyText(payload.card?.shareText || activity.title, "分享文本已复制");
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "生成失败", icon: "none", duration: 1800 });
  }
};

const predictActivity = async (activity: SocialActivityItem) => {
  try {
    const payload = await requestBackendPost<PredictionResponse>(
      backendBaseUrl.value,
      "/api/v1/social/activities/predict",
      {
        activityType: activity.activityType,
        day: activity.day,
        startSection: activity.startSection,
        participantStudentIds: activity.participantStudentIds,
      },
      authSession.value.token,
    );
    predictionByActivityId.value = {
      ...predictionByActivityId.value,
      [activity.activityId]: payload.prediction,
    };
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "预测失败", icon: "none", duration: 1800 });
  }
};

const calcSmartReminder = async (activity: SocialActivityItem) => {
  try {
    const payload = await requestBackendPost<{ reminder: { leadMinutes: number; reason: string } }>(
      backendBaseUrl.value,
      "/api/v1/social/reminders/smart-lead",
      { activityType: activity.activityType, distanceMeters: 1000, locationLabel: activity.title },
      authSession.value.token,
    );
    uni.showToast({ title: `建议提前 ${payload.reminder.leadMinutes} 分钟`, icon: "none", duration: 1800 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "计算失败", icon: "none", duration: 1800 });
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void loadActivities();
});
</script>

<style scoped>
.card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  padding: 16rpx;
  margin-bottom: 12rpx;
}

.title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.title.small {
  font-size: 25rpx;
}

.sub,
.meta-line,
.empty {
  margin-top: 8rpx;
  font-size: 21rpx;
  color: var(--text-sub);
  line-height: 1.45;
}

.activity-head,
.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.action-row {
  margin-top: 12rpx;
}

.badge {
  flex-shrink: 0;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 6rpx 10rpx;
  font-size: 19rpx;
  color: var(--text-sub);
  background: var(--muted-bg);
}

.btn {
  flex: 1;
  border-radius: 8rpx;
  padding: 12rpx 10rpx;
  text-align: center;
  font-size: 22rpx;
  color: #ffffff;
  background: var(--accent);
}

.btn.ghost {
  color: var(--text-main);
  background: var(--card-bg);
  border: 1rpx solid var(--line);
}
</style>
