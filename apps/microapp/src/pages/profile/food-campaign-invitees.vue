<template>
  <PageContainer title="选择参与人">
    <view class="page">
      <view v-if="!isAuthed" class="card">
        <view class="empty">请先在账号页完成登录授权。</view>
      </view>

      <view v-else class="card">
        <view class="title-row">
          <view class="title">可邀请用户</view>
          <view class="sub">已选 {{ selectedStudentIds.length }} 人</view>
        </view>
        <input v-model.trim="searchKeyword" class="input" type="text" placeholder="搜索姓名 / 学号 ID" />
        <view class="inline-actions">
          <button class="btn mini ghost" @click="selectAllVisible">全选可见</button>
          <button class="btn mini ghost" @click="clearSelected" :disabled="selectedStudentIds.length === 0">清空</button>
        </view>

        <view v-if="loading" class="empty">加载中...</view>
        <view v-else-if="filteredCandidates.length === 0" class="empty">没有符合条件的用户</view>
        <view v-else class="list">
          <view
            v-for="item in filteredCandidates"
            :key="item.studentId"
            class="candidate-item"
            @click="toggleSelected(item.studentId)"
          >
            <view class="candidate-main">
              <view class="candidate-name">{{ item.name || item.studentId }}</view>
              <view class="candidate-meta">{{ item.studentId }}<text v-if="item.classLabel"> · {{ item.classLabel }}</text></view>
            </view>
            <view class="check" :class="{ active: selectedSet.has(item.studentId) }">
              {{ selectedSet.has(item.studentId) ? "✓" : "" }}
            </view>
          </view>
        </view>
      </view>

      <view class="card">
        <button class="btn" @click="confirmSelection">确认并返回</button>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import {
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendGet,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

interface SocialUserItem {
  studentId: string;
  name: string;
  classLabel?: string;
}

interface SocialDashboardResponse {
  me?: SocialUserItem | null;
  candidates?: SocialUserItem[];
}

interface InviteeStoragePayload {
  selectedStudentIds: string[];
}

const FOOD_CAMPAIGN_INVITEE_STORAGE_KEY = "touchx_food_campaign_invitees";

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const loading = ref(false);
const searchKeyword = ref("");
const candidates = ref<SocialUserItem[]>([]);
const selectedStudentIds = ref<string[]>([]);

const isAuthed = computed(() => Boolean(authSession.value.token && authSession.value.user));
const currentStudentId = computed(() => String(authSession.value.user?.studentId || "").trim());
const selectedSet = computed(() => new Set(selectedStudentIds.value));

const normalizeStudentIds = (values: unknown[]) => {
  const result: string[] = [];
  for (const value of values) {
    const studentId = String(value || "").trim();
    if (!studentId || result.includes(studentId)) {
      continue;
    }
    result.push(studentId);
  }
  return result;
};

const parseStudentIdsFromText = (value: string) => {
  return normalizeStudentIds(String(value || "").split(/[,，\s\n]+/));
};

const filteredCandidates = computed(() => {
  const keyword = String(searchKeyword.value || "").trim().toLowerCase();
  if (!keyword) {
    return candidates.value;
  }
  return candidates.value.filter((item) => {
    const name = String(item.name || "").toLowerCase();
    const studentId = String(item.studentId || "").toLowerCase();
    return name.includes(keyword) || studentId.includes(keyword);
  });
});

const refreshAuthState = () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
};

const loadCandidates = async () => {
  if (!isAuthed.value) {
    candidates.value = [];
    return;
  }
  loading.value = true;
  try {
    const data = await requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/v1/social/me", {}, authSession.value.token);
    const merged = new Map<string, SocialUserItem>();
    for (const item of data.candidates || []) {
      const studentId = String(item?.studentId || "").trim();
      if (!studentId || studentId === currentStudentId.value || merged.has(studentId)) {
        continue;
      }
      merged.set(studentId, item);
    }
    const meStudentId = String(data.me?.studentId || "").trim();
    if (meStudentId && meStudentId !== currentStudentId.value && !merged.has(meStudentId)) {
      merged.set(meStudentId, data.me as SocialUserItem);
    }
    candidates.value = Array.from(merged.values());
  } finally {
    loading.value = false;
  }
};

const toggleSelected = (studentId: string) => {
  const normalized = String(studentId || "").trim();
  if (!normalized) {
    return;
  }
  const next = new Set(selectedStudentIds.value);
  if (next.has(normalized)) {
    next.delete(normalized);
  } else {
    next.add(normalized);
  }
  selectedStudentIds.value = Array.from(next);
};

const selectAllVisible = () => {
  const next = new Set(selectedStudentIds.value);
  for (const item of filteredCandidates.value) {
    const studentId = String(item.studentId || "").trim();
    if (!studentId) {
      continue;
    }
    next.add(studentId);
  }
  selectedStudentIds.value = Array.from(next);
};

const clearSelected = () => {
  selectedStudentIds.value = [];
};

const confirmSelection = () => {
  const payload: InviteeStoragePayload = { selectedStudentIds: normalizeStudentIds(selectedStudentIds.value) };
  uni.setStorageSync(FOOD_CAMPAIGN_INVITEE_STORAGE_KEY, payload);
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.navigateTo({ url: "/pages/profile/food-campaign" });
};

onLoad((query) => {
  const selectedRaw = query?.selected;
  if (Array.isArray(selectedRaw)) {
    selectedStudentIds.value = normalizeStudentIds(selectedRaw);
    return;
  }
  selectedStudentIds.value = parseStudentIdsFromText(String(selectedRaw || ""));
});

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  refreshAuthState();
  void loadCandidates().catch((error) => {
    const message = error instanceof Error ? error.message : "加载失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  });
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
  padding: 18rpx 16rpx;
  margin-bottom: 12rpx;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.sub {
  font-size: 22rpx;
  color: var(--text-sub);
}

.input {
  margin-top: 10rpx;
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 25rpx;
  padding: 12rpx;
}

.inline-actions {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.list {
  margin-top: 10rpx;
}

.candidate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 12rpx;
  margin-top: 8rpx;
}

.candidate-main {
  flex: 1;
  min-width: 0;
}

.candidate-name {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text-main);
}

.candidate-meta {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.check {
  width: 34rpx;
  height: 34rpx;
  border-radius: 8rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  flex: 0 0 34rpx;
}

.check.active {
  border-color: color-mix(in srgb, var(--accent) 65%, #ffffff 35%);
  background: color-mix(in srgb, var(--accent) 12%, #ffffff 88%);
}

.empty {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.btn {
  width: 100%;
  border: none;
  border-radius: 10rpx;
  padding: 14rpx 12rpx;
  font-size: 26rpx;
  background: var(--accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
}

.btn.mini {
  width: auto;
  min-width: 92rpx;
  padding: 8rpx 14rpx;
  font-size: 22rpx;
}

.btn.ghost {
  background: var(--muted-bg);
  color: var(--text-main);
  border: 1rpx solid var(--line);
}
</style>
