<template>
  <view class="page" :class="[ `theme-${themeKey}`, { 'modal-open': isAnyModalOpen } ]">
    <view class="content">
      <template v-if="activeTab === 'today'">
        <view class="card">
          <view class="today-hero">
            <view class="today-greeting">{{ todayGreetingText }}</view>
            <view class="today-hero-sub">第 {{ todayInfo.week }} 周 · {{ todayInfo.weekdayLabel }} · {{ todayInfo.dateLabel }}</view>
          </view>

          <view class="today-mini-grid">
            <view class="today-mini-card">
              <view class="today-mini-label">天气</view>
              <view class="today-mini-value">{{ todayWeatherValue }}</view>
              <view class="today-mini-sub">{{ weatherIntegrationHint }}</view>
            </view>
            <view class="today-mini-card">
              <view class="today-mini-label">节日祝福</view>
              <view class="today-mini-value">{{ todayFestival ? todayFestival.title : "普通的一天" }}</view>
              <view class="today-mini-sub">{{ todayFestival ? todayFestival.wish : "今天也值得被认真对待。" }}</view>
            </view>
          </view>
        </view>

        <view class="card">
          <view class="section-title">学习提醒</view>
          <view v-if="todayFocusCourse" class="today-focus accent" :style="getCourseCardStyle(todayFocusCourse)">
            <view class="today-focus-top">
              <view class="today-focus-name">{{ todayFocusCourse.name }}</view>
              <view class="today-focus-status">{{ todayFocusStatusText }}</view>
            </view>
            <view class="today-focus-meta">
              {{ todayFocusCourse.ownerName }} · {{ formatSectionRange(todayFocusCourse.startSection, todayFocusCourse.endSection) }}
            </view>
            <view class="today-focus-meta">
              教室：{{ formatCourseClassroom(todayFocusCourse) }} · 教师：{{ formatCourseTeacher(todayFocusCourse) }}
            </view>
            <view class="today-focus-line" />
          </view>
          <view v-else class="today-ready empty">今天暂时没有课程安排。</view>

          <view class="today-ready">
            <view class="today-ready-subtitle">出发提醒</view>
            <template v-if="departureReminder">
              <view class="today-ready-line">
                {{ departureReminder.courseName }}（{{ departureReminder.timeRange }}），走过去约 {{ departureReminder.commuteMinutes }} 分钟，建议 {{ departureReminder.leaveAt }} 出发。
              </view>
            </template>
            <view v-else class="today-ready-line">今日暂无出发提醒，按你的节奏安排就好。</view>
          </view>

          <view v-if="showTodayAdvice" class="today-advice">
            <view class="today-ready-subtitle">今日建议</view>
            <view v-for="(item, index) in todayAdviceList" :key="`advice-${index}`" class="today-advice-item">{{ item }}</view>
          </view>
        </view>

        <view class="card">
          <view class="section-title">今日课程</view>
          <view v-if="todayCourses.length > 0" class="section-sub">今天有 {{ todayCourses.length }} 门课，共 {{ todaySectionLoad }} 节</view>
          <view v-if="todayCourses.length === 0" class="tip">今天没有安排课程。</view>
          <view v-else class="today-list">
            <view
              v-for="course in todayCourses"
              :key="`today-${course.ownerId}-${course.id}`"
              class="today-item"
              :class="{ accent: isFocusCourse(course) }"
              :style="getCourseCardStyle(course)"
            >
              <view class="today-item-main">
                <view class="today-course">{{ course.name }}</view>
                <view class="today-owner">{{ course.ownerName }}</view>
                <view class="today-item-meta">教室：{{ formatCourseClassroom(course) }}</view>
                <view class="today-item-meta">教师：{{ formatCourseTeacher(course) }}</view>
              </view>
              <view class="today-time">{{ getSectionStartTime(course.startSection) }}</view>
            </view>
          </view>
        </view>
      </template>

      <template v-else-if="activeTab === 'schedule'">
        <view class="card schedule-card">
          <view class="top-bar">
            <view class="week-toolbar">
              <view class="week-nav-btn prev" @click="shiftWeek(-1)">
                <view class="nav-chevron left" />
              </view>
              <view class="week-center-group">
                <text class="week-main" @click="openWeekPicker">第 {{ selectedWeek }} 周</text>
                <view class="setting-btn inline" @click="openIncludePicker">
                  <view class="gear-icon" />
                </view>
              </view>
              <view class="week-nav-btn next" @click="shiftWeek(1)">
                <view class="nav-chevron right" />
              </view>
            </view>
            <text class="week-sub">{{ getWeekDateRangeLabel(selectedWeek) }}</text>
          </view>
          <view v-if="hasMultipleIncluded" class="owner-legend">
            <view v-for="student in includedSchedules" :key="`owner-${student.id}`" class="owner-item">
              <view class="owner-dot" :style="getOwnerDotStyle(student.id)" />
              <text>{{ student.name }}</text>
            </view>
          </view>

          <view v-if="markedCourseName" class="mark-tip" @click="markedCourseName = ''">
            已标记：{{ markedCourseName }}（点击清除）
          </view>

	          <view class="table-wrap">
	            <view class="table-row head-row">
	              <view class="time-col head">节次</view>
	              <view
	                v-for="(dayLabel, dayIndex) in weekdayLabels"
	                :key="`head-${dayLabel}`"
	                class="day-col head"
	                :class="{ 'today-column': isTodayColumn(dayIndex + 1) }"
	              >
	                {{ dayLabel }}
	              </view>
	            </view>

	            <view
	              v-for="row in gridRows"
	              :key="`course-${selectedWeek}-${row.section}`"
	              :id="`section-row-${row.section}`"
	              class="table-row"
	              :class="{
	                'part-start': row.isPartStart,
	                'row-morning': row.part === '上午',
	                'row-afternoon': row.part === '下午',
	                'row-evening': row.part === '晚上',
	              }"
	            >
	              <view class="time-col">
	                <view class="section-no">{{ row.section }}</view>
	                <view class="section-time">{{ row.time }}</view>
	              </view>

	              <view
	                v-for="(cell, dayIndex) in row.cells"
	                :key="`course-${selectedWeek}-${row.section}-${dayIndex}`"
	                class="day-col cell"
	                :class="{
	                  busy: cell.busy,
	                  'today-column': isTodayColumn(dayIndex + 1),
	                  'merge-prev': cell.mergeWithPrev,
	                  'merge-next': cell.mergeWithNext,
	                  marked: markedCourseName && cell.labels.includes(markedCourseName),
	                  upcoming: isUpcomingCell(dayIndex + 1, row.section),
	                  'upcoming-tail': isUpcomingTail(dayIndex + 1, row.section),
	                }"
	                :style="getCellStyle(cell)"
	                @click="openCourseDialog(selectedWeek, dayIndex + 1, row.section)"
	                @longpress="onCellLongPress(selectedWeek, dayIndex + 1, row.section)"
	              >
                <text v-if="cell.busy && cell.showLabel" class="cell-text">{{ renderCellTitle(cell.labels) }}</text>
              </view>
            </view>
          </view>
        </view>
      </template>

      <template v-else>
        <view class="card">
          <view class="section-title">我的</view>
          <view class="profile-grid">
            <view class="profile-info-card">
              <view class="profile-info-label">当前账号</view>
              <view class="profile-info-value">{{ activeSchedule.name }}</view>
            </view>
            <view class="profile-info-card">
              <view class="profile-info-label">学号</view>
              <view class="profile-info-value">{{ activeSchedule.studentNo || "待配置" }}</view>
            </view>
            <view class="profile-info-card">
              <view class="profile-info-label">后端状态</view>
              <view class="profile-info-value">{{ backendProbeStatusLabel }}</view>
            </view>
            <view class="profile-info-card">
              <view class="profile-info-label">默认出发点</view>
              <view class="profile-info-value">实验室</view>
            </view>
          </view>
          <view class="profile-action-row">
            <view class="profile-action-btn" @click="openUserPicker">切换课表账号</view>
            <view class="profile-action-btn ghost" @click="openBackendProbeDialog">检查后端</view>
          </view>
        </view>

        <view class="card">
          <view class="section-title">设置</view>
          <view class="setting-item" @click="toggleTodayAdvice">
            <view class="setting-item-main">
              <view class="setting-item-title">今日建议</view>
              <view class="setting-item-sub">是否在今日页展示建议内容</view>
            </view>
            <view class="setting-item-state">{{ showTodayAdvice ? "已开启" : "已关闭" }}</view>
          </view>
        </view>

        <view class="card">
          <view class="section-title">主题</view>
          <view class="theme-switch">
            <view
              v-for="item in themeOptions"
              :key="item.key"
              class="theme-chip"
              :class="{ active: item.key === themeKey }"
              @click="setTheme(item.key)"
            >
              <view class="theme-chip-main">
                <view class="theme-swatch" :style="getThemePreviewStyle(item.key)" />
                <text>{{ item.label }}</text>
              </view>
              <text class="theme-chip-state">{{ item.key === themeKey ? "已启用" : "切换" }}</text>
            </view>
          </view>
        </view>
      </template>
    </view>

    <view class="bottom-nav">
      <view
        v-for="item in navItems"
        :key="item.key"
        class="bottom-nav-item"
        :class="{ active: activeTab === item.key }"
        @click="activeTab = item.key"
      >
        <text class="bottom-nav-text">{{ item.label }}</text>
        <view class="bottom-nav-line" />
      </view>
    </view>

    <view v-if="showIncludePicker" class="dialog-mask" @click="closeIncludePicker">
      <view class="dialog-card" @click.stop>
        <view class="dialog-title">课程显示设置</view>
        <view class="dialog-sub">勾选后将对应同学课程合并进课表（当前账号不可取消）</view>
        <checkbox-group @change="onIncludeChange">
          <label v-for="student in studentSchedules" :key="student.id" class="check-item">
            <view class="owner-dot small" :style="getOwnerDotStyle(student.id)" />
            <checkbox
              :value="student.id"
              :checked="includedStudentIds.includes(student.id)"
              :disabled="student.id === activeStudentId"
              color="#111111"
            />
            <text>{{ student.name }}</text>
          </label>
        </checkbox-group>
        <button class="dialog-btn" @click="closeIncludePicker">完成</button>
      </view>
    </view>

    <view v-if="showThemeUnlockDialog" class="dialog-mask" @click="closeThemeUnlockDialog">
      <view class="dialog-card unlock-card" @click.stop>
        <view class="dialog-title">解锁炫靓紫</view>
        <view class="dialog-sub">请输入密码后启用该主题（只需输入一次）</view>
        <input
          v-model="themePasswordInput"
          class="unlock-input"
          type="text"
          password
          placeholder="请输入解锁密码"
          :maxlength="8"
        />
        <view v-if="themeUnlockError" class="unlock-error">{{ themeUnlockError }}</view>
        <view class="unlock-actions">
          <view class="unlock-btn ghost" @click="closeThemeUnlockDialog">取消</view>
          <view class="unlock-btn" @click="confirmPurpleUnlock">解锁</view>
        </view>
      </view>
    </view>

    <view v-if="showBackendProbeDialog" class="dialog-mask" @click="closeBackendProbeDialog">
      <view class="dialog-card" @click.stop>
        <view class="dialog-title">后端在线检测</view>
        <view class="dialog-sub">检测 `/health`，在线后拉取 `/api/today-brief`。</view>
        <view class="backend-mock-row">
          <view class="backend-mock-btn" @click="runBackendProbe">立即检测</view>
          <view class="backend-mock-btn" @click="refreshTodayBrief">刷新今日数据</view>
        </view>
        <view class="backend-status-tip">当前展示：{{ backendProbeStatusLabel }}</view>
        <view v-if="todayBackendError" class="backend-status-tip error">{{ todayBackendError }}</view>
        <button class="dialog-btn" @click="closeBackendProbeDialog">关闭</button>
      </view>
    </view>

    <view v-if="showUserPicker" class="auth-mask" @click="closeUserPicker">
      <view class="auth-card" @click.stop>
        <view class="auth-title">切换课表账号</view>
        <view class="auth-sub">点击列表项后立即切换</view>
        <view class="picker-list">
          <view
            v-for="candidate in loginCandidates"
            :key="candidate.studentId"
            class="picker-item"
            :class="{ active: candidate.studentId === activeStudentId }"
            @click="selectFromModal(candidate.studentId)"
          >
            <view class="picker-name">{{ candidate.name }}</view>
            <view class="picker-wechat">微信号：{{ candidate.wechatId }}</view>
          </view>
        </view>
      </view>
    </view>

    <view v-if="showCourseDialog" class="dialog-mask" @click="closeCourseDialog">
      <view class="dialog-card course-dialog-card" @click.stop>
        <view class="dialog-title">课程详情</view>
        <view class="dialog-sub">
          第 {{ dialogWeek }} 周 · {{ weekdayLabels[dialogDay - 1] }} · 第 {{ dialogSection }} 节
        </view>
        <view class="dialog-list">
          <view v-for="course in dialogCourses" :key="`dialog-${course.ownerId}-${course.id}`" class="dialog-item">
            <view class="dialog-name">{{ course.name }}</view>
            <view class="dialog-meta">课表：{{ course.ownerName }}</view>
            <view class="dialog-meta">节次：{{ formatSectionRange(course.startSection, course.endSection) }}</view>
            <view class="dialog-meta">周次：{{ formatWeekRule(course) }}</view>
            <view class="dialog-meta">教室：{{ course.classroom || "待配置" }}</view>
          </view>
        </view>
        <button class="dialog-btn" @click="closeCourseDialog">关闭</button>
      </view>
    </view>

    <view v-if="showWeekPicker" class="dialog-mask" @click="closeWeekPicker">
      <view class="dialog-card" @click.stop>
        <view class="dialog-title">选择周次</view>
        <scroll-view class="week-picker-list" scroll-y>
          <view
            v-for="week in allWeeks"
            :key="`picker-${week}`"
            class="week-picker-item"
            :class="{ active: week === selectedWeek }"
            @click="chooseWeek(week)"
          >
            <text>第 {{ week }} 周</text>
            <text class="week-picker-date">{{ getWeekDateRangeLabel(week) }}</text>
          </view>
        </scroll-view>
        <button class="dialog-btn" @click="closeWeekPicker">关闭</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type CSSProperties } from "vue";
