<template>
  <scale-fade-dialog :show="showIncludePicker" :duration-ms="200" @close="emit('close-include-picker')">
    <template #default="{ isOpen }">
      <view class="dialog-card dialog-pop-card" :class="{ 'is-open': isOpen }" @click.stop>
        <view class="dialog-title">课程显示设置</view>
        <view class="dialog-sub">勾选后将对应同学课程合并进课表（可只看他人课表）</view>
        <view class="display-setting-item">
          <view class="display-setting-text">
            <text class="display-setting-title">显示周六周日</text>
            <text class="display-setting-desc">关闭后仅展示周一到周五</text>
          </view>
          <switch :checked="showWeekend" @change="onShowWeekendChange" />
        </view>
        <checkbox-group @change="onIncludeChange">
          <label v-for="student in selectableStudentSchedules" :key="student.id" class="check-item">
            <view class="owner-dot small" :style="getOwnerDotStyle(student.id)" />
            <checkbox
              :value="student.id"
              :checked="includedStudentIds.includes(student.id)"
              color="#111111"
            />
            <view class="check-item-main">
              <text class="check-item-name">{{ student.name }}</text>
              <text class="check-item-meta">{{ includeStatusByStudentId[student.id] || "状态未知" }}</text>
            </view>
          </label>
        </checkbox-group>
        <button class="dialog-btn" @click="emit('close-include-picker')">完成</button>
      </view>
    </template>
  </scale-fade-dialog>

  <scale-fade-dialog :show="showThemeUnlockDialog" :duration-ms="200" @close="emit('close-theme-unlock-dialog')">
    <template #default="{ isOpen }">
      <view class="dialog-card unlock-card dialog-pop-card" :class="{ 'is-open': isOpen }" @click.stop>
        <view class="dialog-title">解锁炫靓紫</view>
        <view class="dialog-sub">请输入密码后启用该主题（只需输入一次）</view>
        <input
          :value="themePasswordInput"
          class="unlock-input"
          type="text"
          password
          placeholder="请输入 8 位解锁密码"
          :maxlength="8"
          @input="onThemePasswordInput"
        />
        <view v-if="themeUnlockError" class="unlock-error">{{ themeUnlockError }}</view>
        <view class="unlock-actions">
          <view class="unlock-btn ghost" @click="emit('close-theme-unlock-dialog')">取消</view>
          <view class="unlock-btn" @click="emit('confirm-purple-unlock')">解锁</view>
        </view>
      </view>
    </template>
  </scale-fade-dialog>

  <scale-fade-dialog :show="showBackendProbeDialog" :duration-ms="200" @close="emit('close-backend-probe-dialog')">
    <template #default="{ isOpen }">
      <view class="dialog-card dialog-pop-card" :class="{ 'is-open': isOpen }" @click.stop>
        <view class="dialog-title">后端在线检测</view>
        <view class="dialog-sub">检测 `/health`，在线后拉取 `/api/today-brief`。</view>
        <view class="backend-mock-row">
          <view class="backend-mock-btn" @click="emit('run-backend-probe')">立即检测</view>
          <view class="backend-mock-btn" @click="emit('refresh-today-brief')">刷新今日数据</view>
        </view>
        <view class="backend-status-tip">当前展示：{{ backendProbeStatusLabel }}</view>
        <view v-if="todayBackendError" class="backend-status-tip error">{{ todayBackendError }}</view>
        <button class="dialog-btn" @click="emit('close-backend-probe-dialog')">关闭</button>
      </view>
    </template>
  </scale-fade-dialog>

  <scale-fade-dialog :show="showUserPicker" :duration-ms="200" @close="emit('close-user-picker')">
    <template #default="{ isOpen }">
      <view class="auth-card dialog-pop-card" :class="{ 'is-open': isOpen }" @click.stop>
        <view class="auth-title">切换课表账号</view>
        <view class="auth-sub">点击列表项后立即切换</view>
        <view class="picker-list">
          <view
            v-for="candidate in loginCandidates"
            :key="candidate.studentId"
            class="picker-item"
            :class="{ active: candidate.studentId === activeStudentId }"
            @click="emit('select-from-modal', candidate.studentId)"
          >
            <view class="picker-name">{{ candidate.name }}</view>
            <view class="picker-desc">{{ candidate.description }}</view>
          </view>
        </view>
      </view>
    </template>
  </scale-fade-dialog>

  <scale-fade-dialog :show="showCourseDialog" :duration-ms="200" @close="emit('close-course-dialog')">
    <template #default="{ isOpen }">
      <view class="dialog-card course-dialog-card" :class="{ 'is-open': isOpen }" @click.stop>
        <view class="dialog-title">课程详情</view>
        <view class="dialog-sub">
          第 {{ dialogWeek }} 周 · {{ weekdayLabels[dialogDay - 1] }} · 第 {{ dialogSection }} 节
        </view>
        <view class="dialog-list">
          <view v-for="course in dialogCourses" :key="`dialog-${course.ownerId}-${course.id}`" class="dialog-item">
            <view class="dialog-name-row">
              <view class="dialog-name">{{ course.name }}</view>
              <text v-if="isPracticeCourse(course)" class="practice-tag">实践</text>
            </view>
            <view class="dialog-meta">课表：{{ course.ownerName }}</view>
            <view class="dialog-meta">节次：{{ formatSectionRange(course.startSection, course.endSection) }}</view>
            <view class="dialog-meta">周次：{{ formatWeekRule(course) }}</view>
            <view class="dialog-meta">教室：{{ course.classroom || "待配置" }}</view>
            <view class="dialog-meta">教师：{{ formatCourseTeacher(course) }}</view>
            <view class="dialog-meta">教学班：{{ formatCourseTeachingClasses(course) }}</view>
            <view v-if="canTogglePracticeCourse(course)" class="dialog-inline-actions">
              <view
                class="practice-action-btn"
                :class="{ pending: isPracticeTogglePending(course) }"
                @click="emitTogglePractice(course)"
              >
                {{
                  isPracticeTogglePending(course)
                    ? "处理中..."
                    : isPracticeCourse(course)
                      ? "取消实践"
                      : "标记实践"
                }}
              </view>
            </view>
          </view>
        </view>
        <view class="dialog-action-row">
          <button class="dialog-btn ghost" @click="emit('close-course-dialog')">关闭</button>
        </view>
      </view>
    </template>
  </scale-fade-dialog>

  <scale-fade-dialog :show="showWeekPicker" :duration-ms="200" @close="emit('close-week-picker')">
    <template #default="{ isOpen }">
      <view class="dialog-card dialog-pop-card week-picker-dialog-card" :class="{ 'is-open': isOpen }" @click.stop>
        <view class="dialog-title">选择周次</view>
        <scroll-view class="week-picker-list" scroll-y>
          <view
            v-for="week in allWeeks"
            :key="`picker-${week}`"
            class="week-picker-item"
            :class="{ active: week === selectedWeek }"
            @click="emit('choose-week', week)"
          >
            <text>第 {{ week }} 周</text>
            <text class="week-picker-date">{{ getWeekDateRangeLabel(week) }}</text>
          </view>
        </scroll-view>
        <button class="dialog-btn" @click="emit('close-week-picker')">关闭</button>
      </view>
    </template>
  </scale-fade-dialog>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import ScaleFadeDialog from "./ScaleFadeDialog.vue";
