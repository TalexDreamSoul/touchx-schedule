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
      :open-profile-activities-page="openProfileActivitiesPage"
      :open-profile-ai-assistant-page="openProfileAiAssistantPage"
      :open-profile-exam-companion-page="openProfileExamCompanionPage"
      :open-profile-free-heatmap-page="openProfileFreeHeatmapPage"
      :open-profile-schedule-import-page="openProfileScheduleImportPage"
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
  openProfileActivitiesPage: () => void;
  openProfileAiAssistantPage: () => void;
  openProfileExamCompanionPage: () => void;
  openProfileFreeHeatmapPage: () => void;
  openProfileScheduleImportPage: () => void;
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
