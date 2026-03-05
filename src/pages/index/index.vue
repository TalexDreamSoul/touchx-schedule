<template>
  <view
    class="page"
    :class="[ `theme-${themeKey}`, { 'modal-open': isAnyModalOpen, 'tab-switching': isTabSwitching } ]"
    :style="pageThemeStyle"
  >
    <GlobalBackground
      :image-src="pageBackgroundImageSrc"
      :blur-enabled="pageBackgroundBlurEnabled"
      :blur-radius="pageBackgroundBlurRadius"
      :mask-color="pageBackgroundMaskColor"
    />
    <view class="page-content-layer">
      <view class="tab-screen-stage">
        <view class="tab-screen-track" :style="tabScreenTrackStyle">
          <view class="tab-screen-panel" :class="{ 'tab-screen-panel-blur': shouldBlurPanel(0) }">
            <schedule-top-header v-bind="todayScheduleTopHeaderProps" @include-click="openIncludePicker" @week-click="openWeekPicker" />
            <view class="content">
              <today-tab-content v-bind="todayTabProps" />
            </view>
          </view>
          <view class="tab-screen-panel schedule-tab-panel" :class="{ 'tab-screen-panel-blur': shouldBlurPanel(1) }">
            <schedule-top-header v-bind="scheduleScheduleTopHeaderProps" @include-click="openIncludePicker" @week-click="openWeekPicker" />
            <view class="content schedule-content">
              <view class="schedule-content-inner">
                <schedule-tab-content v-bind="scheduleTabProps" />
              </view>
            </view>
          </view>
          <view class="tab-screen-panel" :class="{ 'tab-screen-panel-blur': shouldBlurPanel(2) }">
            <schedule-top-header v-bind="profileScheduleTopHeaderProps" @include-click="openIncludePicker" @week-click="openWeekPicker" />
              <view class="profile-tab-wrap">
                <profile-display-section v-bind="profileDisplayProps" />
                <profile-actions-section style="flex: 1" v-bind="profileActionsProps" />
              </view>
          </view>
        </view>
      </view>

      <index-bottom-nav v-bind="bottomNavProps" @change="onBottomNavChange" />

      <auth-authorize-dialog
        :show="showQuickAuthDialog"
        :pending="quickAuthPending"
        :hint-text="authStatusHint"
        :show-student-no-input="true"
        :student-no-value="quickAuthStudentNo"
        :require-agreement="true"
        :agreement-checked="quickAuthAgreementChecked"
        confirm-text="微信授权并登录"
        pending-text="授权中..."
        subtitle="登录后可绑定课表账号并继续浏览。"
        @update:student-no-value="updateQuickAuthStudentNo"
        @update:agreement-checked="updateQuickAuthAgreementChecked"
        @close="closeQuickAuthDialog"
        @confirm="runQuickAuthLogin"
      />

      <index-dialogs
        v-bind="dialogProps"
        @close-include-picker="closeIncludePicker"
        @include-change="onIncludeChange"
        @update-show-weekend="updateShowWeekend"
        @close-theme-unlock-dialog="closeThemeUnlockDialog"
        @update-theme-password-input="updateThemePasswordInput"
        @confirm-purple-unlock="confirmPurpleUnlock"
        @close-backend-probe-dialog="closeBackendProbeDialog"
        @run-backend-probe="runBackendProbe"
        @refresh-today-brief="refreshTodayBrief"
        @close-user-picker="closeUserPicker"
        @select-from-modal="selectFromModal"
        @close-course-dialog="closeCourseDialog"
        @toggle-practice-course="togglePracticeCourse"
        @close-week-picker="closeWeekPicker"
        @choose-week="chooseWeek"
      />
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { onPullDownRefresh, onShow } from "@dcloudio/uni-app";
import {
  sectionTimes as localSectionTimes,
  termMeta as localTermMeta,
  weekdayLabels as localWeekdayLabels,
} from "@/data/schedules";
import { useModalScrollLock } from "@/composables/useModalScrollLock";
import { useActiveScheduleState } from "@/composables/useActiveScheduleState";
import { useBackendApi } from "@/composables/useBackendApi";
import { useScheduleCellStyles } from "@/composables/useScheduleCellStyles";
import { useScheduleViewport } from "@/composables/useScheduleViewport";
import { useScheduleWeekSwipe } from "@/composables/useScheduleWeekSwipe";
import { buildRegisteredUsersFromDashboard, useSocialDashboard } from "@/composables/useSocialDashboard";
import AuthAuthorizeDialog from "@/components/AuthAuthorizeDialog.vue";
import GlobalBackground from "@/components/GlobalBackground.vue";
import IndexBottomNav from "./components/IndexBottomNav.vue";
import IndexDialogs from "./components/IndexDialogs.vue";
import ProfileActionsSection from "./components/ProfileActionsSection.vue";
import ProfileDisplaySection from "./components/ProfileDisplaySection.vue";
import ScheduleTabContent from "./components/ScheduleTabContent.vue";
import ScheduleTopHeader from "./components/ScheduleTopHeader.vue";
import TodayTabContent from "./components/TodayTabContent.vue";
import { buildCoursePracticeKey, getWeekCourses, normalizePracticeCourseKey } from "@/utils/schedule";
import {
  fetchMiniProgramCode,
  readLocalWallpaperPath,
  resolveBackendRuntimeDefaultMode,
  resolveClientPlatform,
  resolveStudentIdByStudentNo,
  saveLocalWallpaperPath,
  STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY,
  STORAGE_THEME_WALLPAPER_EFFECT_LEVEL_KEY,
  STORAGE_THEME_WALLPAPER_ENABLED_KEY,
  tryGetWechatProfile,
} from "@/utils/profile-service";
import type { CourseItem, SectionTime, StudentSchedule } from "@/types/schedule";
import type { SocialDashboardResponse, SocialUserItem } from "@/composables/useSocialDashboard";
import type { DisplayCourse, GridRow, ScheduleWeekPanel, WeekPanelRole } from "./types";

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
type ThemeWallpaperEffectLevel = "light" | "medium" | "heavy";
type TabKey = "today" | "schedule" | "profile";
type BackendProbeStatus = "untested" | "online" | "offline";
type BackendEndpointMode = "local" | "online";
type ScheduleFetchState = "idle" | "loading" | "ready" | "error";
const STORAGE_SELECTED_STUDENT_KEY = "touchx_v2_selected_student_id";
const STORAGE_SELECTED_WEEK_KEY = "touchx_v2_selected_week";
const STORAGE_THEME_KEY = "touchx_theme_key";
const STORAGE_PURPLE_UNLOCKED_KEY = "touchx_theme_purple_unlocked";
const STORAGE_INCLUDED_IDS_KEY = "touchx_v2_included_student_ids";
const STORAGE_BACKEND_BASE_URL_KEY = "touchx_v2_backend_base_url";
const STORAGE_BACKEND_ENDPOINT_MODE_KEY = "touchx_v2_backend_endpoint_mode";
const STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY = "touchx_show_non_current_week_courses";
const STORAGE_SHOW_WEEKEND_KEY = "touchx_show_weekend";
const STORAGE_THEME_IMAGE_MAP_KEY = "touchx_theme_image_map";
const STORAGE_THEME_IMAGE_UPDATED_AT_KEY = "touchx_theme_image_updated_at";
const STORAGE_AUTH_TOKEN_KEY = "touchx_v2_auth_token";
const STORAGE_AUTH_EXPIRES_AT_KEY = "touchx_v2_auth_expires_at";
const STORAGE_AUTH_USER_KEY = "touchx_v2_auth_user";
const STORAGE_AUTH_MODE_KEY = "touchx_v2_auth_mode";
const STORAGE_SCHEDULE_CACHE_SOURCE_KEY = "touchx_v2_schedule_cache_source";
const MAX_COMPARE_OWNERS = 7;
const DEFAULT_TERM_WEEK1_MONDAY = localTermMeta.week1Monday;
const DEFAULT_TERM_MAX_WEEK = localTermMeta.maxWeek;
const LOCAL_BACKEND_BASE_URL = String(import.meta.env.VITE_LOCAL_BACKEND_BASE_URL || "http://127.0.0.1:9986").trim();
const ONLINE_BACKEND_BASE_URL = String(import.meta.env.VITE_ONLINE_BACKEND_BASE_URL || "https://schedule-ends.tagzxia.com").trim();
const RUNTIME_BACKEND_DEFAULT_MODE = resolveBackendRuntimeDefaultMode();
const DEFAULT_BACKEND_BASE_URL = RUNTIME_BACKEND_DEFAULT_MODE === "local" ? LOCAL_BACKEND_BASE_URL : ONLINE_BACKEND_BASE_URL;

type ScheduleDataSource = "backend" | "cache" | "local";

const runtimeStudentSchedules = ref<StudentSchedule[]>([]);
const scheduleDataSource = ref<ScheduleDataSource>("local");
const scheduleCacheAt = ref(0);
const runtimeTermWeek1Monday = ref(DEFAULT_TERM_WEEK1_MONDAY);
const runtimeTermMaxWeek = ref(DEFAULT_TERM_MAX_WEEK);
const runtimeSectionTimes = ref<SectionTime[]>([...localSectionTimes]);
const runtimeWeekdayLabels = ref<string[]>([...localWeekdayLabels]);

const studentSchedules = computed<StudentSchedule[]>(() => {
  return runtimeStudentSchedules.value;
});

const sectionTimes = computed<SectionTime[]>(() => {
  if (runtimeSectionTimes.value.length > 0) {
    return runtimeSectionTimes.value;
  }
  return localSectionTimes;
});

const weekdayLabels = computed<string[]>(() => {
  if (runtimeWeekdayLabels.value.length > 0) {
    return runtimeWeekdayLabels.value;
  }
  return localWeekdayLabels;
});

const termWeek1Monday = computed(() => {
  return runtimeTermWeek1Monday.value || DEFAULT_TERM_WEEK1_MONDAY;
});

const termMaxWeek = computed(() => {
  const value = Number(runtimeTermMaxWeek.value || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TERM_MAX_WEEK;
  }
  return Math.max(1, Math.floor(value));
});

const themeOptions: Array<{ key: ThemeKey; label: string }> = [
  { key: "black", label: "典雅黑" },
  { key: "purple", label: "炫靓紫" },
  { key: "green", label: "不蕉绿" },
  { key: "pink", label: "墨新粉" },
  { key: "blue", label: "菱光蓝" },
  { key: "yellow", label: "曜晶黄" },
  { key: "orange", label: "焰霞橙" },
];

const navItems: Array<{ key: TabKey; label: string }> = [
  { key: "today", label: "今日" },
  { key: "schedule", label: "课程表" },
  { key: "profile", label: "我的" },
];
const tabOrder: TabKey[] = ["today", "schedule", "profile"];
const TAB_SCREEN_ANIMATION_MS = 320;

interface BackendTodayBrief {
  studentId: string;
  studentName: string;
  weekNo: number;
  dayNo: number;
  dayLabel: string;
  greeting: string;
  weather?: {
    status?: string;
    summary?: string;
    temperature?: string;
    advice?: string;
  };
  nextCourse?: {
    name: string;
    startSection: number;
    endSection: number;
    startTime: string;
    endTime: string;
    minutesToStart: number;
    classroom?: string | null;
    teacher?: string | null;
    buildingLabel: string;
    commuteMinutes: number;
    prepMinutes: number;
    leaveInMinutes: number;
    prepareItems: string[];
    from: string;
  } | null;
  tips?: string[];
  generatedAt?: string;
}

interface AuthUserProfile {
  openId: string;
  studentId: string;
  studentName: string;
  classLabel?: string;
  nickname: string;
  avatarUrl: string;
}

interface BackendAuthMeResponse {
  ok?: boolean;
  mode?: "wechat" | "mock";
  expiresAt?: number;
  user?: AuthUserProfile;
}

interface BackendAuthLoginResponse {
  ok?: boolean;
  token?: string;
  expiresAt?: number;
  mode?: "wechat" | "mock";
  user?: AuthUserProfile;
}

interface BackendSchedulePayload {
  term?: {
    name?: string;
    week1Monday?: string;
    maxWeek?: number;
  };
  sectionTimes?: Array<{
    section: number;
    start: string;
    end: string;
    part: "上午" | "下午" | "晚上";
  }>;
  weekdayLabels?: string[];
  students?: StudentSchedule[];
  generatedAt?: number;
}

interface BackendSingleSchedulePayload {
  term?: BackendSchedulePayload["term"];
  sectionTimes?: BackendSchedulePayload["sectionTimes"];
  weekdayLabels?: string[];
  student?: StudentSchedule;
  generatedAt?: number;
}

