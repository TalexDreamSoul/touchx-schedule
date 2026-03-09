<template>
  <view class="today-page-shell">
    <view class="today-greeting-row">
      <view class="today-greeting-top">{{ todayGreetingText }}</view>
      <view class="today-food-icon-btn" @click="props.onOpenFoodCampaign" title="食物竞选">🍽️</view>
    </view>

    <view class="card" v-if="isAuthed && props.foodCampaignHighlights.length > 0">
      <view class="food-section-head">
        <view>
          <view class="section-title">美食竞选</view>
          <view class="section-sub">正在参与或即将截止</view>
        </view>
        <view class="food-section-badge">{{ props.foodCampaignHighlights.length }}</view>
      </view>
      <view class="food-campaign-list">
        <view
          v-for="item in props.foodCampaignHighlights"
          :key="`food-campaign-${item.campaignId}`"
          class="food-campaign-item"
          @click="props.onFoodCampaignClick(item.campaignId)"
        >
          <view class="food-campaign-dot" :class="{ live: item.status === 'open' }" />
          <view class="food-campaign-main">
            <view class="food-campaign-title">{{ item.title || "今天吃什么" }}</view>
            <view class="food-campaign-meta">
              <text class="food-campaign-status-label">{{ item.statusLabel }}</text>
              <text class="food-campaign-sep">·</text>
              <text>{{ item.headcount || 0 }}人</text>
              <text class="food-campaign-sep">·</text>
              <text>{{ formatFoodCampaignTime(item.timeTs) }}</text>
            </view>
          </view>
          <view class="food-campaign-arrow">›</view>
        </view>
      </view>
    </view>

    <view v-if="!isAuthed || shouldShowStudyCard" class="lesson-widget-block">
      <view class="lesson-widget-head">
        <view class="lesson-widget-title">今日待上课程</view>
        <view class="lesson-widget-count">{{ isAuthed ? `${pendingCourseCount} 门` : "待授权" }}</view>
      </view>
      <view v-if="fridayEarlyNoticeText" class="lesson-special-notice">{{ fridayEarlyNoticeText }}</view>
      <view v-if="!isAuthed" class="auth-gate-line" @click="onAuthorize">去授权</view>
      <template v-else>
        <scroll-view v-if="pendingCourseItems.length > 0" class="lesson-widget-scroll" scroll-x :show-scrollbar="false">
          <view class="lesson-widget-list">
            <view
              v-for="item in pendingCourseItems"
              :key="item.key"
              class="lesson-widget-item"
              :class="{ 'has-owner-tag': shouldShowPendingCourseOwner(item.course) }"
              :style="getCourseCardStyle(item.course)"
              @click="handleTodayCourseClick(item.course)"
            >
              <view class="lesson-widget-mark" />
              <view class="lesson-widget-main">
                <view class="lesson-widget-name-row">
                  <view class="lesson-widget-name">{{ item.course.name }}</view>
                  <text v-if="isPracticeCourse(item.course)" class="practice-tag">实践</text>
                </view>
                <view class="lesson-widget-reminder">{{ getItemDepartureReminderText(item) }}</view>
              </view>
              <view class="lesson-widget-time">
                <view>{{ item.startTime }}</view>
                <view>{{ item.endTime }}</view>
              </view>
              <view v-if="shouldShowPendingCourseOwner(item.course)" class="lesson-widget-owner-tag">
                来自 {{ item.course.ownerName }}
              </view>
            </view>
          </view>
        </scroll-view>
        <view v-else class="today-ready empty">今天暂无待上课程。</view>

      </template>
    </view>

    <view class="card">
      <view class="section-title">今日课程</view>
      <view v-if="!isAuthed" class="auth-gate-line" @click="onAuthorize">去授权</view>
      <template v-else>
        <view v-if="todayCourses.length > 0" class="section-sub">今天有 {{ todayCourses.length }} 门课，共 {{ todaySectionLoad }} 节</view>
        <view v-if="todayCourses.length === 0" class="tip">今天没有安排课程。</view>
        <view v-else class="today-list-scroll">
          <view class="today-list">
            <view
              v-for="course in todayCourses"
              :key="`today-${course.ownerId}-${course.id}`"
              class="today-item"
              :class="{ accent: isFocusCourse(course) }"
              :style="getCourseCardStyle(course)"
              @click="handleTodayCourseClick(course)"
            >
              <view class="today-item-main">
                <view class="today-course-row">
                  <view class="today-course">{{ course.name }}</view>
                  <text v-if="isPracticeCourse(course)" class="practice-tag">实践</text>
                </view>
                <view class="today-owner">{{ course.ownerName }}</view>
                <view class="today-item-meta">教室：{{ formatCourseClassroom(course) }}</view>
                <view class="today-item-meta">教师：{{ formatCourseTeacher(course) }}</view>
              </view>
              <view class="today-time">{{ getSectionStartTime(course.startSection) }}</view>
            </view>
          </view>
        </view>
      </template>
    </view>

    <view class="card">
      <view class="today-semester-card">
        <view class="today-semester-title">我的加入</view>
        <view class="today-semester-main">
          你已经开学 {{ semesterElapsed.totalDays }} 天 {{ semesterElapsed.totalWeeks }} 周 {{ semesterElapsed.totalHours }} 小时
        </view>
        <view class="today-semester-note">* 以 3 月 1 日早上 8:00 作为起始计时</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { CSSProperties } from "vue";