import { sectionTimes, studentSchedules, termMeta, weekdayLabels } from "@/data/schedules";
import { useModalScrollLock } from "@/composables/useModalScrollLock";
import { formatSectionRange, getWeekCourses } from "@/utils/schedule";
import type { CourseItem } from "@/types/schedule";

interface DisplayCourse extends CourseItem {
  ownerId: string;
  ownerName: string;
}

interface GridRow {
  section: number;
  time: string;
  part: "上午" | "下午" | "晚上";
  isPartStart: boolean;
  cells: Array<{
    busy: boolean;
    labels: string[];
    ownerIds: string[];
    showLabel: boolean;
    part: string;
    mergeWithPrev: boolean;
    mergeWithNext: boolean;
  }>;
}

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
type TabKey = "today" | "schedule" | "profile";
type BackendProbeStatus = "untested" | "online" | "offline";

const STORAGE_SELECTED_STUDENT_KEY = "touchx_selected_student_id";
const STORAGE_SELECTED_WEEK_KEY = "touchx_selected_week";
const STORAGE_THEME_KEY = "touchx_theme_key";
const STORAGE_PURPLE_UNLOCKED_KEY = "touchx_theme_purple_unlocked";
const STORAGE_MARKED_COURSE_KEY = "touchx_marked_course_name";
const STORAGE_INCLUDED_IDS_KEY = "touchx_included_student_ids";
const STORAGE_BACKEND_BASE_URL_KEY = "touchx_backend_base_url";
const STORAGE_SHOW_TODAY_ADVICE_KEY = "touchx_show_today_advice";
const TERM_WEEK1_MONDAY = termMeta.week1Monday;
const TERM_MAX_WEEK = termMeta.maxWeek;
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:8000";