interface BackendThemeImagesResponse {
  ok?: boolean;
  images?: Record<string, string>;
  updatedAt?: number;
}

interface BackendPracticeCourseToggleResponse {
  ok?: boolean;
  courseKey?: string;
  enabled?: boolean;
  practiceCourseKeys?: string[];
}

const allWeeks = computed(() => Array.from({ length: termMaxWeek.value }, (_, index) => index + 1));
const activeTab = ref<TabKey>("schedule");
const isTabSwitching = ref(false);
const tabTrackIndex = ref(tabOrder.indexOf(activeTab.value));
const tabSwitchDurationMs = ref(TAB_SCREEN_ANIMATION_MS);
const blurPanelIndex = ref<number | null>(null);
const scheduleTableScrollIntoViewId = ref("");
let tabSwitchCleanupTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleTableScrollIntoViewResetTimer: ReturnType<typeof setTimeout> | null = null;
const selectedWeek = ref(resolveWeekByDate(new Date()));
const themeKey = ref<ThemeKey>("black");
const showIncludePicker = ref(false);
const showUserPicker = ref(false);
const showCourseDialog = ref(false);
const showWeekPicker = ref(false);
const showThemeUnlockDialog = ref(false);
const showBackendProbeDialog = ref(false);
const showQuickAuthDialog = ref(false);
const purpleUnlocked = ref(false);
const pendingThemeKey = ref<ThemeKey>("black");
const themePasswordInput = ref("");
const themeUnlockError = ref("");
const backendProbeStatus = ref<BackendProbeStatus>("untested");
const backendEndpointMode = ref<BackendEndpointMode>(RUNTIME_BACKEND_DEFAULT_MODE);
const backendBaseUrl = ref(DEFAULT_BACKEND_BASE_URL);
const todayBackendBrief = ref<BackendTodayBrief | null>(null);
const todayBackendError = ref("");
const showWeekend = ref(true);
const authToken = ref("");
const authExpiresAt = ref(0);
const authMode = ref<"none" | "wechat" | "mock">("none");
const authUser = ref<AuthUserProfile | null>(null);
const authStatusHint = ref("");
const {
  dashboard: socialDashboard,
  refreshDashboard: refreshSocialDashboardData,
  clearDashboard,
} = useSocialDashboard();
const quickAuthPending = ref(false);
const quickAuthStudentNo = ref("");
const quickAuthAgreementChecked = ref(false);
const schedulePullRefreshing = ref(false);
const scheduleFetchStateByStudentId = ref<Record<string, ScheduleFetchState>>({});
const navTabRefreshPending = ref(false);
const queuedNavTabRefresh = ref<TabKey | "">("");
const isAuthed = computed(() => Boolean(authToken.value && authUser.value));
const localWallpaperUrl = ref("");
const themeImageMap = ref<Partial<Record<ThemeKey, string>>>({});
const themeImageUpdatedAt = ref(0);
const themeWallpaperEnabled = ref(true);
const themeWallpaperBlurEnabled = ref(true);
const themeWallpaperEffectLevel = ref<ThemeWallpaperEffectLevel>("medium");

const { inferBackendEndpointModeByUrl, applyBackendEndpointMode, requestBackendGet, requestBackendPost } = useBackendApi({
  backendBaseUrl,
  backendEndpointMode,
  authToken,
  defaultBackendBaseUrl: DEFAULT_BACKEND_BASE_URL,
  localBackendBaseUrl: LOCAL_BACKEND_BASE_URL,
  onlineBackendBaseUrl: ONLINE_BACKEND_BASE_URL,
  storageBackendEndpointModeKey: STORAGE_BACKEND_ENDPOINT_MODE_KEY,
  storageBackendBaseUrlKey: STORAGE_BACKEND_BASE_URL_KEY,
});

const loginCandidates = computed(() => {
  return buildRegisteredUsersFromDashboard(socialDashboard.value).map((item) => ({
    studentId: item.studentId,
    name: item.name,
    description: [item.classLabel ? `班级：${item.classLabel}` : "", item.studentNo ? `学号：${item.studentNo}` : ""]
      .filter((text) => text)
      .join(" · ") || "已注册用户",
  }));
});

const {
  activeStudentId,
  includedStudentIds,
  activeSchedule,
  includedSchedules,
  hasMultipleIncluded,
  subscribedStudentIds,
  selectableStudentSchedules,
  isKnownStudentId,
  normalizeIncludedIds,
  setIncludedIds,
  syncIncludedIdsWithVisibleList,
} = useActiveScheduleState({
  studentSchedules,
  socialDashboard,
  maxCompareOwners: MAX_COMPARE_OWNERS,
  includedStorageKey: STORAGE_INCLUDED_IDS_KEY,
});
const socialActionPending = ref(false);
const practiceCourseKeys = ref<string[]>([]);
const practiceTogglePendingCourseKey = ref("");
const showNonCurrentWeekCourses = ref(false);
const dialogWeek = ref(1);
const dialogDay = ref(1);
const dialogSection = ref(1);
const dialogCourses = ref<DisplayCourse[]>([]);
const currentWeek = ref(resolveWeekByDate(new Date()));
const todayWeekday = ref(resolveWeekday(new Date()));
const {
  topSafeInset,
  capsuleReserveRight,
  leftActionsReserve,
  capsuleTopOffset,
  capsuleHeight,
  scheduleSwipeViewportWidth,
  resolveTopSafeInset,
  syncScheduleSwipeViewportWidth,
} = useScheduleViewport();

const isAnyModalOpen = computed(() => {
  return (
    showIncludePicker.value ||
    showUserPicker.value ||
    showCourseDialog.value ||
    showWeekPicker.value ||
    showThemeUnlockDialog.value ||
    showBackendProbeDialog.value ||
    showQuickAuthDialog.value
  );
});

const {
  ignoreTapUntil,
  scheduleTrackStyle,
  onScheduleTouchStart,
  onScheduleTouchMove,
  onScheduleTouchEnd,
  onScheduleTouchCancel,
  onScheduleMouseDown,
  onScheduleMouseCancel,
} = useScheduleWeekSwipe({
  activeTab,
  isAnyModalOpen,
  selectedWeek,
  termMaxWeek,
  scheduleSwipeViewportWidth,
  syncScheduleSwipeViewportWidth,
});

const { getOwnerDotStyle, getOwnerMarkerStyle, getCourseCardStyle, getCellStyle, getCellTextStyle } = useScheduleCellStyles({
  themeKey,
  hasMultipleIncluded,
  studentSchedules,
});

const backendProbeStatusLabel = computed(() => {
  if (backendProbeStatus.value === "online") {
    return "在线";
  }
  if (backendProbeStatus.value === "offline") {
    return "离线";
  }
  return "未测试";
});

const backendEndpointModeLabel = computed(() => {
  return backendEndpointMode.value === "online" ? "线上" : "本地";
});

const scheduleSourceLabel = computed(() => {
  if (scheduleDataSource.value === "backend") {
    return "后端实时";
  }
  if (scheduleDataSource.value === "cache") {
    return "本地缓存";
  }
  return "前端本地兜底";
});

const scheduleCacheTimeLabel = computed(() => {
  if (scheduleCacheAt.value <= 0) {
    return "无";
  }
  const date = new Date(scheduleCacheAt.value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
});

const authStatusLabel = computed(() => {
  if (!authUser.value || !authToken.value) {
    return "";
  }
  if (!authUser.value.studentId) {
    return "已登录（未绑定课表）";
  }
  const modeLabel = authMode.value === "wechat" ? "微信" : "开发";
  return `${modeLabel}已授权`;
});

const normalizeThemeImageMap = (raw: unknown): Partial<Record<ThemeKey, string>> => {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const result: Partial<Record<ThemeKey, string>> = {};
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [rawThemeKey, rawUrl] of entries) {
    const theme = String(rawThemeKey || "").trim() as ThemeKey;
    const isKnownTheme = themeOptions.some((item) => item.key === theme);
    if (!isKnownTheme) {
      continue;
    }
    const imageUrl = String(rawUrl || "").trim();
    if (!imageUrl) {
      continue;
    }
    result[theme] = imageUrl;
  }
  return result;
};

const persistThemeImageMapToStorage = (nextMap: Partial<Record<ThemeKey, string>>, updatedAt = Date.now()) => {
  uni.setStorageSync(STORAGE_THEME_IMAGE_MAP_KEY, JSON.stringify(nextMap));
  uni.setStorageSync(STORAGE_THEME_IMAGE_UPDATED_AT_KEY, Number(updatedAt || 0));
};

const restoreThemeImageMapFromStorage = () => {
  const raw = uni.getStorageSync(STORAGE_THEME_IMAGE_MAP_KEY);
  let parsed: unknown = {};
  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      parsed = {};
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }
  themeImageMap.value = normalizeThemeImageMap(parsed);
  themeImageUpdatedAt.value = Number(uni.getStorageSync(STORAGE_THEME_IMAGE_UPDATED_AT_KEY) || 0);
};

const resolveThemeImageUrl = (rawUrl: string) => {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (!trimmed.startsWith("/")) {
    return "";
  }
  const base = String(backendBaseUrl.value || DEFAULT_BACKEND_BASE_URL).trim().replace(/\/+$/, "");
  if (!base) {
    return "";
  }
  return `${base}${trimmed}`;
};

const activeThemePatternImageUrl = computed(() => {
  const raw = String(themeImageMap.value[themeKey.value] || "").trim();
  return resolveThemeImageUrl(raw);
});

const hasThemePatternImage = computed(() => themeWallpaperEnabled.value && Boolean(activeThemePatternImageUrl.value));
const isThemeWallpaperTab = computed(() => activeTab.value === "today" || activeTab.value === "schedule");
const isThemeWallpaperEffectTab = computed(() => activeTab.value === "schedule");
const shouldUseThemeWallpaperBackground = computed(() => isThemeWallpaperTab.value && hasThemePatternImage.value);
const themeWallpaperEffectMap: Record<ThemeWallpaperEffectLevel, { blurRadius: number; maskColor: string }> = {
  light: { blurRadius: 20, maskColor: "rgba(70, 75, 88, 0.28)" },
  medium: { blurRadius: 30, maskColor: "rgba(70, 75, 88, 0.38)" },
  heavy: { blurRadius: 40, maskColor: "rgba(70, 75, 88, 0.46)" },
};
const pageBackgroundImageSrc = computed(() => {
  if (shouldUseThemeWallpaperBackground.value) {
    return activeThemePatternImageUrl.value;
  }
  return "/static/background.png";
});
const pageBackgroundBlurEnabled = computed(() => {
  if (!isThemeWallpaperEffectTab.value || !shouldUseThemeWallpaperBackground.value) {
    return false;
  }
  return themeWallpaperBlurEnabled.value;
});
const pageBackgroundBlurRadius = computed(() => {
  if (!isThemeWallpaperEffectTab.value || !shouldUseThemeWallpaperBackground.value) {
    return 0;
  }
  return themeWallpaperEffectMap[themeWallpaperEffectLevel.value].blurRadius;
});
const TODAY_PAGE_BACKGROUND_MASK_GRADIENT =
  "linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.84) 20%, rgba(255, 255, 255, 0.96) 58%, rgba(255, 255, 255, 0.99) 100%)";
const pageBackgroundMaskColor = computed(() => {
  if (activeTab.value === "today") {
    return TODAY_PAGE_BACKGROUND_MASK_GRADIENT;
  }
  if (!shouldUseThemeWallpaperBackground.value) {
    return "var(--bg)";
  }
  if (isThemeWallpaperEffectTab.value) {
    return themeWallpaperEffectMap[themeWallpaperEffectLevel.value].maskColor;
  }
  return "rgba(70, 75, 88, 0.28)";
});

const syncThemeWallpaperEnabledFromStorage = () => {
  themeWallpaperEnabled.value = readStorageBoolean(STORAGE_THEME_WALLPAPER_ENABLED_KEY, true);
};

const syncThemeWallpaperBlurEnabledFromStorage = () => {
  themeWallpaperBlurEnabled.value = readStorageBoolean(STORAGE_THEME_WALLPAPER_BLUR_ENABLED_KEY, true);
};

const resolveThemeWallpaperEffectLevel = (raw: unknown): ThemeWallpaperEffectLevel => {
  const value = String(raw || "").trim();
  if (value === "light" || value === "medium" || value === "heavy") {
    return value;
  }
  return "medium";
};

const syncThemeWallpaperEffectLevelFromStorage = () => {
  themeWallpaperEffectLevel.value = resolveThemeWallpaperEffectLevel(
    uni.getStorageSync(STORAGE_THEME_WALLPAPER_EFFECT_LEVEL_KEY),
  );
};

