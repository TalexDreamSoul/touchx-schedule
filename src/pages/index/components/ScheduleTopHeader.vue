<template>
  <view class="top-safe-bar" :style="{ height: `${topSafeInset}px`, paddingTop: `${capsuleTopOffset}px` }">
    <view
      v-if="isScheduleTab"
      class="safe-week-row"
      :style="{ gridTemplateColumns: `${leftActionsReserve}px 1fr ${capsuleReserveRight}px`, minHeight: `${capsuleHeight}px` }"
    >
      <view class="safe-left-actions">
        <view class="setting-btn inline" @click="emit('include-click')">
          <view class="gear-icon" />
        </view>
      </view>
      <view class="safe-week-center">
        <view class="safe-week-info">
          <text class="week-main compact" @click="emit('week-click')">第 {{ selectedWeek }} 周</text>
          <text class="week-sub compact">{{ weekRangeLabel }}</text>
        </view>
      </view>
      <view class="safe-right-spacer" />
    </view>
    <view
      v-else-if="headerTitle"
      class="safe-title-row"
      :style="{ gridTemplateColumns: `${titleSideReserve}px 1fr ${titleSideReserve}px`, minHeight: `${capsuleHeight}px` }"
    >
      <view class="safe-left-spacer" />
      <view class="safe-title-main">{{ headerTitle }}</view>
      <view class="safe-right-spacer" />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  isScheduleTab: boolean;
  topSafeInset: number;
  capsuleTopOffset: number;
  leftActionsReserve: number;
  capsuleReserveRight: number;
  capsuleHeight: number;
  selectedWeek: number;
  weekRangeLabel: string;
  headerTitle: string;
}>();

const titleSideReserve = computed(() => {
  return Math.max(Number(props.leftActionsReserve || 0), Number(props.capsuleReserveRight || 0));
});

const emit = defineEmits<{
  (event: "include-click"): void;
  (event: "week-click"): void;
}>();
</script>

<style scoped>
.top-safe-bar {
  width: 100%;
  box-sizing: border-box;
  padding-left: 16rpx;
  padding-right: 16rpx;
}

.safe-week-row {
  width: 100%;
  display: grid;
  align-items: center;
  column-gap: 10rpx;
}

.safe-left-actions {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.safe-week-center {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.safe-week-info {
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 12rpx;
  white-space: nowrap;
}

.safe-right-spacer {
  min-height: 1px;
}

.safe-title-row {
  width: 100%;
  display: grid;
  align-items: center;
}

.safe-title-main {
  min-width: 0;
  font-size: 31rpx;
  font-weight: 400;
  line-height: 1.08;
  color: var(--text-main);
  text-align: center;
  opacity: 0.78;
}

.safe-left-spacer {
  min-height: 1px;
}

.week-main {
  padding: 4rpx 6rpx;
  text-align: center;
  font-size: 31rpx;
  font-weight: 700;
  color: var(--text-main);
}

.week-main.compact {
  font-size: 42rpx;
  line-height: 1.05;
  padding: 0;
  font-weight: 700;
  white-space: nowrap;
}

.week-sub.compact {
  margin-top: 0;
  font-size: 20rpx;
  line-height: 1.1;
  color: var(--text-sub);
  white-space: nowrap;
}

.setting-btn.inline {
  width: 52rpx;
  height: 40rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.gear-icon {
  width: 18rpx;
  height: 18rpx;
  border: 2rpx solid currentColor;
  border-radius: 999rpx;
  position: relative;
}

.gear-icon::before,
.gear-icon::after {
  content: "";
  position: absolute;
  inset: -5rpx 7rpx;
  border-top: 2rpx solid currentColor;
  border-bottom: 2rpx solid currentColor;
}

.gear-icon::after {
  inset: 7rpx -5rpx;
  border: none;
  border-left: 2rpx solid currentColor;
  border-right: 2rpx solid currentColor;
}

.week-sub {
  margin-top: 2rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}
</style>
