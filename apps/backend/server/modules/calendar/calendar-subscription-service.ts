import type { CalendarSubscription } from "@touchx/shared";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import {
  calendarSourceIdFromScheduleId,
  findScheduleByCalendarSourceId,
  getUserCalendarSubscriptions,
} from "./calendar-adapter";

export const listUserCalendarSubscriptions = (store: NexusStore, user: UserRecord) => {
  const items = getUserCalendarSubscriptions(store, user).map((item) => {
    const scheduleId = item.sourceId.replace(/^schedule:/, "");
    const schedule = store.schedules.find((row) => row.id === scheduleId) || null;
    const classItem = schedule ? store.classes.find((row) => row.id === schedule.classId) || null : null;
    return {
      ...item,
      sourceTitle: schedule?.title || "",
      classId: classItem?.id || "",
      classLabel: classItem?.name || "",
    };
  });
  return {
    items,
    total: items.length,
  };
};

export const subscribeCalendarSource = (store: NexusStore, user: UserRecord, sourceId: string) => {
  const schedule = findScheduleByCalendarSourceId(store, sourceId);
  if (!schedule) {
    return null;
  }
  const publishedVersion = store.scheduleVersions.find(
    (item) => item.scheduleId === schedule.id && item.versionNo === schedule.publishedVersionNo && item.status === "published",
  ) || null;
  if (!publishedVersion) {
    return "not_published" as const;
  }
  const existing = store.scheduleSubscriptions.find(
    (item) => item.subscriberUserId === user.userId && item.sourceScheduleId === schedule.id,
  );
  if (existing) {
    const item: CalendarSubscription = {
      id: existing.id,
      userId: existing.subscriberUserId,
      sourceId: calendarSourceIdFromScheduleId(existing.sourceScheduleId),
      sourceVersionId: `schedule_version:${existing.sourceScheduleId}:${existing.baseVersionNo}`,
      followMode: existing.followMode === "patched" ? "manual_review" : "auto",
      status: "active",
      defaultReminderEnabled: true,
      createdAt: existing.createdAt,
      updatedAt: existing.createdAt,
    };
    return { subscription: item, duplicated: true };
  }
  const subscription = {
    id: storeHelpers.createId("schedule_subscription"),
    subscriberUserId: user.userId,
    sourceScheduleId: schedule.id,
    baseVersionNo: publishedVersion.versionNo,
    followMode: "following" as const,
    createdAt: storeHelpers.nowIso(),
  };
  store.scheduleSubscriptions.push(subscription);
  const item: CalendarSubscription = {
    id: subscription.id,
    userId: user.userId,
    sourceId: calendarSourceIdFromScheduleId(schedule.id),
    sourceVersionId: `schedule_version:${schedule.id}:${publishedVersion.versionNo}`,
    followMode: "auto",
    status: "active",
    defaultReminderEnabled: true,
    createdAt: subscription.createdAt,
    updatedAt: subscription.createdAt,
  };
  return { subscription: item, duplicated: false };
};