const loginCandidates = [
  { studentId: "caiziling", name: "蔡子菱", wechatId: "C605460328" },
  { studentId: "mawanqing", name: "马晚晴", wechatId: "mwq031103" },
  { studentId: "tangzixian", name: "唐子贤", wechatId: "TanGzXia330" },
  { studentId: "wuxinyu", name: "伍鑫宇", wechatId: "jinzhi101_10_0" },
];

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

const themePreviewMap: Record<ThemeKey, { start: string; end: string }> = {
  black: { start: "#f3f3f3", end: "#121212" },
  purple: { start: "#f6f3fb", end: "#7a56d8" },
  green: { start: "#f2f7f3", end: "#2f9a5f" },
  pink: { start: "#fbf3f6", end: "#c7568f" },
  blue: { start: "#f2f6fb", end: "#3f7bd1" },
  yellow: { start: "#fbf8ee", end: "#b6922d" },
  orange: { start: "#fbf5f1", end: "#c97235" },
};

const ownerColorOrder: Record<string, number> = {
  caiziling: 0,
  mawanqing: 1,
  tangzixian: 2,
  wuxinyu: 3,
};

const themeOwnerPaletteMap: Record<ThemeKey, string[]> = {
  black: ["#2f2f2f", "#555555", "#767676", "#9a9a9a"],
  purple: ["#7a56d8", "#8f6ee0", "#a486e8", "#b99df0"],
  green: ["#2f9a5f", "#44ab72", "#58bc84", "#70cb97"],
  pink: ["#c7568f", "#d26da0", "#dd85b2", "#e89cc3"],
  blue: ["#3f7bd1", "#598fd9", "#73a4e1", "#8db8e9"],
  yellow: ["#b6922d", "#c3a84b", "#d0be69", "#ddd487"],
  orange: ["#c97235", "#d5854d", "#e19766", "#eca97e"],
};

interface FestivalCard {
  title: string;
  wish: string;
}

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

const fixedDateFestivals: Record<string, FestivalCard> = {
  "2026-03-03": { title: "元宵节", wish: "愿你灯火可亲，喜乐常在。" },
};

const monthDayFestivals: Record<string, FestivalCard> = {
  "01-01": { title: "元旦", wish: "新年开门红，课程和生活都顺顺利利。" },
  "02-14": { title: "情人节", wish: "愿你被爱包围，也别忘了爱自己。" },
  "03-08": { title: "妇女节", wish: "祝你今天和每天都闪闪发光。" },
  "03-14": { title: "白色情人节", wish: "愿每一份心意都被温柔回应。" },
  "05-20": { title: "520", wish: "今天适合勇敢表达喜欢，也适合喜欢自己。" },
  "06-01": { title: "儿童节", wish: "保留一点童心，学习也会更轻松。" },
  "11-11": { title: "双十一", wish: "理性下单，快乐生活，作业按时交。" },
  "12-24": { title: "平安夜", wish: "平安喜乐，明天醒来也是好心情。" },
  "12-25": { title: "圣诞节", wish: "节日快乐，愿你今天收到很多好消息。" },
};

const allWeeks = Array.from({ length: TERM_MAX_WEEK }, (_, index) => index + 1);
const activeTab = ref<TabKey>("schedule");
const selectedWeek = ref(resolveWeekByDate(new Date()));
const themeKey = ref<ThemeKey>("black");
const activeStudentId = ref(studentSchedules[0]?.id ?? "");
const includedStudentIds = ref<string[]>([]);
const showIncludePicker = ref(false);
const showUserPicker = ref(false);
const markedCourseName = ref("");
const ignoreTapUntil = ref(0);
const showCourseDialog = ref(false);
const showWeekPicker = ref(false);
const showThemeUnlockDialog = ref(false);
const showBackendProbeDialog = ref(false);
const purpleUnlocked = ref(false);
const pendingThemeKey = ref<ThemeKey>("black");
const themePasswordInput = ref("");
const themeUnlockError = ref("");
const backendProbeStatus = ref<BackendProbeStatus>("untested");
const backendBaseUrl = ref(DEFAULT_BACKEND_BASE_URL);
const todayBackendBrief = ref<BackendTodayBrief | null>(null);
const todayBackendError = ref("");
const showTodayAdvice = ref(true);
const dialogWeek = ref(1);
const dialogDay = ref(1);
const dialogSection = ref(1);
const dialogCourses = ref<DisplayCourse[]>([]);
const currentWeek = ref(resolveWeekByDate(new Date()));
const todayWeekday = ref(resolveWeekday(new Date()));

