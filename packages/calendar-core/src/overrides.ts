import type { CalendarSourceEvent, EffectiveCalendarEvent, UserEventOverride } from "@touchx/shared";

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export const findLatestOverrideForEvent = (
  overrides: UserEventOverride[],
  sourceEventId: string,
  userId?: string,
) => {
  return overrides
    .filter((item) => item.sourceEventId === sourceEventId)
    .filter((item) => (!userId ? true : item.userId === userId))
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt))[0] || null;
};

export const applyUserEventOverrideToSourceEvent = (
  event: CalendarSourceEvent,
  override: UserEventOverride | null | undefined,
): CalendarSourceEvent | null => {
  if (!override) {
    return { ...event, tags: [...event.tags], metadata: { ...event.metadata } };
  }
  if (override.action === "hide") {
    return null;
  }
  const next: CalendarSourceEvent = {
    ...event,
    tags: [...event.tags],
    metadata: {
      ...event.metadata,
      overrideId: override.id,
      overrideAction: override.action,
      overrideReason: override.reason || "",
    },
  };
  if (override.action === "modify") {
    if (hasOwn(override, "title") && override.title !== undefined) {
      next.title = String(override.title || "");
    }
    if (hasOwn(override, "description") && override.description !== undefined) {
      next.description = String(override.description || "");
    }
    if (hasOwn(override, "location") && override.location !== undefined) {
      next.location = String(override.location || "");
    }
    if (hasOwn(override, "startTime") && override.startTime !== undefined) {
      next.startTime = String(override.startTime || "");
    }
    if (hasOwn(override, "endTime") && override.endTime !== undefined) {
      next.endTime = String(override.endTime || "");
    }
    if (Number.isFinite(Number(override.startSection))) {
      next.startSection = Number(override.startSection);
    }
    if (Number.isFinite(Number(override.endSection))) {
      next.endSection = Number(override.endSection);
    }
  }
  return next;
};

export const applyUserEventOverrides = (
  events: CalendarSourceEvent[],
  overrides: UserEventOverride[],
  userId?: string,
) => {
  return events.flatMap((event) => {
    const override = findLatestOverrideForEvent(overrides, event.id, userId);
    const next = applyUserEventOverrideToSourceEvent(event, override);
    return next ? [next] : [];
  });
};

export const applyUserEventOverrideToEffectiveEvent = (
  event: EffectiveCalendarEvent,
  override: UserEventOverride | null | undefined,
): EffectiveCalendarEvent | null => {
  if (!override) {
    return { ...event, tags: [...event.tags], metadata: { ...event.metadata } };
  }
  if (override.action === "hide") {
    return null;
  }
  const next: EffectiveCalendarEvent = {
    ...event,
    tags: [...event.tags],
    metadata: {
      ...event.metadata,
      overrideId: override.id,
      overrideAction: override.action,
      overrideReason: override.reason || "",
    },
    overrideState: override.action === "reminder_only" ? "reminder_only" : "modified",
  };
  if (override.action === "reminder_only") {
    next.reminderEnabled = Array.isArray(override.reminderRules)
      ? override.reminderRules.some((rule) => rule.enabled)
      : next.reminderEnabled;
    return next;
  }
  if (hasOwn(override, "title") && override.title !== undefined) {
    next.title = String(override.title || "");
  }
  if (hasOwn(override, "description") && override.description !== undefined) {
    next.description = String(override.description || "");
  }
  if (hasOwn(override, "location") && override.location !== undefined) {
    next.location = String(override.location || "");
  }
  if (hasOwn(override, "startTime") && override.startTime !== undefined) {
    next.startTime = String(override.startTime || "");
  }
  if (hasOwn(override, "endTime") && override.endTime !== undefined) {
    next.endTime = String(override.endTime || "");
  }
  if (Number.isFinite(Number(override.startSection))) {
    next.startSection = Number(override.startSection);
  }
  if (Number.isFinite(Number(override.endSection))) {
    next.endSection = Number(override.endSection);
  }
  return next;
};
