import type { ReminderRule } from "./notification";

export const CALENDAR_SOURCE_TYPES = [
  "class_schedule",
  "exam_schedule",
  "school_calendar",
  "club_activity",
  "organization_event",
  "public_calendar",
  "academic_system",
  "pdf_import",
  "manual_collection",
  "personal_template",
  "custom",
] as const;

export const CALENDAR_SOURCE_OWNER_TYPES = ["system", "class", "user", "organization"] as const;
export const CALENDAR_SOURCE_VISIBILITIES = ["public", "class_only", "invite_only", "private"] as const;
export const CALENDAR_SOURCE_STATUSES = ["draft", "published", "archived"] as const;
export const CALENDAR_SOURCE_VERSION_STATUSES = ["draft", "published", "deprecated"] as const;
export const CALENDAR_EVENT_TYPES = ["course", "exam", "todo", "activity", "holiday", "deadline", "custom"] as const;
export const CALENDAR_RECURRENCE_TYPES = ["weekly", "date", "range"] as const;
export const CALENDAR_PARITIES = ["all", "odd", "even"] as const;
export const CALENDAR_SUBSCRIPTION_FOLLOW_MODES = ["auto", "manual_review", "pinned_version"] as const;
export const CALENDAR_SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled"] as const;
export const USER_EVENT_OVERRIDE_ACTIONS = ["hide", "modify", "reminder_only"] as const;
export const PERSONAL_EVENT_TYPES = ["todo", "note", "exam", "activity", "custom"] as const;
export const PERSONAL_EVENT_STATUSES = ["pending", "done", "cancelled", "archived"] as const;
export const PERSONAL_EVENT_PRIORITIES = ["low", "normal", "high"] as const;
export const PERSONAL_EVENT_SOURCES = ["manual", "ai", "pdf", "academic_system", "bot"] as const;
export const EFFECTIVE_CALENDAR_ORIGIN_TYPES = ["source", "personal", "activity", "system"] as const;
export const EFFECTIVE_CALENDAR_OVERRIDE_STATES = ["none", "hidden", "modified", "reminder_only"] as const;

export type CalendarSourceType = (typeof CALENDAR_SOURCE_TYPES)[number];
export type CalendarSourceOwnerType = (typeof CALENDAR_SOURCE_OWNER_TYPES)[number];
export type CalendarSourceVisibility = (typeof CALENDAR_SOURCE_VISIBILITIES)[number];
export type CalendarSourceStatus = (typeof CALENDAR_SOURCE_STATUSES)[number];
export type CalendarSourceVersionStatus = (typeof CALENDAR_SOURCE_VERSION_STATUSES)[number];
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];
export type CalendarRecurrenceType = (typeof CALENDAR_RECURRENCE_TYPES)[number];
export type CalendarParity = (typeof CALENDAR_PARITIES)[number];
export type CalendarSubscriptionFollowMode = (typeof CALENDAR_SUBSCRIPTION_FOLLOW_MODES)[number];
export type CalendarSubscriptionStatus = (typeof CALENDAR_SUBSCRIPTION_STATUSES)[number];
export type UserEventOverrideAction = (typeof USER_EVENT_OVERRIDE_ACTIONS)[number];
export type PersonalEventType = (typeof PERSONAL_EVENT_TYPES)[number];
export type PersonalEventStatus = (typeof PERSONAL_EVENT_STATUSES)[number];
export type PersonalEventPriority = (typeof PERSONAL_EVENT_PRIORITIES)[number];
export type PersonalEventSource = (typeof PERSONAL_EVENT_SOURCES)[number];
export type EffectiveCalendarOriginType = (typeof EFFECTIVE_CALENDAR_ORIGIN_TYPES)[number];
export type EffectiveCalendarOverrideState = (typeof EFFECTIVE_CALENDAR_OVERRIDE_STATES)[number];

export interface CalendarSource {
  id: string;
  type: CalendarSourceType;
  title: string;
  description: string;
  ownerType: CalendarSourceOwnerType;
  ownerId: string;
  timezone: string;
  visibility: CalendarSourceVisibility;
  status: CalendarSourceStatus;
  currentVersionId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarSourceVersion {
  id: string;
  sourceId: string;
  versionNo: number;
  status: CalendarSourceVersionStatus;
  changeSummary: string;
  createdBy: string;
  createdAt: string;
  publishedAt: string;
}

export interface CalendarSourceEvent {
  id: string;
  sourceId: string;
  versionId: string;
  title: string;
  description: string;
  eventType: CalendarEventType;
  location: string;
  teacherOrOwner: string;
  recurrenceType: CalendarRecurrenceType;
  weekday?: number;
  weekExpr?: string;
  parity?: CalendarParity;
  date?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface CalendarSubscription {
  id: string;
  userId: string;
  sourceId: string;
  sourceVersionId: string;
  followMode: CalendarSubscriptionFollowMode;
  status: CalendarSubscriptionStatus;
  defaultReminderEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserEventOverride {
  id: string;
  userId: string;
  sourceEventId: string;
  action: UserEventOverrideAction;
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  reminderRules?: ReminderRule[];
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalEvent {
  id: string;
  userId: string;
  title: string;
  description: string;
  eventType: PersonalEventType;
  status: PersonalEventStatus;
  priority: PersonalEventPriority;
  date?: string;
  weekday?: number;
  weekExpr?: string;
  parity?: CalendarParity;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  dueAt?: string;
  tags: string[];
  source: PersonalEventSource;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveCalendarEvent {
  id: string;
  originType: EffectiveCalendarOriginType;
  originId: string;
  sourceId?: string;
  subscriptionId?: string;
  title: string;
  description: string;
  eventType: CalendarEventType;
  date?: string;
  weekday?: number;
  weekExpr?: string;
  parity?: CalendarParity;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  location: string;
  tags: string[];
  reminderEnabled: boolean;
  overrideState: EffectiveCalendarOverrideState;
  metadata: Record<string, unknown>;
}

export interface CalendarConflict {
  id: string;
  eventIds: string[];
  date?: string;
  weekday?: number;
  startSection?: number;
  endSection?: number;
  startTime?: string;
  endTime?: string;
  severity: "info" | "warning" | "blocking";
  reason: string;
}

export interface ReminderCandidate {
  id: string;
  eventId: string;
  userId: string;
  scheduledAt: string;
  offsetMinutes: number;
  templateKey: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
}
