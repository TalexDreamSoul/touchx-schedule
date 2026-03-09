<template>
  <PageViewContainer title="编辑学号">
      <view v-if="!isBound" class="card">
        <view class="empty">请先在“账号与授权”页面绑定课表账号。</view>
        <view class="btn" @click="goAccountPage">去绑定</view>
      </view>

      <view v-else class="card">
        <view class="title">学号</view>
        <view class="sub">保存后写入云端，换设备登录后可同步。</view>
        <view class="input-row">
          <input v-model="studentNoDraft" class="input" type="text" maxlength="32" placeholder="请输入学号" />
          <view class="btn ghost" :class="{ pending: savePending }" @click="saveStudentNo">{{ savePending ? "同步中" : "同步云端" }}</view>
        </view>
        <view class="hint">{{ hintText || "当前仅允许编辑已授权账号的学号" }}</view>
      </view>
  </PageViewContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
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

interface SocialUserItem {
  studentNo?: string;
}

interface SocialDashboardResponse {
  me?: SocialUserItem;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const studentNoDraft = ref("");
const hintText = ref("");
const savePending = ref(false);

const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));
const isBound = computed(() => Boolean(authSession.value.user?.studentId));

const normalizeStudentNo = (value: unknown) => {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 32);
};

const refreshSocialMe = async () => {
  if (!isAuthed.value || !isBound.value) {
    studentNoDraft.value = "";
    return;
  }
  const data = await requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/v1/social/me", {}, authSession.value.token);
  studentNoDraft.value = normalizeStudentNo(data.me?.studentNo);
};

const refreshState = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  hintText.value = "";
  studentNoDraft.value = "";
  if (isAuthed.value) {
    try {
      await refreshSocialMe();
    } catch (error) {
      // ignore transient failures
    }
  }
};

const saveStudentNo = async () => {
  if (!isAuthed.value || !isBound.value) {
    uni.showToast({ title: "请先登录", icon: "none", duration: 1600 });
    return;
  }
  if (savePending.value) {
    return;
  }
  savePending.value = true;
  try {
    const studentNo = normalizeStudentNo(studentNoDraft.value);
    if (!studentNo) {
      hintText.value = "学号不能为空";
      uni.showToast({ title: "请先填写学号", icon: "none", duration: 1600 });
      return;
    }
    if (!/^\d{6,32}$/.test(studentNo)) {
      hintText.value = "学号格式不正确";
      uni.showToast({ title: "学号格式不正确", icon: "none", duration: 1600 });
      return;
    }
    await requestBackendPost(backendBaseUrl.value, "/api/v1/social/profile", { studentNo }, authSession.value.token);
    studentNoDraft.value = studentNo;
    hintText.value = "学号已同步到云端";
    uni.showToast({ title: "同步成功", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步失败";
    hintText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    savePending.value = false;
  }
};

const goAccountPage = () => {
  uni.navigateTo({ url: "/pages/profile/account" });
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void refreshState();
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

.sub {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.input-row {
  margin-top: 12rpx;
  display: flex;
  gap: 8rpx;
}

.input {
  flex: 1;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx;
  font-size: 22rpx;
  color: var(--text-main);
  background: var(--card-bg);
}

.btn {
  text-align: center;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx 12rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 22rpx;
}

.btn.ghost {
  background: var(--card-bg);
  color: var(--text-main);
}

.btn.pending {
  opacity: 0.64;
}

.hint {
  margin-top: 10rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.empty {
  font-size: 21rpx;
  color: var(--text-sub);
}
</style>
