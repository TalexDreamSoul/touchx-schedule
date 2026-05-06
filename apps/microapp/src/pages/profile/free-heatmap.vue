<template>
  <PageViewContainer title="共同空闲热力图">
    <view class="card">
      <view class="title">圈子/订阅空闲密度</view>
      <view class="sub">基于你和已订阅对象的忙闲聚合，颜色越深代表越多人空闲。</view>
      <view class="week-row">
        <input v-model.number="week" class="input" type="number" />
        <view class="btn" @click="loadHeatmap">刷新</view>
      </view>
      <view class="mode-row">
        <view class="mode-chip" :class="{ active: selectedScope === 'subscriptions' }" @click="selectSubscriptions">订阅分组</view>
        <view
          v-for="circle in circles"
          :key="circle.circleId"
          class="mode-chip"
          :class="{ active: selectedScope === 'circle' && selectedCircleId === circle.circleId }"
          @click="selectCircle(circle.circleId)"
        >
          {{ circle.name }}
        </view>
      </view>
    </view>

    <view v-if="pageError" class="card">
      <view class="empty">{{ pageError }}</view>
    </view>

    <view v-if="heatmap" class="card">
      <view class="title small">第 {{ heatmap.week }} 周 · {{ heatmap.participantCount }} 人</view>
      <view class="heat-grid">
        <view v-for="cell in heatmap.cells" :key="`${cell.day}-${cell.section}`" class="heat-cell" :style="cellStyle(cell.freeRatio)">
          <view class="heat-main">周{{ cell.day }}-{{ cell.section }}</view>
          <view class="heat-sub">{{ cell.freeCount }}/{{ cell.totalCount }}</view>
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
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

interface SocialMeResponse {
  me?: { studentId?: string };
  subscriptions?: Array<{
    studentId: string;
    relationStatus?: {
      status?: string;
      visibilityScope?: string;
    };
    visibilityScope?: string;
  }>;
  circles?: Array<{ circleId: string; name: string; memberCount?: number }>;
}

interface HeatmapCell {
  day: number;
  section: number;
  totalCount: number;
  freeCount: number;
  freeRatio: number;
}

interface HeatmapPayload {
  week: number;
  participantCount: number;
  cells: HeatmapCell[];
}

interface HeatmapResponse {
  heatmap: HeatmapPayload;
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const week = ref(1);
const heatmap = ref<HeatmapPayload | null>(null);
const circles = ref<Array<{ circleId: string; name: string; memberCount?: number }>>([]);
const selectedScope = ref<"subscriptions" | "circle">("subscriptions");
const selectedCircleId = ref("");
const pageError = ref("");

const cellStyle = (ratio: number) => {
  const alpha = Math.max(0.08, Math.min(0.9, Number(ratio || 0)));
  return {
    background: `rgba(47, 85, 200, ${alpha})`,
    color: alpha > 0.45 ? "#ffffff" : "var(--text-main)",
  };
};

const selectSubscriptions = () => {
  selectedScope.value = "subscriptions";
  selectedCircleId.value = "";
  void loadHeatmap();
};

const selectCircle = (circleId: string) => {
  selectedScope.value = "circle";
  selectedCircleId.value = circleId;
  void loadHeatmap();
};

const loadHeatmap = async () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
  if (!authSession.value.token) {
    pageError.value = "请先登录后查看热力图。";
    return;
  }
  try {
    const social = await requestBackendGet<SocialMeResponse>(
      backendBaseUrl.value,
      "/api/v1/social/me",
      {},
      authSession.value.token,
    );
    circles.value = social.circles || [];
    if (selectedScope.value === "circle" && !circles.value.some((item) => item.circleId === selectedCircleId.value)) {
      selectedScope.value = "subscriptions";
      selectedCircleId.value = "";
    }
    const studentIds = (social.subscriptions || [])
      .filter((item) => {
        const status = item.relationStatus?.status || "none";
        const visibilityScope = item.relationStatus?.visibilityScope || item.visibilityScope || "hidden";
        return status === "subscribed" && (visibilityScope === "busy_free" || visibilityScope === "detail");
      })
      .map((item) => item.studentId)
      .filter((item) => item);
    const params: Record<string, string> = {
      week: String(Math.max(1, Number(week.value || 1))),
    };
    if (selectedScope.value === "circle" && selectedCircleId.value) {
      params.circleId = selectedCircleId.value;
    } else {
      params.studentIds = studentIds.join(",");
    }
    const payload = await requestBackendGet<HeatmapResponse>(
      backendBaseUrl.value,
      "/api/v1/social/free-heatmap",
      params,
      authSession.value.token,
    );
    heatmap.value = payload.heatmap;
    pageError.value = "";
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "热力图加载失败";
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void loadHeatmap();
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
}

.week-row {
  margin-top: 14rpx;
  display: flex;
  gap: 10rpx;
}

.mode-row {
  margin-top: 14rpx;
  display: flex;
  gap: 8rpx;
  overflow-x: auto;
}

.mode-chip {
  flex-shrink: 0;
  padding: 8rpx 12rpx;
  border-radius: 8rpx;
  border: 1rpx solid var(--line);
  color: var(--text-sub);
  font-size: 21rpx;
  background: var(--muted-bg);
}

.mode-chip.active {
  color: #fff;
  border-color: var(--accent);
  background: var(--accent);
}

.input {
  flex: 1;
  min-height: 64rpx;
  padding: 0 14rpx;
  border-radius: 8rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
}

.btn {
  min-width: 150rpx;
  border-radius: 8rpx;
  padding: 14rpx 10rpx;
  text-align: center;
  font-size: 22rpx;
  color: #ffffff;
  background: var(--accent);
}

.heat-grid {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6rpx;
}

.heat-cell {
  min-height: 66rpx;
  border-radius: 8rpx;
  padding: 8rpx 4rpx;
  text-align: center;
  box-sizing: border-box;
}

.heat-main {
  font-size: 18rpx;
  font-weight: 700;
}

.heat-sub {
  margin-top: 4rpx;
  font-size: 17rpx;
}
</style>
