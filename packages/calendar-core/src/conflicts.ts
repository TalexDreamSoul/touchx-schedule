import type { CalendarConflict, EffectiveCalendarEvent } from "@touchx/shared";

const hasTimeRange = (event: EffectiveCalendarEvent) => {
  return Number.isFinite(Number(event.startSection)) && Number.isFinite(Number(event.endSection));
};

const isOverlap = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => {
  return leftStart <= rightEnd && rightStart <= leftEnd;
};

const sameBucket = (left: EffectiveCalendarEvent, right: EffectiveCalendarEvent) => {
  if (left.date || right.date) {
    return String(left.date || "") === String(right.date || "");
  }
  return Number(left.weekday || 0) === Number(right.weekday || 0);
};

export const detectCalendarConflicts = (events: EffectiveCalendarEvent[]) => {
  const conflicts: CalendarConflict[] = [];
  const candidates = events.filter((item) => item.overrideState !== "hidden" && hasTimeRange(item));
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];
      if (!sameBucket(left, right)) {
        continue;
      }
      const leftStart = Number(left.startSection);
      const leftEnd = Number(left.endSection);
      const rightStart = Number(right.startSection);
      const rightEnd = Number(right.endSection);
      if (!isOverlap(leftStart, leftEnd, rightStart, rightEnd)) {
        continue;
      }
      conflicts.push({
        id: `conflict:${left.id}:${right.id}`,
        eventIds: [left.id, right.id],
        date: left.date || right.date,
        weekday: left.weekday || right.weekday,
        startSection: Math.max(leftStart, rightStart),
        endSection: Math.min(leftEnd, rightEnd),
        severity: left.originType === "personal" || right.originType === "personal" ? "warning" : "info",
        reason: `${left.title} 与 ${right.title} 时间重叠`,
      });
    }
  }
  return conflicts;
};
