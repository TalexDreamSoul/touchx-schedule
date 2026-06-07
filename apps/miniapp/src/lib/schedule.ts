import {
  DEFAULT_SCHEDULE_SECTION_TIMES,
  DEFAULT_SCHEDULE_TERM_META,
  DEFAULT_SCHEDULE_WEEKDAY_LABELS,
} from "@touchx/shared";
import { calendarEventColors } from "@touchx/ui-tokens";
import type { EffectiveCalendarItem, PersonalEventRow } from "./api";

export const sectionTimes = DEFAULT_SCHEDULE_SECTION_TIMES.map((item) => ({ ...item }));
export const termMeta = { ...DEFAULT_SCHEDULE_TERM_META };
export const weekdayLabels = [...DEFAULT_SCHEDULE_WEEKDAY_LABELS];

export const eventTypeLabels: Record<string, string> = {
  course: "课程",
  exam: "考试",
  todo: "待办",
  activity: "活动",
  holiday: "假期",
  deadline: "截止",
  custom: "日程",
};

export const eventTypeClassNames: Record<string, string> = {
  course: "event-course",
  exam: "event-exam",
  todo: "event-todo",
  activity: "event-activity",
  holiday: "event-holiday",
  deadline: "event-deadline",
  custom: "event-custom",
};

export const eventTypeColors: Record<string, string> = {
  ...calendarEventColors,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (value: number) => String(value).padStart(2, "0");

let serverOffsetMs = 0;

export const getServerOffsetMs = () => serverOffsetMs;

export const syncServerOffsetFromIso = (serverNowIso?: string) => {
  const serverNowMs = Date.parse(String(serverNowIso || ""));
  if (Number.isFinite(serverNowMs)) {
    serverOffsetMs = serverNowMs - Date.now();
  }
  return serverOffsetMs;
};

export const getServerNow = () => new Date(Date.now() + serverOffsetMs);

export const buildDateKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const parseDateKey = (dateKey: string) => {
  const [year, month, day] = String(dateKey || "").split("-").map((item) => Number(item));
  return { year, month, day };
};

export const addDays = (dateKey: string, offsetDays: number) => {
  const parsed = parseDateKey(dateKey);
  const date = new Date(parsed.year, parsed.month - 1, parsed.day + offsetDays);
  return buildDateKey(date);
};

export const resolveWeekByDate = (date: Date) => {
  const base = parseDateKey(termMeta.week1Monday);
  const baseDate = new Date(base.year, base.month - 1, base.day);
  const diffDays = Math.floor((date.getTime() - baseDate.getTime()) / DAY_MS);
  if (diffDays < 0) return 1;
  return Math.max(1, Math.min(termMeta.maxWeek, Math.floor(diffDays / 7) + 1));
};

export const resolveWeekday = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

export const resolveDateByWeekday = (week: number, weekday: number) => {
  return addDays(termMeta.week1Monday, (Math.max(1, week) - 1) * 7 + (Math.max(1, Math.min(7, weekday)) - 1));
};

export const formatDateLabel = (dateKey: string) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed.month || !parsed.day) return dateKey || "--";
  return `${parsed.month}月${parsed.day}日`;
};

export const formatWeekRange = (week: number) => {
  const start = resolveDateByWeekday(week, 1);
  const end = resolveDateByWeekday(week, 7);
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
};

export const getTodayInfo = (now = getServerNow()) => {
  const date = now;
  const dateKey = buildDateKey(date);
  const weekday = resolveWeekday(date);
  return {
    date,
    dateKey,
    week: resolveWeekByDate(date),
    weekday,
    weekdayLabel: weekdayLabels[weekday - 1] || String(weekday),
  };
};

export const getEventType = (event: Pick<EffectiveCalendarItem, "eventType">) => {
  const value = String(event.eventType || "custom");
  return eventTypeLabels[value] ? value : "custom";
};

export const getEventTypeLabel = (type: string) => eventTypeLabels[type] || eventTypeLabels.custom;
export const getEventClassName = (type: string) => eventTypeClassNames[type] || eventTypeClassNames.custom;
export const getEventColor = (type: string) => eventTypeColors[type] || eventTypeColors.custom;

