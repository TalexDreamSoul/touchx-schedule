<template>
  <PageViewContainer title="日历分类视图">
    <view class="card">
      <view class="title">分类日历</view>
      <view class="sub">基于标签和来源聚合课程、个人日程与活动，不复制底层数据。</view>
      <view class="week-row">
        <input v-model.number="week" class="input" type="number" />
        <view class="btn" @click="loadViews">刷新</view>
      </view>
      <view class="tabs">
        <view
          v-for="view in views"
          :key="view.key"
          class="tab"
          :class="{ active: activeViewKey === view.key }"
          @click="activeViewKey = view.key"
        >
          {{ view.label }} {{ view.count }}
        </view>
      </view>
    </view>

    <view v-if="pageError" class="card">
      <view class="empty">{{ pageError }}</view>
    </view>

    <view v-if="activeView" class="card">
      <view class="section-head">
        <view>
          <view class="title small">{{ activeView.label }}</view>
          <view class="sub">第 {{ week }} 周 · {{ activeView.count }} 项</view>
        </view>
      </view>
      <view v-if="activeView.items.length === 0" class="empty">暂无内容</view>
      <view v-for="item in activeView.items" :key="item.id" class="list-item">
        <view class="item-main">
          <view class="item-title">{{ item.title }}</view>
          <view class="sub">{{ item.subtitle || formatTime(item) }}</view>
          <view v-if="item.tags.length" class="tag-row">
            <view v-for="tag in item.tags" :key="`${item.id}-${tag}`" class="tag">{{ tag }}</view>
          </view>
        </view>
        <view class="source">{{ formatSource(item.source) }}</view>
      </view>
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
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

type CalendarViewKey = "learning" | "social" | "personal";

interface CalendarViewItem {
  id: string;
  source: string;
  title: string;
  subtitle: string;
  day: number;
  startSection: number;
  endSection: number;
  tags: string[];
}

interface CalendarViewBucket {
  key: CalendarViewKey;
  label: string;
  count: number;
  items: CalendarViewItem[];
}

interface CalendarViewsResponse {
  week: number;
  views: CalendarViewBucket[];
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const week = ref(1);
const views = ref<CalendarViewBucket[]>([]);
const activeViewKey = ref<CalendarViewKey>("learning");
const pageError = ref("");

const activeView = computed(() => views.value.find((item) => item.key === activeViewKey.value) || null);

const formatSource = (source: string) => {
  if (source === "course") {
    return "课程";
  }
  if (source === "activity") {
    return "活动";
  }
  if (source === "exam") {
    return "考试";
  }
  return "日程";
};

const formatTime = (item: CalendarViewItem) => {
  return `周${item.day} 第 ${item.startSection}-${item.endSection} 节`;
};

const loadViews = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token) {
    pageError.value = "请先登录后查看分类日历。";
    return;
  }
  try {
    const payload = await requestBackendGet<CalendarViewsResponse>(
      backendBaseUrl.value,
      "/api/v1/calendar/views",
      { week: String(Math.max(1, Number(week.value || 1))) },
      authSession.value.token,
    );
    week.value = payload.week || week.value;
    views.value = Array.isArray(payload.views) ? payload.views : [];
    if (!views.value.some((item) => item.key === activeViewKey.value)) {
      activeViewKey.value = views.value[0]?.key || "learning";
    }
    pageError.value = "";
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "分类日历加载失败";
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void loadViews();
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

.week-row,
.section-head,
.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.week-row {
  margin-top: 16rpx;
}

.input {
  flex: 1;
  min-width: 0;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 10rpx 12rpx;
  color: var(--text-main);
}

.btn {
  flex-shrink: 0;
  padding: 10rpx 16rpx;
  border-radius: 10rpx;
  background: var(--accent);
  color: #fff;
  font-size: 22rpx;
}

.tabs {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  overflow: hidden;
}

.tab {
  padding: 10rpx 8rpx;
  text-align: center;
  font-size: 21rpx;
  color: var(--text-sub);
  background: var(--muted-bg);
}

.tab.active {
  color: #fff;
  background: var(--accent);
}

.list-item {
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 1rpx solid var(--line);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--text-main);
}

.source {
  flex-shrink: 0;
  font-size: 21rpx;
  color: var(--text-sub);
}

.tag-row {
  margin-top: 8rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 6rpx;
}

.tag {
  padding: 3rpx 8rpx;
  border-radius: 8rpx;
  font-size: 18rpx;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--muted-bg) 90%);
}
</style>
