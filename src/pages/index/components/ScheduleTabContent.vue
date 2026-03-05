<template>
  <view class="card schedule-card">
    <view v-if="hasMultipleIncluded" class="owner-legend">
      <view v-for="student in includedSchedules" :key="`owner-${student.id}`" class="owner-item">
        <view class="owner-dot" :style="getOwnerDotStyle(student.id)" />
        <text>{{ student.name }}</text>
      </view>
    </view>

    <view
      class="table-wrap"
      @touchstart="onScheduleTouchStart"
      @touchmove="onScheduleTouchMove"
      @touchend="onScheduleTouchEnd"
      @touchcancel="onScheduleTouchCancel"
      @mousedown="onScheduleMouseDown"
      @mousemove="onScheduleMouseMove"
      @mouseup="onScheduleMouseUp"
    >
      <view class="table-head-wrap">
        <view class="table-swipe-track" :style="scheduleTrackStyle">
          <view v-for="panel in scheduleWeekPanels" :key="`head-${panel.role}`" class="table-week-panel">
            <view class="table-row head-row">
              <view class="time-col head">节次</view>
              <view
                v-for="dayNumber in visibleDayNumbers"
                :key="`head-${panel.role}-${dayNumber}`"
                class="day-col head"
                :class="{ 'today-column': isTodayColumn(panel.week, dayNumber) }"
              >
                {{ weekdayLabels[dayNumber - 1] }}
              </view>
            </view>
          </view>
        </view>
      </view>

      <scroll-view
        class="table-body-scroll"
        :style="tableBodyScrollStyle"
        scroll-y
        scroll-with-animation
        :scroll-into-view="tableBodyScrollIntoViewId"
      >
        <view id="schedule-table-top-anchor" class="table-scroll-anchor" />
        <view class="table-swipe-track" :style="scheduleTrackStyle">
          <view v-for="panel in scheduleWeekPanels" :key="panel.role" class="table-week-panel table-body-panel">
            <view
              v-for="row in panel.rows"
              :key="`course-${panel.role}-${panel.week}-${row.section}`"
              :id="panel.role === 'current' ? `section-row-${row.section}` : `section-row-shadow-${panel.role}-${panel.week}-${row.section}`"
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
                v-for="dayNumber in visibleDayNumbers"
                :key="`course-${panel.role}-${panel.week}-${row.section}-${dayNumber}`"
                class="day-col cell"
                :class="{
                  busy: row.cells[dayNumber - 1].busy,
                  'out-of-week': row.cells[dayNumber - 1].isOutOfWeek,
                  'today-column': isTodayColumn(panel.week, dayNumber),
                  'merge-prev': row.cells[dayNumber - 1].mergeWithPrev,
                  'merge-next': row.cells[dayNumber - 1].mergeWithNext,
                  upcoming: isUpcomingCell(panel.week, dayNumber, row.section),
                  'upcoming-tail': isUpcomingTail(panel.week, dayNumber, row.section),
                }"
                :style="getCellStyle(row.cells[dayNumber - 1])"
                @click="openCourseDialog(panel.week, dayNumber, row.section)"
              >
                <view
                  v-if="row.cells[dayNumber - 1].busy && row.cells[dayNumber - 1].showLabel"
                  class="cell-text"
                  :style="getCellTextStyle(row.cells[dayNumber - 1])"
                >
                  <view v-if="hasMultipleIncluded" class="cell-owner-markers">
                    <view
                      v-for="(ownerId, ownerIndex) in row.cells[dayNumber - 1].ownerIds"
                      :key="`marker-${panel.role}-${panel.week}-${row.section}-${dayNumber}-${ownerId}-${ownerIndex}`"
                      class="cell-owner-dot"
                      :style="getOwnerMarkerStyle(ownerId)"
                    />
                  </view>
                  <text class="cell-title">{{ renderCellTitle(row.cells[dayNumber - 1].labels) }}</text>
                  <text v-if="row.cells[dayNumber - 1].hasPracticeCourse" class="cell-practice-tag">实践</text>
                  <text v-if="row.cells[dayNumber - 1].classroomLabel" class="cell-room">{{ row.cells[dayNumber - 1].classroomLabel }}</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>

      <view class="today-column-overlay-layer" aria-hidden="true">
        <view class="today-column-overlay-track" :style="scheduleTrackStyle">
          <view v-for="panel in scheduleWeekPanels" :key="`overlay-${panel.role}`" class="today-column-overlay-panel">
            <view class="today-column-outline" :style="getTodayColumnOverlayStyle(panel.week)">
              <view class="today-column-outline-base" />
              <view class="today-column-outline-flow">
                <view class="today-column-flow-reveal-window">
                  <image class="today-column-flow-image" :src="TODAY_COLUMN_FLOW_IMAGE_SRC" mode="scaleToFill" />
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import type { GridRowCell, ScheduleWeekPanel } from "../types";

