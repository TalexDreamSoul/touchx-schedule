<template>
  <view class="bottom-nav">
    <view class="bottom-nav-indicator-layer">
      <view class="bottom-nav-indicator" :style="indicatorStyle">
        <view :key="props.activeTab" class="bottom-nav-indicator-inner" />
      </view>
    </view>
    <view
      v-for="item in navItems"
      :key="item.key"
      class="bottom-nav-item"
      :class="{ active: activeTab === item.key }"
      @click="emit('change', item.key)"
    >
      <text class="bottom-nav-text">{{ item.label }}</text>
      <view class="bottom-nav-line-placeholder" />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from "vue";

interface NavItem {
  key: string;
  label: string;
}

const props = defineProps<{
  navItems: NavItem[];
  activeTab: string;
}>();

const emit = defineEmits<{
  (event: "change", tabKey: string): void;
}>();

const activeIndex = computed(() => {
  const index = props.navItems.findIndex((item) => item.key === props.activeTab);
  return index >= 0 ? index : 0;
});

const indicatorStyle = computed(() => {
  const itemCount = Math.max(props.navItems.length, 1);
  return {
    width: `${100 / itemCount}%`,
    transform: `translateX(${activeIndex.value * 100}%)`
  };
});
</script>

<style scoped>
.bottom-nav {
  --indicator-offset: 28rpx;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 108rpx;
  height: calc(108rpx + env(safe-area-inset-bottom));
  height: calc(108rpx + constant(safe-area-inset-bottom));
  display: flex;
  box-sizing: border-box;
  padding-bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: constant(safe-area-inset-bottom);
  background: var(--card-bg);
  border-top: 1rpx solid var(--line);
  z-index: 60;
}

.bottom-nav-indicator-layer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  bottom: env(safe-area-inset-bottom);
  bottom: constant(safe-area-inset-bottom);
  height: 108rpx;
  pointer-events: none;
}

.bottom-nav-indicator {
  position: absolute;
  left: 0;
  bottom: var(--indicator-offset);
  display: flex;
  justify-content: center;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.bottom-nav-indicator-inner {
  width: 42rpx;
  height: 8rpx;
  border-radius: 8rpx;
  background: var(--line-strong);
  animation: indicator-width-pop 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes indicator-width-pop {
  0% {
    width: 42rpx;
    border-radius: 8rpx;
  }
  45% {
    width: 74rpx;
    border-radius: 14rpx;
  }
  100% {
    width: 42rpx;
    border-radius: 8rpx;
  }
}

.bottom-nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  box-sizing: border-box;
  padding-bottom: var(--indicator-offset);
  gap: 8rpx;
}

.bottom-nav-text {
  display: block;
  font-size: 24rpx;
  line-height: 1;
  color: var(--text-sub);
}

.bottom-nav-line-placeholder {
  width: 42rpx;
  height: 8rpx;
  opacity: 0;
}

.bottom-nav-item.active .bottom-nav-text {
  color: var(--text-main);
  font-weight: 600;
}
</style>