const pageThemeStyle = computed((): Record<string, string> => {
  const imageUrl = activeThemePatternImageUrl.value;
  if (!imageUrl) {
    return {
      "--bg-pattern-image": "none",
      "--bg-pattern-size": "auto",
      "--bg-pattern-position": "center",
      "--bg-pattern-repeat": "no-repeat",
    };
  }
  const escapedImageUrl = imageUrl.replace(/"/g, '\\"');
  return {
    "--bg-pattern-image": `url("${escapedImageUrl}")`,
    "--bg-pattern-size": "cover",
    "--bg-pattern-position": "center",
    "--bg-pattern-repeat": "no-repeat",
  };
});

const refreshThemeImageMap = async () => {
  try {
    const response = await requestBackendGet<BackendThemeImagesResponse>("/api/theme-images");
    const nextMap = normalizeThemeImageMap(response.images || {});
    const updatedAt = Number(response.updatedAt || Date.now());
    if (updatedAt > 0 && themeImageUpdatedAt.value > 0 && updatedAt < themeImageUpdatedAt.value) {
      return;
    }
    themeImageMap.value = nextMap;
    themeImageUpdatedAt.value = updatedAt;
    persistThemeImageMapToStorage(nextMap, updatedAt);
  } catch (error) {
    // 静默失败，保留本地缓存
  }
};

const isCurrentUserAdmin = computed(() => {
  return Boolean(socialDashboard.value?.me?.isAdmin);
});

const clearAuthSession = () => {
  authToken.value = "";
  authExpiresAt.value = 0;
  authUser.value = null;
  authMode.value = "none";
  practiceCourseKeys.value = [];
  practiceTogglePendingCourseKey.value = "";
  clearDashboard();
  activeStudentId.value = "";
  setIncludedIds([]);
  showUserPicker.value = false;
  uni.removeStorageSync(STORAGE_AUTH_TOKEN_KEY);
  uni.removeStorageSync(STORAGE_AUTH_EXPIRES_AT_KEY);
  uni.removeStorageSync(STORAGE_AUTH_USER_KEY);
  uni.removeStorageSync(STORAGE_AUTH_MODE_KEY);
  clearRuntimeScheduleData();
};

const persistAuthSession = () => {
  if (!authToken.value || !authUser.value) {
    clearAuthSession();
    return;
  }
  uni.setStorageSync(STORAGE_AUTH_TOKEN_KEY, authToken.value);
  uni.setStorageSync(STORAGE_AUTH_EXPIRES_AT_KEY, authExpiresAt.value);
  uni.setStorageSync(STORAGE_AUTH_USER_KEY, JSON.stringify(authUser.value));
  uni.setStorageSync(STORAGE_AUTH_MODE_KEY, authMode.value);
};

const resolveRequestErrorMessage = (error: unknown, fallback = "请求失败") => {
  const rawMessage = error instanceof Error ? String(error.message || "").trim() : "";
  if (!rawMessage) {
    return fallback;
  }
  if (/timeout/i.test(rawMessage)) {
    return "网络较慢，请稍后重试";
  }
  if (/request:fail/i.test(rawMessage)) {
    return "网络请求失败，请检查网络或后端地址";
  }
  return rawMessage;
};

const normalizePracticeCourseKeys = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const key = normalizePracticeCourseKey(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  return result;
};

const practiceCourseKeySet = computed(() => new Set(practiceCourseKeys.value));

const getCoursePracticeKey = (course: CourseItem) => {
  const fromPayload = normalizePracticeCourseKey((course as { practiceCourseKey?: unknown }).practiceCourseKey);
  if (fromPayload) {
    return fromPayload;
  }
  return buildCoursePracticeKey(course);
};

const isPracticeCourse = (course: DisplayCourse) => {
  if (!isAuthed.value) {
    return false;
  }
  if (!activeStudentId.value || course.ownerId !== activeStudentId.value) {
    return false;
  }
  const key = getCoursePracticeKey(course);
  if (!key) {
    return false;
  }
  return practiceCourseKeySet.value.has(key);
};

const canTogglePracticeCourse = (course: DisplayCourse) => {
  if (!isAuthed.value) {
    return false;
  }
  if (!activeStudentId.value || course.ownerId !== activeStudentId.value) {
    return false;
  }
  return Boolean(getCoursePracticeKey(course));
};

useModalScrollLock(isAnyModalOpen);

const formatScheduleOwnerName = (schedule: StudentSchedule) => {
  return schedule.classLabel ? `${schedule.name}（${schedule.classLabel}）` : schedule.name;
};

const buildWeekDisplayCourses = (week: number) => {
  const merged: DisplayCourse[] = [];
  for (const schedule of includedSchedules.value) {
    const courses = getWeekCourses(schedule, week);
    for (const course of courses) {
      merged.push({ ...course, ownerId: schedule.id, ownerName: formatScheduleOwnerName(schedule) });
    }
  }

  return merged.sort(
    (a, b) => a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection || a.ownerName.localeCompare(b.ownerName),
  );
};

const buildWeekCellMap = (courses: DisplayCourse[]) => {
  const map: Record<string, DisplayCourse[]> = {};
  for (const course of courses) {
    for (let section = course.startSection; section <= course.endSection; section += 1) {
      const key = `${course.day}-${section}`;
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(course);
    }
  }
  return map;
};

const selectedWeekCourses = computed<DisplayCourse[]>(() => buildWeekDisplayCourses(selectedWeek.value));
const selectedWeekCellMap = computed(() => buildWeekCellMap(selectedWeekCourses.value));

const allTermCellMap = computed(() => {
  const map: Record<string, DisplayCourse[]> = {};
  for (const schedule of includedSchedules.value) {
    for (const course of schedule.courses) {
      const displayCourse: DisplayCourse = {
        ...course,
        ownerId: schedule.id,
        ownerName: formatScheduleOwnerName(schedule),
      };
      for (let section = course.startSection; section <= course.endSection; section += 1) {
        const key = `${course.day}-${section}`;
        if (!map[key]) {
          map[key] = [];
        }
        map[key].push(displayCourse);
      }
    }
  }
  return map;
});

const normalizeClassroomLabel = (classroom?: string | null) => {
  const text = (classroom || "").trim().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }
  return text;
};

const pickCellClassroomLabel = (courses: DisplayCourse[]) => {
  const labels = Array.from(new Set(courses.map((course) => normalizeClassroomLabel(course.classroom)).filter((item) => item !== "")));
  return labels[0] || "";
};

const resolveWeekCellCourses = (week: number, weekCellMap: Record<string, DisplayCourse[]>, day: number, section: number) => {
  const key = `${day}-${section}`;
  const weekCourses = weekCellMap[key] ?? [];
  if (weekCourses.length > 0) {
    return { courses: weekCourses, isOutOfWeek: false };
  }
  if (!showNonCurrentWeekCourses.value) {
    return { courses: [] as DisplayCourse[], isOutOfWeek: false };
  }
  const outOfWeekCourses = allTermCellMap.value[key] ?? [];
  if (outOfWeekCourses.length > 0) {
    return { courses: outOfWeekCourses, isOutOfWeek: true };
  }
  return { courses: [] as DisplayCourse[], isOutOfWeek: false };
};

const buildGridRowsForWeek = (week: number, weekCellMap: Record<string, DisplayCourse[]>): GridRow[] => {
  const resolveDisplayCourses = (day: number, section: number) => {
    return resolveWeekCellCourses(week, weekCellMap, day, section);
  };

  const getCellSignature = (courses: DisplayCourse[]) => {
    if (courses.length === 0) {
      return "";
    }
    return courses
      .map((course) => `${course.ownerId}:${course.id}`)
      .sort((a, b) => a.localeCompare(b))
      .join("|");
  };

  return sectionTimes.value.map((slot) => {
    const cells = Array.from({ length: 7 }, (_, dayIndex) => {
      const day = dayIndex + 1;
      const { courses, isOutOfWeek } = resolveDisplayCourses(day, slot.section);
      const prevCourses = resolveDisplayCourses(day, slot.section - 1).courses;
      const nextCourses = resolveDisplayCourses(day, slot.section + 1).courses;
      const prevPart = sectionTimes.value[slot.section - 2]?.part;
      const nextPart = sectionTimes.value[slot.section]?.part;
      const signature = getCellSignature(courses);
      const prevSignature = getCellSignature(prevCourses);
      const nextSignature = getCellSignature(nextCourses);
      let showLabel = false;
      let labelSpan = 1;

      if (signature !== "") {
        let groupStart = slot.section;
        while (groupStart > 1) {
          const upperPart = sectionTimes.value[groupStart - 2]?.part;
          const upperSignature = getCellSignature(resolveDisplayCourses(day, groupStart - 1).courses);
          if (upperPart !== slot.part || upperSignature !== signature) {
            break;
          }
          groupStart -= 1;
        }

        let groupEnd = slot.section;
        while (groupEnd < sectionTimes.value.length) {
          const lowerPart = sectionTimes.value[groupEnd]?.part;
          const lowerSignature = getCellSignature(resolveDisplayCourses(day, groupEnd + 1).courses);
          if (lowerPart !== slot.part || lowerSignature !== signature) {
            break;
          }
          groupEnd += 1;
        }

        labelSpan = groupEnd - groupStart + 1;
        showLabel = slot.section === groupStart;
      }

      return {
        busy: courses.length > 0,
        labels: Array.from(new Set(courses.map((course) => course.name))),
        classroomLabel: pickCellClassroomLabel(courses),
        ownerIds: Array.from(new Set(courses.map((course) => course.ownerId))),
        hasPracticeCourse: courses.some((course) => isPracticeCourse(course)),
        showLabel,
        labelSpan,
        part: slot.part,
        isOutOfWeek,
        mergeWithPrev: signature !== "" && prevPart === slot.part && prevSignature === signature,
        mergeWithNext: signature !== "" && nextPart === slot.part && nextSignature === signature,
      };
    });

    return {
      section: slot.section,
      time: slot.start,
      part: slot.part,
      isPartStart: slot.section === 1 || sectionTimes.value[slot.section - 2]?.part !== slot.part,
      cells,
    };
  });
};

const schedulePanelWeeks = computed(() => {
  return {
    prev: Math.max(1, selectedWeek.value - 1),
    current: selectedWeek.value,
    next: Math.min(termMaxWeek.value, selectedWeek.value + 1),
  };
});

const scheduleWeekCellMaps = computed(() => {
  const map: Record<number, Record<string, DisplayCourse[]>> = {};
  const uniqueWeeks = Array.from(new Set([schedulePanelWeeks.value.prev, schedulePanelWeeks.value.current, schedulePanelWeeks.value.next]));
  for (const week of uniqueWeeks) {
    map[week] = buildWeekCellMap(buildWeekDisplayCourses(week));
  }
  return map;
});

const scheduleWeekPanels = computed<ScheduleWeekPanel[]>(() => {
  const panelDefs: Array<{ role: WeekPanelRole; week: number }> = [
    { role: "prev", week: schedulePanelWeeks.value.prev },
    { role: "current", week: schedulePanelWeeks.value.current },
    { role: "next", week: schedulePanelWeeks.value.next },
  ];
  return panelDefs.map((panel) => {
    const cellMap = scheduleWeekCellMaps.value[panel.week] ?? {};
    return {
      role: panel.role,
      week: panel.week,
      rows: buildGridRowsForWeek(panel.week, cellMap),
    };
  });
});

const gridRows = computed<GridRow[]>(() => {
  return scheduleWeekPanels.value.find((panel) => panel.role === "current")?.rows ?? [];
});

const nextUpcomingCourse = computed(() => {
  if (selectedWeek.value !== currentWeek.value) {
    return null;
  }

  const courses = selectedWeekCourses.value.filter((course) => course.day === todayWeekday.value);
  if (courses.length === 0) {
    return null;
  }

  const now = Date.now();
  let target: { course: DisplayCourse; startTs: number } | null = null;

  for (const course of courses) {
    const sectionStart = sectionTimes.value[course.startSection - 1];
    const sectionEnd = sectionTimes.value[course.endSection - 1];
    if (!sectionStart) {
      continue;
    }
    const [startHour, startMinute] = sectionStart.start.split(":").map((item) => Number(item));
    const [endHour, endMinute] = (sectionEnd?.end ?? sectionStart.end).split(":").map((item) => Number(item));
    const startDate = new Date();
    const endDate = new Date();
    startDate.setHours(startHour, startMinute, 0, 0);
    endDate.setHours(endHour, endMinute, 0, 0);
    const startTs = startDate.getTime();
    const endTs = endDate.getTime();

    if (endTs < now) {
      continue;
    }
    if (!target || startTs < target.startTs) {
      target = { course, startTs };
    }
  }

  return target?.course ?? null;
});

