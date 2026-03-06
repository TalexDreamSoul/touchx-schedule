<template>
  <view class="pc-root" :class="themeClass">
    <GlobalBackground :blur-enabled="false" mask-color="var(--bg)" />
    <view class="pc-content-layer">
      <view
        class="pc-header"
        :style="{
          paddingTop: `${headerTopPadding}px`,
          paddingLeft: `${horizontalPadding}px`,
          paddingRight: `${horizontalPadding}px`,
        }"
      >
        <view
          class="pc-header-row"
          :style="{
            minHeight: `${headerRowHeight}px`,
            gridTemplateColumns: `${sideReserve}px 1fr ${sideReserve}px`,
          }"
        >
          <view class="pc-left">
            <view v-if="showBack" class="pc-back-btn" @click="goBack">‹</view>
          </view>
          <view class="pc-title">{{ title }}</view>
          <view class="pc-right" />
        </view>
      </view>
      <view class="pc-body">
        <slot />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import GlobalBackground from "@/components/GlobalBackground.vue";
import { STORAGE_PURPLE_UNLOCKED_KEY, STORAGE_THEME_KEY } from "@/utils/profile-service";

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
const THEME_KEY_SET = new Set<ThemeKey>(["black", "purple", "green", "pink", "blue", "yellow", "orange"]);

const props = withDefaults(
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

const headerTopPadding = ref(44);
const headerRowHeight = ref(32);
const sideReserve = ref(88);
const horizontalPadding = ref(16);
const storageThemeKey = ref<ThemeKey>("black");

const isThemeKey = (value: unknown): value is ThemeKey => THEME_KEY_SET.has(value as ThemeKey);

const syncThemeKeyFromStorage = () => {
  const savedTheme = String(uni.getStorageSync(STORAGE_THEME_KEY) || "").trim();
  const purpleUnlocked = Boolean(uni.getStorageSync(STORAGE_PURPLE_UNLOCKED_KEY));
  if (savedTheme === "purple" && !purpleUnlocked) {
    storageThemeKey.value = "black";
    return;
  }
  storageThemeKey.value = isThemeKey(savedTheme) ? savedTheme : "black";
};

const themeClass = computed(() => {
  const activeThemeKey = isThemeKey(props.themeKey) ? props.themeKey : storageThemeKey.value;
  return `theme-${activeThemeKey}`;
});

const resolveHeaderLayout = () => {
  const info = uni.getSystemInfoSync();
  const statusBar = Number(info.statusBarHeight || 0);
  const windowWidth = Number(info.windowWidth || 375);
  let nextHeaderTopPadding = Math.max(24, statusBar + 6);
  let nextHeaderRowHeight = 32;
  let nextSideReserve = 88;

  const uniAny = uni as unknown as {
    getMenuButtonBoundingClientRect?: () => { top?: number; left?: number; width?: number; height?: number };
  };

  if (typeof uniAny.getMenuButtonBoundingClientRect === "function") {
    const rect = uniAny.getMenuButtonBoundingClientRect();
    const menuTop = Number(rect?.top || 0);
    const menuLeft = Number(rect?.left || 0);
    const menuWidth = Number(rect?.width || 0);
    const menuHeight = Number(rect?.height || 0);
    if (menuTop > 0) {
      nextHeaderTopPadding = menuTop;
    }
    if (menuHeight > 0) {
      nextHeaderRowHeight = menuHeight;
    }
    if (menuLeft > 0 && menuWidth > 0 && windowWidth > 0) {
      const rightReserve = Math.ceil(windowWidth - menuLeft + 8);
      nextSideReserve = Math.max(88, rightReserve);
    }
  }

  headerTopPadding.value = nextHeaderTopPadding;
  headerRowHeight.value = nextHeaderRowHeight;
  sideReserve.value = nextSideReserve;
};

const goBack = () => {
  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack();
    return;
  }
  uni.reLaunch({ url: "/pages/index/index" });
};

