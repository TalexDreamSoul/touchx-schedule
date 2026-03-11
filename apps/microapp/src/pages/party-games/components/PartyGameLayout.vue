<template>
  <PageContainer :title="title" :theme-key="themeKey">
    <view class="pg-page">
      <view class="pg-card pg-hero">
        <view class="pg-hero-head">
          <view class="pg-title">{{ title }}</view>
          <view class="pg-badge">{{ playerRange }}</view>
        </view>
        <view class="pg-subtitle">{{ subtitle }}</view>
        <view class="pg-meta">建议时长：{{ duration }}</view>
        <view class="pg-tip">主持建议：{{ hostTip }}</view>
      </view>

      <view class="pg-card">
        <view class="pg-section-title">玩法说明</view>
        <view class="pg-how-list">
          <view v-for="(item, index) in howToPlay" :key="`how-${index}`" class="pg-how-item">
            <text class="pg-how-index">{{ index + 1 }}</text>
            <text class="pg-how-text">{{ item }}</text>
          </view>
        </view>
      </view>

      <slot />
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import PageContainer from "@/components/PageContainer.vue";

defineProps<{
  title: string;
  subtitle: string;
  playerRange: string;
  duration: string;
  hostTip: string;
  howToPlay: string[];
  themeKey: "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
}>();
</script>

<style scoped>
.pg-page {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.pg-card {
  background: color-mix(in srgb, var(--card-bg) 92%, #ffffff 8%);
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  padding: 18rpx;
}

.pg-hero {
  background: linear-gradient(145deg, color-mix(in srgb, var(--card-bg) 88%, var(--accent) 12%), var(--card-bg));
}

.pg-hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.pg-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--text-main);
}

.pg-badge {
  font-size: 22rpx;
  color: var(--accent);
  border: 1rpx solid color-mix(in srgb, var(--accent) 58%, var(--line) 42%);
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
}

.pg-subtitle {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.pg-meta {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.pg-tip {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--text-main);
  background: color-mix(in srgb, var(--muted-bg) 80%, var(--card-bg) 20%);
  border-radius: 10rpx;
  padding: 10rpx 12rpx;
}

.pg-section-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.pg-how-list {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.pg-how-item {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}

.pg-how-index {
  width: 34rpx;
  height: 34rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 34rpx;
  text-align: center;
  color: #ffffff;
  background: var(--accent);
  flex-shrink: 0;
}

.pg-how-text {
  font-size: 24rpx;
  line-height: 1.55;
  color: var(--text-main);
}
</style>
