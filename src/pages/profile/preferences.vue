<template>
  <PageContainer title="偏好设置" :theme-key="themeKey">
    <view class="page">
      <view class="card">
        <view class="sub">简洁展示，只保留常用设置。</view>

        <view class="setting-row">
          <view>
            <view class="setting-title">非本周课程</view>
            <view class="setting-sub">显示非本周课程（灰色）</view>
          </view>
          <switch :checked="showNonCurrent" :color="switchColor" @change="onShowNonCurrentChange" />
        </view>
      </view>

      <view class="card">
        <view class="title small">主题</view>
        <view class="theme-list">
          <view
            v-for="item in themeOptions"
            :key="item.key"
            class="theme-item"
            :class="{ active: item.key === themeKey }"
            @click="setTheme(item.key)"
          >
            <view class="theme-item-main">
              <view class="theme-indicator" :style="{ background: item.indicator }" />
              <view class="theme-label">
                <text>{{ item.label }}</text>
                <text v-if="item.key === themeKey" class="theme-label-enabled">已启用</text>
              </view>
            </view>
            <view v-if="item.key === 'purple' && !purpleUnlocked" class="theme-action">解锁</view>
          </view>
        </view>
        <view v-if="themeWallpaperSwitchVisible" class="setting-row">
          <view>
            <view class="setting-title">启用主题壁纸</view>
            <view class="setting-sub">关闭后仅展示主题渐变背景</view>
          </view>
          <switch :checked="themeWallpaperEnabled" color="#111111" @change="onThemeWallpaperEnabledChange" />
        </view>
        <view v-if="themeWallpaperSwitchVisible && themeWallpaperEnabled" class="setting-row">
          <view>
            <view class="setting-title">壁纸模糊</view>
            <view class="setting-sub">仅课程表页生效：开启更柔和，关闭更清晰</view>
          </view>
          <switch :checked="themeWallpaperBlurEnabled" :color="switchColor" @change="onThemeWallpaperBlurEnabledChange" />
        </view>
        <view v-if="themeWallpaperSwitchVisible && themeWallpaperEnabled" class="setting-row" @click="pickThemeWallpaperEffectLevel">
          <view>
            <view class="setting-title">强度档位</view>
            <view class="setting-sub">仅课程表页生效：同时影响模糊与灰遮罩（轻/中/重）</view>
          </view>
          <view class="link">{{ themeWallpaperEffectLevelLabel }}</view>
        </view>
      </view>

      <view class="card">
        <view class="title small">壁纸</view>
        <view class="sub">上传后会同步到云端并应用到首页背景（建议 ≤ 5MB）。</view>
        <view class="wallpaper-wrap">
          <image v-if="wallpaperUrl" class="wallpaper-img" :src="wallpaperUrl" mode="aspectFill" />
          <view v-else class="wallpaper-placeholder">未设置壁纸</view>
        </view>
        <view class="actions">
          <view class="btn ghost" :class="{ pending: wallpaperPending }" @click="uploadWallpaper">
            {{ wallpaperPending ? "上传中" : "上传壁纸" }}
          </view>
          <view v-if="wallpaperUrl" class="btn ghost danger" @click="clearWallpaper">清除壁纸</view>
        </view>
      </view>

      <view v-if="isAdmin" class="card">
        <view class="title small">后端配置（管理员）</view>
        <view class="setting-row" @click="pickBackendMode">
          <view>
            <view class="setting-title">后端环境</view>
            <view class="setting-sub">{{ backendEndpointModeLabel }} · {{ backendBaseUrl }}</view>
          </view>
          <view class="link">切换</view>
        </view>
        <view class="setting-row static">
          <view>
            <view class="setting-title">课表数据来源</view>
            <view class="setting-sub">{{ scheduleSourceLabel }} · 最近缓存：{{ scheduleCacheTimeLabel }}</view>
          </view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import { useSocialDashboard, type SocialDashboardResponse } from "@/composables/useSocialDashboard";
