<template>
  <PageContainer title="绑定课表">
    <view class="page">
      <view v-if="!isAuthed" class="card">
        <view class="empty">请先在“账号与授权”页面完成授权登录。</view>
        <view class="btn" @click="goAccountPage">去账号与授权</view>
      </view>

      <view v-else class="card">
        <view class="title">选择课表账号</view>
        <view class="sub">除管理员外，绑定他人课表需输入对方 4 位验证码（对方可在“个人界面”查看）。</view>

        <view v-if="loading" class="state">加载中...</view>
        <view v-else-if="students.length === 0" class="state">暂无可绑定课表</view>

        <view v-else class="list">
          <view
            v-for="item in students"
            :key="item.studentId"
            class="item"
            :class="{ active: item.studentId === currentStudentId }"
            @click="bindTargetStudent(item.studentId)"
          >
            <view class="item-main">
              <view class="item-title">{{ item.name }}</view>
              <view class="item-sub">{{ formatStudentMeta(item) }}</view>
            </view>
            <view class="item-status">
              {{ pendingStudentId === item.studentId ? "绑定中" : item.studentId === currentStudentId ? "当前" : "绑定" }}
            </view>
          </view>
        </view>

        <view v-if="hintText" class="hint">{{ hintText }}</view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import {
  guardProfilePageAccess,
  persistAuthSessionToStorage,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

interface SocialUserItem {
  studentId: string;
  name: string;
  studentNo?: string;
  classLabel?: string;
  isAdmin?: boolean;
}

interface SocialDashboardResponse {
  me?: SocialUserItem | null;
  candidates?: SocialUserItem[];
}

interface BindStudentResponse {
  me?: SocialUserItem;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const loading = ref(false);
const hintText = ref("");
const pendingStudentId = ref("");
const students = ref<SocialUserItem[]>([]);

const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));
const currentStudentId = computed(() => String(authSession.value.user?.studentId || "").trim());

const resolveActionErrorMessage = (error: unknown, fallback: string) => {
  const rawMessage = error instanceof Error ? String(error.message || "").trim() : "";
  return rawMessage || fallback;
};

const refreshAuthState = () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
};

const formatStudentMeta = (item: SocialUserItem) => {
  const classLabel = String(item.classLabel || "").trim();
  const studentNo = String(item.studentNo || "").trim();
  const segments = [classLabel ? `班级：${classLabel}` : "", studentNo ? `学号：${studentNo}` : "学号：未绑定"].filter((value) => value);
  return segments.join(" · ");
};

const normalizeRandomCode = (value: unknown) => {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 4);
};

const promptTargetRandomCode = () => {
  return new Promise<string | null>((resolve) => {
    uni.showModal({
      title: "输入验证码（4位）",
      content: "",
      editable: true,
      placeholderText: "4 位数字验证码",
      success: (result) => {
        if (!result.confirm) {
          resolve(null);
          return;
        }
        const code = normalizeRandomCode((result as { content?: string }).content);
        if (code.length !== 4) {
          uni.showToast({ title: "请输入 4 位数字验证码", icon: "none", duration: 1800 });
          resolve("");
          return;
        }
        resolve(code);
      },
      fail: () => {
        resolve(null);
      },
    });
  });
};

const shouldPromptRandomCodeByMessage = (message: string) => {
  return /验证码/.test(String(message || ""));
};

const refreshStudents = async () => {
  if (!isAuthed.value) {
    students.value = [];
    return;
  }
  loading.value = true;
  hintText.value = "";
  try {
    const data = await requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/social/me", {}, authSession.value.token);
    const merged = new Map<string, SocialUserItem>();
    const me = data.me;
    if (me?.studentId) {
      merged.set(me.studentId, me);
    }
    for (const item of data.candidates || []) {
      if (!item?.studentId) {
        continue;
      }
      if (!merged.has(item.studentId)) {
        merged.set(item.studentId, item);
      }
    }
    students.value = Array.from(merged.values());
  } catch (error) {
    const message = resolveActionErrorMessage(error, "课表列表加载失败");
    hintText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    loading.value = false;
  }
};

const bindTargetStudent = async (studentId: string) => {
  const targetStudentId = String(studentId || "").trim();
  if (!isAuthed.value || !targetStudentId || pendingStudentId.value) {
    return;
  }
  if (targetStudentId === currentStudentId.value) {
    uni.showToast({ title: "当前已绑定该课表", icon: "none", duration: 1400 });
    return;
  }
  pendingStudentId.value = targetStudentId;
  try {
    let data: BindStudentResponse;
    try {
      data = await requestBackendPost<BindStudentResponse>(
        backendBaseUrl.value,
        "/api/social/bind-student",
        { target_student_id: targetStudentId },
        authSession.value.token,
      );
    } catch (error) {
      const firstMessage = resolveActionErrorMessage(error, "绑定失败");
      if (!shouldPromptRandomCodeByMessage(firstMessage)) {
        throw error;
      }
      const code = await promptTargetRandomCode();
      if (code === null || !code) {
        return;
      }
      data = await requestBackendPost<BindStudentResponse>(
        backendBaseUrl.value,
        "/api/social/bind-student",
        {
          target_student_id: targetStudentId,
          target_random_code: code,
        },
        authSession.value.token,
      );
    }
    if (authSession.value.user && authSession.value.token) {
      persistAuthSessionToStorage({
        token: authSession.value.token,
        expiresAt: authSession.value.expiresAt,
        mode: authSession.value.mode === "wechat" ? "wechat" : "mock",
        user: {
          ...authSession.value.user,
          studentId: targetStudentId,
          studentName: String(data.me?.name || authSession.value.user.studentName || ""),
          classLabel: String(data.me?.classLabel || authSession.value.user.classLabel || ""),
        },
      });
      authSession.value = readAuthSessionFromStorage();
    }
    uni.showToast({ title: "绑定成功", icon: "none", duration: 1200 });
    await refreshStudents();
    const pages = getCurrentPages();
    if (pages.length > 1) {
      uni.navigateBack();
    }
  } catch (error) {
    const message = resolveActionErrorMessage(error, "绑定失败");
    hintText.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    pendingStudentId.value = "";
  }
};

const goAccountPage = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.navigateTo({ url: "/pages/profile/account" });
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  refreshAuthState();
  void refreshStudents();
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  box-sizing: border-box;
}

.card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  padding: 20rpx 16rpx 16rpx;
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

.state {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.list {
  margin-top: 16rpx;
  border-top: 1rpx solid var(--line);
  border-bottom: 1rpx solid var(--line);
}

.item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid var(--line);
}

.item:last-child {
  border-bottom: none;
}

.item.active .item-title {
  color: var(--accent);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.item-sub {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.item-status {
  font-size: 22rpx;
  color: var(--accent);
  font-weight: 600;
}

.hint {
  margin-top: 10rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.btn {
  margin-top: 14rpx;
  text-align: center;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx 12rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 22rpx;
}

.empty {
  font-size: 22rpx;
  color: var(--text-sub);
}
</style>
