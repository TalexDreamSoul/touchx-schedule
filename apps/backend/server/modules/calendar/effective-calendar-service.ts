import { resolveEffectiveCalendarEvents, expandRecurringEvents, detectCalendarConflicts, resolveReminderCandidates } from "@touchx/calendar-core";
import type { EffectiveCalendarEvent } from "@touchx/shared";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import {
  getEffectiveScheduleEntriesForUser,
  SCHEDULE_TERM_META,
  resolveCurrentWeekForDate,
} from "../../services/schedule-calendar";
import {
  getUserCalendarSubscriptions,
  toCalendarEventFromEffectiveScheduleEntry,
  toCalendarSource,
  toPersonalEvent,
  toUserEventOverride,
} from "./calendar-adapter";

export interface BuildEffectiveCalendarOptions {
  week?: number;
  date?: string;
  includeHidden?: boolean;
}

const normalizeWeek = (value: unknown) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return resolveCurrentWeekForDate(new Date());
  }
  return Math.min(SCHEDULE_TERM_META.maxWeek, Math.max(1, parsed));
};

const uniqueEffectiveEvents = (events: EffectiveCalendarEvent[]) => {
  const map = new Map<string, EffectiveCalendarEvent>();
  events.forEach((item) => {
    const key = [
      item.originType,
      item.originId,
      item.date || "",
      item.weekday || "",
      item.startSection || "",
      item.endSection || "",
      item.title,
    ].join("|");
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
};

export const buildEffectiveCalendarForUser = (
  store: NexusStore,
  user: UserRecord,
  options: BuildEffectiveCalendarOptions = {},
) => {
  const week = normalizeWeek(options.week);
  const sourceEvents = getEffectiveScheduleEntriesForUser(store, user).map((entry) => toCalendarEventFromEffectiveScheduleEntry(entry));
  const sourceIdSet = new Set(sourceEvents.map((item) => item.sourceId));
  const schedules = store.schedules.filter((schedule) => sourceIdSet.has(`schedule:${schedule.id}`));
  const sources = schedules.map((schedule) => toCalendarSource(store, schedule));
  const subscriptions = getUserCalendarSubscriptions(store, user);
  const patches = store.schedulePatches
    .filter((patch) => subscriptions.some((sub) => sub.id === patch.subscriptionId))
    .map((patch) => toUserEventOverride(store, patch, user.userId));
  const personalEvents = store.userScheduleEvents
    .filter((item) => item.userId === user.userId)
    .filter((item) => !(item.tags || []).includes("done") && !(item.tags || []).includes("archived"))
    .map((item) => toPersonalEvent(item));
  const resolved = resolveEffectiveCalendarEvents({
    sources,
    sourceEvents,
    subscriptions: subscriptions.length > 0 ? subscriptions : undefined,
    personalEvents,
    overrides: patches,
    userId: user.userId,
    includeHidden: options.includeHidden,
  });
  const expanded = expandRecurringEvents(resolved, {
    week,
    week1Monday: SCHEDULE_TERM_META.week1Monday,
    startDate: options.date,
    endDate: options.date,
  });
  const items = uniqueEffectiveEvents(expanded);
  const reminderCandidates = resolveReminderCandidates({
    userId: user.userId,
    events: items,
    rules: store.reminderRules,
    defaultOffsets: user.reminderWindowMinutes,
  });
  return {
    week,
    items,
    total: items.length,
    conflicts: detectCalendarConflicts(items),
    reminderCandidates,
  };
};