import {
  STORAGE_BACKEND_BASE_URL_KEY,
  STORAGE_BACKEND_ENDPOINT_MODE_KEY,
  STORAGE_PURPLE_UNLOCKED_KEY,
  STORAGE_SCHEDULE_CACHE_SOURCE_KEY,
  STORAGE_SCHEDULE_CACHE_TIME_KEY,
  STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY,
  STORAGE_THEME_KEY,
  STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY,
  STORAGE_THEME_WALLPAPER_EFFECT_LEVEL_KEY,
  STORAGE_THEME_WALLPAPER_ENABLED_KEY,
  type BackendEndpointMode,
  getBackendBaseUrlByMode,
  guardProfilePageAccess,
  readLocalWallpaperPath,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  uploadBackendImage,
  resolveBackendBaseUrlFromStorage,
  resolveBackendRuntimeDefaultMode,
  saveLocalWallpaperPath,
} from "@/utils/profile-service";

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
type ThemeWallpaperEffectLevel = "light" | "medium" | "heavy";
const PURPLE_THEME_UNLOCK_PASSWORD = "1353";

const themeOptions: Array<{ key: ThemeKey; label: string; indicator: string }> = [
  { key: "black", label: "典雅黑", indicator: "#1d1d1f" },
  { key: "purple", label: "炫靓紫", indicator: "#7d4dff" },
  { key: "green", label: "不蕉绿", indicator: "#3cb371" },
  { key: "pink", label: "墨新粉", indicator: "#ff6fa7" },
  { key: "blue", label: "菱光蓝", indicator: "#4d82ff" },
  { key: "yellow", label: "曜晶黄", indicator: "#f0c43c" },
  { key: "orange", label: "焰霞橙", indicator: "#ff8c42" },
];

const showNonCurrent = ref(false);
const themeKey = ref<ThemeKey>("black");
const purpleUnlocked = ref(false);
const {
  dashboard,
  refreshDashboard: refreshSocialDashboardData,
  clearDashboard,
} = useSocialDashboard();
const isAdmin = computed(() => Boolean(dashboard.value?.me?.isAdmin));
const backendBaseUrl = ref("");
const runtimeBackendDefaultMode = resolveBackendRuntimeDefaultMode();
const backendMode = ref<BackendEndpointMode>(runtimeBackendDefaultMode);
const scheduleSource = ref("local");
const scheduleCacheAt = ref(0);
const wallpaperUrl = ref("");
const wallpaperPending = ref(false);
const themeImageMap = ref<Partial<Record<ThemeKey, string>>>({});
const themeWallpaperEnabled = ref(true);
const themeWallpaperBlurEnabled = ref(true);
const themeWallpaperEffectLevel = ref<ThemeWallpaperEffectLevel>("medium");
const authToken = ref("");
const isBound = computed(() => Boolean(dashboard.value?.me?.studentId));
const themeWallpaperSwitchVisible = computed(() => {
  return Boolean(String(themeImageMap.value[themeKey.value] || "").trim());
});

const backendEndpointModeLabel = computed(() => {
  return backendMode.value === "online" ? "线上" : "本地";
});

const scheduleSourceLabel = computed(() => {
  if (scheduleSource.value === "backend") {
    return "后端实时";
  }
  if (scheduleSource.value === "cache") {
    return "本地缓存";
  }
  return "前端本地兜底";
});

