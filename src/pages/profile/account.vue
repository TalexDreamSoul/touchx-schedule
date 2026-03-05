<template>
  <PageContainer title="账号与授权">
    <view class="page">
      <view class="card">
        <view class="sub">先微信登录，再绑定一个课表账号。</view>

        <view class="list">
          <view class="list-item avatar-row" @click="goAvatarPage">
            <view class="avatar-wrap">
              <image v-if="avatarUrl" class="avatar-img" :src="avatarUrl" mode="aspectFill" />
              <view v-else class="avatar-placeholder">头像</view>
            </view>
            <view class="item-main">
              <view class="row-title">微信头像</view>
              <view class="row-sub">
                {{ avatarPending ? "上传中..." : avatarUrl ? "已设置，点击进入二级页更换" : "未设置，点击进入二级页上传" }}
              </view>
            </view>
            <view class="chevron">›</view>
          </view>

          <view class="list-item" @click="goBindStudentPage">
            <view class="item-main">
              <view class="row-title">当前绑定课表</view>
              <view class="row-sub">{{ boundStudentName || "未绑定（点击绑定）" }}</view>
            </view>
            <view class="chevron">›</view>
          </view>

          <view class="list-item" @click="goStudentNoPage">
            <view class="item-main">
              <view class="row-title">编辑学号</view>
              <view class="row-sub">{{ editStudentNoSubText }}</view>
            </view>
            <view class="chevron">›</view>
          </view>

          <view class="list-item" @click="updateRandomCode">
            <view class="item-main">
              <view class="row-title">我的验证码（4位）</view>
              <view class="row-sub">{{ randomCodePending ? "修改中..." : `${myRandomCode || "----"}（点击修改）` }}</view>
            </view>
            <view class="chevron">›</view>
          </view>

          <view class="list-item" @click="bindNotify">
            <view class="item-main">
              <view class="row-title">通知绑定</view>
              <view class="row-sub">
                {{
                  notifyPending
                    ? "处理中..."
                    : notifyBound
                      ? "已绑定企业微信通知，点击可更新"
                      : "未绑定企业微信通知，点击立即绑定"
                }}
              </view>
            </view>
            <view class="chevron">›</view>
          </view>

          <view class="list-item" @click="unbindNotify">
            <view class="item-main">
              <view class="row-title">解绑通知</view>
              <view class="row-sub">{{ notifyPending ? "处理中..." : "点击后不再接收课程提醒" }}</view>
            </view>
            <view class="chevron">›</view>
          </view>

          <view class="list-item" @click="unbindAuth">
            <view class="item-main">
              <view class="row-title">解除微信授权</view>
              <view class="row-sub">{{ authUnbindPending ? "处理中..." : "清空微信绑定，允许其他人重新绑定账号" }}</view>
            </view>
            <view class="chevron">›</view>
          </view>
        </view>

        <view class="actions">
          <view class="btn" :class="{ pending: loginPending }" @click="runCardAuthLogin">{{ loginPending ? "授权中" : authButtonText }}</view>
        </view>
        <view class="hint">{{ hintText }}</view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import { useProfileAccountPage } from "@/composables/useProfileAccountPage";
import { guardProfilePageAccess } from "@/utils/profile-service";

const {
  avatarUrl,
  hintText,
  loginPending,
  avatarPending,
  notifyPending,
  randomCodePending,
  authUnbindPending,
  boundStudentName,
  myRandomCode,
  notifyBound,
  editStudentNoSubText,
  authButtonText,
  refreshState,
  authLogin,
  goBindStudentPage,
  goAvatarPage,
  goStudentNoPage,
  bindNotify,
  unbindNotify,
  updateRandomCode,
  unbindAuth,
} = useProfileAccountPage();

const runCardAuthLogin = async () => {
  await authLogin();
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void refreshState();
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
  padding: 18rpx 16rpx 16rpx;
  margin-bottom: 12rpx;
}

.sub {
  font-size: 22rpx;
  color: var(--text-sub);
}

.list {
  margin-top: 14rpx;
  border-top: 1rpx solid var(--line);
  border-bottom: 1rpx solid var(--line);
}

.list-item {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 0;
  border-bottom: 1rpx solid var(--line);
}

.list-item:last-child {
  border-bottom: none;
}

.avatar-row {
  align-items: center;
}

.avatar-wrap {
  width: 98rpx;
  height: 98rpx;
  border-radius: 999rpx;
  overflow: hidden;
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
}

.avatar-img {
  width: 100%;
  height: 100%;
  display: block;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  color: var(--text-sub);
}

.item-main {
  flex: 1;
  min-width: 0;
}

.chevron {
  font-size: 40rpx;
  color: var(--text-sub);
  opacity: 0.72;
  line-height: 1;
}

.row-title {
  font-size: 34rpx;
  color: var(--text-main);
  font-weight: 700;
}

.row-sub {
  margin-top: 6rpx;
  font-size: 28rpx;
  color: var(--text-sub);
  font-weight: 400;
}

.actions {
  margin-top: 18rpx;
}

.btn {
  text-align: center;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx 12rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 22rpx;
}

.btn.ghost {
  background: var(--card-bg);
  color: var(--text-main);
}

.btn.pending {
  opacity: 0.64;
}

.hint {
  margin-top: 10rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}
</style>
