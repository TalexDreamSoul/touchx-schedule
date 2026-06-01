import type {
  CalendarSourceType,
  CalendarSourceVisibility,
  ScheduleConflict,
  ScheduleSubscription,
} from "@touchx/shared";
import type { NexusStore } from "../../services/domain-store";
import {
  storeHelpers,
  type ScheduleEntryRecord,
  type ScheduleRecord,
  type ScheduleVersionRecord,
  type UserRecord,
} from "../../services/domain-store";
import {
  findScheduleByCalendarSourceId,
  listCalendarSourceEvents,
  toAdminCalendarSourcePayload,
  toCalendarSource,
  toCalendarSourceVersion,
} from "./calendar-adapter";

const asString = (value: unknown) => String(value || "").trim();

const normalizeCalendarSourceType = (value: unknown): CalendarSourceType => {
  const text = asString(value) as CalendarSourceType;
  if (
    text === "class_schedule" ||
    text === "exam_schedule" ||
    text === "school_calendar" ||
    text === "club_activity" ||
    text === "organization_event" ||
    text === "public_calendar" ||
    text === "academic_system" ||
    text === "pdf_import" ||
    text === "manual_collection" ||
    text === "personal_template" ||
    text === "custom"
  ) {
    return text;
  }
  return "custom";
};

const normalizeCalendarVisibility = (value: unknown, fallback: CalendarSourceVisibility = "private"): CalendarSourceVisibility => {
  const text = asString(value) as CalendarSourceVisibility;
  if (text === "public" || text === "class_only" || text === "invite_only" || text === "private") {
    return text;
  }
  return fallback;
};

const normalizeScheduleEntriesFromSourceEvents = (events: unknown[], sourceType: CalendarSourceType): ScheduleEntryRecord[] => {
  if (!Array.isArray(events)) {
    return [];
  }
  return events.map((raw) => {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const title = asString(item.title || item.courseName || item.name);
    const weekday = Math.max(1, Math.min(7, Math.trunc(Number(item.weekday || item.day || 1))));
    const startSection = Math.max(1, Math.trunc(Number(item.startSection || item.start_section || 1)));
    const endSection = Math.max(startSection, Math.trunc(Number(item.endSection || item.end_section || startSection)));
    if (!title) {
      return null;
    }
    return {
      id: storeHelpers.createId("entry"),
      day: weekday,
      startSection,
      endSection,
      weekExpr: asString(item.weekExpr || item.week_expr) || "1-25",
      parity: item.parity === "odd" || item.parity === "even" ? item.parity : "all",
      courseName: title,
      classroom: asString(item.location || item.classroom || item.room),
      teacher: asString(item.teacherOrOwner || item.teacher || item.owner),
    } satisfies ScheduleEntryRecord;
  }).filter((item): item is ScheduleEntryRecord => Boolean(item));
};

const ensurePersonalSourceClass = (store: NexusStore, user: UserRecord) => {
  const now = storeHelpers.nowIso();
  const classId = `user:${user.userId}`;
  let classItem = store.classes.find((item) => item.id === classId) || null;
  if (!classItem) {
    classItem = {
      id: classId,
      name: `${user.nickname || user.name || user.accountName || user.userId}的日程源`,
      ownerUserId: user.userId,
      timezone: "Asia/Shanghai",
      status: "active",
      activeJoinCode: storeHelpers.generateJoinCode(),
      createdAt: now,
      updatedAt: now,
    };
    store.classes.push(classItem);
  } else {
    classItem.updatedAt = now;
  }
  if (!store.classMembers.some((item) => item.classId === classId && item.userId === user.userId)) {
    store.classMembers.push({
      id: storeHelpers.createId("class_member"),
      classId,
      userId: user.userId,
      classRole: "class_owner",
      joinedAt: now,
    });
  }
  if (!user.classIds.includes(classId)) {
    user.classIds = [...user.classIds, classId];
    user.updatedAt = now;
  }
  return classItem;
};

const createConflict = (
  store: NexusStore,
  subscription: ScheduleSubscription,
  entryId: string,
  sourceVersionNo: number,
  conflictType: ScheduleConflict["conflictType"],
) => {
  const exists = store.scheduleConflicts.find(
    (item) =>
      item.subscriptionId === subscription.id &&
      item.entryId === entryId &&
      item.sourceVersionNo === sourceVersionNo &&
      item.resolutionStatus === "pending",
  );
  if (exists) {
    return exists;
  }
  const conflict: ScheduleConflict = {
    id: storeHelpers.createId("schedule_conflict"),
    subscriptionId: subscription.id,
    entryId,
    sourceVersionNo,
    conflictType,
    resolutionStatus: "pending",
    createdAt: storeHelpers.nowIso(),
  };
  store.scheduleConflicts.push(conflict);
  return conflict;
};

export const onSchedulePublished = (store: NexusStore, schedule: ScheduleRecord, newVersionNo: number) => {
  const relatedSubscriptions = store.scheduleSubscriptions.filter((item) => item.sourceScheduleId === schedule.id);
  relatedSubscriptions.forEach((subscription) => {
    const patches = store.schedulePatches.filter((patch) => patch.subscriptionId === subscription.id);
    if (patches.length === 0) {
      subscription.followMode = "following";
      subscription.baseVersionNo = newVersionNo;
      return;
    }
    subscription.followMode = "patched";
    subscription.baseVersionNo = newVersionNo;
    patches.forEach((patch) => {
      createConflict(store, subscription, patch.entryId, newVersionNo, "source_changed_after_patch");
    });
  });
};