import type { DisplayCourse } from "../types";

const SEMESTER_START_AT = new Date(2026, 2, 1, 8, 0, 0, 0);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const nowTimestamp = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const semesterElapsed = computed(() => {
  const elapsedMs = Math.max(0, nowTimestamp.value - SEMESTER_START_AT.getTime());
  const totalHours = Math.floor(elapsedMs / HOUR_MS);
  const totalDays = Math.floor(elapsedMs / DAY_MS);
  const totalWeeks = Math.floor(elapsedMs / WEEK_MS);
  return {
    totalHours,
    totalDays,
    totalWeeks,
  };
});

onMounted(() => {
  nowTimestamp.value = Date.now();
  timer = setInterval(() => {
    nowTimestamp.value = Date.now();
  }, 60 * 1000);
});

onUnmounted(() => {
  if (!timer) {
    return;
  }
  clearInterval(timer);
  timer = null;
});

interface TodayInfoLike {
  week: number;
  weekdayLabel: string;
  dateLabel: string;
}

interface DepartureReminderLike {
  courseName: string;
  timeRange: string;
  commuteMinutes: number;
  leadMinutes?: number;
  leaveAt: string;
}

interface TodayFoodCampaignHighlightItem {
  campaignId: string;
  title: string;
  status: string;
  statusLabel: string;
  headcount: number;
  timeTs: number;
}

interface PendingCourseItem {
  key: string;
  course: DisplayCourse;
  startTime: string;
  endTime: string;
  startTs: number;
}

const parseTimeToTodayTimestamp = (timeText: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeText || "").trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  return target.getTime();
};

const props = defineProps<{
  isAuthed: boolean;
  onAuthorize: () => void;
  onOpenFoodCampaign: () => void;
  onFoodCampaignClick: (campaignId: string) => void;
  activeStudentId: string;
  onTodayCourseClick: (course: DisplayCourse) => void;
  todayGreetingText: string;
  todayInfo: TodayInfoLike;
  shouldShowStudyCard: boolean;
  todayFocusCourse: DisplayCourse | null;
  todayFocusStatusText: string;
  departureReminder: DepartureReminderLike | null;
  todayCourses: DisplayCourse[];
  todaySectionLoad: number;
  getCourseCardStyle: (course: DisplayCourse) => CSSProperties;
  formatSectionRange: (startSection: number, endSection: number) => string;
  formatCourseClassroom: (course: DisplayCourse) => string;
  formatCourseTeacher: (course: DisplayCourse) => string;
  isPracticeCourse: (course: DisplayCourse) => boolean;
  isFocusCourse: (course: DisplayCourse) => boolean;
  getSectionStartTime: (section: number) => string;
  getSectionEndTime: (section: number) => string;
  foodCampaignHighlights: TodayFoodCampaignHighlightItem[];
}>();

