import type { NexusStore, ScheduleEntryRecord, UserRecord } from "../../services/domain-store";
import { addDaysToDateKey, getSectionTimeBySection, SCHEDULE_TERM_META, zonedDateTimeToUtc } from "../../services/schedule-calendar";
import { getPublishedScheduleVersion, isPublishedScheduleVisibleToUser } from "../schedule/schedule-service";
import { buildEffectiveCalendarForUser } from "./effective-calendar-service";

const asString = (value: unknown) => String(value || "").trim();

const ICS_ESCAPE_PATTERN = /[\\,;\n\r]/g;

const escapeIcsText = (value: unknown) => {
  return asString(value).replace(ICS_ESCAPE_PATTERN, (char) => {
    if (char === "\n" || char === "\r") return "\\n";
    return `\\${char}`;
  });
};

const toIcsDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const expandWeekExprForIcs = (weekExpr: string, maxWeek = SCHEDULE_TERM_META.maxWeek) => {
  const weeks = new Set<number>();
  const normalized = asString(weekExpr) || `1-${maxWeek}`;
  for (const match of normalized.matchAll(/(\d+)(?:-(\d+))?/g)) {
    const start = Math.max(1, Math.min(maxWeek, Number(match[1]) || 1));
    const end = Math.max(start, Math.min(maxWeek, Number(match[2] || match[1]) || start));
    for (let week = start; week <= end; week += 1) {
      weeks.add(week);
    }
  }
  return Array.from(weeks).sort((left, right) => left - right);
};

const isWeekParityMatchedForIcs = (week: number, parity: ScheduleEntryRecord["parity"]) => {
  if (parity === "odd") return week % 2 === 1;
  if (parity === "even") return week % 2 === 0;
  return true;
};

export const toIcsContent = (input: {
  calendarId: string;
  title: string;
  description?: string;
  entries: ScheduleEntryRecord[];
  timezone: string;
  sourceTitle?: string;
}) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TouchX//Calendar//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.title)}`,
    `X-WR-TIMEZONE:${input.timezone}`,
  ];
  const stamp = toIcsDate(new Date());
  input.entries.forEach((entry, index) => {
    const startTime = getSectionTimeBySection(entry.startSection)?.start || "08:30";
    const endTime = getSectionTimeBySection(entry.endSection)?.end || startTime;
    expandWeekExprForIcs(entry.weekExpr).filter((week) => isWeekParityMatchedForIcs(week, entry.parity)).forEach((week) => {
      const dateKey = addDaysToDateKey(SCHEDULE_TERM_META.week1Monday, (week - 1) * 7 + Math.max(1, Math.min(7, entry.day)) - 1);
      const startAt = zonedDateTimeToUtc(dateKey, startTime, input.timezone);
      const endAt = zonedDateTimeToUtc(dateKey, endTime, input.timezone);
      if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
        return;
      }
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${input.calendarId}-${index}-w${week}@touchx`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART:${toIcsDate(startAt)}`);
      lines.push(`DTEND:${toIcsDate(endAt)}`);
      lines.push(`SUMMARY:${escapeIcsText(entry.courseName)}`);
      lines.push(`DESCRIPTION:${escapeIcsText([input.sourceTitle || "TouchX", entry.teacher ? `负责人 ${entry.teacher}` : "", `周次 ${entry.weekExpr}`].filter(Boolean).join(" / "))}`);
      lines.push(`LOCATION:${escapeIcsText(entry.classroom || "")}`);
      lines.push(`X-TX-DAY:${entry.day}`);
      lines.push(`X-TX-WEEK:${week}`);
      lines.push(`X-TX-SECTION:${entry.startSection}-${entry.endSection}`);
      lines.push("END:VEVENT");
    });
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
};

export const buildUserCalendarIcs = (
  store: NexusStore,
  user: UserRecord,
  options: {
    week?: unknown;
    date?: unknown;
  },
) => {
  const calendar = buildEffectiveCalendarForUser(store, user, {
    week: Number(options.week || 0) || undefined,
    date: asString(options.date),
  });
  const entries = calendar.items.map((item) => ({
    id: item.id,
    day: Math.max(1, Math.min(7, Number(item.weekday || 1))),
    startSection: Math.max(1, Number(item.startSection || 1)),
    endSection: Math.max(Number(item.startSection || 1), Number(item.endSection || item.startSection || 1)),
    weekExpr: item.weekExpr || String(calendar.week),
    parity: item.parity === "odd" || item.parity === "even" ? item.parity : "all",
    courseName: item.title,
    classroom: item.location,
    teacher: asString(item.metadata?.teacherOrOwner),
  } satisfies ScheduleEntryRecord));
  return {
    content: toIcsContent({
      calendarId: `user-${user.userId}`,
      title: `${user.nickname || user.name || user.accountName || "TouchX"}的日程`,
      entries,
      timezone: "Asia/Shanghai",
      sourceTitle: "TouchX 日程",
    }),
    filename: "touchx-calendar.ics",
  };
};

export const buildCalendarSourceIcs = (store: NexusStore, sourceId: string, user: UserRecord) => {
  const scheduleId = sourceId.replace(/^schedule:/, "");
  const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
  if (!schedule) {
    return { ok: false as const, reason: "source_not_found" as const };
  }
  if (!isPublishedScheduleVisibleToUser(store, schedule, user)) {
    return { ok: false as const, reason: "forbidden" as const };
  }
  const version = getPublishedScheduleVersion(store, schedule.id, schedule.publishedVersionNo);
  if (!version) {
    return { ok: false as const, reason: "not_published" as const };
  }
  const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
  const timezone = classItem?.timezone || "Asia/Shanghai";
  return {
    ok: true as const,
    content: toIcsContent({
      calendarId: schedule.id,
      title: schedule.title,
      description: schedule.description,
      entries: version.entries,
      timezone,
      sourceTitle: schedule.title,
    }),
    filename: `${encodeURIComponent(schedule.title)}.ics`,
  };
};

export const buildScheduleIcs = (store: NexusStore, scheduleId: string) => {
  const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
  if (!schedule) {
    return { ok: false as const, reason: "schedule_not_found" as const };
  }
  const publishedVersion = getPublishedScheduleVersion(store, schedule.id, schedule.publishedVersionNo);
  if (!publishedVersion) {
    return { ok: false as const, reason: "not_published" as const };
  }
  const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
  const timezone = classItem?.timezone || "Asia/Shanghai";
  return {
    ok: true as const,
    content: toIcsContent({
      calendarId: schedule.id,
      title: schedule.title,
      description: schedule.description,
      entries: publishedVersion.entries,
      timezone,
      sourceTitle: schedule.title,
    }),
    filename: `${encodeURIComponent(schedule.title)}.ics`,
  };
};
