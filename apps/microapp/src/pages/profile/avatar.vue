<template>
  <PageContainer title="微信头像">
    <view class="page">
      <view v-if="!isAuthed" class="card">
        <view class="empty">请先在“账号与授权”页面完成授权登录。</view>
        <view class="btn" @click="goAccountPage">去账号与授权</view>
      </view>

      <view v-else-if="!isBound" class="card">
        <view class="empty">请先绑定课表账号，再设置微信头像。</view>
        <view class="btn" @click="goAccountPage">去绑定</view>
      </view>

      <view v-else class="card">
        <view class="title">当前头像</view>
        <view class="sub">同步后会在课表社交信息中展示。</view>
        <view class="avatar-preview">
          <image v-if="avatarRenderUrl" class="avatar-img" :src="avatarRenderUrl" mode="aspectFill" @error="onAvatarLoadError" />
          <view v-else class="avatar-placeholder">未设置</view>
        </view>
        <view class="action-list">
          <!-- #ifdef MP-WEIXIN -->
          <button
            class="btn wechat-btn"
            open-type="chooseAvatar"
            :disabled="avatarPending"
            @chooseavatar="onChooseWechatAvatar"
          >
            {{ avatarPending ? "上传中" : "使用微信头像" }}
          </button>
          <!-- #endif -->
          <view class="btn ghost" :class="{ pending: avatarPending }" @click="uploadAvatar">
            {{ avatarPending ? "上传中" : "从相册/相机上传" }}
          </view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import { guardProfilePageAccess } from "@/utils/profile-service";
import { useProfileAccountPage } from "@/composables/useProfileAccountPage";

const { avatarUrl, avatarPending, isAuthed, isBound, refreshState, uploadAvatar, uploadAvatarByPath } = useProfileAccountPage();

const avatarLoadFailed = ref(false);

watch(avatarUrl, () => {
  avatarLoadFailed.value = false;
});

const avatarRenderUrl = computed(() => {
  if (avatarLoadFailed.value) {
    return "";
  }
  return String(avatarUrl.value || "").trim();
});

const onAvatarLoadError = () => {
  avatarLoadFailed.value = true;
};

const goAccountPage = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.navigateTo({ url: "/pages/profile/account" });
};

const onChooseWechatAvatar = async (event: { detail?: { avatarUrl?: string } }) => {
  if (avatarPending.value) {
    return;
  }
  const tempAvatarPath = String(event?.detail?.avatarUrl || "").trim();
  if (!tempAvatarPath) {
    uni.showToast({ title: "未选择头像", icon: "none", duration: 1500 });
    return;
  }
  await uploadAvatarByPath(tempAvatarPath);
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
  padding: 20rpx 16rpx 16rpx;
  margin-bottom: 12rpx;
}

.title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.sub {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.avatar-preview {
  margin: 16rpx auto 0;
  width: 180rpx;
  height: 180rpx;
  border-radius: 999rpx;
  overflow: hidden;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
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
  color: var(--text-sub);
  font-size: 24rpx;
}

.action-list {
  margin-top: 16rpx;
}

.btn {
  text-align: center;
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 12rpx 12rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 22rpx;
}

.btn + .btn {
  margin-top: 10rpx;
}

.btn.ghost {
  background: var(--card-bg);
  color: var(--text-main);
}

.btn.pending {
  opacity: 0.64;
}

.wechat-btn {
  line-height: normal;
}

.wechat-btn::after {
  border: none;
}

.empty {
  font-size: 22rpx;
  color: var(--text-sub);
}
</style>