const SCHEDULE_TIME_COLUMN_WIDTH = "108rpx";
const SCHEDULE_HEAD_ROW_HEIGHT = "96rpx";
const SCHEDULE_BODY_ROW_HEIGHT = "104rpx";
const SCHEDULE_HEAD_ROW_HEIGHT_UPX = 96;
const SCHEDULE_BODY_MIN_HEIGHT_UPX = 420;
const HIDDEN_OVERLAY_STYLE: CSSProperties = { display: "none" };
const TODAY_COLUMN_FLOW_IMAGE_SRC = "/static/schedule/today-column-flow.png";

interface IncludedScheduleLike {
  id: string;
  name: string;
}

const props = defineProps<{
  hasMultipleIncluded: boolean;
  includedSchedules: IncludedScheduleLike[];
  scheduleTrackStyle: CSSProperties;
  scheduleWeekPanels: ScheduleWeekPanel[];
  weekdayLabels: string[];
  visibleDayNumbers: number[];
  tableBodyScrollIntoViewId: string;
  getOwnerDotStyle: (ownerId: string) => CSSProperties;
  getOwnerMarkerStyle: (ownerId: string) => CSSProperties;
  isTodayColumn: (week: number, day: number) => boolean;
  isUpcomingCell: (week: number, day: number, section: number) => boolean;
  isUpcomingTail: (week: number, day: number, section: number) => boolean;
  getCellStyle: (cell: GridRowCell) => CSSProperties;
  getCellTextStyle: (cell: GridRowCell) => CSSProperties;
  openCourseDialog: (week: number, day: number, section: number) => void;
  renderCellTitle: (labels: string[]) => string;
  onScheduleTouchStart: (...args: any[]) => void;
  onScheduleTouchMove: (...args: any[]) => void;
  onScheduleTouchEnd: (...args: any[]) => void;
  onScheduleTouchCancel: (...args: any[]) => void;
  onScheduleMouseDown: (...args: any[]) => void;
  onScheduleMouseMove: (...args: any[]) => void;
  onScheduleMouseUp: (...args: any[]) => void;
}>();

const todayColumnOverlayStyleByWeek = computed<Record<number, CSSProperties>>(() => {
  const dayCount = props.visibleDayNumbers.length;
  if (dayCount <= 0) {
    return {};
  }

  const styleMap: Record<number, CSSProperties> = {};
  for (const panel of props.scheduleWeekPanels) {
    if (styleMap[panel.week]) {
      continue;
    }
    const todayIndex = props.visibleDayNumbers.findIndex((dayNumber) => props.isTodayColumn(panel.week, dayNumber));
    if (todayIndex < 0) {
      styleMap[panel.week] = HIDDEN_OVERLAY_STYLE;
      continue;
    }
    styleMap[panel.week] = {
      left: `calc(${SCHEDULE_TIME_COLUMN_WIDTH} + (100% - ${SCHEDULE_TIME_COLUMN_WIDTH}) * ${todayIndex} / ${dayCount})`,
      width: `calc((100% - ${SCHEDULE_TIME_COLUMN_WIDTH}) / ${dayCount})`,
      height: `calc(${SCHEDULE_HEAD_ROW_HEIGHT} + ${panel.rows.length} * ${SCHEDULE_BODY_ROW_HEIGHT})`,
    };
  }
  return styleMap;
});

const getTodayColumnOverlayStyle = (week: number): CSSProperties => {
  return todayColumnOverlayStyleByWeek.value[week] || HIDDEN_OVERLAY_STYLE;
};

const tableBodyScrollStyle = ref<CSSProperties>({});
let tableBodyHeightSyncTimer: ReturnType<typeof setTimeout> | null = null;

const syncTableBodyScrollHeight = () => {
  nextTick(() => {
    const query = uni.createSelectorQuery();
    query.select(".table-wrap").boundingClientRect((result: unknown) => {
      const rect = (Array.isArray(result) ? result[0] : result) as { height?: number | string } | undefined;
      const wrapHeight = Number(rect?.height || 0);
      if (!Number.isFinite(wrapHeight) || wrapHeight <= 0) {
        return;
      }
      const headHeight = Number(uni.upx2px(SCHEDULE_HEAD_ROW_HEIGHT_UPX));
      const minBodyHeight = Number(uni.upx2px(SCHEDULE_BODY_MIN_HEIGHT_UPX));
      const bodyHeight = Math.max(minBodyHeight, Math.floor(wrapHeight - headHeight));
      tableBodyScrollStyle.value = {
        height: `${bodyHeight}px`,
        minHeight: `${minBodyHeight}px`,
        flex: "0 0 auto",
      };
    });
    query.exec();
  });
};

const scheduleBodyHeightSyncDeps = computed(() => {
  return [
    props.scheduleWeekPanels.length,
    props.visibleDayNumbers.length,
    props.hasMultipleIncluded ? props.includedSchedules.length : 0,
  ].join("-");
});

watch(scheduleBodyHeightSyncDeps, () => {
  syncTableBodyScrollHeight();
}, { flush: "post" });

onMounted(() => {
  syncTableBodyScrollHeight();
  tableBodyHeightSyncTimer = setTimeout(() => {
    syncTableBodyScrollHeight();
  }, 120);
});

onUnmounted(() => {
  if (tableBodyHeightSyncTimer) {
    clearTimeout(tableBodyHeightSyncTimer);
    tableBodyHeightSyncTimer = null;
  }
});
</script>

