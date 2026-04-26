<template>
  <PageViewContainer title="考试周伴侣">
    <view class="card">
      <view class="title">考试倒计时</view>
      <view class="sub">从 AI 日程、手动日程和导入结果里识别考试类安排。</view>
    </view>

    <view v-if="pageError" class="card">
      <view class="empty">{{ pageError }}</view>
    </view>

    <view class="card">
      <view class="section-head">
        <view>
          <view class="title small">考试安排</view>
          <view class="sub">{{ countdowns.length }} 个已识别考试日程</view>
        </view>
        <view class="btn ghost" @click="precreateAfterExamActivity">预创建考后活动</view>
      </view>
      <view v-if="countdowns.length === 0" class="empty">暂无考试日程，可先用 AI 时间助手录入“期末考试”。</view>
      <view v-for="item in countdowns" :key="item.eventId" class="list-item">
        <view>
          <view class="item-title">{{ item.title }}</view>
          <view class="sub">{{ item.examDate ? `考试日期：${item.examDate}` : "考试日期待补全" }} · {{ formatPriority(item.priorityLabel) }}</view>
        </view>
        <view class="countdown">{{ formatCountdown(item.examDate) }}</view>
      </view>
    </view>

    <view class="card">
      <view class="title small">静态自习室推荐</view>
      <view v-for="item in studyRooms" :key="`${item.label}-${item.timeRange}`" class="list-item">
        <view>
          <view class="item-title">{{ item.label }}</view>
          <view class="sub">{{ item.timeRange }} · {{ item.reason }}</view>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="title small">考后预创建</view>
      <view v-if="precreatedActivities.length === 0" class="empty">暂无预创建活动。</view>
      <view v-for="item in precreatedActivities" :key="item.activityId" class="list-item">
        <view>
          <view class="item-title">{{ item.title }}</view>
          <view class="sub">{{ item.timeLabel }} · {{ item.status }}</view>
        </view>
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

type PriorityLabel = "low" | "normal" | "high";

interface ExamCountdown {
  eventId: string;
  title: string;
  examDate: string;
  priorityLabel: PriorityLabel;
}

interface StudyRoomRecommendation {
  label: string;
  timeRange: string;
  reason: string;
}

interface PrecreatedActivity {
  activityId: string;
  title: string;
  status: string;
  timeLabel: string;
}

interface ExamCompanionResponse {
  countdowns: ExamCountdown[];
  studyRoomRecommendations: StudyRoomRecommendation[];
  precreatedActivities: PrecreatedActivity[];
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const countdowns = ref<ExamCountdown[]>([]);
const studyRooms = ref<StudyRoomRecommendation[]>([]);
const precreatedActivities = ref<PrecreatedActivity[]>([]);
const pageError = ref("");

const loadCompanion = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token) {
    pageError.value = "请先登录后查看考试周伴侣。";
    return;
  }
  try {
    const payload = await requestBackendGet<ExamCompanionResponse>(
      backendBaseUrl.value,
      "/api/v1/exams/companion",
      {},
      authSession.value.token,
    );
    countdowns.value = payload.countdowns || [];
    studyRooms.value = payload.studyRoomRecommendations || [];
    precreatedActivities.value = payload.precreatedActivities || [];
    pageError.value = "";
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "考试周数据加载失败";
  }
};

const formatPriority = (label: PriorityLabel) => {
  if (label === "high") {
    return "高优先级";
  }
  if (label === "low") {
    return "低优先级";
  }
  return "普通优先级";
};

const formatCountdown = (examDate: string) => {
  if (!examDate) {
    return "待定";
  }
  const target = Date.parse(examDate);
  if (!Number.isFinite(target)) {
    return "待定";
  }
  const days = Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return "已结束";
  }
  return `${days} 天`;
};

const precreateAfterExamActivity = async () => {
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      "/api/v1/social/activities",
      {
        title: "考后复盘活动",
        activityType: "exam-after",
        week: 16,
        day: 5,
        startSection: 9,
        endSection: 10,
        participantStudentIds: [],
        sendNow: false,
      },
      authSession.value.token,
    );
    await loadCompanion();
    uni.showToast({ title: "已预创建", icon: "none", duration: 1200 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "创建失败", icon: "none", duration: 1800 });
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void loadCompanion();
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
.empty {
  margin-top: 8rpx;
  font-size: 21rpx;
  color: var(--text-sub);
  line-height: 1.45;
}

.section-head,
.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.list-item {
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid var(--line);
}

.item-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--text-main);
}

.countdown {
  flex-shrink: 0;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--accent);
}

.btn {
  flex-shrink: 0;
  border-radius: 8rpx;
  padding: 10rpx 12rpx;
  text-align: center;
  font-size: 21rpx;
  color: #ffffff;
  background: var(--accent);
}

.btn.ghost {
  color: var(--text-main);
  background: var(--card-bg);
  border: 1rpx solid var(--line);
}
</style>
