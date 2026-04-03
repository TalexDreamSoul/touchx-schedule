<template>
  <PageViewContainer title="通知与订阅">
      <template v-if="!isBound">
        <view class="card">
          <view class="sub">除管理员外，订阅他人课表需输入对方个人页中的 4 位验证码。</view>
        </view>
        <view class="card">
          <view class="empty">请先在“账号与授权”页面绑定一个课表账号。</view>
          <view class="btn" @click="goAccountPage">去绑定</view>
        </view>
      </template>

      <template v-else>
        <view class="card">
          <view class="sub">除管理员外，订阅他人课表需输入对方个人页中的 4 位验证码。</view>
        </view>

        <view class="card">
          <view class="mini-grid">
            <view class="mini-item">
              <view class="mini-key">我的订阅</view>
              <view class="mini-value">{{ subscriptions.length }} 人</view>
            </view>
          <view class="mini-item">
            <view class="mini-key">我的验证码</view>
            <view class="mini-value code">{{ dashboard?.me?.randomCode || "----" }}</view>
          </view>
        </view>
        <view class="my-line">
            <image
              v-if="canShowAvatar(`me-${dashboard?.me?.studentId || 'me'}`, dashboard?.me?.avatarUrl)"
              class="avatar"
              :src="dashboard?.me?.avatarUrl"
              mode="aspectFill"
              @error="onAvatarLoadError(`me-${dashboard?.me?.studentId || 'me'}`)"
            />
            <view v-else class="avatar placeholder">我</view>
            <view class="my-meta">
              <view class="sub-name">{{ dashboard?.me?.name || "--" }}</view>
              <view class="sub-meta">{{ dashboard?.me?.classLabel ? `班级：${dashboard?.me?.classLabel}` : "班级未设置" }}</view>
              <view class="sub-meta">{{ dashboard?.me?.studentNo ? `学号：${dashboard?.me?.studentNo}` : "学号未同步" }}</view>
            </view>
          </view>
        </view>

        <view class="card">
          <view class="title small">广场（{{ candidates.length }}）</view>
          <view v-if="candidates.length === 0" class="empty">暂无已注册用户</view>
          <view v-for="item in candidates" :key="`candidate-${item.studentId}`" class="sub-item">
            <view class="user-line">
              <image
                v-if="canShowAvatar(`candidate-${item.studentId}`, item.avatarUrl)"
                class="avatar"
                :src="item.avatarUrl"
                mode="aspectFill"
                @error="onAvatarLoadError(`candidate-${item.studentId}`)"
              />
              <view v-else class="avatar placeholder">{{ item.name.slice(0, 1) }}</view>
              <view>
                <view class="sub-name">{{ item.name }}</view>
                <view class="sub-meta">{{ item.classLabel ? `班级：${item.classLabel}` : "班级未设置" }}</view>
                <view class="sub-meta">{{ item.studentNo ? `学号：${item.studentNo}` : "学号未同步" }}</view>
              </view>
            </view>
            <view
              class="sub-action"
              :class="{ remove: subscribedStudentIdSet.has(item.studentId), pending: disableMutations }"
              @click="toggleSubscribe(item.studentId)"
            >
              {{
                disableMutations
                  ? "处理中..."
                  : (subscribedStudentIdSet.has(item.studentId) ? "取消订阅" : "订阅")
              }}
            </view>
          </view>
        </view>

        <view class="card">
          <view class="title small">我的订阅（{{ subscriptions.length }}）</view>
          <view v-if="subscriptions.length === 0" class="empty">暂无订阅对象</view>
          <view v-for="item in subscriptions" :key="item.studentId" class="sub-item">
            <view class="user-line">
              <image
                v-if="canShowAvatar(`subscription-${item.studentId}`, item.avatarUrl)"
                class="avatar"
                :src="item.avatarUrl"
                mode="aspectFill"
                @error="onAvatarLoadError(`subscription-${item.studentId}`)"
              />
              <view v-else class="avatar placeholder">{{ item.name.slice(0, 1) }}</view>
              <view>
                <view class="sub-name">{{ item.name }}</view>
                <view class="sub-meta">{{ item.classLabel ? `班级：${item.classLabel}` : "班级未设置" }}</view>
                <view class="sub-meta">{{ item.studentNo ? `学号：${item.studentNo}` : "学号未同步" }}</view>
              </view>
            </view>
            <view
              class="sub-action remove"
              :class="{ pending: disableMutations }"
              @click="unsubscribe(item.studentId)"
            >
              {{ disableMutations ? "处理中..." : "取消" }}
            </view>
          </view>
        </view>

      </template>
  </PageViewContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageViewContainer from "@/components/PageViewContainer.vue";