const todayInfo = computed(() => {
  const now = new Date();
  const week = resolveWeekByDate(now);
  const weekday = resolveWeekday(now);
  return {
    week,
    weekday,
    weekdayLabel: weekdayLabels.value[weekday - 1],
    dateLabel: formatMonthDay(now),
  };
});

const todayCourses = computed<DisplayCourse[]>(() => {
  const week = todayInfo.value.week;
  const weekday = todayInfo.value.weekday;
  const merged: DisplayCourse[] = [];

  for (const schedule of includedSchedules.value) {
    const courses = getWeekCourses(schedule, week).filter((course) => course.day === weekday);
    for (const course of courses) {
      merged.push({ ...course, ownerId: schedule.id, ownerName: formatScheduleOwnerName(schedule) });
    }
  }

  return merged.sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection || a.ownerName.localeCompare(b.ownerName));
});

const getCourseStartEndTs = (course: DisplayCourse) => {
  const sectionStart = sectionTimes.value[course.startSection - 1];
  const sectionEnd = sectionTimes.value[course.endSection - 1];
  if (!sectionStart || !sectionEnd) {
    return null;
  }
  const start = new Date();
  const end = new Date();
  const [startHour, startMinute] = sectionStart.start.split(":").map((item) => Number(item));
  const [endHour, endMinute] = sectionEnd.end.split(":").map((item) => Number(item));
  start.setHours(startHour, startMinute, 0, 0);
  end.setHours(endHour, endMinute, 0, 0);
  return {
    startTs: start.getTime(),
    endTs: end.getTime(),
  };
};

const todayFocusInfo = computed<{
  course: DisplayCourse;
  status: "upcoming" | "ongoing";
  startTs: number;
  endTs: number;
} | null>(() => {
  if (todayCourses.value.length === 0) {
    return null;
  }

  const now = Date.now();
  let upcoming: { course: DisplayCourse; startTs: number; endTs: number } | null = null;
  let ongoing: { course: DisplayCourse; startTs: number; endTs: number } | null = null;

  for (const course of todayCourses.value) {
    const timeRange = getCourseStartEndTs(course);
    if (!timeRange) {
      continue;
    }
    if (timeRange.startTs <= now && now < timeRange.endTs) {
      if (!ongoing || timeRange.endTs < ongoing.endTs) {
        ongoing = { course, ...timeRange };
      }
      continue;
    }
    if (timeRange.startTs > now) {
      if (!upcoming || timeRange.startTs < upcoming.startTs) {
        upcoming = { course, ...timeRange };
      }
    }
  }

  if (ongoing) {
    return { ...ongoing, status: "ongoing" };
  }
  if (upcoming) {
    return { ...upcoming, status: "upcoming" };
  }
  return null;
});

const todayFocusCourse = computed(() => {
  return todayFocusInfo.value?.course ?? null;
});

const fallbackGreeting = computed(() => {
  const hour = new Date().getHours();
  let prefix = "你好";
  if (hour < 6) {
    prefix = "夜深了";
  } else if (hour < 12) {
    prefix = "早上好";
  } else if (hour < 18) {
    prefix = "下午好";
  } else {
    prefix = "晚上好";
  }
  return `${prefix}，${activeSchedule.value.name}`;
});

const todaySectionLoad = computed(() => {
  return todayCourses.value.reduce((total, course) => total + (course.endSection - course.startSection + 1), 0);
});

const todayGreetingText = computed(() => {
  return todayBackendBrief.value?.greeting || fallbackGreeting.value;
});

const todayFocusStatusText = computed(() => {
  const info = todayFocusInfo.value;
  if (!info) {
    return todayCourses.value.length > 0 ? "今日课程已结束" : "今天暂时没有课程安排";
  }
  const now = Date.now();
  if (info.status === "ongoing") {
    const minutes = Math.max(1, Math.ceil((info.endTs - now) / (60 * 1000)));
    return `${minutes} 分钟后下课`;
  }
  const minutes = Math.max(1, Math.ceil((info.startTs - now) / (60 * 1000)));
  return `${minutes} 分钟后上课`;
});

const inferBuildingLabel = (classroom?: string | null) => {
  const text = (classroom || "").replace(/\s+/g, "");
  if (!text) {
    return "教学楼待定";
  }
  if (/^(10-|十教)/.test(text)) {
    return "10教";
  }
  if (/^[123]-|^[一二三]教/.test(text)) {
    return "1-3教";
  }
  if (/^[5678]-|^[五六七八]教/.test(text)) {
    return "5-8教";
  }
  return "教学楼";
};

const estimateCommuteMinutes = (classroom?: string | null) => {
  const building = inferBuildingLabel(classroom);
  if (building === "10教" || building === "1-3教") {
    return 10;
  }
  if (building === "5-8教") {
    return 5;
  }
  return 7;
};

const subtractMinutesFromTime = (timeText: string, minutes: number) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeText || "").trim());
  if (!match) {
    return "--:--";
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return "--:--";
  }
  const totalMinutes = Math.max(0, hour * 60 + minute - Math.max(0, minutes));
  const outHour = `${Math.floor(totalMinutes / 60)}`.padStart(2, "0");
  const outMinute = `${totalMinutes % 60}`.padStart(2, "0");
  return `${outHour}:${outMinute}`;
};

const departureReminder = computed(() => {
  const next = todayBackendBrief.value?.nextCourse;
  if (next) {
    const commuteMinutes = next.commuteMinutes > 0 ? next.commuteMinutes : estimateCommuteMinutes(next.classroom);
    const leaveAt = subtractMinutesFromTime(next.startTime, commuteMinutes);
    return {
      courseName: next.name,
      timeRange: `${next.startTime}-${next.endTime}`,
      commuteMinutes,
      leaveAt,
    };
  }

  const info = todayFocusInfo.value;
  if (!info || info.status !== "upcoming") {
    return null;
  }
  const commuteMinutes = estimateCommuteMinutes(info.course.classroom);
  const startTime = sectionTimes.value[info.course.startSection - 1]?.start ?? "--:--";
  return {
    courseName: info.course.name,
    timeRange: `${startTime}-${sectionTimes.value[info.course.endSection - 1]?.end ?? "--:--"}`,
    commuteMinutes,
    leaveAt: subtractMinutesFromTime(startTime, commuteMinutes),
  };
});

const shouldShowStudyCard = computed(() => {
  if (todayCourses.value.length > 0) {
    return true;
  }
  if (todayFocusCourse.value) {
    return true;
  }
  if (departureReminder.value) {
    return true;
  }
  return false;
});

const isFocusCourse = (course: DisplayCourse) => {
  const focus = todayFocusCourse.value;
  if (!focus) {
    return false;
  }
  return focus.ownerId === course.ownerId && focus.id === course.id;
};

const formatCourseClassroom = (course: DisplayCourse) => {
  return (course.classroom || "").trim() || "待排教室";
};

const formatCourseTeacher = (course: DisplayCourse) => {
  return (course.teacher || "").trim() || "待同步";
};

const formatCourseTeachingClasses = (course: DisplayCourse) => {
  return (course.teachingClasses || "").trim() || "待同步";
};

const isTodayColumn = (week: number, day: number) => {
  return week === currentWeek.value && day === todayWeekday.value;
};

const SCHEDULE_TABLE_TOP_ANCHOR_ID = "schedule-table-top-anchor";

const clearScheduleTableScrollIntoViewResetTimer = () => {
  if (!scheduleTableScrollIntoViewResetTimer) {
    return;
  }
  clearTimeout(scheduleTableScrollIntoViewResetTimer);
  scheduleTableScrollIntoViewResetTimer = null;
};

const triggerScheduleTableScrollIntoView = (targetId: string) => {
  clearScheduleTableScrollIntoViewResetTimer();
  if (scheduleTableScrollIntoViewId.value === targetId) {
    scheduleTableScrollIntoViewId.value = "";
    nextTick(() => {
      scheduleTableScrollIntoViewId.value = targetId;
      scheduleTableScrollIntoViewResetTimer = setTimeout(() => {
        scheduleTableScrollIntoViewId.value = "";
        scheduleTableScrollIntoViewResetTimer = null;
      }, 120);
    });
    return;
  }
  scheduleTableScrollIntoViewId.value = targetId;
  scheduleTableScrollIntoViewResetTimer = setTimeout(() => {
    scheduleTableScrollIntoViewId.value = "";
    scheduleTableScrollIntoViewResetTimer = null;
  }, 120);
};

const scrollScheduleTableToTop = () => {
  nextTick(() => {
    triggerScheduleTableScrollIntoView(SCHEDULE_TABLE_TOP_ANCHOR_ID);
  });
};

const normalizeStudentSchedulePayload = (payload: BackendSchedulePayload) => {
  const rows = Array.isArray(payload.students) ? payload.students : [];
  return rows
    .filter((row) => row && typeof row.id === "string" && typeof row.name === "string")
    .map((row) => ({
      id: row.id,
      name: row.name,
      studentNo: row.studentNo,
      classLabel: row.classLabel,
      courses: (row.courses || []).map((course) => ({
        id: course.id,
        name: course.name,
        day: Number(course.day),
        startSection: Number(course.startSection),
        endSection: Number(course.endSection),
        weekExpr: course.weekExpr,
        parity: course.parity,
        classroom: course.classroom ?? null,
        teacher: course.teacher ?? null,
        teachingClasses: course.teachingClasses ?? null,
        practiceCourseKey: getCoursePracticeKey(course),
      })),
    })) as StudentSchedule[];
};

const normalizeSingleStudentSchedulePayload = (payload: BackendSingleSchedulePayload) => {
  const student = payload.student;
  if (!student || typeof student.id !== "string" || typeof student.name !== "string") {
    return null;
  }
  const rows = normalizeStudentSchedulePayload({ students: [student] });
  return rows[0] || null;
};

const normalizeScheduleWeek1Monday = (value: unknown) => {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  return DEFAULT_TERM_WEEK1_MONDAY;
};

const normalizeScheduleMaxWeek = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TERM_MAX_WEEK;
  }
  return Math.max(1, Math.floor(parsed));
};

const normalizeScheduleSectionTimes = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [...localSectionTimes];
  }
  const rows = value
    .map((item) => {
      const row = item as Partial<SectionTime>;
      const section = Number(row.section);
      const start = String(row.start || "").trim();
      const end = String(row.end || "").trim();
      const part = row.part === "上午" || row.part === "下午" || row.part === "晚上" ? row.part : "";
      if (!Number.isFinite(section) || section <= 0 || !start || !end || !part) {
        return null;
      }
      return {
        section: Math.floor(section),
        start,
        end,
        part,
      } as SectionTime;
    })
    .filter((item): item is SectionTime => Boolean(item))
    .sort((a, b) => a.section - b.section);
  if (rows.length === 0) {
    return [...localSectionTimes];
  }
  return rows;
};

const normalizeScheduleWeekdayLabels = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [...localWeekdayLabels];
  }
  const rows = value.map((item) => String(item || "").trim()).filter((item) => item !== "");
  if (rows.length !== 7) {
    return [...localWeekdayLabels];
  }
  return rows;
};

const syncWeekValues = () => {
  currentWeek.value = resolveWeekByDate(new Date());
  if (selectedWeek.value > termMaxWeek.value) {
    selectedWeek.value = termMaxWeek.value;
  }
  if (selectedWeek.value < 1) {
    selectedWeek.value = 1;
  }
};

const applyRuntimeScheduleMeta = (payload?: BackendSchedulePayload) => {
  runtimeTermWeek1Monday.value = normalizeScheduleWeek1Monday(payload?.term?.week1Monday);
  runtimeTermMaxWeek.value = normalizeScheduleMaxWeek(payload?.term?.maxWeek);
  runtimeSectionTimes.value = normalizeScheduleSectionTimes(payload?.sectionTimes);
  runtimeWeekdayLabels.value = normalizeScheduleWeekdayLabels(payload?.weekdayLabels);
  syncWeekValues();
};

const sortRuntimeScheduleRows = (rows: StudentSchedule[]) => {
  const order = new Map(loginCandidates.value.map((item, index) => [item.studentId, index]));
  return [...rows].sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name, "zh-CN");
  });
};

