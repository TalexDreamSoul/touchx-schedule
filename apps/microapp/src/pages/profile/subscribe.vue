<template>
  <PageViewContainer title="通知与订阅">
      <template v-if="!isBound">
        <view class="card">
          <view class="sub">订阅他人课表会先发送请求，对方可选择仅忙闲或详细日程。</view>
        </view>
        <view class="card">
          <view class="empty">请先在“账号与授权”页面绑定一个课表账号。</view>
          <view class="btn" @click="goAccountPage">去绑定</view>
        </view>
      </template>

      <template v-else>
        <view class="card">
          <view class="sub">订阅他人课表会先发送请求，对方同意后才会出现在共同空闲里。</view>
        </view>

        <view class="card">
          <view class="mini-grid">
            <view class="mini-item">
              <view class="mini-key">我的订阅</view>
              <view class="mini-value">{{ subscriptions.length }} 人</view>
            </view>
            <view class="mini-item">
              <view class="mini-key">待我处理</view>
              <view class="mini-value">{{ inboundPendingRequests.length }} 条</view>
            </view>
            <view class="mini-item">
              <view class="mini-key">未读通知</view>
              <view class="mini-value">{{ dashboard?.unreadNotificationCount || 0 }} 条</view>
            </view>
            <view class="mini-item">
              <view class="mini-key">我的圈子</view>
              <view class="mini-value">{{ dashboard?.circles?.length || 0 }} 个</view>
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
          <view class="section-head">
            <view>
              <view class="title small">通知（{{ notifications.length }}）</view>
              <view class="sub">订阅、圈子和组局事件会进入离线通知队列。</view>
            </view>
          </view>
          <view v-if="notifications.length === 0" class="empty">暂无通知</view>
          <view v-for="item in notifications" :key="item.notificationId" class="sub-item">
            <view>
              <view class="sub-name">{{ item.title }}</view>
              <view class="sub-meta">{{ item.body }}</view>
            </view>
            <view v-if="item.status === 'unread'" class="sub-action" @click="markNotificationRead(item.notificationId)">已读</view>
          </view>
        </view>

        <view class="card">
          <view class="section-head">
            <view>
              <view class="title small">待处理请求（{{ inboundPendingRequests.length }}）</view>
              <view class="sub">同意后，对方才能把你加入共同空闲对比。</view>
            </view>
          </view>
          <view v-if="inboundPendingRequests.length === 0" class="empty">暂无待处理订阅请求</view>
          <view v-for="item in inboundPendingRequests" :key="item.requestId" class="sub-item">
            <view class="user-line">
              <view class="avatar placeholder">{{ item.requester?.name?.slice(0, 1) || "同" }}</view>
              <view>
                <view class="sub-name">{{ item.requester?.name || "同学" }}</view>
                <view class="sub-meta">申请查看：{{ formatVisibility(item.requestedVisibility) }}</view>
              </view>
            </view>
            <view class="action-row">
              <view class="sub-action" :class="{ pending: disableMutations }" @click="acceptRequest(item.requestId)">同意</view>
              <view class="sub-action remove" :class="{ pending: disableMutations }" @click="rejectRequest(item.requestId)">拒绝</view>
            </view>
          </view>
        </view>

        <view class="card">
          <view class="section-head">
            <view>
              <view class="title small">圈子（{{ dashboard?.circles?.length || 0 }}）</view>
              <view class="sub">退出圈子后，你的日程会立即对圈内成员不可见。</view>
            </view>
            <view class="sub-action" @click="createCircle">新建</view>
          </view>
          <view v-if="!dashboard?.circles?.length" class="empty">暂无圈子</view>
          <view v-for="item in dashboard?.circles || []" :key="item.circleId" class="sub-item">
            <view>
              <view class="sub-name">{{ item.name }}</view>
              <view class="sub-meta">成员 {{ item.memberCount || 1 }} 人 · 邀请码 {{ item.inviteToken || "--" }}</view>
            </view>
            <view class="action-row compact">
              <view class="sub-action" @click="copyCircleInvite(item)">邀请</view>
              <view class="sub-action remove" @click="leaveCircle(item.circleId)">退出</view>
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
                  : (subscribedStudentIdSet.has(item.studentId) ? "取消订阅" : pendingRequestStudentIdSet.has(item.studentId) ? "已请求" : "请求订阅")
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
            <view class="action-row compact">
              <view
                class="sub-action remove"
                :class="{ pending: disableMutations }"
                @click="unsubscribe(item.studentId)"
              >
                {{ disableMutations ? "处理中..." : "取消" }}
              </view>
              <view
                class="sub-action danger"
                :class="{ pending: disableMutations }"
                @click="blockStudent(item.studentId)"
              >
                屏蔽
              </view>
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
import {
  useSocialDashboard,
  type SocialDashboardResponse,
  type SocialCircleItem,
  type SocialUserItem,
} from "@/composables/useSocialDashboard";
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
const notifications = ref<SocialNotificationItem[]>([]);