import { useSocialDashboard, type SocialDashboardResponse, type SocialUserItem } from "@/composables/useSocialDashboard";
import {
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const {
  dashboard,
  subscriptions,
  candidates,
  subscribedStudentIdSet,
  refreshDashboard: refreshSocialDashboardData,
  hydrateDashboardFromStorage,
  patchDashboard,
  clearDashboard,
} = useSocialDashboard();
const bootstrapping = ref(true);
const pendingByStudentId = ref<Record<string, boolean>>({});
const brokenAvatarKeys = ref<Record<string, boolean>>({});

interface SocialSubscribeMutationResponse {
  ok?: boolean;
  subscribed?: boolean;
  removed?: boolean;
  stateRevision?: number;
}

const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));
const isBound = computed(() => Boolean(dashboard.value?.me?.studentId));
const hasPendingMutation = computed(() => Object.values(pendingByStudentId.value).some((value) => Boolean(value)));
const disableMutations = computed(() => bootstrapping.value || hasPendingMutation.value);

const normalizeStudentId = (value: unknown) => String(value || "").trim();

const setTargetPending = (studentId: string, value: boolean) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!normalizedStudentId) {
    return;
  }
  pendingByStudentId.value = {
    ...pendingByStudentId.value,
    [normalizedStudentId]: value,
  };
};

const isTargetPending = (studentId: string) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!normalizedStudentId) {
    return false;
  }
  return Boolean(pendingByStudentId.value[normalizedStudentId]);
};

const dedupeUsers = (rows: SocialUserItem[]) => {
  const list: SocialUserItem[] = [];
  const seen = new Set<string>();
  rows.forEach((item) => {
    const studentId = normalizeStudentId(item.studentId);
    if (!studentId || seen.has(studentId)) {
      return;
    }
    seen.add(studentId);
    list.push(item);
  });
  return list;
};

const applySubscriptionOptimisticPatch = (studentId: string, subscribed: boolean, minRevision = 0) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!normalizedStudentId) {
    return;
  }
  patchDashboard((current) => {
    if (!current) {
      return current;
    }
    const meStudentId = normalizeStudentId(current.me?.studentId);
    const subscriptionRows = [...(current.subscriptions || [])];
    const candidateRows = [...(current.candidates || [])];
    const existingSubscription = subscriptionRows.find((item) => normalizeStudentId(item.studentId) === normalizedStudentId) || null;
    const existingCandidate = candidateRows.find((item) => normalizeStudentId(item.studentId) === normalizedStudentId) || null;
    if (subscribed) {
      const target = existingSubscription || existingCandidate;
      if (!target) {
        return {
          ...current,
          stateRevision: Math.max(Number(current.stateRevision || 0), Number(minRevision || 0)),
        };
      }
      const nextSubscriptions = dedupeUsers([...subscriptionRows, target]);
      const nextCandidates = candidateRows.filter((item) => normalizeStudentId(item.studentId) !== normalizedStudentId);
      return {
        ...current,
        subscriptions: nextSubscriptions,
        candidates: nextCandidates,
        stateRevision: Math.max(Number(current.stateRevision || 0), Number(minRevision || 0)),
      };
    }
    const nextSubscriptions = subscriptionRows.filter((item) => normalizeStudentId(item.studentId) !== normalizedStudentId);
    const removed = existingSubscription;
    const nextCandidates = [...candidateRows];
    if (
      removed &&
      normalizeStudentId(removed.studentId) !== meStudentId &&
      !nextCandidates.some((item) => normalizeStudentId(item.studentId) === normalizedStudentId)
    ) {
      nextCandidates.unshift(removed);
    }
    return {
      ...current,
      subscriptions: dedupeUsers(nextSubscriptions),
      candidates: dedupeUsers(nextCandidates),
      stateRevision: Math.max(Number(current.stateRevision || 0), Number(minRevision || 0)),
    };
  });
};

const refreshDashboard = async () => {
  if (!isAuthed.value) {
    clearDashboard(true);
    return;
  }
  await refreshSocialDashboardData(() =>
    requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/v1/social/me", {}, authSession.value.token),
    backendBaseUrl.value,
  );
};

const refreshState = async () => {
  bootstrapping.value = true;
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  brokenAvatarKeys.value = {};
  pendingByStudentId.value = {};
  try {
    await refreshDashboard();
  } catch (error) {
    if (!hydrateDashboardFromStorage(backendBaseUrl.value)) {
      clearDashboard();
    }
  } finally {
    bootstrapping.value = false;
  }
};