const applyRuntimeStudentSchedules = (rows: StudentSchedule[], source: ScheduleDataSource, cacheTime: number) => {
  runtimeStudentSchedules.value = sortRuntimeScheduleRows(rows);
  scheduleDataSource.value = source;
  scheduleCacheAt.value = cacheTime;
  const hasActive = Boolean(activeStudentId.value && runtimeStudentSchedules.value.some((item) => item.id === activeStudentId.value));
  if (!hasActive) {
    activeStudentId.value = "";
    includedStudentIds.value = [];
    showUserPicker.value = false;
    return;
  }
  showUserPicker.value = false;
};

const mergeRuntimeScheduleCandidates = (users: SocialUserItem[]) => {
  const oldRows = new Map(runtimeStudentSchedules.value.map((item) => [item.id, item]));
  const rows = users.map((user) => {
    const existing = oldRows.get(user.studentId);
    return {
      id: user.studentId,
      name: user.name,
      studentNo: user.studentNo,
      classLabel: user.classLabel,
      courses: existing?.courses || [],
    } as StudentSchedule;
  });
  applyRuntimeStudentSchedules(rows, scheduleDataSource.value, scheduleCacheAt.value);
};

const syncDashboardStudentLists = (dashboard: SocialDashboardResponse, preferredIncludedIds: string[]) => {
  const registeredUsers = buildRegisteredUsersFromDashboard(dashboard);
  mergeRuntimeScheduleCandidates(registeredUsers);
  syncIncludedIdsWithVisibleList(preferredIncludedIds);
  return registeredUsers;
};

const clearRuntimeScheduleData = () => {
  applyRuntimeScheduleMeta();
  applyRuntimeStudentSchedules([], "local", 0);
  scheduleFetchStateByStudentId.value = {};
};

const loadScheduleForStudent = async (studentId: string) => {
  if (!studentId || !isAuthed.value) {
    return false;
  }
  try {
    const payload = await requestBackendGet<BackendSingleSchedulePayload>(
      "/api/schedules/student",
      { student_id: studentId },
      true,
    );
    const row = normalizeSingleStudentSchedulePayload(payload);
    if (!row) {
      throw new Error("EMPTY_SCHEDULE");
    }
    applyRuntimeScheduleMeta(payload as BackendSchedulePayload);
    const cacheAt = Date.now();
    const nextRows = runtimeStudentSchedules.value.map((item) => (item.id === row.id ? row : item));
    if (!nextRows.some((item) => item.id === row.id)) {
      nextRows.push(row);
    }
    applyRuntimeStudentSchedules(nextRows, "backend", cacheAt);
    uni.setStorageSync(STORAGE_SCHEDULE_CACHE_SOURCE_KEY, "backend");
    return true;
  } catch (error) {
    return false;
  }
};

const hasScheduleCoursesLoaded = (studentId: string) => {
  const row = runtimeStudentSchedules.value.find((item) => item.id === studentId);
  return Boolean(row && Array.isArray(row.courses) && row.courses.length > 0);
};

const getScheduleFetchState = (studentId: string): ScheduleFetchState => {
  const state = scheduleFetchStateByStudentId.value[studentId];
  if (state) {
    return state;
  }
  return hasScheduleCoursesLoaded(studentId) ? "ready" : "idle";
};

const setScheduleFetchState = (studentId: string, state: ScheduleFetchState) => {
  if (!studentId) {
    return;
  }
  scheduleFetchStateByStudentId.value = {
    ...scheduleFetchStateByStudentId.value,
    [studentId]: state,
  };
};

const ensureScheduleLoaded = async (studentId: string) => {
  if (!studentId || !isAuthed.value || backendProbeStatus.value !== "online") {
    return false;
  }
  if (hasScheduleCoursesLoaded(studentId)) {
    setScheduleFetchState(studentId, "ready");
    return true;
  }
  if (getScheduleFetchState(studentId) === "loading") {
    return false;
  }
  setScheduleFetchState(studentId, "loading");
  const success = await loadScheduleForStudent(studentId);
  setScheduleFetchState(studentId, success ? "ready" : "error");
  return success;
};

const ensureIncludedSchedulesLoaded = async (studentIds: string[]) => {
  if (!isAuthed.value || backendProbeStatus.value !== "online") {
    return;
  }
  const targets = Array.from(new Set(studentIds)).filter((studentId) => isKnownStudentId(studentId));
  await Promise.all(targets.map((studentId) => ensureScheduleLoaded(studentId)));
};

const includeStatusByStudentId = computed<Record<string, string>>(() => {
  const subscribedSet = new Set(subscribedStudentIds.value);
  const statusMap: Record<string, string> = {};
  for (const student of selectableStudentSchedules.value) {
    const relation = student.id === activeStudentId.value ? "本人" : subscribedSet.has(student.id) ? "已订阅" : "未订阅";
    let pullStatus = "未拉取";
    if (backendProbeStatus.value !== "online") {
      pullStatus = "后端离线";
    } else {
      const state = getScheduleFetchState(student.id);
      if (state === "loading") {
        pullStatus = "拉取中";
      } else if (state === "ready") {
        pullStatus = "已拉取";
      } else if (state === "error") {
        pullStatus = "拉取失败";
      }
    }
    statusMap[student.id] = `${relation} · ${pullStatus}`;
  }
  return statusMap;
});

const refreshScheduleData = async () => {
  if (!isAuthed.value || backendProbeStatus.value !== "online") {
    clearRuntimeScheduleData();
    return false;
  }
  if (!activeStudentId.value) {
    applyRuntimeScheduleMeta();
    scheduleDataSource.value = "local";
    scheduleCacheAt.value = 0;
    return false;
  }
  return loadScheduleForStudent(activeStudentId.value);
};

const runBackendProbe = async () => {
  try {
    await requestBackendGet<{ status?: string }>("/health");
    backendProbeStatus.value = "online";
    todayBackendError.value = "";
    return true;
  } catch (error) {
    backendProbeStatus.value = "offline";
    todayBackendError.value = "后端连接失败，请确认服务是否已启动。";
    return false;
  }
};

const parseStoredAuthUser = (raw: unknown): AuthUserProfile | null => {
  if (!raw) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return parseStoredAuthUser(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }
  if (typeof raw !== "object") {
    return null;
  }
  const data = raw as Partial<AuthUserProfile>;
  if (!data.openId) {
    return null;
  }
  return {
    openId: String(data.openId),
    studentId: String(data.studentId || ""),
    studentName: String(data.studentName || ""),
    classLabel: String(data.classLabel || ""),
    nickname: String(data.nickname || ""),
    avatarUrl: String(data.avatarUrl || ""),
  };
};

const restoreAuthSessionFromStorage = () => {
  const token = String(uni.getStorageSync(STORAGE_AUTH_TOKEN_KEY) || "").trim();
  const expiresAt = Number(uni.getStorageSync(STORAGE_AUTH_EXPIRES_AT_KEY) || 0);
  const mode = String(uni.getStorageSync(STORAGE_AUTH_MODE_KEY) || "").trim();
  const user = parseStoredAuthUser(uni.getStorageSync(STORAGE_AUTH_USER_KEY));
  if (!token || !user || expiresAt <= 0) {
    clearAuthSession();
    return;
  }
  authToken.value = token;
  authExpiresAt.value = expiresAt;
  authMode.value = mode === "wechat" ? "wechat" : "mock";
  authUser.value = user;
};

const requestAuthProfile = async () => {
  const response = await requestBackendGet<BackendAuthMeResponse>("/api/auth/me", {}, true);
  if (!response.user || !response.user.openId) {
    throw new Error("登录状态异常");
  }
  authMode.value = response.mode === "wechat" ? "wechat" : "mock";
  authExpiresAt.value = Number(response.expiresAt || 0);
  authUser.value = response.user;
  authStatusHint.value = "";
  persistAuthSession();
};

const refreshSocialDashboard = async () => {
  if (!isAuthed.value) {
    practiceCourseKeys.value = [];
    practiceTogglePendingCourseKey.value = "";
    clearDashboard();
    clearRuntimeScheduleData();
    return;
  }
  try {
    const previousIncludedIds = [...includedStudentIds.value];
    const response = await refreshSocialDashboardData(() => requestBackendGet<SocialDashboardResponse>("/api/social/me", {}, true));
    practiceCourseKeys.value = normalizePracticeCourseKeys(response.me?.practiceCourseKeys || []);
    practiceTogglePendingCourseKey.value = "";
    const cloudWallpaper = String(response.me?.wallpaperUrl || "").trim();
    localWallpaperUrl.value = cloudWallpaper;
    saveLocalWallpaperPath(cloudWallpaper);
    const preferredIncludedIds = previousIncludedIds.length > 0 ? previousIncludedIds : [];
    const registeredUsers = buildRegisteredUsersFromDashboard(response);
    const registeredIds = new Set(registeredUsers.map((item) => item.studentId));
    const currentActiveStudentId = activeStudentId.value.trim();
    const defaultStudentId = String(response.me?.studentId || "").trim();
    const nextActiveStudentId = currentActiveStudentId && registeredIds.has(currentActiveStudentId)
      ? currentActiveStudentId
      : defaultStudentId && registeredIds.has(defaultStudentId)
        ? defaultStudentId
        : "";
    activeStudentId.value = nextActiveStudentId;
    const fallbackIncludedIds = nextActiveStudentId ? [nextActiveStudentId] : [];
    syncDashboardStudentLists(response, preferredIncludedIds.length > 0 ? preferredIncludedIds : fallbackIncludedIds);
    if (!nextActiveStudentId) {
      showUserPicker.value = false;
      return;
    }
    uni.setStorageSync(STORAGE_SELECTED_STUDENT_KEY, nextActiveStudentId);
    await loadScheduleForStudent(nextActiveStudentId);
    showUserPicker.value = false;
  } catch (error) {
    practiceCourseKeys.value = [];
    practiceTogglePendingCourseKey.value = "";
    clearDashboard();
    clearRuntimeScheduleData();
  }
};

const openQuickAuthDialog = () => {
  showQuickAuthDialog.value = true;
  authStatusHint.value = "";
  quickAuthAgreementChecked.value = false;
};

const closeQuickAuthDialog = () => {
  if (quickAuthPending.value) {
    return;
  }
  showQuickAuthDialog.value = false;
};

const updateQuickAuthStudentNo = (value: string) => {
  quickAuthStudentNo.value = String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 32);
};

const updateQuickAuthAgreementChecked = (value: boolean) => {
  quickAuthAgreementChecked.value = Boolean(value);
};

const runQuickAuthLogin = async () => {
  if (quickAuthPending.value) {
    return;
  }
  if (!quickAuthAgreementChecked.value) {
    authStatusHint.value = "请先同意用户协议与隐私政策";
    uni.showToast({ title: "请先同意协议", icon: "none", duration: 1400 });
    return;
  }
  const studentNo = String(quickAuthStudentNo.value || "").trim();
  if (!studentNo) {
    authStatusHint.value = "请输入学号";
    uni.showToast({ title: "请输入学号", icon: "none", duration: 1400 });
    return;
  }
  const studentId = resolveStudentIdByStudentNo(studentNo);
  quickAuthPending.value = true;
  authStatusHint.value = "";
  try {
    const code = await fetchMiniProgramCode();
    const profile = await tryGetWechatProfile();
    const response = await requestBackendPost<BackendAuthLoginResponse>("/api/auth/wechat-login", {
      code,
      student_id: studentId || undefined,
      student_no: studentNo,
      nickname: profile.nickname || "",
      avatar_url: profile.avatarUrl || "",
      client_platform: resolveClientPlatform(),
    });
    if (!response.token || !response.user?.openId) {
      throw new Error("授权失败，请重试");
    }
    authToken.value = String(response.token || "").trim();
    authExpiresAt.value = Number(response.expiresAt || 0);
    authMode.value = response.mode === "wechat" ? "wechat" : "mock";
    authUser.value = {
      openId: String(response.user.openId || ""),
      studentId: String(response.user.studentId || ""),
      studentName: String(response.user.studentName || ""),
      classLabel: String(response.user.classLabel || ""),
      nickname: String(response.user.nickname || ""),
      avatarUrl: String(response.user.avatarUrl || ""),
    };
    persistAuthSession();
    await refreshSocialDashboard();
    showQuickAuthDialog.value = false;
    authStatusHint.value = authUser.value?.studentId ? "" : "登录成功，请先绑定一个课表账号";
    uni.showToast({ title: "授权成功", icon: "none", duration: 1200 });
  } catch (error) {
    const message = resolveRequestErrorMessage(error, "授权失败");
    authStatusHint.value = message;
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    quickAuthPending.value = false;
  }
};

