import type { NexusStore } from "../../services/domain-store";
import {
  findScheduleByCalendarSourceId,
  listCalendarSourceEvents,
  toAdminCalendarSourcePayload,
  toCalendarSource,
  toCalendarSourceVersion,
} from "./calendar-adapter";

export const listCalendarSources = (store: NexusStore) => {
  const items = store.schedules
    .map((schedule) => toAdminCalendarSourcePayload(store, schedule))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    items,
    total: items.length,
  };
};

export const getCalendarSourceDetail = (store: NexusStore, sourceId: string) => {
  const schedule = findScheduleByCalendarSourceId(store, sourceId);
  if (!schedule) {
    return null;
  }
  const versions = store.scheduleVersions
    .filter((item) => item.scheduleId === schedule.id)
    .sort((left, right) => right.versionNo - left.versionNo)
    .map((item) => toCalendarSourceVersion(item));
  const events = listCalendarSourceEvents(store, sourceId);
  return {
    item: toAdminCalendarSourcePayload(store, schedule),
    source: toCalendarSource(store, schedule),
    versions,
    events,
    eventCount: events.length,
  };
};
