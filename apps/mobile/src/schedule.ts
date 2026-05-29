import type { EffectiveCalendarItem, PersonalEventRow } from "./api";

export const sectionTimes = [
  { section: 1, start: "08:30", end: "09:15", part: "上午" },
  { section: 2, start: "09:20", end: "10:05", part: "上午" },
  { section: 3, start: "10:25", end: "11:10", part: "上午" },
  { section: 4, start: "11:15", end: "12:00", part: "上午" },
  { section: 5, start: "14:30", end: "15:15", part: "下午" },
  { section: 6, start: "15:20", end: "16:05", part: "下午" },
  { section: 7, start: "16:25", end: "17:10", part: "下午" },
  { section: 8, start: "17:15", end: "18:00", part: "下午" },
  { section: 9, start: "19:00", end: "19:45", part: "晚上" },
  { section: 10, start: "19:50", end: "20:35", part: "晚上" },
  { section: 11, start: "20:40", end: "21:25", part: "晚上" },
] as const;

export const termMeta = {
  name: "2025-2026-2",
  week1Monday: "2026-03-02",
  maxWeek: 25,
  timezone: "Asia/Shanghai",
} as const;

export const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"] as const;

export const eventTypeLabels: Record<string, string> = {
  course: "课程",
  exam: "考试",
  todo: "待办",
  activity: "活动",
  holiday: "假期",
  deadline: "截止",
  custom: "日程",
};

export const eventTypeColors: Record<string, string> = {
  course: "#2f55c8",
  exam: "#d24747",
  todo: "#8e57de",
  activity: "#159b57",
  holiday: "#d9a511",
  deadline: "#cf6f17",
  custom: "#64748b",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (value: number) => String(value).padStart(2, "0");

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

export const getTodayInfo = () => {
  const date = new Date();
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

export const getEventColor = (eventOrType: EffectiveCalendarItem | string) => {
  const type = typeof eventOrType === "string" ? eventOrType : getEventType(eventOrType);
  return eventTypeColors[type] || eventTypeColors.custom;
};

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

export const priorityLabel = (priority?: string) => {
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "中";
};

export const resolveGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
};
