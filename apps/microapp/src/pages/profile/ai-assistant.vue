<template>
  <PageViewContainer title="AI 时间助手">
    <view class="card">
      <view class="title">自然语言创建日程</view>
      <view class="sub">先解析成候选日程，确认后才会写入个人日程。</view>
      <textarea v-model="inputText" class="textarea" maxlength="300" placeholder="例如：周一三五下午2-4点训练，期末考试复习 DDL" />
      <view class="btn" @click="parseText">解析</view>
    </view>

    <view v-if="pageError" class="card">
      <view class="empty">{{ pageError }}</view>
    </view>

    <view v-for="(item, index) in candidates" :key="`candidate-${index}`" class="card">
      <view class="title small">{{ item.title }}</view>
      <view class="sub">标签：{{ item.tags.join(" / ") }} · 优先级：{{ formatPriority(item.priorityLabel) }} · 置信度 {{ Math.round(item.confidence * 100) }}%</view>
      <view class="form-grid">
        <view class="form-field">
          <view class="label">周几</view>
          <input v-model.number="item.day" class="input" type="number" />
        </view>
        <view class="form-field">
          <view class="label">开始节</view>
          <input v-model.number="item.startSection" class="input" type="number" />
        </view>
        <view class="form-field">
          <view class="label">结束节</view>
          <input v-model.number="item.endSection" class="input" type="number" />
        </view>
        <view class="form-field">
          <view class="label">周次</view>
          <input v-model.trim="item.weekExpr" class="input" />
        </view>
      </view>
      <view class="btn" @click="commitCandidate(item)">确认写入</view>
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
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

type PriorityLabel = "low" | "normal" | "high";

interface ScheduleCandidate {
  title: string;
  description: string;
  tags: string[];
  priorityLabel: PriorityLabel;
  priorityScore: number;
  repeatWeekdays: number[];
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity: "all" | "odd" | "even";
  examLike: boolean;
  confidence: number;
}

interface ParseResponse {
  provider: string;
  candidates: ScheduleCandidate[];
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const inputText = ref("");
const candidates = ref<ScheduleCandidate[]>([]);
const pageError = ref("");

const syncContext = () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
};

const formatPriority = (label: PriorityLabel) => {
  if (label === "high") {
    return "高";
  }
  if (label === "low") {
    return "低";
  }
  return "普通";
};

const parseText = async () => {
  syncContext();
  if (!authSession.value.token) {
    pageError.value = "请先登录后使用 AI 时间助手。";
    return;
  }
  if (!inputText.value.trim()) {
    uni.showToast({ title: "请输入日程文本", icon: "none", duration: 1600 });
    return;
  }
  try {
    const payload = await requestBackendPost<ParseResponse>(
      backendBaseUrl.value,
      "/api/v1/ai/schedule/parse",
      { text: inputText.value.trim() },
      authSession.value.token,
    );
    candidates.value = (payload.candidates || []).map((item) => ({
      ...item,
      day: Number(item.day || item.repeatWeekdays?.[0] || 1),
      startSection: Number(item.startSection || 1),
      endSection: Number(item.endSection || item.startSection || 1),
      weekExpr: item.weekExpr || "1-20",
      parity: item.parity || "all",
    }));
    pageError.value = "";
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "解析失败";
  }
};

const commitCandidate = async (candidate: ScheduleCandidate) => {
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      "/api/v1/ai/schedule/commit",
      {
        title: candidate.title,
        description: candidate.description,
        day: candidate.day,
        startSection: candidate.startSection,
        endSection: candidate.endSection,
        weekExpr: candidate.weekExpr,
        parity: candidate.parity,
        tags: candidate.tags,
      },
      authSession.value.token,
    );
    uni.showToast({ title: "已写入日程", icon: "none", duration: 1200 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "写入失败", icon: "none", duration: 1800 });
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  syncContext();
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

.textarea {
  margin-top: 14rpx;
  width: 100%;
  min-height: 180rpx;
  padding: 16rpx;
  box-sizing: border-box;
  border-radius: 10rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 24rpx;
}

.form-grid {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}

.label {
  font-size: 21rpx;
  color: var(--text-sub);
}

.input {
  margin-top: 6rpx;
  min-height: 64rpx;
  padding: 0 14rpx;
  border-radius: 8rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 23rpx;
}

.btn {
  margin-top: 14rpx;
  border-radius: 8rpx;
  padding: 14rpx 10rpx;
  text-align: center;
  font-size: 23rpx;
  color: #ffffff;
  background: var(--accent);
}
</style>
