<template>
  <view class="profile-display-card">
    <view class="profile-display-avatar">
      <image v-if="profileAvatarUrl" class="profile-display-avatar-img" :src="profileAvatarUrl" mode="aspectFill" />
      <view v-else class="profile-display-avatar-fallback">
        <view class="profile-display-avatar-top" />
        <view class="profile-display-avatar-bottom" />
      </view>
    </view>

    <view class="profile-display-main">
      <view class="profile-display-name" :class="{ 'profile-display-name-guest': !isAuthed }">
        {{ profileName || (isAuthed ? "未绑定课表" : "未登录") }}
      </view>
      <view v-if="profileClassLabel || authStatusLabel" class="profile-display-sub">
        {{ profileClassLabel || authStatusLabel }}
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  isAuthed: boolean;
  profileName: string;
  profileClassLabel: string;
  profileAvatarUrl: string;
  authStatusLabel: string;
}>();
</script>

<style scoped>
.profile-display-card {
  padding: 42rpx 26rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 36rpx;
}

.profile-display-avatar {
  width: 124rpx;
  height: 124rpx;
  border-radius: 999rpx;
  background: #d1d5db;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.profile-display-avatar-img {
  width: 100%;
  height: 100%;
  display: block;
}

.profile-display-avatar-fallback {
  width: 78rpx;
  height: 78rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.profile-display-avatar-top {
  width: 28rpx;
  height: 28rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.55);
}

.profile-display-avatar-bottom {
  margin-top: 8rpx;
  width: 50rpx;
  height: 24rpx;
  border-radius: 999rpx 999rpx 12rpx 12rpx;
  background: rgba(255, 255, 255, 0.55);
}

.profile-display-main {
  width: 100%;
  min-width: 0;
}

.profile-display-name {
  font-size: 45rpx;
  color: var(--text-main);
  font-weight: 700;
  line-height: 1.08;
}

.profile-display-name-guest {
  font-size: 38rpx;
}

.profile-display-sub {
  margin-top: 18rpx;
  font-size: 30rpx;
  color: var(--text-sub);
  line-height: 1.25;
}
</style>