interface SocialSubscribeMutationResponse {
  ok?: boolean;
  subscribed?: boolean;
  pending?: boolean;
  removed?: boolean;
  stateRevision?: number;
}

interface SocialNotificationItem {
  notificationId: string;
  title: string;
  body: string;
  status: "unread" | "read";
}

interface SocialNotificationsResponse {
  items: SocialNotificationItem[];
}

const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));
const isBound = computed(() => Boolean(dashboard.value?.me?.studentId));
const hasPendingMutation = computed(() => Object.values(pendingByStudentId.value).some((value) => Boolean(value)));
const disableMutations = computed(() => bootstrapping.value || hasPendingMutation.value);
const inboundPendingRequests = computed(() => {
  const meStudentId = normalizeStudentId(dashboard.value?.me?.studentId);
  return (dashboard.value?.subscriptionRequests || []).filter((item) => {
    return item.status === "pending" && normalizeStudentId(item.target?.studentId) === meStudentId;
  });
});
const pendingRequestStudentIdSet = computed(() => {
  const meStudentId = normalizeStudentId(dashboard.value?.me?.studentId);
  return new Set(
    (dashboard.value?.subscriptionRequests || [])
      .filter((item) => item.status === "pending" && normalizeStudentId(item.requester?.studentId) === meStudentId)
      .map((item) => normalizeStudentId(item.target?.studentId))
      .filter((item) => item),
  );
});

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
    notifications.value = [];
    return;
  }
  await refreshSocialDashboardData(() =>
    requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/v1/social/me", {}, authSession.value.token),
    backendBaseUrl.value,
  );
};

const refreshNotifications = async () => {
  if (!isAuthed.value) {
    notifications.value = [];
    return;
  }
  const payload = await requestBackendGet<SocialNotificationsResponse>(
    backendBaseUrl.value,
    "/api/v1/notifications",
    { limit: "20" },
    authSession.value.token,
  );
  notifications.value = payload.items || [];
};

