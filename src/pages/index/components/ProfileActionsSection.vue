<template>
  <view class="profile-actions-wrap">
    <view v-if="isAuthed" class="profile-nav-card">
      <view class="profile-nav-item" @click="openProfileAccountPage">
        <view class="profile-nav-icon profile-nav-icon-account">账</view>
        <view class="profile-nav-main">
          <view class="profile-nav-title">授权设置</view>
          <view class="profile-nav-sub">登录授权、学号同步、头像与资料管理</view>
        </view>
        <view class="profile-nav-arrow">›</view>
      </view>

      <view class="profile-nav-item" @click="openProfileSubscribePage">
        <view class="profile-nav-icon profile-nav-icon-subscribe">铃</view>
        <view class="profile-nav-main">
          <view class="profile-nav-title">通知与订阅</view>
          <view class="profile-nav-sub">随机码订阅、通知绑定、订阅列表管理</view>
        </view>
        <view class="profile-nav-arrow">›</view>
      </view>

      <view class="profile-nav-item" @click="openProfilePreferencesPage">
        <view class="profile-nav-icon profile-nav-icon-preferences">设</view>
        <view class="profile-nav-main">
          <view class="profile-nav-title">偏好设置</view>
          <view class="profile-nav-sub">主题与显示设置{{ isCurrentUserAdmin ? "、管理员后端配置" : "" }}</view>
        </view>
        <view class="profile-nav-arrow">›</view>
      </view>
    </view>

    <view v-else class="profile-auth-center">
      <view class="profile-auth-action" @click="openProfileAccountPage">授 权</view>
    </view>
    <view class="profile-powered">Powered by TaGzxia.</view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  isAuthed: boolean;
  isCurrentUserAdmin: boolean;
  openProfileAccountPage: () => void;
  openProfileSubscribePage: () => void;
  openProfilePreferencesPage: () => void;
}>();
</script>

<style scoped>
.profile-actions-wrap {
  position: relative;
  padding: 24rpx;
  display: flex;
  flex-direction: column;

  flex: 1;
  height: 100%;
  border-radius: 24rpx;
  background-color: var(--card-bg);
}

.profile-nav-card {
  border-radius: 24rpx;
  background: var(--card-bg);
  border: 1rpx solid var(--line);
}

.profile-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 22rpx 22rpx;
  border-bottom: 1rpx solid var(--line);
}

.profile-nav-item:last-child {
  border-bottom: none;
}

.profile-nav-icon {
  width: 58rpx;
  height: 58rpx;
  border-radius: 16rpx;
  color: #ffffff;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.profile-nav-icon-account {
  background: #1677ff;
}

.profile-nav-icon-subscribe {
  background: #ff4d4f;
}

.profile-nav-icon-preferences {
  background: #9ca3af;
}

.profile-nav-main {
  flex: 1;
  min-width: 0;
}

.profile-nav-title {
  font-size: 34rpx;
  color: var(--text-main);
  font-weight: 700;
  line-height: 1.1;
}

.profile-nav-sub {
  margin-top: 8rpx;
  font-size: 28rpx;
  color: var(--text-sub);
  line-height: 1.25;
}

.profile-nav-arrow {
  flex-shrink: 0;
  color: var(--text-sub);
  font-size: 40rpx;
  line-height: 1;
  opacity: 0.7;
}

.profile-auth-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-auth-action {
  width: 100%;
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  text-align: center;
  font-size: 28rpx;
  font-weight: 600;
  letter-spacing: 8rpx;
  text-indent: 8rpx;
  color: #ffffff;
  background: var(--accent);
  border: none;
}

.profile-powered {
  margin-top: 28rpx;
  text-align: center;
  font-size: 24rpx;
  color: var(--text-sub);
  opacity: 0.9;
  pointer-events: none;
  flex-shrink: 0;
}
</style>
