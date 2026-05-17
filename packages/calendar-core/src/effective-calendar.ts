import type {
  CalendarSource,
  CalendarSourceEvent,
  CalendarSubscription,
  EffectiveCalendarEvent,
  PersonalEvent,
  UserEventOverride,
} from "@touchx/shared";
import { applyUserEventOverrideToEffectiveEvent, findLatestOverrideForEvent } from "./overrides";

export interface ResolveEffectiveCalendarEventsInput {
  sources?: CalendarSource[];
  sourceEvents: CalendarSourceEvent[];
  subscriptions?: CalendarSubscription[];
  personalEvents?: PersonalEvent[];
  overrides?: UserEventOverride[];
  userId?: string;
  includeHidden?: boolean;
}

const toSourceEffectiveEvent = (
  event: CalendarSourceEvent,
  options: {
    source?: CalendarSource | null;
    subscription?: CalendarSubscription | null;
  } = {},
): EffectiveCalendarEvent => {
  return {
    id: `source:${event.id}`,
    originType: "source",
    originId: event.id,
    sourceId: event.sourceId,
    subscriptionId: options.subscription?.id,
    title: event.title,
    description: event.description,
    eventType: event.eventType,
    date: event.date,
    weekday: event.weekday,
    weekExpr: event.weekExpr,
    parity: event.parity,
    startTime: event.startTime,
    endTime: event.endTime,
    startSection: event.startSection,
    endSection: event.endSection,
    location: event.location,
    tags: [...event.tags],
    reminderEnabled: options.subscription?.defaultReminderEnabled ?? true,
    overrideState: "none",
    metadata: {
      ...event.metadata,
      sourceTitle: options.source?.title || "",
      sourceType: options.source?.type || "custom",
      sourceTimezone: options.source?.timezone || "",
      versionId: event.versionId,
      recurrenceType: event.recurrenceType,
      teacherOrOwner: event.teacherOrOwner,
    },
  };
};

export const toPersonalEffectiveEvent = (event: PersonalEvent): EffectiveCalendarEvent => {
  return {
    id: `personal:${event.id}`,
    originType: "personal",
    originId: event.id,
    title: event.title,
    description: event.description,
    eventType: event.eventType === "note" ? "custom" : event.eventType,
    date: event.date,
    weekday: event.weekday,
    weekExpr: event.weekExpr,
    parity: event.parity,
    startTime: event.startTime,
    endTime: event.endTime,
    startSection: event.startSection,
    endSection: event.endSection,
    location: "",
    tags: [...event.tags],
    reminderEnabled: event.status === "pending",
    overrideState: "none",
    metadata: {
      status: event.status,
      priority: event.priority,
      dueAt: event.dueAt || "",
      source: event.source,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    },
  };
};

const sortEffectiveEvents = (items: EffectiveCalendarEvent[]) => {
  return [...items].sort((left, right) => {
    const leftDate = String(left.date || "");
    const rightDate = String(right.date || "");
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }
    const leftWeekday = Number(left.weekday || 99);
    const rightWeekday = Number(right.weekday || 99);
    if (leftWeekday !== rightWeekday) {
      return leftWeekday - rightWeekday;
    }
    const leftStart = Number(left.startSection || 99);
    const rightStart = Number(right.startSection || 99);
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });
};

export const resolveEffectiveCalendarEvents = (input: ResolveEffectiveCalendarEventsInput) => {
  const sources = input.sources || [];
  const sourceById = new Map(sources.map((source) => [source.id, source] as const));
  const subscriptions = input.subscriptions || [];
  const activeSubscriptionBySourceId = new Map(
    subscriptions
      .filter((item) => item.status === "active")
      .map((item) => [item.sourceId, item] as const),
  );
  const sourceItems = input.sourceEvents.flatMap((event) => {
    const subscription = activeSubscriptionBySourceId.get(event.sourceId) || null;
    if (subscriptions.length > 0 && !subscription) {
      return [];
    }
    const source = sourceById.get(event.sourceId) || null;
    const base = toSourceEffectiveEvent(event, { source, subscription });
    const override = findLatestOverrideForEvent(input.overrides || [], event.id, input.userId);
    const overridden = applyUserEventOverrideToEffectiveEvent(base, override);
    if (!overridden) {
      if (!input.includeHidden) {
        return [];
      }
      return [
        {
          ...base,
          reminderEnabled: false,
          overrideState: "hidden" as const,
          metadata: {
            ...base.metadata,
            overrideId: override?.id || "",
            overrideReason: override?.reason || "",
          },
        },
      ];
    }
    return [overridden];
  });
  const personalItems = (input.personalEvents || [])
    .filter((item) => item.status !== "archived" && item.status !== "cancelled")
    .map((item) => toPersonalEffectiveEvent(item));
  return sortEffectiveEvents([...sourceItems, ...personalItems]);
};
