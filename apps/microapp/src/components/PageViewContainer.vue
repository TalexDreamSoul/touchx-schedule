<template>
  <PageContainer :title="title" :show-back="showBack" :theme-key="themeKey">
    <view class="pvc-page">
      <slot />
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import PageContainer from "@/components/PageContainer.vue";

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";

withDefaults(
  defineProps<{
    title: string;
    showBack?: boolean;
    themeKey?: ThemeKey | "";
  }>(),
  {
    showBack: true,
    themeKey: "",
  },
);
</script>

<style scoped>
.pvc-page {
  padding: 20rpx;
  box-sizing: border-box;
}
</style>