const pendingCourseItems = computed<PendingCourseItem[]>(() => {
  const now = Date.now();
  const items: PendingCourseItem[] = [];

  for (const course of props.todayCourses) {
    const startTime = props.getSectionStartTime(course.startSection);
    const endTime = props.getSectionEndTime(course.endSection);
    const startTs = parseTimeToTodayTimestamp(startTime);
    const endTs = parseTimeToTodayTimestamp(endTime);
    if (startTs === null || endTs === null || endTs <= now) {
      continue;
    }
    items.push({
      key: `${course.ownerId}-${course.id}-${course.startSection}-${course.endSection}`,
      course,
      startTime,
      endTime,
      startTs,
    });
  }

  return items.sort((a, b) => a.startTs - b.startTs);
});

const fridayEarlyNoticeText = computed(() => {
  if (props.todayInfo.weekdayLabel !== "周五") {
    return "";
  }
  const hasTwoThirtyCourse = props.todayCourses.some((course) => {
    const startTime = props.getSectionStartTime(course.startSection);
    return startTime === "14:30";
  });
  if (!hasTwoThirtyCourse) {
    return "";
  }
  return "今日周五下午 14:30 课程建议提前 1 小时准备。";
});

const pendingCourseCount = computed(() => {
  return pendingCourseItems.value.length;
});

const handleTodayCourseClick = (course: DisplayCourse) => {
  props.onTodayCourseClick(course);
};

const shouldShowPendingCourseOwner = (course: DisplayCourse) => {
  const activeId = String(props.activeStudentId || "").trim();
  if (!activeId) {
    return false;
  }
  return course.ownerId !== activeId;
};

const DEFAULT_COMMUTE_MINUTES = 7;
const MINUTE_MS = 60 * 1000;

const getCountdownMinutes = (targetTs: number, nowTs: number) => {
  return Math.max(1, Math.ceil((targetTs - nowTs) / MINUTE_MS));
};

type OngoingCourseReminder =
  | { type: "inBreak"; minutesToResume: number }
  | { type: "beforeBreak"; minutesToBreak: number; breakMinutes: number }
  | { type: "toEnd"; minutesToEnd: number };

