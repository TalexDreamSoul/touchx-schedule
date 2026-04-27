<template>
  <PageViewContainer title="加入圈子">
    <view class="card">
      <view class="title">圈子邀请</view>
      <view class="sub">加入前选择你对圈内成员开放的日程范围。</view>
    </view>

    <view v-if="pageError" class="card">
      <view class="empty">{{ pageError }}</view>
    </view>

    <view v-if="circle" class="card">
      <view class="title small">{{ circle.name }}</view>
      <view class="sub">成员 {{ circle.memberCount || 0 }} 人 · {{ formatCircleType(circle.circleType) }}</view>
      <view v-if="circle.owner?.name" class="sub">创建者：{{ circle.owner.name }}</view>
      <view class="visibility-row">
        <view
          class="visibility-option"
          :class="{ active: visibilityScope === 'busy_free' }"
          @click="visibilityScope = 'busy_free'"
        >
          <view class="option-title">仅忙闲</view>
          <view class="option-sub">只参与共同空闲计算</view>
        </view>
        <view
          class="visibility-option"
          :class="{ active: visibilityScope === 'detail' }"
          @click="visibilityScope = 'detail'"
        >
          <view class="option-title">详细日程</view>
          <view class="option-sub">圈内成员可看课程详情</view>
        </view>
      </view>
      <view class="btn" :class="{ disabled: submitPending || joined }" @click="joinCircle">
        {{ joined ? "已加入" : submitPending ? "加入中..." : "确认加入" }}
      </view>
    </view>
  </PageViewContainer>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import PageViewContainer from "@/components/PageViewContainer.vue";
import {
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

type VisibilityScope = "busy_free" | "detail";

interface CirclePreview {
  circleId: string;
  name: string;
  circleType?: "class" | "club" | "custom";
  memberCount?: number;
  owner?: { name?: string } | null;
}

interface CircleJoinPreviewResponse {
  circle: CirclePreview;
  joined: boolean;
  currentVisibilityScope?: string;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const inviteToken = ref("");
const circle = ref<CirclePreview | null>(null);
const visibilityScope = ref<VisibilityScope>("busy_free");
const joined = ref(false);
const submitPending = ref(false);
const pageError = ref("");

const syncContext = () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
};

const formatCircleType = (value?: string) => {
  if (value === "class") {
    return "班级圈子";
  }
  if (value === "club") {
    return "社团圈子";
  }
  return "自定义圈子";
};

const loadPreview = async () => {
  syncContext();
  if (!authSession.value.token) {
    pageError.value = "请先登录后加入圈子。";
    return;
  }
  if (!inviteToken.value) {
    pageError.value = "邀请链接缺少 token。";
    return;
  }
  try {
    const payload = await requestBackendGet<CircleJoinPreviewResponse>(
      backendBaseUrl.value,
      "/api/v1/social/circles/join-preview",
      { token: inviteToken.value },
      authSession.value.token,
    );
    circle.value = payload.circle;
    joined.value = Boolean(payload.joined);
    visibilityScope.value = payload.currentVisibilityScope === "detail" ? "detail" : "busy_free";
    pageError.value = "";
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "圈子邀请加载失败";
  }
};

const joinCircle = async () => {
  if (!circle.value || joined.value || submitPending.value) {
    return;
  }
  submitPending.value = true;
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      `/api/v1/social/circles/${encodeURIComponent(circle.value.circleId)}/join`,
      { inviteToken: inviteToken.value, visibilityScope: visibilityScope.value },
      authSession.value.token,
    );
    joined.value = true;
    uni.showToast({ title: "已加入圈子", icon: "none", duration: 1200 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "加入失败", icon: "none", duration: 1800 });
  } finally {
    submitPending.value = false;
  }
};

onLoad((query) => {
  inviteToken.value = String(query?.token || "").trim();
});

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void loadPreview();
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

.visibility-row {
  margin-top: 16rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}

.visibility-option {
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 14rpx;
  background: var(--muted-bg);
}

.visibility-option.active {
  border-color: var(--accent);
  background: rgba(37, 99, 235, 0.1);
}

.option-title {
  font-size: 23rpx;
  font-weight: 700;
  color: var(--text-main);
}

.option-sub {
  margin-top: 6rpx;
  font-size: 19rpx;
  color: var(--text-sub);
}

.btn {
  margin-top: 16rpx;
  text-align: center;
  border-radius: 10rpx;
  padding: 18rpx 12rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 600;
}

.btn.disabled {
  opacity: 0.6;
}
</style>
