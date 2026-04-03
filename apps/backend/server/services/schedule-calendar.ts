import {
  DEFAULT_SCHEDULE_SECTION_TIMES,
  DEFAULT_SCHEDULE_TERM_HOLIDAYS,
  DEFAULT_SCHEDULE_TERM_META,
  DEFAULT_SCHEDULE_TERM_TIMEZONE,
  DEFAULT_SCHEDULE_WEEKDAY_LABELS,
} from "@touchx/shared";
import type {
  NexusStore,
  ScheduleEntryRecord,
  ScheduleRecord,
  ScheduleVersionRecord,
  UserRecord,
} from "./domain-store";

export interface ScheduleCalendarEntry extends ScheduleEntryRecord {
  scheduleId: string;
  scheduleTitle: string;
  classId: string;
  timezone: string;
}

export const SCHEDULE_SECTION_TIMES = DEFAULT_SCHEDULE_SECTION_TIMES.map((item) => ({ ...item }));
export const SCHEDULE_TERM_META = { ...DEFAULT_SCHEDULE_TERM_META };
export const SCHEDULE_TERM_HOLIDAYS = DEFAULT_SCHEDULE_TERM_HOLIDAYS.map((item) => ({ ...item }));
export const SCHEDULE_WEEKDAY_LABELS = [...DEFAULT_SCHEDULE_WEEKDAY_LABELS];
export const SCHEDULE_DEFAULT_TIMEZONE: string = DEFAULT_SCHEDULE_TERM_TIMEZONE;

const weekRangeMatcher = /(\d+)(?:-(\d+))?/g;
const minuteMs = 60 * 1000;
const dayMs = 24 * 60 * minuteMs;

const asString = (value: unknown) => String(value || "").trim();

export const buildDateKey = (year: number, month: number, day: number) => {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const parseDateKey = (dateKey: string) => {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((item) => Number(item));
  return {
    year,
    month,
    day,
  };
};

export const toDateTimeParts = (date: Date, timeZone: string = SCHEDULE_DEFAULT_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => {
    return parts.find((item) => item.type === type)?.value || "";
  };
  const year = Number(pick("year"));
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  const hour = Number(pick("hour"));
  const minute = Number(pick("minute"));
  return {
    year,
    month,
    day,
    hour,
    minute,
    dateKey: buildDateKey(year, month, day),
  };
};

export const toAcademicWeekDay = (date: Date, timeZone: string = SCHEDULE_DEFAULT_TIMEZONE) => {
  const parts = toDateTimeParts(date, timeZone);
  const value = new Date(parts.year, parts.month - 1, parts.day).getDay();
  return value === 0 ? 7 : value;
};

export const addDaysToDateKey = (dateKey: string, offsetDays: number) => {
  const parsed = parseDateKey(dateKey);
  const next = new Date(parsed.year, parsed.month - 1, parsed.day + offsetDays);
  return buildDateKey(next.getFullYear(), next.getMonth() + 1, next.getDate());
};

export const compareDateKeys = (left: string, right: string) => {
  const leftParsed = parseDateKey(left);
  const rightParsed = parseDateKey(right);
  const leftDate = new Date(leftParsed.year, leftParsed.month - 1, leftParsed.day);
  const rightDate = new Date(rightParsed.year, rightParsed.month - 1, rightParsed.day);
  const diffDays = Math.round((leftDate.getTime() - rightDate.getTime()) / dayMs);
  return diffDays;
};

export const resolveCurrentWeekForDate = (date: Date, timeZone: string = SCHEDULE_DEFAULT_TIMEZONE) => {
  const baseParsed = parseDateKey(SCHEDULE_TERM_META.week1Monday);
  const targetParts = toDateTimeParts(date, timeZone);
  const baseDate = new Date(baseParsed.year, baseParsed.month - 1, baseParsed.day);
  const targetDate = new Date(targetParts.year, targetParts.month - 1, targetParts.day);
  const diffDays = Math.floor((targetDate.getTime() - baseDate.getTime()) / dayMs);
  if (diffDays < 0) {
    return 1;
  }
  return Math.min(SCHEDULE_TERM_META.maxWeek, Math.floor(diffDays / 7) + 1);
};

export const isScheduleEntryInWeek = (entry: Pick<ScheduleEntryRecord, "weekExpr" | "parity">, week: number) => {
  if (!Number.isInteger(week) || week < 1 || week > SCHEDULE_TERM_META.maxWeek) {
    return false;
  }
  const weekExpr = asString(entry.weekExpr);
  if (!weekExpr) {
    return false;
  }
  let matched = false;
  weekRangeMatcher.lastIndex = 0;
  for (const match of weekExpr.matchAll(weekRangeMatcher)) {
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    if (week >= start && week <= end) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    return false;
  }
  if (entry.parity === "odd") {
    return week % 2 === 1;
  }
  if (entry.parity === "even") {
    return week % 2 === 0;
  }
  return true;
};

const getPublishedScheduleVersion = (store: NexusStore, scheduleId: string, versionNo = 0): ScheduleVersionRecord | null => {
  if (versionNo > 0) {
    return (
      store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo && item.status === "published") ||
      null
    );
  }
  const versions = store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId && item.status === "published")
    .sort((left, right) => right.versionNo - left.versionNo);
  return versions[0] || null;
};