async function bindNotifyChannel() {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录授权", icon: "none", duration: 1600 });
    return;
  }
  if (socialActionPending.value) {
    return;
  }
  uni.showModal({
    title: "绑定微信通知",
    content: "请输入企业微信用户ID（或 wecom://用户ID）",
    editable: true,
    success: async (result) => {
      if (!result.confirm) {
        return;
      }
      const value = String((result as { content?: string }).content || "").trim();
      if (!value) {
        uni.showToast({ title: "请输入企业微信用户ID", icon: "none", duration: 1600 });
        return;
      }
      socialActionPending.value = true;
      try {
        await requestBackendPost("/api/social/notify/bind", { channel_url: value }, true);
        uni.showToast({ title: "绑定成功", icon: "none", duration: 1200 });
        void refreshSocialDashboard();
      } catch (error) {
        const message = error instanceof Error ? error.message : "绑定失败";
        uni.showToast({ title: message, icon: "none", duration: 1800 });
      } finally {
        socialActionPending.value = false;
      }
    },
  });
}

async function unbindNotifyChannel() {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录授权", icon: "none", duration: 1600 });
    return;
  }
  if (socialActionPending.value) {
    return;
  }
  socialActionPending.value = true;
  try {
    await requestBackendPost("/api/social/notify/unbind", {}, true);
    uni.showToast({ title: "已解绑", icon: "none", duration: 1200 });
    void refreshSocialDashboard();
  } catch (error) {
    const message = error instanceof Error ? error.message : "解绑失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    socialActionPending.value = false;
  }
}

async function unsubscribeStudent(targetStudentId: string) {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录授权", icon: "none", duration: 1600 });
    return;
  }
  if (socialActionPending.value) {
    return;
  }
  socialActionPending.value = true;
  try {
    await requestBackendPost("/api/social/subscribe/remove", { target_student_id: targetStudentId }, true);
    uni.showToast({ title: "已取消订阅", icon: "none", duration: 1200 });
    await refreshSocialDashboard();
  } catch (error) {
    const message = error instanceof Error ? error.message : "取消失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    socialActionPending.value = false;
  }
}

async function togglePracticeCourse(course: DisplayCourse) {
  if (!canTogglePracticeCourse(course)) {
    uni.showToast({ title: "仅可设置本人课程", icon: "none", duration: 1600 });
    return;
  }
  const courseKey = getCoursePracticeKey(course);
  if (!courseKey) {
    uni.showToast({ title: "课程标识异常，请稍后重试", icon: "none", duration: 1600 });
    return;
  }
  if (practiceTogglePendingCourseKey.value === courseKey) {
    return;
  }
  const nextEnabled = !isPracticeCourse(course);
  practiceTogglePendingCourseKey.value = courseKey;
  try {
    const response = await requestBackendPost<BackendPracticeCourseToggleResponse>(
      "/api/social/practice-course",
      {
        course_key: courseKey,
        enabled: nextEnabled,
      },
      true,
    );
    if (Array.isArray(response.practiceCourseKeys)) {
      practiceCourseKeys.value = normalizePracticeCourseKeys(response.practiceCourseKeys);
    } else {
      const values = new Set(practiceCourseKeys.value);
      if (nextEnabled) {
        values.add(courseKey);
      } else {
        values.delete(courseKey);
      }
      practiceCourseKeys.value = [...values];
    }
    uni.showToast({
      title: nextEnabled ? "已标记实践" : "已取消实践",
      icon: "none",
      duration: 1200,
    });
  } catch (error) {
    const message = resolveRequestErrorMessage(error, "实践设置失败");
    uni.showToast({ title: message, icon: "none", duration: 1800 });
  } finally {
    if (practiceTogglePendingCourseKey.value === courseKey) {
      practiceTogglePendingCourseKey.value = "";
    }
  }
}

const refreshTodayBrief = async () => {
  if (backendProbeStatus.value !== "online") {
    return;
  }
  if (!activeStudentId.value) {
    todayBackendBrief.value = null;
    return;
  }
  try {
    const brief = await requestBackendGet<BackendTodayBrief>("/api/today-brief", { student_id: activeStudentId.value });
    todayBackendBrief.value = brief;
    todayBackendError.value = "";
  } catch (error) {
    todayBackendBrief.value = null;
    todayBackendError.value = "今日数据获取失败，已使用本地逻辑兜底。";
  }
};

const syncDisplayStateFromStorage = () => {
  syncThemeFromStorage();
  restoreThemeImageMapFromStorage();
  syncThemeWallpaperEnabledFromStorage();
  syncThemeWallpaperBlurEnabledFromStorage();
  syncThemeWallpaperEffectLevelFromStorage();
  showNonCurrentWeekCourses.value = readStorageBoolean(STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY, false);
  showWeekend.value = readStorageBoolean(STORAGE_SHOW_WEEKEND_KEY, true);
  localWallpaperUrl.value = readLocalWallpaperPath();
};

const refreshCurrentTabData = async (tab: TabKey) => {
  if (navTabRefreshPending.value) {
    queuedNavTabRefresh.value = tab;
    return;
  }
  navTabRefreshPending.value = true;
  try {
    syncDisplayStateFromStorage();
    if (!isAuthed.value) {
      todayBackendBrief.value = null;
      clearRuntimeScheduleData();
      return;
    }
    const backendReady = backendProbeStatus.value === "online" ? true : await runBackendProbe();
    if (!backendReady) {
      return;
    }
    await requestAuthProfile().catch(() => {
      clearAuthSession();
    });
    if (!isAuthed.value) {
      return;
    }
    await refreshSocialDashboard();
    if (tab === "today") {
      await refreshTodayBrief();
      return;
    }
    if (tab === "schedule") {
      await ensureIncludedSchedulesLoaded(includedStudentIds.value);
    }
  } finally {
    navTabRefreshPending.value = false;
    const queuedTab = queuedNavTabRefresh.value;
    queuedNavTabRefresh.value = "";
    if (queuedTab) {
      void refreshCurrentTabData(queuedTab);
    }
  }
};

onMounted(() => {
  resolveTopSafeInset();
  const savedWeek = Number(uni.getStorageSync(STORAGE_SELECTED_WEEK_KEY));
  if (savedWeek >= 1 && savedWeek <= termMaxWeek.value) {
    selectedWeek.value = savedWeek;
  }

  syncDisplayStateFromStorage();

  if (RUNTIME_BACKEND_DEFAULT_MODE === "local") {
    const savedMode = String(uni.getStorageSync(STORAGE_BACKEND_ENDPOINT_MODE_KEY) || "").trim();
    const legacyUrl = String(uni.getStorageSync(STORAGE_BACKEND_BASE_URL_KEY) || "").trim();
    const mode: BackendEndpointMode =
      savedMode === "local" || savedMode === "online"
        ? (savedMode as BackendEndpointMode)
        : inferBackendEndpointModeByUrl(legacyUrl || DEFAULT_BACKEND_BASE_URL);
    applyBackendEndpointMode(mode);
  } else {
    applyBackendEndpointMode("online");
  }
  void refreshThemeImageMap();
  restoreAuthSessionFromStorage();

  void runBackendProbe().then(async (ok) => {
    if (!ok) {
      clearRuntimeScheduleData();
      return;
    }
    if (isAuthed.value) {
      await requestAuthProfile().catch(() => {
        clearAuthSession();
        authStatusHint.value = "授权已过期，请重新登录";
      });
      await refreshSocialDashboard();
    } else {
      clearRuntimeScheduleData();
    }
    void refreshTodayBrief();
  });

  scrollScheduleTableToTop();
  syncScheduleSwipeViewportWidth();
});

onShow(() => {
  syncDisplayStateFromStorage();
  void refreshThemeImageMap();
  restoreAuthSessionFromStorage();
  void refreshCurrentTabData(activeTab.value);
});

const handleSchedulePullDownRefresh = async () => {
  if (schedulePullRefreshing.value || activeTab.value !== "schedule") {
    return;
  }
  schedulePullRefreshing.value = true;
  try {
    const backendReady = backendProbeStatus.value === "online" ? true : await runBackendProbe();
    if (!backendReady || !isAuthed.value) {
      return;
    }
    await requestAuthProfile().catch(() => {
      clearAuthSession();
    });
    if (!isAuthed.value) {
      return;
    }
    await refreshSocialDashboard();
    void refreshTodayBrief();
  } finally {
    schedulePullRefreshing.value = false;
    uni.stopPullDownRefresh();
  }
};

onPullDownRefresh(() => {
  void handleSchedulePullDownRefresh();
});

watch(selectedWeek, (value) => {
  uni.setStorageSync(STORAGE_SELECTED_WEEK_KEY, value);
});

watch(themeKey, (value) => {
  uni.setStorageSync(STORAGE_THEME_KEY, value);
});

watch(showWeekend, (value) => {
  uni.setStorageSync(STORAGE_SHOW_WEEKEND_KEY, Boolean(value));
});

watch(activeTab, (value) => {
  const currentIndex = tabOrder.indexOf(value);
  if (currentIndex >= 0 && !isTabSwitching.value) {
    tabTrackIndex.value = currentIndex;
  }
  if (value === "schedule") {
    scrollScheduleTableToTop();
    syncScheduleSwipeViewportWidth();
  } else {
    onScheduleMouseCancel();
  }
  void refreshCurrentTabData(value);
});

watch(activeStudentId, () => {
  practiceTogglePendingCourseKey.value = "";
  if (activeStudentId.value) {
    showUserPicker.value = false;
  }
  setIncludedIds(activeStudentId.value ? [activeStudentId.value] : []);
  if (backendProbeStatus.value === "online") {
    void refreshTodayBrief();
    if (isAuthed.value && activeStudentId.value) {
      void refreshScheduleData();
      void ensureScheduleLoaded(activeStudentId.value);
    }
  }
});

watch(includedStudentIds, () => {
  if (backendProbeStatus.value === "online") {
    void ensureIncludedSchedulesLoaded(includedStudentIds.value);
  }
});

watch(backendProbeStatus, (value) => {
  if (value === "online") {
    void refreshThemeImageMap();
    if (isAuthed.value) {
      void requestAuthProfile().catch(() => {
        clearAuthSession();
      });
      void refreshSocialDashboard();
    } else {
      clearRuntimeScheduleData();
    }
  }
});

const openProfileAccountPage = () => {
  if (!isAuthed.value) {
    openQuickAuthDialog();
    return;
  }
  uni.navigateTo({ url: "/pages/profile/account" });
};

const openProfileSubscribePage = () => {
  if (!isAuthed.value) {
    openQuickAuthDialog();
    return;
  }
  uni.navigateTo({ url: "/pages/profile/subscribe" });
};

const openProfilePreferencesPage = () => {
  if (!isAuthed.value) {
    openQuickAuthDialog();
    return;
  }
  uni.navigateTo({ url: "/pages/profile/preferences" });
};

const clearTabSwitchTimers = () => {
  if (tabSwitchCleanupTimer) {
    clearTimeout(tabSwitchCleanupTimer);
    tabSwitchCleanupTimer = null;
  }
};

const shouldBlurPanel = (panelIndex: number) => {
  return isTabSwitching.value && blurPanelIndex.value === panelIndex;
};

const runTabSwitch = (nextTab: TabKey) => {
  const nextIndex = tabOrder.indexOf(nextTab);
  const prevIndex = tabTrackIndex.value;
  if (nextIndex < 0 || nextIndex === prevIndex) {
    return;
  }
  const distance = Math.abs(nextIndex - prevIndex);
  blurPanelIndex.value = prevIndex;
  tabSwitchDurationMs.value = TAB_SCREEN_ANIMATION_MS * distance;
  activeTab.value = nextTab;
  tabTrackIndex.value = nextIndex;
  isTabSwitching.value = true;
  clearTabSwitchTimers();
  tabSwitchCleanupTimer = setTimeout(() => {
    isTabSwitching.value = false;
    blurPanelIndex.value = null;
    tabSwitchDurationMs.value = TAB_SCREEN_ANIMATION_MS;
    tabSwitchCleanupTimer = null;
  }, tabSwitchDurationMs.value);
};

const onBottomNavChange = (tabKey: string) => {
  if (tabKey !== "today" && tabKey !== "schedule" && tabKey !== "profile") {
    return;
  }
  if (tabKey === activeTab.value) {
    if (tabKey === "schedule") {
      scrollScheduleTableToTop();
    }
    void refreshCurrentTabData(tabKey as TabKey);
    return;
  }
  runTabSwitch(tabKey as TabKey);
};

onUnmounted(() => {
  clearTabSwitchTimers();
  clearScheduleTableScrollIntoViewResetTimer();
  blurPanelIndex.value = null;
});