const refreshState = async () => {
  bootstrapping.value = true;
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  brokenAvatarKeys.value = {};
  pendingByStudentId.value = {};
  try {
    await refreshDashboard();
    await refreshNotifications();
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

const formatVisibility = (value: unknown) => {
  if (value === "detail") {
    return "详细日程";
  }
  if (value === "hidden" || value === "blocked") {
    return "不可见";
  }
  return "仅忙闲";
};

const subscribeStudent = async (studentId: string) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!isAuthed.value || disableMutations.value || isTargetPending(normalizedStudentId)) {
    return;
  }
  setTargetPending(normalizedStudentId, true);
  try {
    const payload = await requestBackendPost<SocialSubscribeMutationResponse>(
      backendBaseUrl.value,
      "/api/v1/social/subscription-requests",
      { targetStudentId: normalizedStudentId, visibilityScope: "busy_free" },
      authSession.value.token,
    );
    const mutationRevision = Number(payload.stateRevision || 0);
    if (payload.subscribed) {
      applySubscriptionOptimisticPatch(normalizedStudentId, true, mutationRevision);
    }
    await refreshDashboard();
    uni.showToast({ title: payload.pending ? "请求已发送" : "订阅成功", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "订阅失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    setTargetPending(normalizedStudentId, false);
  }
};

const decideRequest = async (requestId: string, decision: "accept" | "reject", visibilityScope = "busy_free") => {
  if (!requestId || disableMutations.value) {
    return;
  }
  pendingByStudentId.value = {
    ...pendingByStudentId.value,
    [`request-${requestId}`]: true,
  };
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      `/api/v1/social/subscription-requests/${encodeURIComponent(requestId)}/decision`,
      { decision, visibilityScope },
      authSession.value.token,
    );
    await refreshDashboard();
    uni.showToast({ title: decision === "accept" ? "已同意" : "已拒绝", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "处理失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    const next = { ...pendingByStudentId.value };
    delete next[`request-${requestId}`];
    pendingByStudentId.value = next;
  }
};

const acceptRequest = (requestId: string) => {
  uni.showActionSheet({
    itemList: ["仅忙闲", "详细日程"],
    success: (result) => {
      const visibilityScope = result.tapIndex === 1 ? "detail" : "busy_free";
      void decideRequest(requestId, "accept", visibilityScope);
    },
  });
};

const rejectRequest = (requestId: string) => {
  void decideRequest(requestId, "reject", "hidden");
};

const createCircle = () => {
  if (!isAuthed.value || disableMutations.value) {
    return;
  }
  uni.showModal({
    title: "新建圈子",
    editable: true,
    placeholderText: "班级/社团名称",
    success: async (result) => {
      if (!result.confirm) {
        return;
      }
      const name = String((result as { content?: string }).content || "").trim();
      if (!name) {
        uni.showToast({ title: "请输入圈子名称", icon: "none", duration: 1600 });
        return;
      }
      try {
        await requestBackendPost(backendBaseUrl.value, "/api/v1/social/circles", { name, circleType: "custom" }, authSession.value.token);
        await refreshDashboard();
        uni.showToast({ title: "圈子已创建", icon: "none", duration: 1200 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "创建失败";
        uni.showToast({ title: message, icon: "none", duration: 1800 });
      }
    },
  });
};

const leaveCircle = async (circleId: string) => {
  if (!circleId || disableMutations.value) {
    return;
  }
  try {
    await requestBackendPost(backendBaseUrl.value, `/api/v1/social/circles/${encodeURIComponent(circleId)}/leave`, {}, authSession.value.token);
    await refreshDashboard();
    uni.showToast({ title: "已退出圈子", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "退出失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  }
};

const buildCircleJoinUrl = (item: SocialCircleItem) => {
  const token = normalizeStudentId(item.inviteToken);
  if (!token) {
    return "";
  }
  return `/pages/profile/circle-join?token=${encodeURIComponent(token)}`;
};

const copyCircleInvite = (item: SocialCircleItem) => {
  const path = buildCircleJoinUrl(item);
  if (!path) {
    uni.showToast({ title: "邀请码缺失", icon: "none", duration: 1600 });
    return;
  }
  const text = `${item.name} 邀请链接：${path}`;
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: "邀请链接已复制", icon: "none", duration: 1200 }),
  });
};

const markNotificationRead = async (notificationId: string) => {
  if (!notificationId || disableMutations.value) {
    return;
  }
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
      {},
      authSession.value.token,
    );
    await refreshNotifications();
    await refreshDashboard();
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
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
  if (pendingRequestStudentIdSet.value.has(normalizedStudentId)) {
    uni.showToast({ title: "订阅请求已发送", icon: "none", duration: 1200 });
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

const blockStudent = async (studentId: string) => {
  const normalizedStudentId = normalizeStudentId(studentId);
  if (!isAuthed.value || disableMutations.value || isTargetPending(normalizedStudentId)) {
    return;
  }
  uni.showModal({
    title: "屏蔽订阅",
    content: "屏蔽后双方课表互不可见，可重新发起订阅请求恢复。",
    success: async (result) => {
      if (!result.confirm) {
        return;
      }
      setTargetPending(normalizedStudentId, true);
      try {
        await requestBackendPost(
          backendBaseUrl.value,
          "/api/v1/social/subscriptions/block",
          { targetStudentId: normalizedStudentId },
          authSession.value.token,
        );
        applySubscriptionOptimisticPatch(normalizedStudentId, false);
        await refreshDashboard();
        uni.showToast({ title: "已屏蔽", icon: "none", duration: 1200 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "屏蔽失败";
        uni.showToast({ title: message, icon: "none", duration: 1800 });
      } finally {
        setTargetPending(normalizedStudentId, false);
      }
    },
  });
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

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12rpx;
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

.sub-action.danger {
  color: #ffffff;
  border-radius: 8rpx;
  padding: 8rpx 10rpx;
  background: var(--danger);
}

.sub-action.pending {
  opacity: 0.64;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.action-row.compact {
  flex-shrink: 0;
  gap: 10rpx;
}
</style>