<style scoped>
.card {
  background: var(--card-bg);
  border-radius: 14rpx;
  padding: 16rpx;
  border: 1rpx solid var(--line);
}

.schedule-card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 20rpx;
  padding: 10rpx;
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.schedule-card .owner-legend {
  margin-left: 4rpx;
  margin-right: 4rpx;
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

.table-wrap {
  width: 100%;
  border-radius: 16rpx;
  overflow: hidden;
  background: var(--muted-bg);
  position: relative;
  min-height: 0;
  flex: 1;
  touch-action: pan-y;
  user-select: none;
  display: flex;
  flex-direction: column;
}

.table-head-wrap {
  width: 100%;
  overflow: hidden;
  flex: 0 0 auto;
  position: relative;
  z-index: 2;
}

.table-body-scroll {
  flex: 1;
  min-height: 420rpx;
  height: auto;
  position: relative;
  z-index: 2;
}

.table-scroll-anchor {
  width: 100%;
  height: 1rpx;
}

.table-swipe-track {
  display: flex;
  min-height: 0;
  will-change: transform;
}

.table-week-panel {
  width: 100%;
  flex: 0 0 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-body-panel {
  min-height: 100%;
}

.table-row {
  display: flex;
  min-height: 104rpx;
  flex: 0 0 auto;
}

.head-row {
  flex: 0 0 96rpx;
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

.table-row.part-start:not(:first-child) .time-col,
.table-row.part-start:not(:first-child) .day-col:not(.busy) {
  box-shadow: inset 0 2rpx 0 rgba(255, 255, 255, 0.5);
}

.time-col {
  width: 108rpx;
  background: var(--time-col-bg);
  border-radius: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.head-row .time-col {
  border-top-left-radius: 20rpx;
  border-top-right-radius: 0;
}

.table-row.part-start:first-child .time-col {
  border-top-left-radius: 24rpx;
  border-top-right-radius: 0;
}

.table-row:last-child .time-col {
  border-bottom-left-radius: 24rpx;
  border-bottom-right-radius: 0;
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

.cell {
  position: relative;
  padding: 2rpx 4rpx;
}

.cell-owner-markers {
  position: absolute;
  top: 8rpx;
  right: 6rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5rpx;
  max-width: calc(100% - 12rpx);
  pointer-events: none;
  z-index: 2;
}

.part-start .cell-owner-markers {
  top: 22rpx;
}

.cell-owner-dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--card-bg);
  flex-shrink: 0;
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
  background-clip: content-box;
  border-radius: 16rpx;
}

.cell.busy.merge-prev {
  padding-top: 0;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.cell.busy.merge-next {
  padding-bottom: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
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
  position: absolute;
  left: 4rpx;
  right: 4rpx;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 4rpx;
  padding: 0;
  box-sizing: border-box;
  pointer-events: none;
}

.cell-title {
  font-size: 19rpx;
  line-height: 1.28;
  color: var(--text-main);
  font-weight: 600;
}

.cell-room {
  font-size: 15rpx;
  line-height: 1.2;
  color: var(--text-sub);
}

.cell-practice-tag {
  font-size: 14rpx;
  line-height: 1.2;
  color: #2f76e6;
  border: 1rpx solid rgba(84, 148, 255, 0.4);
  border-radius: 999rpx;
  padding: 1rpx 8rpx;
  background: rgba(84, 148, 255, 0.1);
}

.day-col.today-column {
  background: transparent;
}

.head.today-column {
  background: var(--muted-bg);
  color: var(--accent);
  font-weight: 700;
}

.today-column-overlay-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
}

.today-column-overlay-track {
  display: flex;
  min-height: 0;
  width: 100%;
  height: 100%;
  will-change: transform;
}

.today-column-overlay-panel {
  width: 100%;
  flex: 0 0 100%;
  min-width: 0;
  position: relative;
}

.today-column-outline {
  position: absolute;
  top: 0;
  max-height: 100%;
  box-sizing: border-box;
  border-radius: 16rpx;
  pointer-events: none;
  opacity: 0;
  will-change: opacity;
  animation: today-column-outline-entry 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.today-column-outline-base {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border: 2rpx solid var(--accent);
  border-radius: 16rpx;
  opacity: 0.42;
}

.today-column-outline-flow {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.today-column-flow-reveal-window {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 0%;
  overflow: hidden;
  border-radius: inherit;
  will-change: height, opacity;
  animation: today-column-flow-window-reveal 780ms cubic-bezier(0.22, 1, 0.36, 1) 120ms 1 forwards;
}

.today-column-flow-image {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  opacity: 0.82;
}

@keyframes today-column-outline-entry {
  0% {
    opacity: 0;
  }
  14% {
    opacity: 0.56;
  }
  58% {
    opacity: 1;
  }
  100% {
    opacity: 1;
  }
}

@keyframes today-column-flow-window-reveal {
  0% {
    height: 0%;
    opacity: 0.32;
  }
  30% {
    height: 38%;
    opacity: 0.76;
  }
  100% {
    height: 100%;
    opacity: 1;
  }
}
</style>