const cloneScheduleEntry = (entry: ScheduleEntryRecord): ScheduleEntryRecord => {
  return {
    id: entry.id,
    day: entry.day,
    startSection: entry.startSection,
    endSection: entry.endSection,
    weekExpr: entry.weekExpr,
    parity: entry.parity,
    courseName: entry.courseName,
    classroom: entry.classroom,
    teacher: entry.teacher,
  };
};

const applyEntryPatch = (
  entry: ScheduleEntryRecord,
  patchPayload: Record<string, unknown>,
): ScheduleEntryRecord => {
  const next = cloneScheduleEntry(entry);
  if (Number.isFinite(Number(patchPayload.day))) {
    next.day = Math.max(1, Math.min(7, Math.round(Number(patchPayload.day))));
  }
  if (Number.isFinite(Number(patchPayload.startSection))) {
    next.startSection = Math.max(1, Math.round(Number(patchPayload.startSection)));
  }
  if (Number.isFinite(Number(patchPayload.endSection))) {
    next.endSection = Math.max(next.startSection, Math.round(Number(patchPayload.endSection)));
  }
  if (asString(patchPayload.weekExpr)) {
    next.weekExpr = asString(patchPayload.weekExpr);
  }
  if (patchPayload.parity === "odd" || patchPayload.parity === "even" || patchPayload.parity === "all") {
    next.parity = patchPayload.parity;
  }
  if (Object.prototype.hasOwnProperty.call(patchPayload, "courseName")) {
    next.courseName = asString(patchPayload.courseName);
  }
  if (Object.prototype.hasOwnProperty.call(patchPayload, "classroom")) {
    next.classroom = asString(patchPayload.classroom);
  }
  if (Object.prototype.hasOwnProperty.call(patchPayload, "teacher")) {
    next.teacher = asString(patchPayload.teacher);
  }
  return next;
};

const buildPatchedEntriesForSubscription = (store: NexusStore, schedule: ScheduleRecord, subscriberUserId: string) => {
  const subscription = store.scheduleSubscriptions.find(
    (item) => item.subscriberUserId === subscriberUserId && item.sourceScheduleId === schedule.id,
  );
  const publishedVersion = getPublishedScheduleVersion(store, schedule.id, schedule.publishedVersionNo);
  if (!publishedVersion) {
    return [] as ScheduleCalendarEntry[];
  }
  const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
  const timezone = asString(classItem?.timezone) || SCHEDULE_DEFAULT_TIMEZONE;
  const baseEntries = publishedVersion.entries.map((entry) => cloneScheduleEntry(entry));
  if (!subscription) {
    return baseEntries.map((entry) => ({
      ...entry,
      scheduleId: schedule.id,
      scheduleTitle: schedule.title,
      classId: schedule.classId,
      timezone,
    }));
  }
  const patchedById = new Map(baseEntries.map((entry) => [entry.id, entry]));
  const patches = store.schedulePatches.filter((item) => item.subscriptionId === subscription.id);
  patches.forEach((patch) => {
    const patchPayload = patch.patchPayload || {};
    if (patch.opType === "remove") {
      patchedById.delete(patch.entryId);
      return;
    }
    if (patch.opType === "add") {
      const nextId = asString((patchPayload as Record<string, unknown>).id) || `patch_${patch.id}`;
      patchedById.set(nextId, {
        id: nextId,
        day: Math.max(1, Math.min(7, Math.round(Number((patchPayload as Record<string, unknown>).day || 1)))),
        startSection: Math.max(1, Math.round(Number((patchPayload as Record<string, unknown>).startSection || 1))),
        endSection: Math.max(
          1,
          Math.round(
            Number(
              (patchPayload as Record<string, unknown>).endSection ||
                (patchPayload as Record<string, unknown>).startSection ||
                1,
            ),
          ),
        ),
        weekExpr: asString((patchPayload as Record<string, unknown>).weekExpr) || "1-25",
        parity:
          (patchPayload as Record<string, unknown>).parity === "odd" ||
          (patchPayload as Record<string, unknown>).parity === "even" ||
          (patchPayload as Record<string, unknown>).parity === "all"
            ? ((patchPayload as Record<string, unknown>).parity as ScheduleEntryRecord["parity"])
            : "all",
        courseName: asString((patchPayload as Record<string, unknown>).courseName) || "未命名课程",
        classroom: asString((patchPayload as Record<string, unknown>).classroom),
        teacher: asString((patchPayload as Record<string, unknown>).teacher),
      });
      return;
    }
    const current = patchedById.get(patch.entryId);
    if (!current) {
      return;
    }
    patchedById.set(patch.entryId, applyEntryPatch(current, patchPayload));
  });
  return Array.from(patchedById.values())
    .map((entry) => ({
      ...entry,
      scheduleId: schedule.id,
      scheduleTitle: schedule.title,
      classId: schedule.classId,
      timezone,
    }))
    .sort((left, right) => {
      if (left.day !== right.day) {
        return left.day - right.day;
      }
      if (left.startSection !== right.startSection) {
        return left.startSection - right.startSection;
      }
      return left.endSection - right.endSection;
    });
};

