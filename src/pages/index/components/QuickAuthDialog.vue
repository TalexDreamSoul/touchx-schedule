<template>
  <view v-if="show" class="quick-auth-mask" @click="emit('close')">
    <view class="quick-auth-card" @click.stop>
      <view class="quick-auth-title">微信授权登录</view>
      <view class="quick-auth-sub">登录后可绑定课表账号，再选择要查看的课表。</view>
      <view v-if="hintText" class="quick-auth-hint">{{ hintText }}</view>
      <button class="quick-auth-btn" :disabled="pending" @click="emit('confirm')">
        {{ pending ? "授权中..." : "微信授权并登录" }}
      </button>
      <view class="quick-auth-cancel" @click="emit('close')">暂不登录</view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  show: boolean;
  pending: boolean;
  hintText: string;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "confirm"): void;
}>();
</script>

<style scoped>
.quick-auth-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 120;
  padding: 24rpx;
  background: var(--mask-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.quick-auth-card {
  width: 100%;
  max-width: 640rpx;
  border-radius: 16rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  padding: 24rpx;
}

.quick-auth-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.quick-auth-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--text-sub);
}

.quick-auth-hint {
  margin-top: 10rpx;
  padding: 10rpx 12rpx;
  border-radius: 10rpx;
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
  font-size: 21rpx;
  line-height: 1.45;
  color: var(--text-sub);
}

.quick-auth-btn {
  margin-top: 16rpx;
  border: 1rpx solid var(--line-strong);
  border-radius: 10rpx;
  background: var(--text-main);
  color: #ffffff;
  font-size: 24rpx;
  line-height: 1;
}

.quick-auth-cancel {
  margin-top: 12rpx;
  text-align: center;
  font-size: 22rpx;
  color: var(--text-sub);
}
</style>