onMounted(() => {
  resolveHeaderLayout();
  syncThemeKeyFromStorage();
});

onShow(() => {
  syncThemeKeyFromStorage();
});
</script>

<style scoped>
.pc-root {
  --bg: #f3f4f7;
  --card-bg: #ffffff;
  --muted-bg: #eff2f7;
  --text-main: #111111;
  --text-sub: #5f5f5f;
  --line: #d6d9e0;
  --line-strong: #2c3445;
  --accent: #2f55c8;
  --danger: #c44545;
  --danger-soft: #d8a0a0;
  --mask-bg: rgba(0, 0, 0, 0.45);
  min-height: 100vh;
  position: relative;
  background: transparent;
  color: var(--text-main);
}

.pc-root.theme-black {
  --bg: #f3f4f7;
  --card-bg: #ffffff;
  --muted-bg: #eff2f7;
  --line: #d6d9e0;
  --line-strong: #2c3445;
  --accent: #2f55c8;
  --bg-gradient-start: #f8f9fc;
  --bg-gradient-end: #edf1f9;
  --bg-glow: rgba(97, 110, 150, 0.15);
}

.pc-root.theme-purple {
  --bg: #f5f1ff;
  --card-bg: #fcfaff;
  --muted-bg: #f5edff;
  --line: #d9cfef;
  --line-strong: #8e57de;
  --accent: #a061ff;
}

.pc-root.theme-green {
  --bg: #eef8f2;
  --card-bg: #f9fffb;
  --muted-bg: #ebf9f0;
  --line: #cde2d6;
  --line-strong: #159b57;
  --accent: #13c56a;
  --bg-gradient-start: #f2fbf5;
  --bg-gradient-end: #e7f5ed;
  --bg-glow: rgba(21, 155, 87, 0.2);
}

.pc-root.theme-pink {
  --bg: #fff1f7;
  --card-bg: #fffafe;
  --muted-bg: #fdebf5;
  --line: #ebcede;
  --line-strong: #d93d96;
  --accent: #ef45a5;
  --bg-gradient-start: #fff5fa;
  --bg-gradient-end: #fceaf4;
  --bg-glow: rgba(217, 61, 150, 0.18);
}

.pc-root.theme-blue {
  --bg: #eef5ff;
  --card-bg: #fafdff;
  --muted-bg: #eaf3ff;
  --line: #cddcf3;
  --line-strong: #257ecf;
  --accent: #2e9dff;
  --bg-gradient-start: #f2f7ff;
  --bg-gradient-end: #e8f1ff;
  --bg-glow: rgba(37, 126, 207, 0.22);
}

.pc-root.theme-yellow {
  --bg: #fff9ea;
  --card-bg: #fffdf5;
  --muted-bg: #fdf4e0;
  --line: #eadcb9;
  --line-strong: #ad8100;
  --accent: #d9a511;
  --bg-gradient-start: #fffbf2;
  --bg-gradient-end: #fbf1db;
  --bg-glow: rgba(173, 129, 0, 0.18);
}

.pc-root.theme-orange {
  --bg: #fff3ec;
  --card-bg: #fffaf6;
  --muted-bg: #fdebe0;
  --line: #edd3c2;
  --line-strong: #cf6f17;
  --accent: #f57b16;
  --bg-gradient-start: #fff8f3;
  --bg-gradient-end: #fdeee2;
  --bg-glow: rgba(207, 111, 23, 0.2);
}

.pc-header {
  background: transparent;
  padding-bottom: 10rpx;
}

.pc-content-layer {
  position: relative;
  z-index: 1;
  min-height: 100vh;
}

.pc-header-row {
  display: grid;
  align-items: center;
}

.pc-left {
  display: flex;
  align-items: center;
}

.pc-back-btn {
  width: 56rpx;
  height: 56rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  line-height: 1;
}

.pc-title {
  text-align: center;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.pc-body {
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
}
</style>
