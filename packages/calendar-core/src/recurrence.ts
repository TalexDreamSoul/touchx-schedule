import type { EffectiveCalendarEvent } from "@touchx/shared";

const dayMs = 24 * 60 * 60 * 1000;
const weekRangeMatcher = /(\d+)(?:-(\d+))?/g;

export const parseDateKey = (dateKey: string) => {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((item) => Number(item));
  return { year, month, day };
};

export const buildDateKey = (date: Date) => {
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date
    .getDate()
    .toString()
    .padStart(2, "0")}`;
};

export const addDays = (dateKey: string, offsetDays: number) => {
  const parsed = parseDateKey(dateKey);
  const date = new Date(parsed.year, parsed.month - 1, parsed.day + offsetDays);
  return buildDateKey(date);
};

export const isWeekExprMatched = (weekExpr: string | undefined, week: number, parity: "all" | "odd" | "even" = "all") => {
  if (!Number.isInteger(week) || week < 1) {
    return false;
  }
  const expr = String(weekExpr || "").trim();
  if (!expr) {
    return true;
  }
  let matched = false;
  weekRangeMatcher.lastIndex = 0;
  for (const item of expr.matchAll(weekRangeMatcher)) {
    const start = Number(item[1]);
    const end = Number(item[2] || item[1]);
    if (week >= start && week <= end) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    return false;
  }
  if (parity === "odd") {
    return week % 2 === 1;
  }
  if (parity === "even") {
    return week % 2 === 0;
  }
  return true;
};

export interface ExpandRecurringEventsOptions {
  week?: number;
  week1Monday?: string;
  startDate?: string;
  endDate?: string;
}

const resolveDateForWeekday = (week1Monday: string, week: number, weekday: number) => {
  return addDays(week1Monday, (week - 1) * 7 + (weekday - 1));
};

const isWithinRange = (dateKey: string, startDate?: string, endDate?: string) => {
  if (startDate && dateKey < startDate) {
    return false;
  }
  if (endDate && dateKey > endDate) {
    return false;
  }
  return true;
};

export const expandRecurringEvents = (events: EffectiveCalendarEvent[], options: ExpandRecurringEventsOptions = {}) => {
  const week = Math.max(1, Math.trunc(Number(options.week || 1)));
  const week1Monday = String(options.week1Monday || "").trim();
  return events.flatMap((event) => {
    if (event.date) {
      return isWithinRange(event.date, options.startDate, options.endDate) ? [event] : [];
    }
    if (!event.weekday || !isWeekExprMatched(event.weekExpr, week, event.parity || "all")) {
      return [];
    }
    if (!week1Monday) {
      return [event];
    }
    const date = resolveDateForWeekday(week1Monday, week, event.weekday);
    if (!isWithinRange(date, options.startDate, options.endDate)) {
      return [];
    }
    return [
      {
        ...event,
        date,
      },
    ];
  });
};

export const resolveWeekFromDate = (dateKey: string, week1Monday: string) => {
  const target = parseDateKey(dateKey);
  const base = parseDateKey(week1Monday);
  const targetDate = new Date(target.year, target.month - 1, target.day);
  const baseDate = new Date(base.year, base.month - 1, base.day);
  const diffDays = Math.floor((targetDate.getTime() - baseDate.getTime()) / dayMs);
  if (diffDays < 0) {
    return 1;
  }
  return Math.floor(diffDays / 7) + 1;
};