import type { CourseItem } from "@/types/schedule";
import type { DisplayCourse } from "../types";

interface SelectableStudentSchedule {
  id: string;
  name: string;
}

interface LoginCandidate {
  studentId: string;
  name: string;
  description: string;
}

const props = defineProps<{
  showIncludePicker: boolean;
  selectableStudentSchedules: SelectableStudentSchedule[];
  includeStatusByStudentId: Record<string, string>;
  includedStudentIds: string[];
  showWeekend: boolean;
  getOwnerDotStyle: (ownerId: string) => CSSProperties;
  showThemeUnlockDialog: boolean;
  themePasswordInput: string;
  themeUnlockError: string;
  showBackendProbeDialog: boolean;
  backendProbeStatusLabel: string;
  todayBackendError: string;
  showUserPicker: boolean;
  loginCandidates: LoginCandidate[];
  activeStudentId: string;
  showCourseDialog: boolean;
  dialogWeek: number;
  dialogDay: number;
  dialogSection: number;
  weekdayLabels: string[];
  dialogCourses: DisplayCourse[];
  formatSectionRange: (startSection: number, endSection: number) => string;
  formatWeekRule: (course: CourseItem) => string;
  formatCourseTeacher: (course: DisplayCourse) => string;
  formatCourseTeachingClasses: (course: DisplayCourse) => string;
  getCoursePracticeKey: (course: DisplayCourse) => string;
  isPracticeCourse: (course: DisplayCourse) => boolean;
  canTogglePracticeCourse: (course: DisplayCourse) => boolean;
  practiceTogglePendingCourseKey: string;
  showWeekPicker: boolean;
  allWeeks: number[];
  selectedWeek: number;
  getWeekDateRangeLabel: (week: number) => string;
}>();

