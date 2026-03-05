<template>
  <view class="auth-required-block">
    <view class="auth-required-text">{{ text }}</view>
    <view class="auth-required-btn" @click="emit('authorize')">{{ buttonText }}</view>
  </view>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    text?: string;
    buttonText?: string;
  }>(),
  {
    text: "授权后继续",
    buttonText: "去授权",
  },
);

const emit = defineEmits<{
  (event: "authorize"): void;
}>();
</script>

<style scoped>
.auth-required-block {
  min-height: 360rpx;
  padding: 24rpx 20rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.auth-required-text {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main, #111111);
}

.auth-required-btn {
  margin-top: 18rpx;
  min-width: 220rpx;
  border-radius: 999rpx;
  padding: 12rpx 24rpx;
  text-align: center;
  font-size: 24rpx;
  font-weight: 600;
  color: #ffffff;
  background: var(--accent, #2f55c8);
}
</style>