const isAnyModalOpen = computed(() => {
  return (
    showIncludePicker.value ||
    showUserPicker.value ||
    showCourseDialog.value ||
    showWeekPicker.value ||
    showThemeUnlockDialog.value ||
    showBackendProbeDialog.value
  );
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

useModalScrollLock(isAnyModalOpen);

const activeSchedule = computed(() => {
  return studentSchedules.find((student) => student.id === activeStudentId.value) ?? studentSchedules[0];
});

const includedSchedules = computed(() => {
  const normalizedIds = normalizeIncludedIds(includedStudentIds.value);
  return studentSchedules.filter((student) => normalizedIds.includes(student.id));
});

const hasMultipleIncluded = computed(() => includedSchedules.value.length > 1);

const selectedWeekCourses = computed<DisplayCourse[]>(() => {
  const merged: DisplayCourse[] = [];
  for (const schedule of includedSchedules.value) {
    const courses = getWeekCourses(schedule, selectedWeek.value);
    for (const course of courses) {
      merged.push({ ...course, ownerId: schedule.id, ownerName: schedule.name });
    }
  }

  return merged.sort(
    (a, b) => a.day - b.day || a.startSection - b.startSection || a.endSection - b.endSection || a.ownerName.localeCompare(b.ownerName),
  );
});

const selectedWeekCellMap = computed(() => {
  const map: Record<string, DisplayCourse[]> = {};
  for (const course of selectedWeekCourses.value) {
    for (let section = course.startSection; section <= course.endSection; section += 1) {
      const key = `${course.day}-${section}`;
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(course);
    }
  }
  return map;
});

const gridRows = computed<GridRow[]>(() => {
  const getCellSignature = (courses: DisplayCourse[]) => {
    if (courses.length === 0) {
      return "";
    }
    return courses
      .map((course) => `${course.ownerId}:${course.id}`)
      .sort((a, b) => a.localeCompare(b))
      .join("|");
  };

  return sectionTimes.map((slot) => {
    const cells = Array.from({ length: 7 }, (_, dayIndex) => {
      const day = dayIndex + 1;
      const courses = selectedWeekCellMap.value[`${dayIndex + 1}-${slot.section}`] ?? [];
      const prevCourses = selectedWeekCellMap.value[`${dayIndex + 1}-${slot.section - 1}`] ?? [];
      const nextCourses = selectedWeekCellMap.value[`${dayIndex + 1}-${slot.section + 1}`] ?? [];
      const prevPart = sectionTimes[slot.section - 2]?.part;
      const nextPart = sectionTimes[slot.section]?.part;
      const signature = getCellSignature(courses);
      const prevSignature = getCellSignature(prevCourses);
      const nextSignature = getCellSignature(nextCourses);
      let showLabel = false;

      if (signature !== "") {
        let groupStart = slot.section;
        while (groupStart > 1) {
          const upperPart = sectionTimes[groupStart - 2]?.part;
          const upperSignature = getCellSignature(selectedWeekCellMap.value[`${day}-${groupStart - 1}`] ?? []);
          if (upperPart !== slot.part || upperSignature !== signature) {
            break;
          }
          groupStart -= 1;
        }

        let groupEnd = slot.section;
        while (groupEnd < sectionTimes.length) {
          const lowerPart = sectionTimes[groupEnd]?.part;
          const lowerSignature = getCellSignature(selectedWeekCellMap.value[`${day}-${groupEnd + 1}`] ?? []);
          if (lowerPart !== slot.part || lowerSignature !== signature) {
            break;
          }
          groupEnd += 1;
        }

        const anchorSection = Math.floor((groupStart + groupEnd) / 2);
        showLabel = slot.section === anchorSection;
      }

      return {
        busy: courses.length > 0,
        labels: Array.from(new Set(courses.map((course) => course.name))),
        ownerIds: Array.from(new Set(courses.map((course) => course.ownerId))),
        showLabel,
        part: slot.part,
        mergeWithPrev: signature !== "" && prevPart === slot.part && prevSignature === signature,
        mergeWithNext: signature !== "" && nextPart === slot.part && nextSignature === signature,
      };
    });

    return {
      section: slot.section,
      time: slot.start,
      part: slot.part,
      isPartStart: slot.section === 5 || slot.section === 9,
      cells,
    };
  });
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
    const sectionStart = sectionTimes[course.startSection - 1];
    const sectionEnd = sectionTimes[course.endSection - 1];
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
    weekdayLabel: weekdayLabels[weekday - 1],
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
      merged.push({ ...course, ownerId: schedule.id, ownerName: schedule.name });
    }
  }

  return merged.sort((a, b) => a.startSection - b.startSection || a.endSection - b.endSection || a.ownerName.localeCompare(b.ownerName));
});