export const getEventWeekday = (event: Pick<EffectiveCalendarItem, "weekday" | "date">) => {
  if (event.weekday) return Math.max(1, Math.min(7, Number(event.weekday)));
  if (event.date) {
    const parsed = parseDateKey(event.date);
    return resolveWeekday(new Date(parsed.year, parsed.month - 1, parsed.day));
  }
  return 1;
};

export const getEventStartSection = (event: Pick<EffectiveCalendarItem, "startSection">) => Math.max(1, Math.min(11, Number(event.startSection || 1)));
export const getEventEndSection = (event: Pick<EffectiveCalendarItem, "startSection" | "endSection">) => Math.max(getEventStartSection(event), Math.min(11, Number(event.endSection || event.startSection || 1)));

export const getSectionStartTime = (section: number) => sectionTimes.find((item) => item.section === section)?.start || "--:--";
export const getSectionEndTime = (section: number) => sectionTimes.find((item) => item.section === section)?.end || "--:--";

export const formatSectionRange = (startSection?: number, endSection?: number) => {
  if (!startSection && !endSection) return "全天";
  const start = Math.max(1, Number(startSection || endSection || 1));
  const end = Math.max(start, Number(endSection || startSection || start));
  return `第 ${start}-${end} 节`;
};

export const formatEventTime = (event: EffectiveCalendarItem) => {
  if (event.startTime || event.endTime) return `${event.startTime || "--:--"}-${event.endTime || "--:--"}`;
  if (event.startSection || event.endSection) return `${formatSectionRange(event.startSection, event.endSection)} · ${getSectionStartTime(getEventStartSection(event))}`;
  return "全天";
};

export const formatEventDateTime = (event: EffectiveCalendarItem) => {
  const dateText = event.date ? `${formatDateLabel(event.date)} · ` : "";
  return `${dateText}${formatEventTime(event)}`;
};

export const getEventTeacher = (event: EffectiveCalendarItem) => {
  const metadata = event.metadata || {};
  return String((metadata.teacherOrOwner as string | undefined) || (metadata.teacher as string | undefined) || "").trim();
};

export const getEventLocation = (event: EffectiveCalendarItem) => String(event.location || "").trim() || "地点待定";

export const sortEvents = <T extends Pick<EffectiveCalendarItem, "date" | "weekday" | "startSection" | "startTime" | "title">>(items: T[]) => {
  return [...items].sort((left, right) => {
    const leftDate = String(left.date || "");
    const rightDate = String(right.date || "");
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    const leftDay = Number(left.weekday || 99);
    const rightDay = Number(right.weekday || 99);
    if (leftDay !== rightDay) return leftDay - rightDay;
    const leftSection = Number(left.startSection || 99);
    const rightSection = Number(right.startSection || 99);
    if (leftSection !== rightSection) return leftSection - rightSection;
    return String(left.startTime || "").localeCompare(String(right.startTime || "")) || String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
  });
};

export const isArchivedPersonalEvent = (event: Pick<PersonalEventRow, "tags">) => (event.tags || []).includes("archived");
export const isDonePersonalEvent = (event: Pick<PersonalEventRow, "tags">) => (event.tags || []).includes("done");

export const formatPersonalEventTime = (event: PersonalEventRow) => {
  if (event.examDate) return event.examDate;
  const day = Number(event.weekday || event.day || 0);
  const dayText = day ? `周${weekdayLabels[Math.max(0, Math.min(6, day - 1))]}` : "本周";
  return `${dayText} · ${formatSectionRange(event.startSection, event.endSection)}`;
};

export const priorityLabel = (priority?: string) => {
  if (priority === "high") return "高优先级";
  if (priority === "low") return "低优先级";
  return "普通优先级";
};

export const resolveGreeting = (now = getServerNow()) => {
  const hour = now.getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
};

export const isEventFutureOrOngoing = (event: EffectiveCalendarItem, now = getServerNow()) => {
  const time = event.endTime || getSectionEndTime(getEventEndSection(event));
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return true;
  const end = new Date(now);
  end.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return end.getTime() >= now.getTime();
};

export const resolveSemesterElapsed = (now = getServerNow()) => {
  const semesterStart = new Date(2026, 2, 1, 8, 0, 0, 0);
  const elapsedMs = Math.max(0, now.getTime() - semesterStart.getTime());
  const totalHours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const totalDays = Math.floor(elapsedMs / DAY_MS);
  const totalWeeks = Math.floor(totalDays / 7);
  return { totalHours, totalDays, totalWeeks };
};