const goAccountPage = () => {
  uni.navigateTo({ url: "/pages/profile/account" });
};

const canShowAvatar = (key: string, avatarUrl: unknown) => {
  const normalizedKey = String(key || "").trim();
  const normalizedUrl = String(avatarUrl || "").trim();
  if (!normalizedKey || !normalizedUrl) {
    return false;
  }
  return !Boolean(brokenAvatarKeys.value[normalizedKey]);
};

const onAvatarLoadError = (key: string) => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return;
  }
  brokenAvatarKeys.value = {
    ...brokenAvatarKeys.value,
    [normalizedKey]: true,
  };
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

const subscribeStudent = async (studentId: string) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!isAuthed.value || disableMutations.value || isTargetPending(normalizedStudentId)) {
    return;
  }
  setTargetPending(normalizedStudentId, true);
  try {
    let mutationRevision = 0;
    try {
      const payload = await requestBackendPost<SocialSubscribeMutationResponse>(
        backendBaseUrl.value,
        "/api/v1/social/subscribe",
        { targetStudentId: normalizedStudentId },
        authSession.value.token,
      );
      mutationRevision = Number(payload.stateRevision || 0);
    } catch (error) {
      const firstMessage = error instanceof Error ? error.message : "订阅失败";
      if (!shouldPromptRandomCodeByMessage(firstMessage)) {
        throw error;
      }
      const code = await promptTargetRandomCode();
      if (code === null || !code) {
        return;
      }
      const payload = await requestBackendPost<SocialSubscribeMutationResponse>(
        backendBaseUrl.value,
        "/api/v1/social/subscribe",
        {
          targetStudentId: normalizedStudentId,
          targetRandomCode: code,
        },
        authSession.value.token,
      );
      mutationRevision = Number(payload.stateRevision || 0);
    }
    applySubscriptionOptimisticPatch(normalizedStudentId, true, mutationRevision);
    await refreshDashboard();
    uni.showToast({ title: "订阅成功", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "订阅失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    setTargetPending(normalizedStudentId, false);
  }
};

const toggleSubscribe = async (studentId: string) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!isAuthed.value || bootstrapping.value || isTargetPending(normalizedStudentId)) {
    return;
  }
  if (subscribedStudentIdSet.value.has(normalizedStudentId)) {
    await unsubscribe(normalizedStudentId);
    return;
  }
  await subscribeStudent(normalizedStudentId);
};

const unsubscribe = async (studentId: string) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!isAuthed.value || disableMutations.value || isTargetPending(normalizedStudentId)) {
    return;
  }
  setTargetPending(normalizedStudentId, true);
  try {
    const payload = await requestBackendPost<SocialSubscribeMutationResponse>(
      backendBaseUrl.value,
      "/api/v1/social/subscribe/remove",
      { targetStudentId: normalizedStudentId },
      authSession.value.token,
    );
    const mutationRevision = Number(payload.stateRevision || 0);
    applySubscriptionOptimisticPatch(normalizedStudentId, false, mutationRevision);
    await refreshDashboard();
    uni.showToast({ title: "已取消", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "取消失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    setTargetPending(normalizedStudentId, false);
  }
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

.title.small {
  font-size: 24rpx;
}

.sub {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.mini-grid {
  margin-top: 12rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8rpx;
}

.mini-item {
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx;
  background: var(--muted-bg);
}

.mini-key {
  font-size: 19rpx;
  color: var(--text-sub);
}

.mini-value {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-main);
}

.mini-value.code {
  letter-spacing: 2rpx;
}

.my-line {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.my-meta {
  flex: 1;
  min-width: 0;
}

.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 999rpx;
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
}

.avatar.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-sub);
  font-size: 22rpx;
}

.btn {
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx 12rpx;
  text-align: center;
  font-size: 22rpx;
  background: var(--accent);
  color: #ffffff;
}

.btn.ghost {
  background: var(--card-bg);
  color: var(--text-main);
}

.btn.pending {
  opacity: 0.64;
}

.empty {
  font-size: 21rpx;
  color: var(--text-sub);
}

.sub-item {
  margin-top: 10rpx;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.user-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.sub-name {
  font-size: 22rpx;
  color: var(--text-main);
  font-weight: 600;
}

.sub-meta {
  margin-top: 4rpx;
  font-size: 19rpx;
  color: var(--text-sub);
}

.sub-action {
  font-size: 20rpx;
  color: var(--accent);
  white-space: nowrap;
}

.sub-action.remove {
  color: var(--danger);
}

.sub-action.pending {
  opacity: 0.64;
}
</style>
