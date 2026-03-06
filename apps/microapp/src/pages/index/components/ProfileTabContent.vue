<template>
  <view class="profile-wrap">
    <profile-display-section
      :is-authed="isAuthed"
      :profile-name="profileName"
      :profile-class-label="profileClassLabel"
      :profile-avatar-url="profileAvatarUrl"
      :auth-status-label="authStatusLabel"
    />

    <profile-actions-section
      :is-authed="isAuthed"
      :is-current-user-admin="isCurrentUserAdmin"
      :open-profile-account-page="openProfileAccountPage"
      :open-profile-subscribe-page="openProfileSubscribePage"
      :open-profile-preferences-page="openProfilePreferencesPage"
    />
  </view>
</template>

<script setup lang="ts">
import ProfileActionsSection from "./ProfileActionsSection.vue";
import ProfileDisplaySection from "./ProfileDisplaySection.vue";

defineProps<{
  isAuthed: boolean;
  profileName: string;
  profileClassLabel: string;
  profileAvatarUrl: string;
  authStatusLabel: string;
  isCurrentUserAdmin: boolean;
  showAuthDialog: boolean;
  openAuthModal: () => void;
  openProfileAccountPage: () => void;
  openProfileSubscribePage: () => void;
  openProfilePreferencesPage: () => void;
}>();
</script>

<style scoped>
.profile-wrap {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}
</style>