const getCourseStartEndTs = (course: DisplayCourse) => {
  const sectionStart = sectionTimes[course.startSection - 1];
  const sectionEnd = sectionTimes[course.endSection - 1];
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

const todayFestival = computed<FestivalCard | null>(() => {
  const now = new Date();
  const fullDate = formatIsoDate(now);
  const monthDay = `${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
  return fixedDateFestivals[fullDate] ?? monthDayFestivals[monthDay] ?? null;
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

const todayWeatherValue = computed(() => {
  const weather = todayBackendBrief.value?.weather;
  if (!weather) {
    return backendProbeStatus.value === "online" ? "同步中" : "待接入后端";
  }
  const summary = weather.summary || "天气待同步";
  const temperature = weather.temperature && weather.temperature !== "--" ? ` ${weather.temperature}` : "";
  return `${summary}${temperature}`;
});

const todayAdviceList = computed(() => {
  const list: string[] = [];
  if (todayCourses.value.length === 0) {
    list.push("今天课程较少，建议安排复盘或项目推进。");
  } else if (todaySectionLoad.value >= 8) {
    list.push("课时较满，课间记得补水和活动一下。");
  } else {
    list.push("今天节奏适中，建议在空档整理重点。");
  }

  const focusInfo = todayFocusInfo.value;
  if (focusInfo?.status === "ongoing") {
    list.push("当前正在上课，记得标记重点和疑问点。");
  } else if (focusInfo?.status === "upcoming") {
    list.push("上课前把设备和资料再确认一遍。");
  } else if (todayCourses.value.length > 0) {
    list.push("今天课程已结束，花 10 分钟复盘会更稳。");
  }

  list.push("晚间留一点时间整理明天任务。");
  return list.slice(0, 3);
});

const weatherIntegrationHint = computed(() => {
  const weatherAdvice = todayBackendBrief.value?.weather?.advice;
  if (weatherAdvice) {
    return weatherAdvice;
  }
  if (backendProbeStatus.value === "offline") {
    return "后端离线，天气信息待同步";
  }
  if (backendProbeStatus.value === "online") {
    return "后端在线，正在同步天气信息";
  }
  return "后续展示实时温度、天气和空气质量";
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
  const startTime = sectionTimes[info.course.startSection - 1]?.start ?? "--:--";
  return {
    courseName: info.course.name,
    timeRange: `${startTime}-${sectionTimes[info.course.endSection - 1]?.end ?? "--:--"}`,
    commuteMinutes,
    leaveAt: subtractMinutesFromTime(startTime, commuteMinutes),
  };
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

const isTodayColumn = (day: number) => {
  return selectedWeek.value === currentWeek.value && day === todayWeekday.value;
};

const resolveCurrentPartStartSection = (date: Date) => {
  const hour = date.getHours();
  if (hour >= 18) {
    return 9;
  }
  if (hour >= 12) {
    return 5;
  }
  return 1;
};

const autoScrollToCurrentPart = () => {
  if (activeTab.value !== "schedule") {
    return;
  }

  const targetSection = resolveCurrentPartStartSection(new Date());
  nextTick(() => {
    uni.pageScrollTo({
      selector: `#section-row-${targetSection}`,
      duration: 260,
    });
  });
};

const normalizeBackendBaseUrl = (value: string) => {
  const normalized = (value || "").trim().replace(/\/+$/, "");
  return normalized || DEFAULT_BACKEND_BASE_URL;
};