const emit = defineEmits<{
  (event: "close-include-picker"): void;
  (event: "include-change", value: string[]): void;
  (event: "update-show-weekend", value: boolean): void;
  (event: "close-theme-unlock-dialog"): void;
  (event: "update-theme-password-input", value: string): void;
  (event: "confirm-purple-unlock"): void;
  (event: "close-backend-probe-dialog"): void;
  (event: "run-backend-probe"): void;
  (event: "refresh-today-brief"): void;
  (event: "close-user-picker"): void;
  (event: "select-from-modal", studentId: string): void;
  (event: "close-course-dialog"): void;
  (event: "toggle-practice-course", course: DisplayCourse): void;
  (event: "close-week-picker"): void;
  (event: "choose-week", week: number): void;
}>();

const onIncludeChange = (event: any) => {
  const values = Array.isArray(event?.detail?.value) ? event.detail.value.map((item: unknown) => String(item)) : [];
  emit("include-change", values);
};

const onShowWeekendChange = (event: any) => {
  const nextValue = Boolean(event?.detail?.value);
  emit("update-show-weekend", nextValue);
};

const onThemePasswordInput = (event: any) => {
  const nextValue = String(event?.detail?.value ?? "");
  emit("update-theme-password-input", nextValue);
};

const emitTogglePractice = (course: DisplayCourse) => {
  emit("toggle-practice-course", course);
};

const isPracticeTogglePending = (course: DisplayCourse) => {
  const targetKey = props.getCoursePracticeKey(course);
  if (!targetKey) {
    return false;
  }
  return props.practiceTogglePendingCourseKey === targetKey;
};
</script>

<style scoped>
.display-setting-item {
  margin-top: 14rpx;
  margin-bottom: 6rpx;
  padding: 10rpx 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: var(--muted-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.display-setting-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.display-setting-title {
  font-size: 24rpx;
  color: var(--text-main);
}

.display-setting-desc {
  margin-top: 2rpx;
  font-size: 20rpx;
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

.check-item {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 12rpx;
  color: var(--text-main);
  font-size: 24rpx;
}

.check-item-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.check-item-name {
  font-size: 24rpx;
  color: var(--text-main);
}

.check-item-meta {
  margin-top: 2rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.auth-card,
.dialog-card {
  width: 100%;
  min-width: 60%;
  max-width: 640rpx;
  background: var(--card-bg);
  border-radius: 16rpx;
  padding: 24rpx;
  border: 1rpx solid var(--line);
}

.dialog-pop-card {
  transform-origin: center center;
  transform: scale(1.03);
  opacity: 0;
  transition: transform 200ms ease, opacity 200ms ease;
  will-change: transform, opacity;
}

.dialog-pop-card.is-open {
  transform: scale(1);
  opacity: 1;
}

.course-dialog-card {
  transform-origin: center center;
  border-radius: 28rpx;
  transform: scale(1.05);
  opacity: 0;
  transition: transform 200ms ease, opacity 200ms ease;
  will-change: transform, opacity;
}

.course-dialog-card.is-open {
  transform: scale(1);
  opacity: 1;
}

.week-picker-dialog-card {
  min-width: 68%;
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

.auth-detail-item {
  margin-top: 10rpx;
  font-size: 22rpx;
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

.picker-desc {
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

.dialog-action-row {
  margin-top: 18rpx;
  display: flex;
  gap: 10rpx;
}

.course-dialog-card .dialog-btn {
  flex: 1;
  margin-top: 0;
  border-radius: 10rpx;
  font-size: 23rpx;
}

.course-dialog-card .dialog-btn.ghost {
  background: var(--card-bg);
  color: var(--text-main);
  border: 1rpx solid var(--line);
}

.dialog-name {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text-main);
}

.dialog-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10rpx;
}

.practice-tag {
  flex-shrink: 0;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(84, 148, 255, 0.45);
  background: rgba(84, 148, 255, 0.12);
  color: #2f76e6;
  font-size: 20rpx;
  line-height: 1.4;
}

.dialog-meta {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.dialog-inline-actions {
  margin-top: 10rpx;
  display: flex;
  justify-content: flex-end;
}

.practice-action-btn {
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: #2f76e6;
  border: 1rpx solid rgba(84, 148, 255, 0.5);
  background: rgba(84, 148, 255, 0.12);
}

.practice-action-btn.pending {
  opacity: 0.58;
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

.unlock-btn.pending {
  opacity: 0.64;
  pointer-events: none;
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
