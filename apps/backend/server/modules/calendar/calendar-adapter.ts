import type {
  CalendarSource,
  CalendarSourceEvent,
  CalendarSourceVersion,
  CalendarSubscription,
  PersonalEvent,
  UserEventOverride,
} from "@touchx/shared";
import {
  getSectionTimeBySection,
  type ScheduleCalendarEntry,
} from "../../services/schedule-calendar";
import type {
  NexusStore,
  ScheduleEntryRecord,
  ScheduleRecord,
  ScheduleVersionRecord,
  UserRecord,
  UserScheduleEventRecord,
} from "../../services/domain-store";
import {
  resolveWeekdayForDateKey,
  resolveWeekForDateKey,
  SCHEDULE_TERM_META,
} from "../../services/schedule-calendar";

const asString = (value: unknown) => String(value || "").trim();

export const calendarSourceIdFromScheduleId = (scheduleId: string) => `schedule:${scheduleId}`;
export const calendarSourceEventIdFromEntryId = (entryId: string) => `schedule_entry:${entryId}`;
export const calendarVersionIdFromScheduleVersion = (scheduleId: string, versionNo: number) => `schedule_version:${scheduleId}:${versionNo}`;

const sourceIdToScheduleId = (sourceId: string) => asString(sourceId).replace(/^schedule:/, "");

export const toCalendarSource = (store: NexusStore, schedule: ScheduleRecord): CalendarSource => {
  const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
  const publishedVersion = store.scheduleVersions.find(
    (item) => item.scheduleId === schedule.id && item.versionNo === schedule.publishedVersionNo && item.status === "published",
  );
  const sourceType = schedule.sourceType || (schedule.classId === `user:${schedule.createdByUserId}` ? "custom" : "class_schedule");
  const ownerType = schedule.ownerType || (schedule.classId === `user:${schedule.createdByUserId}` ? "user" : "class");
  const ownerId = schedule.ownerId || (ownerType === "user" ? schedule.createdByUserId : schedule.classId);
  return {
    id: calendarSourceIdFromScheduleId(schedule.id),
    type: sourceType,
    title: schedule.title,
    description: schedule.description,
    ownerType,
    ownerId,
    timezone: asString(classItem?.timezone) || "Asia/Shanghai",
    visibility: schedule.visibility || (ownerType === "user" ? "private" : "class_only"),
    status: schedule.publishedVersionNo > 0 ? "published" : "draft",
    currentVersionId: publishedVersion ? calendarVersionIdFromScheduleVersion(schedule.id, publishedVersion.versionNo) : "",
    createdBy: schedule.createdByUserId,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt,
  };
};

export const toCalendarSourceVersion = (
  version: ScheduleVersionRecord,
): CalendarSourceVersion => ({
  id: calendarVersionIdFromScheduleVersion(version.scheduleId, version.versionNo),
  sourceId: calendarSourceIdFromScheduleId(version.scheduleId),
  versionNo: version.versionNo,
  status: version.status === "published" ? "published" : "draft",
  changeSummary: `课表版本 v${version.versionNo}`,
  createdBy: version.createdByUserId,
  createdAt: version.createdAt,
  publishedAt: version.status === "published" ? version.createdAt : "",
});

export const toCalendarSourceEvent = (
  entry: ScheduleEntryRecord,
  options: {
    scheduleId: string;
    versionId: string;
    eventType?: CalendarSourceEvent["eventType"];
    sourceType?: string;
  },
): CalendarSourceEvent => {
  const startTime = getSectionTimeBySection(entry.startSection)?.start || "";
  const endTime = getSectionTimeBySection(entry.endSection)?.end || "";
  const eventType = options.eventType || (options.sourceType === "class_schedule" ? "course" : "custom");
  return {
    id: calendarSourceEventIdFromEntryId(entry.id),
    sourceId: calendarSourceIdFromScheduleId(options.scheduleId),
    versionId: options.versionId,
    title: entry.courseName,
    description: entry.teacher ? `负责人：${entry.teacher}` : "",
    eventType,
    location: entry.classroom,
    teacherOrOwner: entry.teacher,
    recurrenceType: "weekly",
    weekday: entry.day,
    weekExpr: entry.weekExpr,
    parity: entry.parity,
    startTime,
    endTime,
    startSection: entry.startSection,
    endSection: entry.endSection,
    tags: eventType === "course" ? ["学习", "课程"] : ["日程"],
    metadata: {
      legacyEntryId: entry.id,
      legacyScheduleId: options.scheduleId,
      sourceType: options.sourceType || "class_schedule",
    },
  };
};

export const toCalendarEventFromEffectiveScheduleEntry = (entry: ScheduleCalendarEntry): CalendarSourceEvent => {
  const startTime = getSectionTimeBySection(entry.startSection)?.start || "";
  const endTime = getSectionTimeBySection(entry.endSection)?.end || "";
  const eventType = entry.eventType || (entry.sourceType === "class_schedule" ? "course" : "custom");
  return {
    id: calendarSourceEventIdFromEntryId(entry.id),
    sourceId: calendarSourceIdFromScheduleId(entry.scheduleId),
    versionId: "",
    title: entry.courseName,
    description: entry.teacher ? `负责人：${entry.teacher}` : "",
    eventType,
    location: entry.classroom,
    teacherOrOwner: entry.teacher,
    recurrenceType: "weekly",
    weekday: entry.day,
    weekExpr: entry.weekExpr,
    parity: entry.parity,
    startTime,
    endTime,
    startSection: entry.startSection,
    endSection: entry.endSection,
    tags: eventType === "course" ? ["学习", "课程"] : ["日程"],
    metadata: {
      legacyEntryId: entry.id,
      legacyScheduleId: entry.scheduleId,
      scheduleTitle: entry.scheduleTitle,
      classId: entry.classId,
      timezone: entry.timezone,
      sourceType: entry.sourceType || "class_schedule",
    },
  };
};