const buildBackendUrl = (path: string, query: Record<string, string> = {}) => {
  const base = normalizeBackendBaseUrl(backendBaseUrl.value);
  const search = Object.entries(query)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}${path}${search ? `?${search}` : ""}`;
};

const requestBackendGet = <T>(path: string, query: Record<string, string> = {}) => {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: buildBackendUrl(path, query),
      method: "GET",
      timeout: 3500,
      success: (res) => {
        if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) {
          resolve((res.data || {}) as T);
          return;
        }
        reject(new Error(`HTTP ${res.statusCode || 0}`));
      },
      fail: (err) => {
        reject(new Error(err?.errMsg || "request failed"));
      },
    });
  });
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

const refreshTodayBrief = async () => {
  if (backendProbeStatus.value !== "online") {
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

onMounted(() => {
  const savedStudentId = uni.getStorageSync(STORAGE_SELECTED_STUDENT_KEY);
  if (savedStudentId && studentSchedules.some((item) => item.id === savedStudentId)) {
    activeStudentId.value = savedStudentId;
  } else {
    showUserPicker.value = true;
  }

  const savedWeek = Number(uni.getStorageSync(STORAGE_SELECTED_WEEK_KEY));
  if (savedWeek >= 1 && savedWeek <= TERM_MAX_WEEK) {
    selectedWeek.value = savedWeek;
  }

  const savedTheme = String(uni.getStorageSync(STORAGE_THEME_KEY) || "");
  purpleUnlocked.value = Boolean(uni.getStorageSync(STORAGE_PURPLE_UNLOCKED_KEY));
  if (savedTheme === "light" || savedTheme === "dark") {
    themeKey.value = "black";
  }
  if (savedTheme === "purple" && !purpleUnlocked.value) {
    themeKey.value = "black";
  } else if (themeOptions.some((item) => item.key === savedTheme)) {
    themeKey.value = savedTheme as ThemeKey;
  }

  const savedMarked = String(uni.getStorageSync(STORAGE_MARKED_COURSE_KEY) || "");
  if (savedMarked) {
    markedCourseName.value = savedMarked;
  }

  const savedIncludeIds = uni.getStorageSync(STORAGE_INCLUDED_IDS_KEY);
  if (Array.isArray(savedIncludeIds)) {
    setIncludedIds(savedIncludeIds as string[]);
  } else {
    setIncludedIds([activeStudentId.value]);
  }

  backendBaseUrl.value = normalizeBackendBaseUrl(String(uni.getStorageSync(STORAGE_BACKEND_BASE_URL_KEY) || DEFAULT_BACKEND_BASE_URL));
  uni.setStorageSync(STORAGE_BACKEND_BASE_URL_KEY, backendBaseUrl.value);
  const savedShowTodayAdvice = uni.getStorageSync(STORAGE_SHOW_TODAY_ADVICE_KEY);
  if (savedShowTodayAdvice === false || savedShowTodayAdvice === "false" || savedShowTodayAdvice === 0 || savedShowTodayAdvice === "0") {
    showTodayAdvice.value = false;
  }

  void runBackendProbe().then((ok) => {
    if (ok) {
      void refreshTodayBrief();
    }
  });

  autoScrollToCurrentPart();
});

watch(selectedWeek, (value) => {
  uni.setStorageSync(STORAGE_SELECTED_WEEK_KEY, value);
});

watch(themeKey, (value) => {
  uni.setStorageSync(STORAGE_THEME_KEY, value);
});

watch(markedCourseName, (value) => {
  uni.setStorageSync(STORAGE_MARKED_COURSE_KEY, value);
});

watch(activeTab, (value) => {
  if (value === "schedule") {
    autoScrollToCurrentPart();
  }
  if (value === "today" && backendProbeStatus.value === "online") {
    void refreshTodayBrief();
  }
});

watch(activeStudentId, () => {
  if (backendProbeStatus.value === "online") {
    void refreshTodayBrief();
  }
});

const openIncludePicker = () => {
  showIncludePicker.value = true;
};

const closeIncludePicker = () => {
  showIncludePicker.value = false;
};

const onIncludeChange = (event: { detail: { value: string[] } }) => {
  setIncludedIds(event.detail.value);
};

const toggleTodayAdvice = () => {
  showTodayAdvice.value = !showTodayAdvice.value;
  uni.setStorageSync(STORAGE_SHOW_TODAY_ADVICE_KEY, showTodayAdvice.value);
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
  showBackendProbeDialog.value = true;
  void runBackendProbe().then((ok) => {
    if (ok) {
      void refreshTodayBrief();
    }
  });
};

const closeBackendProbeDialog = () => {
  showBackendProbeDialog.value = false;
};

const openUserPicker = () => {
  showUserPicker.value = true;
};

const closeUserPicker = () => {
  showUserPicker.value = false;
};

const setActiveStudent = (studentId: string) => {
  if (!studentSchedules.some((item) => item.id === studentId)) {
    return;
  }
  activeStudentId.value = studentId;
  markedCourseName.value = "";
  uni.setStorageSync(STORAGE_SELECTED_STUDENT_KEY, studentId);
  setIncludedIds([...includedStudentIds.value, studentId]);
};

const selectFromModal = (studentId: string) => {
  setActiveStudent(studentId);
  showUserPicker.value = false;
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

const shiftWeek = (offset: number) => {
  const nextWeek = Math.min(TERM_MAX_WEEK, Math.max(1, selectedWeek.value + offset));
  selectedWeek.value = nextWeek;
};

const getCoursesByCell = (day: number, section: number) => {
  return selectedWeekCellMap.value[`${day}-${section}`] ?? [];
};

const onCellLongPress = async (_week: number, day: number, section: number) => {
  const courses = getCoursesByCell(day, section);
  if (courses.length === 0) {
    return;
  }

  const uniqueNames = Array.from(new Set(courses.map((item) => item.name)));
  let selectedName = uniqueNames[0];

  if (uniqueNames.length > 1) {
    const index = await chooseCourseName(uniqueNames);
    if (index < 0) {
      return;
    }
    selectedName = uniqueNames[index];
  }

  markedCourseName.value = markedCourseName.value === selectedName ? "" : selectedName;
  ignoreTapUntil.value = Date.now() + 400;
};

const openCourseDialog = (_week: number, day: number, section: number) => {
  if (Date.now() < ignoreTapUntil.value) {
    return;
  }

  const courses = getCoursesByCell(day, section);
  if (courses.length === 0) {
    return;
  }
  dialogWeek.value = selectedWeek.value;
  dialogDay.value = day;
  dialogSection.value = section;
  dialogCourses.value = courses;
  showCourseDialog.value = true;
};

const closeCourseDialog = () => {
  showCourseDialog.value = false;
};

const isUpcomingCell = (day: number, section: number) => {
  const course = nextUpcomingCourse.value;
  if (!course) {
    return false;
  }
  return course.day === day && section >= course.startSection && section <= course.endSection;
};

const isUpcomingTail = (day: number, section: number) => {
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

const chooseCourseName = (items: string[]) => {
  return new Promise<number>((resolve) => {
    uni.showActionSheet({
      itemList: items,
      success: (res) => resolve(Number(res.tapIndex ?? -1)),
      fail: () => resolve(-1),
    });
  });
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
  return sectionTimes[section - 1]?.start ?? "--:--";
};

const getThemePreviewStyle = (key: ThemeKey): CSSProperties => {
  const preview = themePreviewMap[key];
  return {
    background: `linear-gradient(135deg, ${preview.start} 0%, ${preview.end} 100%)`,
  };
};

const getOwnerTone = (ownerId: string) => {
  const palette = themeOwnerPaletteMap[themeKey.value] || themeOwnerPaletteMap.black;
  if (!hasMultipleIncluded.value) {
    return {
      dot: palette[0],
    };
  }
  const knownIndex = ownerColorOrder[ownerId];
  const index =
    knownIndex === undefined ? Array.from(ownerId).reduce((acc, char) => acc + char.charCodeAt(0), 0) % palette.length : knownIndex;
  return {
    dot: palette[index % palette.length],
  };
};

const getOwnerDotStyle = (ownerId: string): CSSProperties => {
  const tone = getOwnerTone(ownerId);
  return {
    backgroundColor: tone.dot,
  };
};

const getCourseCardStyle = (course: DisplayCourse): CSSProperties => {
  const tone = getOwnerTone(course.ownerId);
  return {
    borderColor: "var(--line)",
    backgroundColor: hexToRgba(tone.dot, hasMultipleIncluded.value ? 0.1 : 0.14),
    boxShadow: "none",
  };
};

const getCellStyle = (cell: GridRow["cells"][number]): CSSProperties => {
  if (!cell.busy || cell.ownerIds.length === 0) {
    return {};
  }

  const tones = cell.ownerIds.map((ownerId) => getOwnerTone(ownerId));
  const primary = tones[0].dot;
  return {
    backgroundImage: "none",
    backgroundColor: hexToRgba(primary, hasMultipleIncluded.value && tones.length > 1 ? 0.16 : 0.2),
  };
};

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) {
    return hex;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const normalizeIncludedIds = (ids: string[]) => {
  const validIds = ids.filter((id) => studentSchedules.some((student) => student.id === id));
  if (!validIds.includes(activeStudentId.value)) {
    validIds.unshift(activeStudentId.value);
  }
  return Array.from(new Set(validIds));
};

const setIncludedIds = (ids: string[]) => {
  includedStudentIds.value = normalizeIncludedIds(ids);
  uni.setStorageSync(STORAGE_INCLUDED_IDS_KEY, includedStudentIds.value);
};

function resolveWeekByDate(date: Date) {
  const base = parseDate(TERM_WEEK1_MONDAY);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((target.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) {
    return 1;
  }
  return Math.min(TERM_MAX_WEEK, Math.floor(diffDays / 7) + 1);
}

function resolveWeekday(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function getWeekDateRangeLabel(week: number) {
  const base = parseDate(TERM_WEEK1_MONDAY);
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

function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  --today-col-bg: #ececec;
  --today-head-bg: #e2e2e2;
  --muted-bg: #f7f7f7;
  --part-morning: #f1f1f1;
  --part-afternoon: #ececec;
  --part-evening: #e7e7e7;
  --mask-bg: rgba(0, 0, 0, 0.45);
  min-height: 100vh;
  background: var(--bg);
  color: var(--text-main);
}

.page.theme-purple {
  --bg: #f5f1ff;
  --card-bg: #fcfaff;
  --muted-bg: #f0e9ff;
  --line: #d9cfef;
  --accent: #7a56d8;
  --today-col-bg: #e9e1fb;
  --today-head-bg: #e0d5f8;
  --part-morning: #f0e9ff;
  --part-afternoon: #e9defd;
  --part-evening: #e2d4fa;
}

.page.theme-green {
  --bg: #eef8f2;
  --card-bg: #f9fffb;
  --muted-bg: #e6f4ec;
  --line: #cde2d6;
  --accent: #2f9a5f;
  --today-col-bg: #dcf0e4;
  --today-head-bg: #d0e9da;
  --part-morning: #e9f5ee;
  --part-afternoon: #def0e5;
  --part-evening: #d4ebdd;
}

.page.theme-pink {
  --bg: #fff1f7;
  --card-bg: #fffafe;
  --muted-bg: #fbe7f1;
  --line: #ebcede;
  --accent: #c7568f;
  --today-col-bg: #f6ddea;
  --today-head-bg: #f1d0e1;
  --part-morning: #fbe8f2;
  --part-afternoon: #f7dceb;
  --part-evening: #f1d0e1;
}

.page.theme-blue {
  --bg: #eef5ff;
  --card-bg: #fafdff;
  --muted-bg: #e4eefc;
  --line: #cddcf3;
  --accent: #3f7bd1;
  --today-col-bg: #dae7fb;
  --today-head-bg: #cedff7;
  --part-morning: #e7effd;
  --part-afternoon: #dbe8fb;
  --part-evening: #d1e2f8;
}

.page.theme-yellow {
  --bg: #fff9ea;
  --card-bg: #fffdf4;
  --muted-bg: #f8efd0;
  --line: #eadba8;
  --accent: #b6922d;
  --today-col-bg: #f3e6be;
  --today-head-bg: #ecdca8;
  --part-morning: #f8efd0;
  --part-afternoon: #f3e6be;
  --part-evening: #ecdca8;
}

.page.theme-orange {
  --bg: #fff3ec;
  --card-bg: #fffaf6;
  --muted-bg: #fae8dc;
  --line: #edd3c2;
  --accent: #c97235;
  --today-col-bg: #f5dece;
  --today-head-bg: #efd2bd;
  --part-morning: #fae8dc;
  --part-afternoon: #f5dece;
  --part-evening: #efd2bd;
}

.page.modal-open {
  height: 100vh;
  overflow: hidden;
}

.content {
  padding: 20rpx 20rpx 150rpx;
}

.card {
  background: var(--card-bg);
  border-radius: 14rpx;
  padding: 16rpx;
  margin-bottom: 14rpx;
  border: 1rpx solid var(--line);
}

.schedule-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

.schedule-card .top-bar,
.schedule-card .owner-legend,
.schedule-card .mark-tip {
  margin-left: 4rpx;
  margin-right: 4rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.section-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.today-hero {
  border-radius: 12rpx;
  padding: 16rpx;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.86) 0%, rgba(255, 255, 255, 0.56) 100%);
}

.today-greeting {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--text-main);
}

.today-hero-sub {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.today-mini-grid {
  margin-top: 12rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10rpx;
}

.today-mini-card {
  border-radius: 10rpx;
  padding: 12rpx;
  background: var(--muted-bg);
}

.today-mini-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

.today-mini-value {
  margin-top: 6rpx;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--text-main);
}

.today-mini-sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--text-sub);
  line-height: 1.4;
}

.today-advice {
  margin-top: 8rpx;
  padding: 0 2rpx;
}

.today-advice-item {
  margin-top: 7rpx;
  font-size: 21rpx;
  color: var(--text-sub);
  line-height: 1.4;
}

.today-ready {
  margin-top: 8rpx;
  padding: 0 2rpx;
}

.today-ready.empty {
  font-size: 22rpx;
  color: var(--text-sub);
}

.today-ready-line {
  margin-top: 7rpx;
  font-size: 21rpx;
  color: var(--text-sub);
  line-height: 1.4;
}

.today-ready-subtitle {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--text-main);
}

.top-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 10rpx;
}

.week-toolbar {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.week-nav-btn {
  width: 64rpx;
  height: 52rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
}

.week-center-group {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
}

.week-main {
  padding: 4rpx 6rpx;
  text-align: center;
  font-size: 31rpx;
  font-weight: 700;
  color: var(--text-main);
}

.week-nav-btn.prev {
  justify-self: start;
}

.week-nav-btn.next {
  justify-self: end;
}

.setting-btn.inline {
  width: 52rpx;
  height: 40rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.nav-chevron {
  width: 12rpx;
  height: 12rpx;
  border-top: 2rpx solid currentColor;
  border-right: 2rpx solid currentColor;
}

.nav-chevron.left {
  transform: rotate(-135deg);
}

.nav-chevron.right {
  transform: rotate(45deg);
}

.gear-icon {
  width: 18rpx;
  height: 18rpx;
  border: 2rpx solid currentColor;
  border-radius: 999rpx;
  position: relative;
}

.gear-icon::before,
.gear-icon::after {
  content: "";
  position: absolute;
  inset: -5rpx 7rpx;
  border-top: 2rpx solid currentColor;
  border-bottom: 2rpx solid currentColor;
}

.gear-icon::after {
  inset: 7rpx -5rpx;
  border: none;
  border-left: 2rpx solid currentColor;
  border-right: 2rpx solid currentColor;
}

.week-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.owner-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx 16rpx;
  margin-bottom: 10rpx;
}

.owner-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--text-sub);
}

.owner-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 999rpx;
  flex-shrink: 0;
}

.owner-dot.small {
  width: 12rpx;
  height: 12rpx;
}

.mark-tip {
  margin-bottom: 10rpx;
  font-size: 22rpx;
  color: var(--text-main);
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
  border-radius: 8rpx;
  padding: 8rpx 12rpx;
}

.table-wrap {
  width: 100%;
  border-radius: 0;
  overflow: hidden;
  background: transparent;
}

.table-row {
  display: flex;
  min-height: 86rpx;
}

.time-col,
.day-col {
  box-sizing: border-box;
  padding: 8rpx 6rpx;
}

.head-row .time-col,
.head-row .day-col {
  border-top: none;
}

.part-start .time-col,
.part-start .day-col {
  box-shadow: inset 0 10rpx 0 rgba(255, 255, 255, 0.72);
}

.time-col {
  width: 108rpx;
  background: var(--part-morning);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.table-row.row-morning .time-col {
  background: var(--part-morning);
}

.table-row.row-afternoon .time-col {
  background: var(--part-afternoon);
}

.table-row.row-evening .time-col {
  background: var(--part-evening);
}

.day-col {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.day-col:last-child {
  border-right: none;
}

.head {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--text-main);
  background: var(--muted-bg);
}

.section-no {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--text-main);
}

.section-time {
  margin-top: 3rpx;
  font-size: 18rpx;
  color: var(--text-sub);
}

.cell.busy {
  color: var(--text-main);
}

.cell.busy.merge-prev {
  box-shadow: none;
}

.cell.marked {
  filter: saturate(1.08) brightness(0.98);
}

.cell.upcoming-tail {
  position: relative;
}

.cell.upcoming-tail::after {
  content: "";
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 6rpx;
  height: 8rpx;
  border-radius: 999rpx;
  background: var(--accent);
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.22);
}

.cell-text {
  font-size: 19rpx;
  line-height: 1.3;
  color: var(--text-main);
  width: 100%;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rpx 4rpx;
  box-sizing: border-box;
}

.day-col.today-column {
  background: transparent;
  position: relative;
}

.day-col.today-column::before,
.day-col.today-column::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2rpx;
  background: var(--accent);
  opacity: 0.62;
  pointer-events: none;
}

.day-col.today-column::before {
  left: 0;
}

.day-col.today-column::after {
  right: 0;
}

.head.today-column {
  background: var(--muted-bg);
  font-weight: 700;
  box-shadow: inset 0 2rpx 0 var(--accent);
}

.today-focus {
  margin-top: 12rpx;
  border-radius: 12rpx;
  padding: 14rpx;
  border: none;
}

.today-focus.accent {
  background: var(--today-col-bg);
}

.today-focus-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.today-focus-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.today-focus-status {
  flex-shrink: 0;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, var(--accent) 16%, #ffffff);
  color: var(--accent);
  font-size: 20rpx;
  font-weight: 600;
}

.today-focus-meta {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.today-focus-line {
  margin-top: 12rpx;
  height: 7rpx;
  border-radius: 999rpx;
  background: var(--accent);
}

.today-list {
  margin-top: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.today-item {
  border-radius: 10rpx;
  padding: 12rpx;
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
  border: none;
}

.today-item.accent {
  background: var(--today-col-bg);
}

.today-item-main {
  min-width: 0;
}

.today-course {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text-main);
}

.today-owner {
  margin-top: 4rpx;
  font-size: 21rpx;
  color: var(--text-sub);
}

.today-item-meta {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.today-time {
  font-size: 20rpx;
  color: var(--text-sub);
  text-align: right;
}

.profile-grid {
  margin-top: 12rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10rpx;
}

.profile-info-card {
  border-radius: 10rpx;
  padding: 12rpx;
  background: var(--muted-bg);
}

.profile-info-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

.profile-info-value {
  margin-top: 6rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--text-main);
  line-height: 1.35;
}

.profile-action-row {
  margin-top: 12rpx;
  display: flex;
  gap: 10rpx;
}

.profile-action-btn {
  flex: 1;
  text-align: center;
  padding: 10rpx 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  color: var(--text-main);
  background: var(--muted-bg);
  font-size: 22rpx;
}

.profile-action-btn.ghost {
  background: var(--card-bg);
}

.theme-switch {
  margin-top: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.theme-chip {
  padding: 10rpx 14rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  color: var(--text-main);
  font-size: 22rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card-bg);
}

.theme-chip-main {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.theme-swatch {
  width: 44rpx;
  height: 24rpx;
  border-radius: 8rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.16);
}

.theme-chip-state {
  color: var(--text-sub);
  font-size: 20rpx;
}

.theme-chip.active {
  color: var(--text-main);
  border-color: var(--line-strong);
  box-shadow: inset 4rpx 0 0 var(--line-strong);
}

.theme-chip.active .theme-chip-state {
  color: var(--line-strong);
}

.check-item {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 12rpx;
  color: var(--text-main);
  font-size: 24rpx;
}

.setting-item {
  margin-top: 14rpx;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 12rpx;
  background: var(--muted-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.setting-item-main {
  min-width: 0;
}

.setting-item-title {
  font-size: 23rpx;
  color: var(--text-main);
  font-weight: 600;
}

.setting-item-sub {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.setting-item-state {
  flex-shrink: 0;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  color: var(--text-main);
  background: var(--card-bg);
  border: 1rpx solid var(--line);
}

.tip,
.empty {
  margin-top: 14rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  height: 112rpx;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--card-bg);
  border-top: 1rpx solid var(--line);
  z-index: 60;
}

.bottom-nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}

.bottom-nav-text {
  font-size: 24rpx;
  color: var(--text-sub);
}

.bottom-nav-line {
  width: 42rpx;
  height: 6rpx;
  border-radius: 999rpx;
  background: var(--line-strong);
  opacity: 0;
}

.bottom-nav-item.active .bottom-nav-text {
  color: var(--text-main);
  font-weight: 600;
}

.bottom-nav-item.active .bottom-nav-line {
  opacity: 1;
}

.auth-mask,
.dialog-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: var(--mask-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 20rpx;
}

.auth-card,
.dialog-card {
  width: 100%;
  max-width: 640rpx;
  background: var(--card-bg);
  border-radius: 16rpx;
  padding: 24rpx;
  border: 1rpx solid var(--line);
}

.auth-title,
.dialog-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.auth-sub,
.dialog-sub {
  margin-top: 8rpx;
  font-size: 23rpx;
  color: var(--text-sub);
}

.picker-list {
  margin-top: 16rpx;
  display: flex;
  flex-direction: column;
  max-height: 520rpx;
  overflow: auto;
  gap: 10rpx;
}

.picker-item {
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 14rpx 16rpx;
  background: var(--muted-bg);
}

.picker-item.active {
  border-color: var(--line-strong);
}

.picker-name {
  font-size: 27rpx;
  color: var(--text-main);
  font-weight: 600;
}

.picker-wechat {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.dialog-list {
  margin-top: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  max-height: 620rpx;
  overflow: auto;
}

.dialog-item {
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 12rpx;
}

.course-dialog-card .dialog-item {
  background: var(--muted-bg);
}

.course-dialog-card .dialog-name {
  color: var(--text-main);
}

.course-dialog-card .dialog-meta {
  color: var(--text-sub);
}

.course-dialog-card .dialog-btn {
  background: var(--accent);
  color: #ffffff;
  border: none;
}

.dialog-name {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text-main);
}

.dialog-meta {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.dialog-btn {
  margin-top: 18rpx;
  background: var(--line-strong);
  color: var(--card-bg);
  font-size: 24rpx;
}

.unlock-card {
  max-width: 560rpx;
}

.unlock-input {
  margin-top: 16rpx;
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  padding: 12rpx 14rpx;
  font-size: 24rpx;
  color: var(--text-main);
  background: var(--card-bg);
}

.unlock-error {
  margin-top: 8rpx;
  font-size: 21rpx;
  color: #d64545;
}

.unlock-actions,
.backend-mock-row {
  margin-top: 14rpx;
  display: flex;
  gap: 12rpx;
}

.unlock-btn,
.backend-mock-btn {
  flex: 1;
  text-align: center;
  padding: 10rpx 12rpx;
  border-radius: 10rpx;
  border: 1rpx solid var(--line);
  font-size: 23rpx;
  color: var(--text-main);
  background: var(--muted-bg);
}

.unlock-btn.ghost {
  background: var(--card-bg);
}

.backend-status-tip {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.backend-status-tip.error {
  color: #d64545;
}

.week-picker-list {
  margin-top: 14rpx;
  max-height: 640rpx;
}

.week-picker-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14rpx 10rpx;
  border-bottom: 1rpx solid var(--line);
  font-size: 24rpx;
  color: var(--text-sub);
}

.week-picker-item.active {
  color: var(--text-main);
  font-weight: 600;
}

.week-picker-date {
  font-size: 21rpx;
}
</style>
