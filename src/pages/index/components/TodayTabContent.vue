<template>
  <view v-if="!isAuthed || shouldShowStudyCard" class="card">
    <view class="lesson-widget-head">
      <view class="lesson-widget-title">Today</view>
      <view class="lesson-widget-count">{{ isAuthed ? `${pendingCourseCount} Events` : "待授权" }}</view>
    </view>
    <view v-if="!isAuthed" class="auth-gate-line" @click="onAuthorize">去授权</view>
    <template v-else>
      <view v-if="pinnedCourseItems.length > 0" class="lesson-widget-list">
        <view
          v-for="item in pinnedCourseItems"
          :key="item.key"
          class="lesson-widget-item"
          :style="getCourseCardStyle(item.course)"
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
        </view>
      </view>
      <view v-else class="today-ready empty">今天暂无待上课程。</view>

    </template>
  </view>

  <view class="card">
    <view class="today-hero">
      <view class="today-greeting">{{ todayGreetingText }}</view>
      <view class="today-hero-sub">第 {{ todayInfo.week }} 周 · {{ todayInfo.weekdayLabel }} · {{ todayInfo.dateLabel }}</view>
    </view>

    <view class="today-semester-card">
      <view class="today-semester-title">我的加入</view>
      <view class="today-semester-main">
        你已经开学 {{ semesterElapsed.totalDays }} 天 {{ semesterElapsed.totalWeeks }} 周 {{ semesterElapsed.totalHours }} 小时
      </view>
      <view class="today-semester-note">* 以 3 月 1 日早上 8:00 作为起始计时</view>
    </view>

  </view>

  <view class="card">
    <view class="section-title">今日课程</view>
    <view v-if="!isAuthed" class="auth-gate-line" @click="onAuthorize">去授权</view>
    <template v-else>
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
    </template>
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
  leaveAt: string;
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

const pinnedCourseItems = computed(() => {
  return pendingCourseItems.value.slice(0, 3);
});

const pendingCourseCount = computed(() => {
  return pendingCourseItems.value.length;
});

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
    return `走过去约 ${reminder.commuteMinutes} 分钟，建议 ${reminder.leaveAt} 出发。`;
  }
  const commuteMinutes = DEFAULT_COMMUTE_MINUTES;
  const leaveAt = subtractMinutesFromTime(item.startTime, commuteMinutes);
  return `走过去约 ${commuteMinutes} 分钟，建议 ${leaveAt} 出发。`;
};
</script>

<style scoped>
.card {
  background: color-mix(in srgb, var(--card-bg) 94%, transparent);
  border-radius: 14rpx;
  padding: 16rpx;
  margin-bottom: 14rpx;
  border: 1rpx solid var(--line);
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

.lesson-widget-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.lesson-widget-title {
  font-size: 36rpx;
  font-weight: 700;
  color: var(--text-main);
  line-height: 1;
}

.lesson-widget-count {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--text-sub);
}

.lesson-widget-list {
  margin-top: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.lesson-widget-item {
  border-radius: 12rpx;
  padding: 12rpx;
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
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

.today-hero {
  border-radius: 12rpx;
  padding: 16rpx;
  background: transparent;
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
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

.today-semester-card {
  margin-top: 12rpx;
  border-radius: 10rpx;
  padding: 12rpx;
  background: transparent;
  border: 1rpx solid color-mix(in srgb, var(--line) 72%, transparent);
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
  background: transparent;
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