const scheduleCacheTimeLabel = computed(() => {
  if (!scheduleCacheAt.value) {
    return "无";
  }
  const date = new Date(scheduleCacheAt.value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
});

const switchColor = computed(() => {
  const accentMap: Record<ThemeKey, string> = {
    black: "#2f55c8",
    purple: "#a061ff",
    green: "#13c56a",
    pink: "#ef45a5",
    blue: "#2e9dff",
    yellow: "#d9a511",
    orange: "#f57b16",
  };
  return accentMap[themeKey.value] || accentMap.black;
});

const themeWallpaperEffectLevelLabel = computed(() => {
  if (themeWallpaperEffectLevel.value === "light") {
    return "轻";
  }
  if (themeWallpaperEffectLevel.value === "heavy") {
    return "重";
  }
  return "中";
});

const resolveThemeWallpaperEffectLevel = (raw: unknown): ThemeWallpaperEffectLevel => {
  const value = String(raw || "").trim();
  if (value === "light" || value === "medium" || value === "heavy") {
    return value;
  }
  return "medium";
};

const loadSettings = () => {
  const nonCurrentRaw = uni.getStorageSync(STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY);
  showNonCurrent.value = nonCurrentRaw === true || nonCurrentRaw === "true" || nonCurrentRaw === 1 || nonCurrentRaw === "1";

  const savedTheme = String(uni.getStorageSync(STORAGE_THEME_KEY) || "");
  purpleUnlocked.value = Boolean(uni.getStorageSync(STORAGE_PURPLE_UNLOCKED_KEY));
  if (savedTheme === "purple" && !purpleUnlocked.value) {
    themeKey.value = "black";
  } else if (themeOptions.some((item) => item.key === savedTheme)) {
    themeKey.value = savedTheme as ThemeKey;
  } else {
    themeKey.value = "black";
  }

  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  if (runtimeBackendDefaultMode === "local") {
    const savedMode = String(uni.getStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY) || "").trim();
    backendMode.value = savedMode === "online" ? "online" : "local";
  } else {
    backendMode.value = "online";
  }
  scheduleSource.value = String(uni.getStorageSync(STORAGE_SCHEDULE_CACHE_SOURCE_KEY) || "local");
  scheduleCacheAt.value = Number(uni.getStorageSync(STORAGE_SCHEDULE_CACHE_TIME_KEY) || 0);
  wallpaperUrl.value = readLocalWallpaperPath();
  themeWallpaperEnabled.value = !(uni.getStorageSync(STORAGE_THEME_WALLPAPER_ENABLED_KEY) === false
    || uni.getStorageSync(STORAGE_THEME_WALLPAPER_ENABLED_KEY) === "false"
    || uni.getStorageSync(STORAGE_THEME_WALLPAPER_ENABLED_KEY) === 0
    || uni.getStorageSync(STORAGE_THEME_WALLPAPER_ENABLED_KEY) === "0");
  themeWallpaperBlurEnabled.value = !(uni.getStorageSync(STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY) === false
    || uni.getStorageSync(STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY) === "false"
    || uni.getStorageSync(STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY) === 0
    || uni.getStorageSync(STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY) === "0");
  themeWallpaperEffectLevel.value = resolveThemeWallpaperEffectLevel(
    uni.getStorageSync(STORAGE_THEME_WALLPAPER_EFFECT_LEVEL_KEY),
  );
};