export const toCalendarSubscription = (store: NexusStore, subscription: import("@touchx/shared").ScheduleSubscription): CalendarSubscription => {
  const schedule = store.schedules.find((item) => item.id === subscription.sourceScheduleId) || null;
  const version = schedule
    ? store.scheduleVersions.find(
        (item) => item.scheduleId === schedule.id && item.versionNo === subscription.baseVersionNo,
      ) || null
    : null;
  return {
    id: subscription.id,
    userId: subscription.subscriberUserId,
    sourceId: calendarSourceIdFromScheduleId(subscription.sourceScheduleId),
    sourceVersionId: version ? calendarVersionIdFromScheduleVersion(subscription.sourceScheduleId, version.versionNo) : "",
    followMode: subscription.followMode === "patched" ? "manual_review" : "auto",
    status: "active",
    defaultReminderEnabled: true,
    createdAt: subscription.createdAt,
    updatedAt: subscription.createdAt,
  };
};

export const toUserEventOverride = (store: NexusStore, patch: import("@touchx/shared").SchedulePatch, userId: string): UserEventOverride => {
  const subscription = store.scheduleSubscriptions.find((item) => item.id === patch.subscriptionId) || null;
  return {
    id: patch.id,
    userId,
    sourceEventId: calendarSourceEventIdFromEntryId(patch.entryId),
    action: patch.opType === "remove" ? "hide" : "modify",
    title: asString(patch.patchPayload.courseName) || undefined,
    location: asString(patch.patchPayload.classroom) || undefined,
    startSection: Number.isFinite(Number(patch.patchPayload.startSection)) ? Number(patch.patchPayload.startSection) : undefined,
    endSection: Number.isFinite(Number(patch.patchPayload.endSection)) ? Number(patch.patchPayload.endSection) : undefined,
    reason: subscription ? `legacy schedule patch for ${subscription.sourceScheduleId}` : "legacy schedule patch",
    createdAt: patch.createdAt,
    updatedAt: patch.createdAt,
  };
};

export const toPersonalEvent = (event: UserScheduleEventRecord): PersonalEvent => {
  const date = event.examDate || undefined;
  const week = date ? resolveWeekForDateKey(date) : 0;
  return {
    id: event.id,
    userId: event.userId,
    title: event.title,
    description: event.description,
    eventType: event.source === "exam" ? "exam" : event.source === "activity" ? "activity" : "todo",
    status: "pending",
    priority: event.priorityLabel,
    weekday: date ? resolveWeekdayForDateKey(date) : event.day,
    weekExpr: date && week > 0 ? String(Math.min(SCHEDULE_TERM_META.maxWeek, Math.max(1, week))) : event.weekExpr,
    parity: event.parity,
    startSection: event.startSection,
    endSection: event.endSection,
    date,
    tags: [...event.tags],
    source: event.source === "manual" ? "manual" : event.source === "ai" ? "ai" : "manual",
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
};

export const findScheduleByCalendarSourceId = (store: NexusStore, sourceId: string) => {
  const scheduleId = sourceIdToScheduleId(sourceId);
  return store.schedules.find((item) => item.id === scheduleId) || null;
};

export const toAdminCalendarSourcePayload = (store: NexusStore, schedule: ScheduleRecord) => {
  const source = toCalendarSource(store, schedule);
  const versions = store.scheduleVersions.filter((item) => item.scheduleId === schedule.id);
  const publishedVersion = versions.find((item) => item.versionNo === schedule.publishedVersionNo && item.status === "published") || null;
  const subscriptionCount = store.scheduleSubscriptions.filter((item) => item.sourceScheduleId === schedule.id).length;
  const eventCount = publishedVersion?.entries.length || 0;
  const classItem = store.classes.find((item) => item.id === schedule.classId) || null;
  return {
    ...source,
    scheduleId: schedule.id,
    classId: schedule.classId,
    classLabel: classItem?.name || "",
    versionCount: versions.length,
    currentVersionNo: publishedVersion?.versionNo || 0,
    eventCount,
    subscriptionCount,
  };
};

export const listCalendarSourceEvents = (store: NexusStore, sourceId: string) => {
  const schedule = findScheduleByCalendarSourceId(store, sourceId);
  if (!schedule) {
    return [];
  }
  const publishedVersion = store.scheduleVersions.find(
    (item) => item.scheduleId === schedule.id && item.versionNo === schedule.publishedVersionNo && item.status === "published",
  ) || null;
  if (!publishedVersion) {
    return [];
  }
  const versionId = calendarVersionIdFromScheduleVersion(schedule.id, publishedVersion.versionNo);
  const sourceType = schedule.sourceType || (schedule.classId === `user:${schedule.createdByUserId}` ? "custom" : "class_schedule");
  return publishedVersion.entries.map((entry) => toCalendarSourceEvent(entry, {
    scheduleId: schedule.id,
    versionId,
    sourceType,
    eventType: sourceType === "class_schedule" ? "course" : "custom",
  }));
};

export const getUserCalendarSubscriptions = (store: NexusStore, user: UserRecord) => {
  return store.scheduleSubscriptions
    .filter((item) => item.subscriberUserId === user.userId)
    .map((item) => toCalendarSubscription(store, item));
};