const openIncludePicker = () => {
  if (!isAuthed.value) {
    uni.showToast({
      title: "请先登录",
      icon: "none",
      duration: 1600,
    });
    return;
  }
  if (!activeStudentId.value) {
    uni.showToast({
      title: "请先选择课表账号",
      icon: "none",
      duration: 1600,
    });
    showUserPicker.value = true;
    return;
  }
  showIncludePicker.value = true;
};

const closeIncludePicker = () => {
  showIncludePicker.value = false;
};

const onIncludeChange = (values: string[]) => {
  const rawValidIds = Array.from(new Set(values)).filter((id) => isKnownStudentId(id));
  if (rawValidIds.length > MAX_COMPARE_OWNERS) {
    uni.showToast({
      title: `最多可同时对比 ${MAX_COMPARE_OWNERS} 人`,
      icon: "none",
      duration: 1800,
    });
  }
  setIncludedIds(values);
  if (includedStudentIds.value.length > 0) {
    void ensureIncludedSchedulesLoaded(includedStudentIds.value);
  }
};

const updateShowWeekend = (value: boolean) => {
  const nextValue = Boolean(value);
  if (nextValue === showWeekend.value) {
    return;
  }
  showWeekend.value = nextValue;
};

const toggleShowNonCurrentWeekCourses = () => {
  showNonCurrentWeekCourses.value = !showNonCurrentWeekCourses.value;
  uni.setStorageSync(STORAGE_SHOW_NON_CURRENT_WEEK_COURSES_KEY, showNonCurrentWeekCourses.value);
};

const pickBackendEndpointMode = () => {
  if (!isCurrentUserAdmin.value) {
    uni.showToast({
      title: "仅管理员可切换后端",
      icon: "none",
      duration: 1600,
    });
    return;
  }
  if (RUNTIME_BACKEND_DEFAULT_MODE !== "local") {
    uni.showToast({
      title: "线上版已固定走线上后端",
      icon: "none",
      duration: 1600,
    });
    return;
  }

  const itemList = [
    `本地 (${LOCAL_BACKEND_BASE_URL})`,
    `线上 (${ONLINE_BACKEND_BASE_URL})`,
  ];
  uni.showActionSheet({
    itemList,
    success: (result) => {
      const nextMode: BackendEndpointMode = result.tapIndex === 1 ? "online" : "local";
      if (nextMode === backendEndpointMode.value) {
        return;
      }
      applyBackendEndpointMode(nextMode);
      void refreshThemeImageMap();
      authStatusHint.value = `后端已切换到${nextMode === "online" ? "线上" : "本地"}：${backendBaseUrl.value}`;
      void runBackendProbe().then((ok) => {
        if (ok) {
          void refreshTodayBrief();
        }
      });
    },
  });
};

const readStorageBoolean = (key: string, defaultValue: boolean) => {
  const raw = uni.getStorageSync(key);
  if (raw === true || raw === "true" || raw === 1 || raw === "1") {
    return true;
  }
  if (raw === false || raw === "false" || raw === 0 || raw === "0") {
    return false;
  }
  return defaultValue;
};

const resolveThemeByStorage = (savedTheme: string, isPurpleUnlocked: boolean): ThemeKey => {
  if (savedTheme === "light" || savedTheme === "dark") {
    return "black";
  }
  if (savedTheme === "purple" && !isPurpleUnlocked) {
    return "black";
  }
  if (themeOptions.some((item) => item.key === savedTheme)) {
    return savedTheme as ThemeKey;
  }
  return "black";
};

const syncThemeFromStorage = () => {
  const savedTheme = String(uni.getStorageSync(STORAGE_THEME_KEY) || "");
  purpleUnlocked.value = Boolean(uni.getStorageSync(STORAGE_PURPLE_UNLOCKED_KEY));
  themeKey.value = resolveThemeByStorage(savedTheme, purpleUnlocked.value);
};

const setTheme = (key: ThemeKey) => {
  if (key === "purple" && !purpleUnlocked.value) {
    pendingThemeKey.value = key;
    themePasswordInput.value = "";
    themeUnlockError.value = "";
    showThemeUnlockDialog.value = true;
    return;
  }
  themeKey.value = key;
};

const closeThemeUnlockDialog = () => {
  showThemeUnlockDialog.value = false;
  themePasswordInput.value = "";
  themeUnlockError.value = "";
};

const updateThemePasswordInput = (value: string) => {
  themePasswordInput.value = value;
};

const confirmPurpleUnlock = () => {
  if (themePasswordInput.value.trim() !== "1353") {
    themeUnlockError.value = "密码错误，请重试";
    return;
  }
  purpleUnlocked.value = true;
  uni.setStorageSync(STORAGE_PURPLE_UNLOCKED_KEY, true);
  themeKey.value = pendingThemeKey.value;
  closeThemeUnlockDialog();
};

const openBackendProbeDialog = () => {
  if (!isCurrentUserAdmin.value) {
    uni.showToast({
      title: "仅管理员可查看后端状态",
      icon: "none",
      duration: 1600,
    });
    return;
  }
  showBackendProbeDialog.value = true;
  void runBackendProbe().then((ok) => {
    if (ok) {
      void refreshScheduleData();
      if (authToken.value) {
        void requestAuthProfile().catch(() => {
          clearAuthSession();
        });
        void refreshSocialDashboard();
      }
      void refreshTodayBrief();
    }
  });
};

const closeBackendProbeDialog = () => {
  showBackendProbeDialog.value = false;
};

const openUserPicker = () => {
  if (!isAuthed.value) {
    uni.showToast({
      title: "请先登录",
      icon: "none",
      duration: 1400,
    });
    return;
  }
  if (loginCandidates.value.length === 0) {
    uni.showToast({
      title: "暂无可选课表",
      icon: "none",
      duration: 1400,
    });
    return;
  }
  showUserPicker.value = true;
};

const closeUserPicker = () => {
  if (!activeStudentId.value) {
    return;
  }
  showUserPicker.value = false;
};

const normalizeTargetRandomCode = (value: unknown) => {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 4);
};

const promptTargetRandomCode = () => {
  return new Promise<string | null>((resolve) => {
    uni.showModal({
      title: "输入验证码（4位）",
      content: "",
      editable: true,
      placeholderText: "4 位数字验证码",
      success: (result) => {
        if (!result.confirm) {
          resolve(null);
          return;
        }
        const code = normalizeTargetRandomCode((result as { content?: string }).content);
        if (code.length !== 4) {
          uni.showToast({ title: "请输入 4 位数字验证码", icon: "none", duration: 1800 });
          resolve("");
          return;
        }
        resolve(code);
      },
      fail: () => {
        resolve(null);
      },
    });
  });
};

const shouldPromptRandomCodeByMessage = (message: string) => {
  return /验证码/.test(String(message || ""));
};