const normalizeThemeImageMap = (raw: unknown) => {
  if (!raw || typeof raw !== "object") {
    return {} as Partial<Record<ThemeKey, string>>;
  }
  const result: Partial<Record<ThemeKey, string>> = {};
  for (const [rawThemeKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const theme = String(rawThemeKey || "").trim() as ThemeKey;
    if (!themeOptions.some((item) => item.key === theme)) {
      continue;
    }
    const url = String(rawValue || "").trim();
    if (!url) {
      continue;
    }
    result[theme] = url;
  }
  return result;
};

const refreshThemeImageMap = async () => {
  try {
    const response = await requestBackendGet<{ images?: Record<string, string> }>(backendBaseUrl.value, "/api/theme-images");
    themeImageMap.value = normalizeThemeImageMap(response.images || {});
  } catch (error) {
    themeImageMap.value = {};
  }
};

const refreshAdminStatus = async () => {
  const session = readAuthSessionFromStorage();
  authToken.value = session.token;
  if (!session.token) {
    clearDashboard();
    return;
  }
  try {
    const data = await refreshSocialDashboardData(() =>
      requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/social/me", {}, session.token),
    );
    const cloudWallpaper = String(data.me?.wallpaperUrl || "").trim();
    wallpaperUrl.value = cloudWallpaper;
    saveLocalWallpaperPath(cloudWallpaper);
  } catch (error) {
    clearDashboard();
  }
};

const onShowNonCurrentChange = (event: Event) => {
  const detail = (event as unknown as { detail?: { value?: boolean } }).detail;
  showNonCurrent.value = Boolean(detail?.value);
  uni.setStorageSync(STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY, showNonCurrent.value);
};

const onThemeWallpaperEnabledChange = (event: Event) => {
  const detail = (event as unknown as { detail?: { value?: boolean } }).detail;
  themeWallpaperEnabled.value = Boolean(detail?.value);
  uni.setStorageSync(STORAGE_THEME_WALLPAPER_ENABLED_KEY, themeWallpaperEnabled.value);
};

const onThemeWallpaperBlurEnabledChange = (event: Event) => {
  const detail = (event as unknown as { detail?: { value?: boolean } }).detail;
  themeWallpaperBlurEnabled.value = Boolean(detail?.value);
  uni.setStorageSync(STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY, themeWallpaperBlurEnabled.value);
};

const pickThemeWallpaperEffectLevel = () => {
  if (!themeWallpaperSwitchVisible.value || !themeWallpaperEnabled.value) {
    return;
  }
  const effectLevels: ThemeWallpaperEffectLevel[] = ["light", "medium", "heavy"];
  const itemList = ["轻（更清晰）", "中（推荐）", "重（更柔和）"];
  const currentIndex = effectLevels.indexOf(themeWallpaperEffectLevel.value);
  uni.showActionSheet({
    itemList,
    success: (result) => {
      const nextLevel = effectLevels[result.tapIndex];
      if (!nextLevel) {
        return;
      }
      if (nextLevel === themeWallpaperEffectLevel.value) {
        return;
      }
      themeWallpaperEffectLevel.value = nextLevel;
      uni.setStorageSync(STORAGE_THEME_WALLPAPER_EFFECT_LEVEL_KEY, nextLevel);
    },
    fail: () => {
      if (currentIndex < 0) {
        themeWallpaperEffectLevel.value = "medium";
      }
    },
  });
};

const unlockPurpleTheme = () => {
  uni.showModal({
    title: "解锁炫靓紫",
    content: "请输入解锁密码",
    editable: true,
    placeholderText: "请输入解锁密码",
    success: (result) => {
      if (!result.confirm) {
        return;
      }
      const inputPassword = String((result as { content?: string }).content || "").trim();
      if (inputPassword !== PURPLE_THEME_UNLOCK_PASSWORD) {
        uni.showToast({ title: "密码错误，请重试", icon: "none", duration: 1600 });
        return;
      }
      purpleUnlocked.value = true;
      uni.setStorageSync(STORAGE_PURPLE_UNLOCKED_KEY, true);
      themeKey.value = "purple";
      uni.setStorageSync(STORAGE_THEME_KEY, "purple");
      uni.showToast({ title: "已解锁炫靓紫", icon: "none", duration: 1200 });
    },
  });
};

const setTheme = (key: ThemeKey) => {
  if (key === "purple" && !purpleUnlocked.value) {
    unlockPurpleTheme();
    return;
  }
  themeKey.value = key;
  uni.setStorageSync(STORAGE_THEME_KEY, key);
};

const pickBackendMode = () => {
  if (!isAdmin.value) {
    return;
  }
  if (runtimeBackendDefaultMode !== "local") {
    uni.showToast({ title: "线上版已固定线上后端", icon: "none", duration: 1600 });
    return;
  }
  uni.showActionSheet({
    itemList: ["本地 (http://127.0.0.1:9986)", "线上 (https://schedule-ends.tagzxia.com)"],
    success: (result) => {
      backendMode.value = result.tapIndex === 1 ? "online" : "local";
      backendBaseUrl.value = getBackendBaseUrlByMode(backendMode.value);
      uni.setStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY, backendMode.value);
      uni.setStorageSync(STORAGE_BACKEND_BASE_URL_KEY, backendBaseUrl.value);
    },
  });
};