export const createOrUpdateCustomCalendarSource = (
  store: NexusStore,
  user: UserRecord,
  input: {
    sourceId?: string;
    title?: string;
    description?: string;
    type?: CalendarSourceType;
    visibility?: CalendarSourceVisibility;
    events?: unknown[];
    publish?: boolean;
  },
) => {
  const now = storeHelpers.nowIso();
  const title = asString(input.title);
  if (!title) {
    return null;
  }
  const type = normalizeCalendarSourceType(input.type);
  const visibility = normalizeCalendarVisibility(input.visibility, "private");
  const personalClass = ensurePersonalSourceClass(store, user);
  const scheduleId = asString(input.sourceId).replace(/^schedule:/, "");
  let schedule = scheduleId ? store.schedules.find((item) => item.id === scheduleId && item.createdByUserId === user.userId) || null : null;
  if (!schedule) {
    schedule = {
      id: storeHelpers.createId("schedule"),
      classId: personalClass.id,
      title,
      description: asString(input.description),
      sourceType: type,
      visibility,
      ownerType: "user",
      ownerId: user.userId,
      publishedVersionNo: 0,
      createdByUserId: user.userId,
      createdAt: now,
      updatedAt: now,
    };
    store.schedules.push(schedule);
  } else {
    schedule.title = title;
    schedule.description = asString(input.description);
    schedule.sourceType = type;
    schedule.visibility = visibility;
    schedule.ownerType = "user";
    schedule.ownerId = user.userId;
    schedule.updatedAt = now;
  }
  const events = normalizeScheduleEntriesFromSourceEvents(input.events || [], type);
  if (events.length > 0 || input.publish !== false) {
    const latestVersionNo = store.scheduleVersions
      .filter((item) => item.scheduleId === schedule.id)
      .reduce((max, item) => Math.max(max, Number(item.versionNo || 0)), 0);
    const versionNo = latestVersionNo + 1;
    const version: ScheduleVersionRecord = {
      id: storeHelpers.createId("schedule_version"),
      scheduleId: schedule.id,
      versionNo,
      status: input.publish === false ? "draft" : "published",
      entries: events,
      createdByUserId: user.userId,
      createdAt: now,
    };
    store.scheduleVersions.push(version);
    if (version.status === "published") {
      schedule.publishedVersionNo = versionNo;
      store.scheduleSubscriptions
        .filter((item) => item.sourceScheduleId === schedule.id)
        .forEach((item) => {
          item.baseVersionNo = versionNo;
          item.followMode = "following";
        });
      if (!store.scheduleSubscriptions.some((item) => item.subscriberUserId === user.userId && item.sourceScheduleId === schedule.id)) {
        store.scheduleSubscriptions.push({
          id: storeHelpers.createId("schedule_subscription"),
          subscriberUserId: user.userId,
          sourceScheduleId: schedule.id,
          baseVersionNo: versionNo,
          followMode: "following",
          createdAt: now,
        });
      }
    }
  }
  return schedule;
};

export const publishCalendarSourceVersion = (store: NexusStore, sourceId: string, versionNo: number):
  | { ok: true; schedule: ScheduleRecord; version: ScheduleVersionRecord }
  | { ok: false; reason: "source_not_found" | "version_not_found" } => {
  const scheduleId = sourceId.replace(/^schedule:/, "");
  const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
  if (!schedule) {
    return { ok: false, reason: "source_not_found" };
  }
  const version = store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo) || null;
  if (!version) {
    return { ok: false, reason: "version_not_found" };
  }
  version.status = "published";
  schedule.publishedVersionNo = versionNo;
  schedule.updatedAt = storeHelpers.nowIso();
  onSchedulePublished(store, schedule, versionNo);
  return { ok: true, schedule, version };
};

export const listCalendarSources = (store: NexusStore, options: { viewerUserId?: string; includePrivate?: boolean } = {}) => {
  const viewer = options.viewerUserId ? store.users.find((user) => user.userId === options.viewerUserId) || null : null;
  const items = store.schedules
    .filter((schedule) => options.includePrivate || canViewCalendarSource(store, schedule, viewer))
    .map((schedule) => toAdminCalendarSourcePayload(store, schedule))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    items,
    total: items.length,
  };
};

export const canViewCalendarSource = (store: NexusStore, schedule: ScheduleRecord, viewer: UserRecord | null) => {
  const visibility = schedule.visibility || (schedule.classId === `user:${schedule.createdByUserId}` ? "private" : "class_only");
  if (visibility === "public") return true;
  if (!viewer) return false;
  if (schedule.createdByUserId === viewer.userId || viewer.adminRole === "super_admin" || viewer.adminRole === "operator") return true;
  if (visibility === "class_only") {
    return store.classMembers.some((member) => member.classId === schedule.classId && member.userId === viewer.userId);
  }
  return visibility === "invite_only";
};

export const getCalendarSourceDetail = (store: NexusStore, sourceId: string, viewer?: UserRecord | null) => {
  const schedule = findScheduleByCalendarSourceId(store, sourceId);
  if (!schedule) {
    return null;
  }
  if (!canViewCalendarSource(store, schedule, viewer || null)) {
    return "forbidden" as const;
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
