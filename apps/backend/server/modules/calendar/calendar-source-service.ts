import type { NexusStore } from "../../services/domain-store";
import {
  findScheduleByCalendarSourceId,
  listCalendarSourceEvents,
  toAdminCalendarSourcePayload,
  toCalendarSource,
  toCalendarSourceVersion,
} from "./calendar-adapter";

export const listCalendarSources = (store: NexusStore, options: { viewerUserId?: string; includePrivate?: boolean } = {}) => {
  const viewer = options.viewerUserId ? store.users.find((user) => user.userId === options.viewerUserId) || null : null;
  const items = store.schedules
    .filter((schedule) => {
      if (options.includePrivate) return true;
      const visibility = schedule.visibility || (schedule.classId === `user:${schedule.createdByUserId}` ? "private" : "class_only");
      if (visibility === "public") return true;
      if (!viewer) return false;
      if (schedule.createdByUserId === viewer.userId || viewer.adminRole === "super_admin" || viewer.adminRole === "operator") return true;
      if (visibility === "class_only") {
        return store.classMembers.some((member) => member.classId === schedule.classId && member.userId === viewer.userId);
      }
      return visibility === "invite_only";
    })
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