const getLocalFileSize = (filePath: string) => {
  return new Promise<number>((resolve) => {
    uni.getFileInfo({
      filePath,
      success: (result) => {
        resolve(Number(result.size || 0));
      },
      fail: () => {
        resolve(0);
      },
    });
  });
};

const chooseSingleImage = () => {
  return new Promise<string>((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const filePath = String(result.tempFilePaths?.[0] || "").trim();
        if (!filePath) {
          reject(new Error("未选择图片"));
          return;
        }
        resolve(filePath);
      },
      fail: (error) => {
        reject(new Error(error?.errMsg || "选择图片失败"));
      },
    });
  });
};

const uploadWallpaper = async () => {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录", icon: "none", duration: 1600 });
    return;
  }
  if (!isBound.value) {
    uni.showToast({ title: "请先绑定课表账号", icon: "none", duration: 1600 });
    return;
  }
  if (wallpaperPending.value) {
    return;
  }
  wallpaperPending.value = true;
  try {
    const filePath = await chooseSingleImage();
    const fileSize = await getLocalFileSize(filePath);
    const maxBytes = 5 * 1024 * 1024;
    if (fileSize > maxBytes) {
      throw new Error("图片过大，请选择不超过 5MB 的图片");
    }
    const response = await uploadBackendImage<{ wallpaperUrl?: string; me?: { wallpaperUrl?: string } }>(
      backendBaseUrl.value,
      "/api/social/upload/wallpaper",
      filePath,
      authToken.value,
    );
    const nextUrl = String(response.wallpaperUrl || response.me?.wallpaperUrl || "").trim();
    if (!nextUrl) {
      throw new Error("壁纸地址为空，请重试");
    }
    wallpaperUrl.value = nextUrl;
    saveLocalWallpaperPath(nextUrl);
    uni.showToast({ title: "上传成功", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    wallpaperPending.value = false;
  }
};

const clearWallpaper = async () => {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录", icon: "none", duration: 1600 });
    return;
  }
  if (!isBound.value) {
    uni.showToast({ title: "请先绑定课表账号", icon: "none", duration: 1600 });
    return;
  }
  if (wallpaperPending.value) {
    return;
  }
  wallpaperPending.value = true;
  try {
    await requestBackendPost(backendBaseUrl.value, "/api/social/profile", { wallpaper_url: "" }, authToken.value);
    wallpaperUrl.value = "";
    saveLocalWallpaperPath("");
    uni.showToast({ title: "已清除", icon: "none", duration: 1200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "清除失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    wallpaperPending.value = false;
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  loadSettings();
  void refreshThemeImageMap();
  void refreshAdminStatus();
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
  padding: 16rpx;
  margin-bottom: 12rpx;
}

.title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.title.small {
  font-size: 24rpx;
}

.sub {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.setting-row {
  margin-top: 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 12rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.setting-row.static {
  background: var(--muted-bg);
}

.setting-title {
  font-size: 22rpx;
  color: var(--text-main);
  font-weight: 600;
}

.setting-sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.link {
  font-size: 21rpx;
  color: var(--accent);
}

.actions {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
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

.btn.danger {
  border-color: var(--danger-soft);
  color: var(--danger);
}

.wallpaper-wrap {
  margin-top: 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  overflow: hidden;
  height: 200rpx;
  background: var(--muted-bg);
}

.wallpaper-img {
  width: 100%;
  height: 100%;
  display: block;
}

.wallpaper-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  color: var(--text-sub);
}

.theme-list {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.theme-item {
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 10rpx 12rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
  font-size: 22rpx;
  color: var(--text-main);
  background: var(--card-bg);
}

.theme-item.active {
  border-color: var(--line-strong);
  font-weight: 600;
}

.theme-item-main {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.theme-indicator {
  width: 16rpx;
  height: 16rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(17, 17, 17, 0.2);
  flex-shrink: 0;
}

.theme-label {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.theme-label-enabled {
  font-size: 20rpx;
  color: var(--text-main);
  font-weight: 600;
}

.theme-action {
  font-size: 22rpx;
  color: var(--accent);
  font-weight: 600;
}
</style>