export const getEffectiveScheduleEntriesForUser = (store: NexusStore, user: UserRecord) => {
  const subscriptionScheduleIds = store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .map((item) => item.sourceScheduleId);
  const scheduleIdSet = new Set(subscriptionScheduleIds);
  if (scheduleIdSet.size <= 0) {
    user.classIds.forEach((classId) => {
      store.schedules
        .filter((item) => item.classId === classId)
        .forEach((item) => scheduleIdSet.add(item.id));
    });
  }
  const entries = Array.from(scheduleIdSet.values()).flatMap((scheduleId) => {
    const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
    if (!schedule) {
      return [];
    }
    return buildPatchedEntriesForSubscription(store, schedule, user.userId);
  });
  const dedup = new Map<string, ScheduleCalendarEntry>();
  entries.forEach((entry) => {
    const key = [
      entry.scheduleId,
      entry.id,
      entry.day,
      entry.startSection,
      entry.endSection,
      entry.weekExpr,
      entry.parity,
      entry.courseName,
      entry.classroom,
      entry.teacher,
    ].join("|");
    if (!dedup.has(key)) {
      dedup.set(key, entry);
    }
  });
  return Array.from(dedup.values()).sort((left, right) => {
    if (left.day !== right.day) {
      return left.day - right.day;
    }
    if (left.startSection !== right.startSection) {
      return left.startSection - right.startSection;
    }
    return left.endSection - right.endSection;
  });
};

export const getUserReminderTimezone = (store: NexusStore, user: UserRecord) => {
  const firstSubscribedSchedule = store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .map((item) => store.schedules.find((schedule) => schedule.id === item.sourceScheduleId) || null)
    .find((item) => Boolean(item));
  const fallbackClassId =
    firstSubscribedSchedule?.classId ||
    user.classIds.find((classId) => store.classes.some((item) => item.id === classId)) ||
    "";
  const classItem = store.classes.find((item) => item.id === fallbackClassId) || null;
  return asString(classItem?.timezone) || SCHEDULE_DEFAULT_TIMEZONE;
};

export const getSectionTimeBySection = (section: number) => {
  return SCHEDULE_SECTION_TIMES.find((item) => item.section === section) || null;
};

export const zonedDateTimeToUtc = (dateKey: string, timeText: string, timeZone: string = SCHEDULE_DEFAULT_TIMEZONE) => {
  const { year, month, day } = parseDateKey(dateKey);
  const [hour, minute] = String(timeText || "")
    .split(":")
    .map((item) => Number(item));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(NaN);
  }
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return new Date(NaN);
  }
  const approxUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const actual = toDateTimeParts(approxUtc, timeZone);
  const targetMinutes = hour * 60 + minute;
  const actualMinutes = actual.hour * 60 + actual.minute;
  const diffDays = compareDateKeys(actual.dateKey, dateKey);
  const offsetMinutes = diffDays * 24 * 60 + (actualMinutes - targetMinutes);
  return new Date(approxUtc.getTime() - offsetMinutes * minuteMs);
};
