import { computed, onUnmounted, ref, type CSSProperties, type ComputedRef, type Ref } from "vue";

interface TouchPoint {
  x: number;
  y: number;
}

interface SimpleTouchLike {
  clientX: number;
  clientY: number;
}

interface SimpleTouchEventLike {
  touches?: ArrayLike<SimpleTouchLike>;
  changedTouches?: ArrayLike<SimpleTouchLike>;
  timeStamp?: number;
  preventDefault?: () => void;
  cancelable?: boolean;
}

interface SimpleMouseEventLike {
  clientX: number;
  clientY: number;
  button?: number;
  buttons?: number;
  timeStamp?: number;
}

interface UseScheduleWeekSwipeOptions {
  activeTab: Ref<string>;
  isAnyModalOpen: Ref<boolean> | ComputedRef<boolean>;
  selectedWeek: Ref<number>;
  termMaxWeek: Ref<number> | ComputedRef<number>;
  scheduleSwipeViewportWidth: Ref<number>;
  syncScheduleSwipeViewportWidth: () => void;
}

const SCHEDULE_TAB_KEY = "schedule";
const WEEK_SWIPE_TRIGGER_DISTANCE = 80;
const WEEK_SWIPE_MAX_VERTICAL_DRIFT = 34;
const WEEK_SWIPE_INTENT_LOCK_DISTANCE = 8;
const WEEK_SWIPE_ACTIVATE_DISTANCE = 14;
const WEEK_SWIPE_ACTIVATE_BIAS_X = 6;
const WEEK_SWIPE_EDGE_RESISTANCE = 0.34;
const WEEK_SWIPE_MAX_FOLLOW_RATIO = 0.9;
const WEEK_SWIPE_BASE_DURATION_MS = 150;
const WEEK_SWIPE_MIN_DURATION_MS = 70;
const WEEK_SWIPE_MAX_DURATION_MS = 400;
const WEEK_SWIPE_VELOCITY_TRIGGER = 0.16;
const WEEK_SWIPE_FAST_VELOCITY = 0.72;
const WEEK_SWIPE_MOMENTUM_FACTOR = 320;