const setActiveStudent = async (studentId: string) => {
  if (!isKnownStudentId(studentId)) {
    return;
  }
  if (!isAuthed.value || backendProbeStatus.value !== "online") {
    return;
  }
  try {
    try {
      await requestBackendPost(
        "/api/social/bind-student",
        { target_student_id: studentId },
        true,
      );
    } catch (error) {
      const firstMessage = error instanceof Error ? error.message : "绑定失败";
      if (!shouldPromptRandomCodeByMessage(firstMessage)) {
        throw error;
      }
      const code = await promptTargetRandomCode();
      if (code === null || !code) {
        return;
      }
      await requestBackendPost(
        "/api/social/bind-student",
        {
          target_student_id: studentId,
          target_random_code: code,
        },
        true,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "绑定失败";
    uni.showToast({ title: message, icon: "none", duration: 1800 });
    return;
  }
  activeStudentId.value = studentId;
  uni.setStorageSync(STORAGE_SELECTED_STUDENT_KEY, studentId);
  setIncludedIds([studentId]);
  await refreshSocialDashboard();
};

const selectFromModal = (studentId: string) => {
  void setActiveStudent(studentId).finally(() => {
    if (activeStudentId.value) {
      showUserPicker.value = false;
    }
  });
};

const openWeekPicker = () => {
  showWeekPicker.value = true;
};

const closeWeekPicker = () => {
  showWeekPicker.value = false;
};

const chooseWeek = (week: number) => {
  selectedWeek.value = week;
  showWeekPicker.value = false;
};

const getCoursesByCell = (week: number, day: number, section: number) => {
  const weekCellMap = scheduleWeekCellMaps.value[week] || (week === selectedWeek.value ? selectedWeekCellMap.value : {});
  return resolveWeekCellCourses(week, weekCellMap, day, section).courses;
};

const openCourseDialog = (week: number, day: number, section: number) => {
  if (Date.now() < ignoreTapUntil.value) {
    return;
  }

  const courses = getCoursesByCell(week, day, section);
  if (courses.length === 0) {
    return;
  }
  dialogWeek.value = week;
  dialogDay.value = day;
  dialogSection.value = section;
  dialogCourses.value = courses;
  showCourseDialog.value = true;
};

const openTodayCourseDialog = (course: DisplayCourse) => {
  if (Date.now() < ignoreTapUntil.value) {
    return;
  }
  const week = todayInfo.value.week;
  const day = course.day || todayInfo.value.weekday;
  const sameSlotCourses = todayCourses.value.filter((item) => {
    return item.day === day && item.startSection === course.startSection && item.endSection === course.endSection;
  });
  dialogWeek.value = week;
  dialogDay.value = day;
  dialogSection.value = course.startSection;
  dialogCourses.value = sameSlotCourses.length > 0 ? sameSlotCourses : [course];
  showCourseDialog.value = true;
};

const closeCourseDialog = () => {
  showCourseDialog.value = false;
};

const isUpcomingCell = (week: number, day: number, section: number) => {
  if (week !== selectedWeek.value) {
    return false;
  }
  const course = nextUpcomingCourse.value;
  if (!course) {
    return false;
  }
  return course.day === day && section >= course.startSection && section <= course.endSection;
};

const isUpcomingTail = (week: number, day: number, section: number) => {
  if (week !== selectedWeek.value) {
    return false;
  }
  const course = nextUpcomingCourse.value;
  if (!course) {
    return false;
  }
  return course.day === day && section === course.endSection;
};

const formatWeekRule = (course: CourseItem) => {
  if (course.parity === "odd") {
    return `${course.weekExpr}周(单周)`;
  }
  if (course.parity === "even") {
    return `${course.weekExpr}周(双周)`;
  }
  return `${course.weekExpr}周`;
};

const formatSectionRange = (startSection: number, endSection: number) => {
  const start = sectionTimes.value[startSection - 1];
  const end = sectionTimes.value[endSection - 1];
  if (!start || !end) {
    return `第${startSection}-${endSection}节`;
  }
  return `第${startSection}-${endSection}节 ${start.start}-${end.end}`;
};

const renderCellTitle = (labels: string[]) => {
  if (labels.length === 0) {
    return "";
  }
  if (labels.length === 1) {
    return labels[0];
  }
  return `${labels[0]} +${labels.length - 1}`;
};

const getSectionStartTime = (section: number) => {
  return sectionTimes.value[section - 1]?.start ?? "--:--";
};

const getSectionEndTime = (section: number) => {
  return sectionTimes.value[section - 1]?.end ?? "--:--";
};

const visibleScheduleDayNumbers = computed(() => {
  return showWeekend.value ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];
});

const resolveScheduleTopHeaderProps = (tabKey: TabKey) => ({
  isScheduleTab: tabKey === "schedule",
  headerTitle: tabKey === "profile" ? "我的" : "",
  topSafeInset: topSafeInset.value,
  capsuleTopOffset: capsuleTopOffset.value,
  leftActionsReserve: leftActionsReserve.value,
  capsuleReserveRight: capsuleReserveRight.value,
  capsuleHeight: capsuleHeight.value,
  selectedWeek: selectedWeek.value,
  weekRangeLabel: getWeekDateRangeLabel(selectedWeek.value),
});

const todayScheduleTopHeaderProps = computed(() => {
  return resolveScheduleTopHeaderProps("today");
});

const scheduleScheduleTopHeaderProps = computed(() => {
  return resolveScheduleTopHeaderProps("schedule");
});

const profileScheduleTopHeaderProps = computed(() => {
  return resolveScheduleTopHeaderProps("profile");
});

const todayTabProps = computed(() => ({
  isAuthed: isAuthed.value,
  onAuthorize: openQuickAuthDialog,
  activeStudentId: activeStudentId.value,
  onTodayCourseClick: openTodayCourseDialog,
  todayGreetingText: todayGreetingText.value,
  todayInfo: todayInfo.value,
  shouldShowStudyCard: shouldShowStudyCard.value,
  todayFocusCourse: todayFocusCourse.value,
  todayFocusStatusText: todayFocusStatusText.value,
  departureReminder: departureReminder.value,
  todayCourses: todayCourses.value,
  todaySectionLoad: todaySectionLoad.value,
  getCourseCardStyle,
  formatSectionRange,
  formatCourseClassroom,
  formatCourseTeacher,
  isPracticeCourse,
  isFocusCourse,
  getSectionStartTime,
  getSectionEndTime,
}));

const scheduleTabProps = computed(() => ({
  hasMultipleIncluded: hasMultipleIncluded.value,
  includedSchedules: includedSchedules.value,
  scheduleTrackStyle: scheduleTrackStyle.value,
  scheduleWeekPanels: scheduleWeekPanels.value,
  weekdayLabels: weekdayLabels.value,
  themeKey: themeKey.value,
  visibleDayNumbers: visibleScheduleDayNumbers.value,
  tableBodyScrollIntoViewId: scheduleTableScrollIntoViewId.value,
  getOwnerDotStyle,
  getOwnerMarkerStyle,
  isTodayColumn,
  isUpcomingCell,
  isUpcomingTail,
  getCellStyle,
  getCellTextStyle,
  openCourseDialog,
  renderCellTitle,
  onScheduleTouchStart,
  onScheduleTouchMove,
  onScheduleTouchEnd,
  onScheduleTouchCancel,
  onScheduleMouseDown,
}));

const profileDisplayProps = computed(() => ({
  isAuthed: isAuthed.value,
  profileName: String(socialDashboard.value?.me?.name || authUser.value?.studentName || activeSchedule.value.name || "").trim(),
  profileClassLabel: String(socialDashboard.value?.me?.classLabel || authUser.value?.classLabel || activeSchedule.value.classLabel || "").trim(),
  profileAvatarUrl: String(socialDashboard.value?.me?.avatarUrl || authUser.value?.avatarUrl || "").trim(),
  authStatusLabel: authStatusLabel.value,
}));

const profileActionsProps = computed(() => ({
  isAuthed: isAuthed.value,
  isCurrentUserAdmin: isCurrentUserAdmin.value,
  openProfileAccountPage,
  openProfileSubscribePage,
  openProfilePreferencesPage,
}));

const tabScreenTrackStyle = computed(() => {
  const tabCount = tabOrder.length || 1;
  const offsetPercent = (tabTrackIndex.value * 100) / tabCount;
  return {
    width: `${tabCount * 100}%`,
    transform: `translate3d(-${offsetPercent}%, 0, 0)`,
    transition: isTabSwitching.value
      ? `transform ${tabSwitchDurationMs.value}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
      : "none",
  };
});

const bottomNavProps = computed(() => ({
  navItems,
  activeTab: activeTab.value,
}));

const dialogProps = computed(() => ({
  showIncludePicker: showIncludePicker.value,
  selectableStudentSchedules: selectableStudentSchedules.value,
  includeStatusByStudentId: includeStatusByStudentId.value,
  includedStudentIds: includedStudentIds.value,
  showWeekend: showWeekend.value,
  getOwnerDotStyle,
  showThemeUnlockDialog: showThemeUnlockDialog.value,
  themePasswordInput: themePasswordInput.value,
  themeUnlockError: themeUnlockError.value,
  showBackendProbeDialog: showBackendProbeDialog.value,
  backendProbeStatusLabel: backendProbeStatusLabel.value,
  todayBackendError: todayBackendError.value,
  showUserPicker: showUserPicker.value,
  loginCandidates: loginCandidates.value,
  activeStudentId: activeStudentId.value,
  showCourseDialog: showCourseDialog.value,
  dialogWeek: dialogWeek.value,
  dialogDay: dialogDay.value,
  dialogSection: dialogSection.value,
  weekdayLabels: weekdayLabels.value,
  dialogCourses: dialogCourses.value,
  formatSectionRange,
  formatWeekRule,
  formatCourseTeacher,
  formatCourseTeachingClasses,
  getCoursePracticeKey,
  isPracticeCourse,
  canTogglePracticeCourse,
  practiceTogglePendingCourseKey: practiceTogglePendingCourseKey.value,
  showWeekPicker: showWeekPicker.value,
  allWeeks: allWeeks.value,
  selectedWeek: selectedWeek.value,
  getWeekDateRangeLabel,
}));

function resolveWeekByDate(date: Date) {
  const base = parseDate(termWeek1Monday.value);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((target.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return 1;
  }
  return Math.min(termMaxWeek.value, Math.floor(diffDays / 7) + 1);
}

function resolveWeekday(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function getWeekDateRangeLabel(week: number) {
  const base = parseDate(termWeek1Monday.value);
  const start = addDays(base, (week - 1) * 7);
  const end = addDays(start, 6);
  return `${formatMonthDay(start)} - ${formatMonthDay(end)}`;
}

function parseDate(iso: string) {
  const [year, month, day] = iso.split("-").map((item) => Number(item));
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatMonthDay(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${month}.${day}`;
}
</script>

<style scoped>
.page {
  --bg: #f5f5f5;
  --card-bg: #ffffff;
  --text-main: #111111;
  --text-sub: #5f5f5f;
  --line: #d8d8d8;
  --line-strong: #121212;
  --accent: #2f55c8;
  --bg-gradient-start: #f8f8fb;
  --bg-gradient-end: #edf1fb;
  --bg-glow: rgba(102, 118, 165, 0.16);
  --bg-glow-strong: rgba(255, 255, 255, 0);
  --bg-pattern-image: none;
  --bg-pattern-size: auto;
  --bg-pattern-position: center;
  --bg-pattern-repeat: no-repeat;
  --today-col-bg: #ececec;
  --today-head-bg: #e2e2e2;
  --muted-bg: #f7f7f7;
  --time-col-bg: #eef1f7;
  --mask-bg: rgba(0, 0, 0, 0.45);
  position: relative;
  min-height: 100vh;
  background-color: transparent;
  color: var(--text-main);
}

.page-content-layer {
  position: relative;
  z-index: 1;
  min-height: 100vh;
}

.page.theme-black {
  --bg: #f3f4f7;
  --card-bg: #ffffff;
  --muted-bg: #eff2f7;
  --line: #d6d9e0;
  --line-strong: #2c3445;
  --accent: #2f55c8;
  --today-col-bg: #e6eaf1;
  --today-head-bg: #dde2eb;
  --time-col-bg: #e8edf7;
  --bg-gradient-start: #f8f9fc;
  --bg-gradient-end: #edf1f9;
  --bg-glow: rgba(97, 110, 150, 0.15);
}

.page.theme-purple {
  --bg: #f5f1ff;
  --card-bg: #fcfaff;
  --muted-bg: #f5edff;
  --line: #d9cfef;
  --line-strong: #8e57de;
  --accent: #a061ff;
  --today-col-bg: #f0e4ff;
  --today-head-bg: #eadbff;
  --time-col-bg: #ede4fb;
  --bg-gradient-start: #f4e9ff;
  --bg-gradient-end: #eadfff;
  --bg-glow: rgba(142, 87, 222, 0.32);
  --bg-glow-strong: rgba(171, 109, 255, 0.24);
}

.page.theme-green {
  --bg: #eef8f2;
  --card-bg: #f9fffb;
  --muted-bg: #ebf9f0;
  --line: #cde2d6;
  --line-strong: #159b57;
  --accent: #13c56a;
  --today-col-bg: #e2f8eb;
  --today-head-bg: #d4f2e0;
  --time-col-bg: #e6f3ea;
  --bg-gradient-start: #f2fbf5;
  --bg-gradient-end: #e7f5ed;
  --bg-glow: rgba(21, 155, 87, 0.20);
}

.page.theme-pink {
  --bg: #fff1f7;
  --card-bg: #fffafe;
  --muted-bg: #fdebf5;
  --line: #ebcede;
  --line-strong: #d93d96;
  --accent: #ef45a5;
  --today-col-bg: #fbdded;
  --today-head-bg: #f6d1e5;
  --time-col-bg: #f5e4ed;
  --bg-gradient-start: #fff5fa;
  --bg-gradient-end: #fceaf4;
  --bg-glow: rgba(217, 61, 150, 0.18);
}

.page.theme-blue {
  --bg: #eef5ff;
  --card-bg: #fafdff;
  --muted-bg: #eaf3ff;
  --line: #cddcf3;
  --line-strong: #257ecf;
  --accent: #2e9dff;
  --today-col-bg: #e0eeff;
  --today-head-bg: #d2e7ff;
  --time-col-bg: #e4edf9;
  --bg-gradient-start: #f2f7ff;
  --bg-gradient-end: #e8f1ff;
  --bg-glow: rgba(37, 126, 207, 0.22);
}

.page.theme-yellow {
  --bg: #fff9ea;
  --card-bg: #fffdf5;
  --muted-bg: #fdf4e0;
  --line: #eadcb9;
  --line-strong: #ad8100;
  --accent: #d9a511;
  --today-col-bg: #f9eccc;
  --today-head-bg: #f4e2b1;
  --time-col-bg: #f2e8d3;
  --bg-gradient-start: #fffbf2;
  --bg-gradient-end: #fbf1db;
  --bg-glow: rgba(173, 129, 0, 0.18);
}

.page.theme-orange {
  --bg: #fff3ec;
  --card-bg: #fffaf6;
  --muted-bg: #fdebe0;
  --line: #edd3c2;
  --line-strong: #cf6f17;
  --accent: #f57b16;
  --today-col-bg: #fbe2cd;
  --today-head-bg: #f6d4b9;
  --time-col-bg: #f5e6de;
  --bg-gradient-start: #fff8f3;
  --bg-gradient-end: #fdeee2;
  --bg-glow: rgba(207, 111, 23, 0.2);
}

.page.modal-open {
  height: 100vh;
  overflow: hidden;
}

.tab-screen-stage {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100vh;
  min-height: 100vh;
}

.tab-screen-track {
  display: flex;
  align-items: stretch;
  transform: translate3d(0, 0, 0);
  will-change: transform, filter;
}

.page.tab-switching .tab-screen-stage {
  height: 100vh;
  max-height: 100vh;
}

.tab-screen-panel {
  flex: 0 0 calc(100% / 3);
  width: calc(100% / 3);
  height: 100vh;
  min-height: 100vh;
  box-sizing: border-box;
  transition: filter 160ms linear;
}

.schedule-tab-panel {
  height: calc(100vh - 108rpx);
  height: calc(100vh - 108rpx - env(safe-area-inset-bottom));
  height: calc(100vh - 108rpx - constant(safe-area-inset-bottom));
  max-height: calc(100vh - 108rpx);
  max-height: calc(100vh - 108rpx - env(safe-area-inset-bottom));
  max-height: calc(100vh - 108rpx - constant(safe-area-inset-bottom));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tab-screen-panel-blur {
  filter: blur(1.8px);
}

.page.tab-switching .tab-screen-panel {
  height: 100vh;
  max-height: 100vh;
  overflow: hidden;
}

.page.tab-switching .schedule-tab-panel {
  height: calc(100vh - 108rpx);
  height: calc(100vh - 108rpx - env(safe-area-inset-bottom));
  height: calc(100vh - 108rpx - constant(safe-area-inset-bottom));
  max-height: calc(100vh - 108rpx);
  max-height: calc(100vh - 108rpx - env(safe-area-inset-bottom));
  max-height: calc(100vh - 108rpx - constant(safe-area-inset-bottom));
}

.page.tab-switching .content {
  height: calc(100vh - 110rpx);
  height: calc(100vh - 110rpx - env(safe-area-inset-bottom));
  height: calc(100vh - 110rpx - constant(safe-area-inset-bottom));
  max-height: calc(100vh - 110rpx);
  max-height: calc(100vh - 110rpx - env(safe-area-inset-bottom));
  max-height: calc(100vh - 110rpx - constant(safe-area-inset-bottom));
  overflow: hidden;
}

.content {
  padding: 20rpx 20rpx 130rpx;
  padding: 20rpx 20rpx calc(130rpx + env(safe-area-inset-bottom));
  padding: 20rpx 20rpx calc(130rpx + constant(safe-area-inset-bottom));
}

.profile-tab-wrap {
  display: flex;
  flex-direction: column;
  gap: 22rpx;

  height: calc(100vh - 110rpx);
  height: calc(100vh - 110rpx - env(safe-area-inset-bottom));
  height: calc(100vh - 110rpx - constant(safe-area-inset-bottom));
}

.schedule-content {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.schedule-content-inner {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 20rpx 20rpx 140rpx;
  padding: 20rpx 20rpx calc(140rpx + env(safe-area-inset-bottom));
  padding: 20rpx 20rpx calc(140rpx + constant(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
}
</style>
