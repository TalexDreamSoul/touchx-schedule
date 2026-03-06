<template>
  <PageContainer title="绑定指引">
    <view class="page">
      <view class="card">
        <view class="title">当前账号还未绑定课表</view>
        <view class="sub">请先在企业微信机器人会话里发送以下命令：</view>
        <view class="cmd">bind 学号或姓名</view>
        <view class="example">示例：bind 2305200133</view>
        <view class="steps">
          <view class="step">1. 发送 bind 命令并收到“已绑定”回复。</view>
          <view class="step">2. 回到小程序账号页，点击“微信授权登录”刷新状态。</view>
          <view class="step">3. 看到“当前绑定课表”为已绑定即完成。</view>
        </view>
        <view class="actions">
          <view class="btn" @click="goBackToAccount">我已完成，返回账号页</view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import { guardProfilePageAccess } from "@/utils/profile-service";

const goBackToAccount = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.reLaunch({ url: "/pages/profile/account" });
};

onShow(() => {
  guardProfilePageAccess();
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
  padding: 22rpx 18rpx;
}

.title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--text-main);
}

.sub {
  margin-top: 10rpx;
  font-size: 26rpx;
  color: var(--text-sub);
  line-height: 1.5;
}

.cmd {
  margin-top: 14rpx;
  padding: 14rpx 16rpx;
  border-radius: 10rpx;
  border: 1rpx dashed var(--line-strong);
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 30rpx;
  font-weight: 700;
}

.example {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.steps {
  margin-top: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.step {
  font-size: 24rpx;
  color: var(--text-sub);
  line-height: 1.55;
}

.actions {
  margin-top: 18rpx;
}

.btn {
  text-align: center;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 12rpx 14rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 24rpx;
}
</style>