export const useScheduleWeekSwipe = ({
  activeTab,
  isAnyModalOpen,
  selectedWeek,
  termMaxWeek,
  scheduleSwipeViewportWidth,
  syncScheduleSwipeViewportWidth,
}: UseScheduleWeekSwipeOptions) => {
  const ignoreTapUntil = ref(0);
  const scheduleTouchStartPoint = ref<TouchPoint | null>(null);
  const scheduleSwipeBlocked = ref(false);
  const scheduleSwipeTracking = ref(false);
  const scheduleSwipeOffsetX = ref(0);
  const scheduleSwipeAnimating = ref(false);
  const scheduleSwipeTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSwipeAfterAnimation = ref<(() => void) | null>(null);
  const scheduleSwipeAnimationDurationMs = ref(WEEK_SWIPE_BASE_DURATION_MS);
  const scheduleSwipeVelocityX = ref(0);
  const scheduleSwipeLastPoint = ref<TouchPoint | null>(null);
  const scheduleSwipeLastTs = ref(0);
  const scheduleSwipeStartTs = ref(0);
  const scheduleMouseDragging = ref(false);
  const scheduleSwipePendingOffsetX = ref(0);
  let scheduleSwipeRafId: number | null = null;
  let scheduleWindowMouseListenersBound = false;

  const scheduleTrackStyle = computed<CSSProperties>(() => {
    return {
      transform: `translateX(-100%) translateX(${scheduleSwipeOffsetX.value}px)`,
      transition: scheduleSwipeAnimating.value
        ? `transform ${scheduleSwipeAnimationDurationMs.value}ms cubic-bezier(0.22, 0.61, 0.36, 1)`
        : "none",
    };
  });

  const getTouchFromEvent = (event: SimpleTouchEventLike, preferChanged = false): TouchPoint | null => {
    const source = preferChanged ? event.changedTouches || event.touches : event.touches || event.changedTouches;
    const firstTouch = source?.[0];
    if (!firstTouch) {
      return null;
    }
    return {
      x: Number(firstTouch.clientX),
      y: Number(firstTouch.clientY),
    };
  };

  const getMousePointFromEvent = (event: SimpleMouseEventLike): TouchPoint | null => {
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  };

  const getEventTimestampMs = (event: { timeStamp?: number }) => {
    const ts = Number(event.timeStamp || 0);
    if (Number.isFinite(ts) && ts > 0) {
      return ts;
    }
    return Date.now();
  };

  const clearScheduleSwipeTimer = () => {
    if (scheduleSwipeTimer.value) {
      clearTimeout(scheduleSwipeTimer.value);
      scheduleSwipeTimer.value = null;
    }
    scheduleSwipeAfterAnimation.value = null;
  };

  const clearScheduleSwipeRaf = () => {
    if (scheduleSwipeRafId === null || typeof globalThis.cancelAnimationFrame !== "function") {
      scheduleSwipeRafId = null;
      return;
    }
    globalThis.cancelAnimationFrame(scheduleSwipeRafId);
    scheduleSwipeRafId = null;
  };

  const setScheduleSwipeOffsetWithRaf = (offset: number) => {
    scheduleSwipePendingOffsetX.value = offset;
    if (typeof globalThis.requestAnimationFrame !== "function") {
      scheduleSwipeOffsetX.value = offset;
      return;
    }
    if (scheduleSwipeRafId !== null) {
      return;
    }
    scheduleSwipeRafId = globalThis.requestAnimationFrame(() => {
      scheduleSwipeRafId = null;
      scheduleSwipeOffsetX.value = scheduleSwipePendingOffsetX.value;
    });
  };

  const clampNumber = (value: number, min: number, max: number) => {
    return Math.min(max, Math.max(min, value));
  };

  const resolveSwipeDuration = (distance: number, velocityAbs: number, fallbackMs: number) => {
    if (distance <= 0) {
      return WEEK_SWIPE_MIN_DURATION_MS;
    }
    const viewportWidth = Math.max(1, scheduleSwipeViewportWidth.value);
    const distanceRatio = clampNumber(distance / viewportWidth, 0, 1);
    let target = WEEK_SWIPE_BASE_DURATION_MS * (0.55 + distanceRatio * 0.7);
    if (velocityAbs <= 0.02) {
      return clampNumber(target, WEEK_SWIPE_MIN_DURATION_MS, Math.min(WEEK_SWIPE_MAX_DURATION_MS, fallbackMs));
    }
    const byVelocity = distance / velocityAbs;
    target = Math.min(target, byVelocity * 0.84);
    if (velocityAbs >= WEEK_SWIPE_FAST_VELOCITY) {
      target = Math.min(target, 105);
    }
    return clampNumber(target, WEEK_SWIPE_MIN_DURATION_MS, Math.min(WEEK_SWIPE_MAX_DURATION_MS, fallbackMs));
  };

  const setScheduleSwipeOffset = (offset: number, animated: boolean, onFinished?: () => void, durationMs = WEEK_SWIPE_BASE_DURATION_MS) => {
    clearScheduleSwipeRaf();
    clearScheduleSwipeTimer();
    scheduleSwipeAfterAnimation.value = onFinished || null;
    scheduleSwipeAnimating.value = animated;
    scheduleSwipeAnimationDurationMs.value = clampNumber(durationMs, WEEK_SWIPE_MIN_DURATION_MS, WEEK_SWIPE_MAX_DURATION_MS);
    scheduleSwipeOffsetX.value = offset;
    if (!animated) {
      return;
    }
    scheduleSwipeTimer.value = setTimeout(() => {
      scheduleSwipeAnimating.value = false;
      scheduleSwipeTimer.value = null;
      const callback = scheduleSwipeAfterAnimation.value;
      scheduleSwipeAfterAnimation.value = null;
      callback?.();
    }, scheduleSwipeAnimationDurationMs.value + 24);
  };

  const resetScheduleSwipe = () => {
    scheduleTouchStartPoint.value = null;
    scheduleSwipeBlocked.value = false;
    scheduleSwipeTracking.value = false;
    scheduleSwipeVelocityX.value = 0;
    scheduleSwipeLastPoint.value = null;
    scheduleSwipeLastTs.value = 0;
    scheduleSwipeStartTs.value = 0;
  };

  const canHandleScheduleSwipe = () => {
    return activeTab.value === SCHEDULE_TAB_KEY && !isAnyModalOpen.value;
  };

  const startScheduleSwipe = (point: TouchPoint, startTs: number) => {
    syncScheduleSwipeViewportWidth();
    if (scheduleSwipeAnimating.value) {
      setScheduleSwipeOffset(0, false);
    }
    scheduleTouchStartPoint.value = point;
    scheduleSwipeBlocked.value = false;
    scheduleSwipeTracking.value = false;
    scheduleSwipeVelocityX.value = 0;
    scheduleSwipeLastPoint.value = point;
    scheduleSwipeLastTs.value = startTs;
    scheduleSwipeStartTs.value = startTs;
  };

  const updateScheduleSwipe = (point: TouchPoint, nowTs: number) => {
    if (!scheduleTouchStartPoint.value || scheduleSwipeBlocked.value || !canHandleScheduleSwipe()) {
      return false;
    }

    const rawDeltaX = point.x - scheduleTouchStartPoint.value.x;
    const rawDeltaY = point.y - scheduleTouchStartPoint.value.y;
    const deltaX = Math.abs(rawDeltaX);
    const deltaY = Math.abs(rawDeltaY);
    const lastPoint = scheduleSwipeLastPoint.value;
    const lastTs = scheduleSwipeLastTs.value;
    if (lastPoint && lastTs > 0 && nowTs > lastTs) {
      const instantVelocityX = (point.x - lastPoint.x) / (nowTs - lastTs);
      scheduleSwipeVelocityX.value = scheduleSwipeVelocityX.value * 0.35 + instantVelocityX * 0.65;
    }
    scheduleSwipeLastPoint.value = point;
    scheduleSwipeLastTs.value = nowTs;

    if (!scheduleSwipeTracking.value) {
      if (deltaY >= WEEK_SWIPE_INTENT_LOCK_DISTANCE && deltaY > deltaX) {
        scheduleSwipeBlocked.value = true;
        setScheduleSwipeOffset(0, false);
        return false;
      }
      if (deltaX < WEEK_SWIPE_ACTIVATE_DISTANCE || deltaX <= deltaY + WEEK_SWIPE_ACTIVATE_BIAS_X) {
        return false;
      }
      scheduleSwipeTracking.value = true;
    }

    if (deltaY > WEEK_SWIPE_MAX_VERTICAL_DRIFT && deltaY > deltaX) {
      scheduleSwipeBlocked.value = true;
      setScheduleSwipeOffset(0, true);
      return false;
    }

    const atFirstWeek = selectedWeek.value <= 1;
    const atLastWeek = selectedWeek.value >= termMaxWeek.value;
    const isOutwardSwipe = (atFirstWeek && rawDeltaX > 0) || (atLastWeek && rawDeltaX < 0);
    const offset = isOutwardSwipe ? rawDeltaX * WEEK_SWIPE_EDGE_RESISTANCE : rawDeltaX;
    const maxFollowDistance = scheduleSwipeViewportWidth.value * WEEK_SWIPE_MAX_FOLLOW_RATIO;
    const safeOffset = Math.max(-maxFollowDistance, Math.min(maxFollowDistance, offset));
    setScheduleSwipeOffsetWithRaf(safeOffset);
    return true;
  };

  const finishScheduleSwipe = (endPoint: TouchPoint | null, endTs: number, forcedCancel = false) => {
    const startPoint = scheduleTouchStartPoint.value;
    const hasActiveGesture = Boolean(startPoint) || Math.abs(scheduleSwipeOffsetX.value) > 0.5;
    if (!hasActiveGesture) {
      resetScheduleSwipe();
      return;
    }
    const wasTracking = scheduleSwipeTracking.value;
    const currentOffset = scheduleSwipeOffsetX.value;
    const startTs = scheduleSwipeStartTs.value;
    const blockedByVerticalScroll = scheduleSwipeBlocked.value;
    const sampledVelocityX = scheduleSwipeVelocityX.value;
    const resolvedEndPoint = endPoint || startPoint || null;
    const avgVelocityX =
      startPoint && resolvedEndPoint && startTs > 0 && endTs > startTs ? (resolvedEndPoint.x - startPoint.x) / (endTs - startTs) : 0;
    const releaseVelocityX = Math.abs(avgVelocityX) > Math.abs(sampledVelocityX) ? avgVelocityX : sampledVelocityX;
    const safeVelocityX = clampNumber(releaseVelocityX, -3.2, 3.2);
    resetScheduleSwipe();
    if (forcedCancel || !resolvedEndPoint || !startPoint || blockedByVerticalScroll || !canHandleScheduleSwipe()) {
      const resetDuration = resolveSwipeDuration(Math.abs(currentOffset), Math.abs(safeVelocityX), WEEK_SWIPE_BASE_DURATION_MS - 20);
      setScheduleSwipeOffset(0, true, undefined, resetDuration);
      return;
    }

    const deltaX = wasTracking ? currentOffset : resolvedEndPoint.x - startPoint.x;
    const deltaY = Math.abs(resolvedEndPoint.y - startPoint.y);
    const distancePassed = Math.abs(deltaX) >= WEEK_SWIPE_TRIGGER_DISTANCE;
    const velocityPassed = Math.abs(safeVelocityX) >= WEEK_SWIPE_VELOCITY_TRIGGER;
    const projectedDeltaX = deltaX + safeVelocityX * WEEK_SWIPE_MOMENTUM_FACTOR;
    const momentumPassed = Math.abs(projectedDeltaX) >= WEEK_SWIPE_TRIGGER_DISTANCE;
    if ((!distancePassed && !velocityPassed && !momentumPassed) || deltaY > WEEK_SWIPE_MAX_VERTICAL_DRIFT) {
      if (Math.abs(deltaX) >= WEEK_SWIPE_ACTIVATE_DISTANCE) {
        ignoreTapUntil.value = Date.now() + 220;
      }
      const resetDuration = resolveSwipeDuration(Math.abs(deltaX), Math.abs(safeVelocityX), WEEK_SWIPE_BASE_DURATION_MS - 12);
      setScheduleSwipeOffset(0, true, undefined, resetDuration);
      return;
    }

    const directionSeed = distancePassed ? deltaX : projectedDeltaX !== 0 ? projectedDeltaX : safeVelocityX;
    const swipeDirection = directionSeed > 0 ? -1 : 1;
    const offset = swipeDirection;
    const nextWeek = Math.min(termMaxWeek.value, Math.max(1, selectedWeek.value + offset));
    if (nextWeek === selectedWeek.value) {
      const resetDuration = resolveSwipeDuration(Math.abs(deltaX), Math.abs(safeVelocityX), WEEK_SWIPE_BASE_DURATION_MS - 8);
      setScheduleSwipeOffset(0, true, undefined, resetDuration);
      return;
    }
    const panelTargetOffset = offset > 0 ? -scheduleSwipeViewportWidth.value : scheduleSwipeViewportWidth.value;
    const remainDistance = Math.abs(panelTargetOffset - currentOffset);
    const settleDuration = resolveSwipeDuration(remainDistance, Math.abs(safeVelocityX), WEEK_SWIPE_BASE_DURATION_MS);
    setScheduleSwipeOffset(
      panelTargetOffset,
      true,
      () => {
        selectedWeek.value = nextWeek;
        setScheduleSwipeOffset(0, false);
      },
      settleDuration,
    );
    ignoreTapUntil.value = Date.now() + 260;
  };

  const onScheduleTouchStart = (event: SimpleTouchEventLike) => {
    if (!canHandleScheduleSwipe()) {
      resetScheduleSwipe();
      return;
    }
    const point = getTouchFromEvent(event);
    if (!point) {
      return;
    }
    scheduleMouseDragging.value = false;
    removeScheduleWindowMouseListeners();
    startScheduleSwipe(point, getEventTimestampMs(event));
  };

  const onScheduleTouchMove = (event: SimpleTouchEventLike) => {
    const point = getTouchFromEvent(event);
    if (!point) {
      return;
    }
    const handledByHorizontalSwipe = updateScheduleSwipe(point, getEventTimestampMs(event));
    if (handledByHorizontalSwipe && event.cancelable && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  };

  const onScheduleTouchEnd = (event: SimpleTouchEventLike) => {
    const endPoint = getTouchFromEvent(event, true) || getTouchFromEvent(event);
    finishScheduleSwipe(endPoint, getEventTimestampMs(event));
  };

  const onScheduleTouchCancel = (event?: SimpleTouchEventLike) => {
    finishScheduleSwipe(null, getEventTimestampMs(event || {}), true);
  };

  const onScheduleMouseDown = (event: SimpleMouseEventLike) => {
    if ((event.button ?? 0) !== 0) {
      return;
    }
    if (!canHandleScheduleSwipe()) {
      scheduleMouseDragging.value = false;
      resetScheduleSwipe();
      return;
    }
    const point = getMousePointFromEvent(event);
    if (!point) {
      return;
    }
    scheduleMouseDragging.value = true;
    addScheduleWindowMouseListeners();
    startScheduleSwipe(point, getEventTimestampMs(event));
  };

  const onScheduleMouseMove = (event: SimpleMouseEventLike) => {
    if (!scheduleMouseDragging.value) {
      return;
    }
    if ((event.buttons ?? 1) === 0) {
      onScheduleMouseUp(event);
      return;
    }
    const point = getMousePointFromEvent(event);
    if (!point) {
      return;
    }
    updateScheduleSwipe(point, getEventTimestampMs(event));
  };

  const onScheduleMouseUp = (event?: SimpleMouseEventLike) => {
    if (!scheduleMouseDragging.value && !scheduleTouchStartPoint.value) {
      return;
    }
    scheduleMouseDragging.value = false;
    removeScheduleWindowMouseListeners();
    const point = event ? getMousePointFromEvent(event) : null;
    finishScheduleSwipe(point, getEventTimestampMs(event || {}));
  };

  const onScheduleMouseCancel = () => {
    if (!scheduleMouseDragging.value && !scheduleTouchStartPoint.value) {
      return;
    }
    scheduleMouseDragging.value = false;
    removeScheduleWindowMouseListeners();
    finishScheduleSwipe(null, Date.now(), true);
  };

  const onScheduleWindowMouseMove = (event: MouseEvent) => {
    onScheduleMouseMove(event as unknown as SimpleMouseEventLike);
  };

  const onScheduleWindowMouseUp = (event: MouseEvent) => {
    onScheduleMouseUp(event as unknown as SimpleMouseEventLike);
  };

  const onScheduleWindowBlur = () => {
    onScheduleMouseCancel();
  };

  const onScheduleVisibilityChange = () => {
    if (typeof document !== "undefined" && document.hidden) {
      onScheduleMouseCancel();
    }
  };

  const addScheduleWindowMouseListeners = () => {
    if (scheduleWindowMouseListenersBound || typeof window === "undefined") {
      return;
    }
    window.addEventListener("mousemove", onScheduleWindowMouseMove);
    window.addEventListener("mouseup", onScheduleWindowMouseUp);
    window.addEventListener("blur", onScheduleWindowBlur);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onScheduleVisibilityChange);
    }
    scheduleWindowMouseListenersBound = true;
  };

  const removeScheduleWindowMouseListeners = () => {
    if (!scheduleWindowMouseListenersBound || typeof window === "undefined") {
      return;
    }
    window.removeEventListener("mousemove", onScheduleWindowMouseMove);
    window.removeEventListener("mouseup", onScheduleWindowMouseUp);
    window.removeEventListener("blur", onScheduleWindowBlur);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onScheduleVisibilityChange);
    }
    scheduleWindowMouseListenersBound = false;
  };

  onUnmounted(() => {
    onScheduleMouseCancel();
    removeScheduleWindowMouseListeners();
    clearScheduleSwipeRaf();
    clearScheduleSwipeTimer();
  });

  return {
    ignoreTapUntil,
    scheduleTrackStyle,
    onScheduleTouchStart,
    onScheduleTouchMove,
    onScheduleTouchEnd,
    onScheduleTouchCancel,
    onScheduleMouseDown,
    onScheduleMouseMove,
    onScheduleMouseUp,
    onScheduleMouseCancel,
  };
};