const resolveOngoingCourseReminder = (course: DisplayCourse, nowTs: number): OngoingCourseReminder | null => {
  for (let section = course.startSection; section < course.endSection; section += 1) {
    const sectionEndTs = parseTimeToTodayTimestamp(props.getSectionEndTime(section));
    const nextSectionStartTs = parseTimeToTodayTimestamp(props.getSectionStartTime(section + 1));
    if (sectionEndTs === null || nextSectionStartTs === null) {
      continue;
    }

    const breakMinutes = Math.floor((nextSectionStartTs - sectionEndTs) / MINUTE_MS);
    if (breakMinutes <= 0) {
      continue;
    }

    if (sectionEndTs <= nowTs && nowTs < nextSectionStartTs) {
      return {
        type: "inBreak",
        minutesToResume: getCountdownMinutes(nextSectionStartTs, nowTs),
      };
    }
  }

  for (let section = course.startSection; section < course.endSection; section += 1) {
    const sectionEndTs = parseTimeToTodayTimestamp(props.getSectionEndTime(section));
    const nextSectionStartTs = parseTimeToTodayTimestamp(props.getSectionStartTime(section + 1));
    if (sectionEndTs === null || nextSectionStartTs === null) {
      continue;
    }
    if (sectionEndTs <= nowTs) {
      continue;
    }

    const breakMinutes = Math.floor((nextSectionStartTs - sectionEndTs) / MINUTE_MS);
    if (breakMinutes <= 0) {
      continue;
    }

    return {
      type: "beforeBreak",
      minutesToBreak: getCountdownMinutes(sectionEndTs, nowTs),
      breakMinutes,
    };
  }

  const courseEndTs = parseTimeToTodayTimestamp(props.getSectionEndTime(course.endSection));
  if (courseEndTs === null || courseEndTs <= nowTs) {
    return null;
  }
  return {
    type: "toEnd",
    minutesToEnd: getCountdownMinutes(courseEndTs, nowTs),
  };
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

const getItemDepartureReminderText = (item: PendingCourseItem) => {
  const nowTs = Date.now();
  if (item.startTs <= nowTs) {
    const ongoingReminder = resolveOngoingCourseReminder(item.course, nowTs);
    if (ongoingReminder?.type === "inBreak") {
      return `休息中，${ongoingReminder.minutesToResume} 分钟后上课`;
    }
    if (ongoingReminder?.type === "beforeBreak") {
      return `${ongoingReminder.minutesToBreak} 分钟后休息 ${ongoingReminder.breakMinutes} 分钟`;
    }
    if (ongoingReminder?.type === "toEnd") {
      return `${ongoingReminder.minutesToEnd} 分钟后下课`;
    }
    return "课程进行中";
  }

  const itemTimeRange = `${item.startTime}-${item.endTime}`;
  const reminder = props.departureReminder;
  if (reminder && reminder.courseName === item.course.name && reminder.timeRange === itemTimeRange) {
    const leadMinutes = Number(reminder.leadMinutes || reminder.commuteMinutes || 0);
    if (leadMinutes >= 60) {
      return `该课建议提前 ${leadMinutes} 分钟准备，建议 ${reminder.leaveAt} 出发。`;
    }
    return `走过去约 ${reminder.commuteMinutes} 分钟，建议 ${reminder.leaveAt} 出发。`;
  }
  const commuteMinutes = DEFAULT_COMMUTE_MINUTES;
  const leaveAt = subtractMinutesFromTime(item.startTime, commuteMinutes);
  return `走过去约 ${commuteMinutes} 分钟，建议 ${leaveAt} 出发。`;
};

const formatFoodCampaignTime = (timestamp: number) => {
  const ts = Number(timestamp || 0);
  if (!Number.isFinite(ts) || ts <= 0) {
    return "--";
  }
  const date = new Date(ts * 1000);
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
};
</script>

<style scoped>
.today-page-shell {
  padding: 0 0.5rem;
}

.card {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  z-index: 0;
  background: color-mix(in srgb, var(--card-bg) 92%, #ffffff 8%);
  border-radius: 14rpx;
  padding: 16rpx;
  margin-bottom: 14rpx;
  border: 1rpx solid var(--line);
  backdrop-filter: blur(10px) saturate(1.18);
  -webkit-backdrop-filter: blur(10px) saturate(1.18);
}

.card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.56) 0%, rgba(255, 255, 255, 0.34) 100%);
  filter: saturate(1.08);
}

.section-title {
  margin-top: 2rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.section-sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.tip {
  margin-top: 14rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.auth-gate-line {
  margin-top: 14rpx;
  border-radius: 10rpx;
  padding: 16rpx 12rpx;
  text-align: center;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--accent);
  background: var(--muted-bg);
}

.lesson-widget-block {
  margin-bottom: 14rpx;
}

.lesson-widget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.lesson-special-notice {
  margin-top: 8rpx;
  margin-bottom: 8rpx;
  padding: 8rpx 10rpx;
  border-radius: 10rpx;
  font-size: 20rpx;
  line-height: 1.3;
  color: #9c2f2f;
  border: 1rpx solid rgba(196, 75, 75, 0.3);
  background: rgba(196, 75, 75, 0.08);
}

.lesson-widget-title {
  font-size: 24rpx;
  font-weight: 400;
  color: var(--text-sub);
  opacity: 0.68;
  line-height: 1;
}

.lesson-widget-count {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--text-sub);
}

.lesson-widget-scroll {
  margin-top: 12rpx;
}

.lesson-widget-list {
  display: flex;
  flex-direction: row;
  gap: 10rpx;
  padding-right: 8rpx;
}

.lesson-widget-item {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  z-index: 0;
  border-radius: 12rpx;
  padding: 12rpx;
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  width: 300rpx;
  flex: 0 0 300rpx;
  background: color-mix(in srgb, var(--card-bg) 90%, #ffffff 10%);
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
  backdrop-filter: blur(6px) saturate(1.12);
  -webkit-backdrop-filter: blur(6px) saturate(1.12);
}

.lesson-widget-item.has-owner-tag {
  padding-bottom: 34rpx;
}

.lesson-widget-item::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0.2) 100%);
}

.lesson-widget-mark {
  width: 6rpx;
  align-self: stretch;
  min-height: 40rpx;
  margin: 4rpx 0;
  border-radius: 999rpx;
  background: var(--text-main);
  opacity: 0.88;
}

.lesson-widget-main {
  flex: 1;
  min-width: 0;
}

.lesson-widget-name {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1.3;
}

.lesson-widget-name-row,
.today-course-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.lesson-widget-reminder {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
  line-height: 1.4;
}

.lesson-widget-time {
  min-width: 72rpx;
  font-size: 20rpx;
  font-weight: 600;
  color: var(--text-sub);
  line-height: 1.35;
  text-align: right;
}

.lesson-widget-owner-tag {
  position: absolute;
  right: 12rpx;
  bottom: 10rpx;
  font-size: 16rpx;
  font-weight: 500;
  color: var(--text-sub);
  opacity: 0.6;
  line-height: 1;
}

.today-greeting-top {
  margin: 4rpx 0 14rpx;
  font-size: 34rpx;
  font-weight: 700;
  color: var(--text-main);
}

.today-greeting-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10rpx;
}

.today-food-icon-btn {
  margin-top: 4rpx;
  width: 56rpx;
  height: 56rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  background: color-mix(in srgb, var(--card-bg) 85%, #ffffff 15%);
  border: 1rpx solid color-mix(in srgb, var(--line) 74%, transparent);
  color: var(--text-main);
}

.food-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10rpx;
}

.food-section-badge {
  min-width: 36rpx;
  height: 36rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, var(--accent) 12%, var(--muted-bg) 88%);
  color: var(--accent);
  font-size: 22rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.food-campaign-list {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.food-campaign-item {
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
  border-radius: 12rpx;
  background: color-mix(in srgb, var(--card-bg) 90%, #ffffff 10%);
  padding: 12rpx 14rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.food-campaign-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: var(--text-sub);
  opacity: 0.4;
  flex-shrink: 0;
}

.food-campaign-dot.live {
  background: #22c55e;
  opacity: 1;
  box-shadow: 0 0 6rpx rgba(34, 197, 94, 0.5);
}

.food-campaign-main {
  flex: 1;
  min-width: 0;
}

.food-campaign-title {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--text-main);
}

.food-campaign-meta {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.food-campaign-status-label {
  font-weight: 500;
}

.food-campaign-sep {
  margin: 0 4rpx;
  opacity: 0.5;
}

.food-campaign-arrow {
  font-size: 32rpx;
  color: var(--text-sub);
  opacity: 0.4;
  flex-shrink: 0;
}

.today-semester-card {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  z-index: 0;
  border-radius: 10rpx;
  padding: 12rpx;
  background: color-mix(in srgb, var(--card-bg) 90%, #ffffff 10%);
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
  backdrop-filter: blur(6px) saturate(1.12);
  -webkit-backdrop-filter: blur(6px) saturate(1.12);
}

.today-semester-card::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0.2) 100%);
}

.today-semester-title {
  font-size: 20rpx;
  color: var(--text-sub);
  line-height: 1.2;
}

.today-semester-main {
  margin-top: 6rpx;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--text-main);
  line-height: 1.35;
}

.today-semester-note {
  margin-top: 5rpx;
  font-size: 20rpx;
  color: var(--text-sub);
  line-height: 1.35;
}

.today-ready {
  margin-top: 8rpx;
  padding: 0 2rpx;
}

.today-ready.empty {
  font-size: 22rpx;
  color: var(--text-sub);
}

.today-list-scroll {
  margin-top: 14rpx;
}

.today-list {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.today-item {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  z-index: 0;
  border-radius: 10rpx;
  padding: 12rpx;
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
  border: none;
  backdrop-filter: blur(5px) saturate(1.08);
  -webkit-backdrop-filter: blur(5px) saturate(1.08);
}

.today-item::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.15) 100%);
}

.today-item.accent {
  background: color-mix(in srgb, var(--card-bg) 88%, #ffffff 12%);
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
}

.today-item-main {
  min-width: 0;
}

.today-course {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text-main);
}

.practice-tag {
  flex-shrink: 0;
  padding: 1rpx 8rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(84, 148, 255, 0.4);
  background: rgba(84, 148, 255, 0.1);
  color: #2f76e6;
  font-size: 18rpx;
  line-height: 1.2;
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
</style>
