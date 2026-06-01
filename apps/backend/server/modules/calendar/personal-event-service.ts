import { storeHelpers, type NexusStore, type UserRecord, type UserScheduleEventRecord } from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

export interface PersonalEventInput {
  title?: string;
  description?: string;
  eventType?: string;
  date?: string;
  weekday?: number;
  day?: number;
  weekExpr?: string;
  startSection?: number;
  endSection?: number;
  tags?: string[];
  priority?: "low" | "normal" | "high";
}

const normalizeSource = (value: unknown): UserScheduleEventRecord["source"] => {
  return value === "exam" ? "exam" : value === "activity" ? "activity" : "manual";
};

const normalizePriority = (value: unknown): UserScheduleEventRecord["priorityLabel"] => {
  return value === "high" || value === "low" ? value : "normal";
};

const priorityScore = (priority: UserScheduleEventRecord["priorityLabel"]) => {
  if (priority === "high") return 80;
  if (priority === "low") return 30;
  return 50;
};

export const listPersonalEvents = (
  store: NexusStore,
  user: UserRecord,
  options: { includeArchived?: boolean } = {},
) => {
  const includeArchived = Boolean(options.includeArchived);
  const items = store.userScheduleEvents
    .filter((item) => item.userId === user.userId)
    .filter((item) => includeArchived || !(item.tags || []).includes("archived"))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return { items, total: items.length };
};

export const createPersonalEvent = (store: NexusStore, user: UserRecord, input: PersonalEventInput) => {
  const title = asString(input.title);
  if (!title) {
    return null;
  }
  const now = storeHelpers.nowIso();
  const priority = normalizePriority(input.priority);
  const eventRecord: UserScheduleEventRecord = {
    id: storeHelpers.createId("user_event"),
    userId: user.userId,
    title,
    description: asString(input.description),
    source: normalizeSource(input.eventType),
    day: Math.max(1, Math.min(7, Math.trunc(Number(input.weekday || input.day || 1)))),
    startSection: Math.max(1, Math.trunc(Number(input.startSection || 1))),
    endSection: Math.max(1, Math.trunc(Number(input.endSection || input.startSection || 1))),
    weekExpr: asString(input.weekExpr) || "1-25",
    parity: "all",
    tags: Array.isArray(input.tags) ? input.tags.map((item) => asString(item)).filter(Boolean) : ["个人"],
    priorityScore: priorityScore(priority),
    priorityLabel: priority,
    examDate: asString(input.date),
    createdAt: now,
    updatedAt: now,
  };
  eventRecord.endSection = Math.max(eventRecord.startSection, eventRecord.endSection);
  store.userScheduleEvents.push(eventRecord);
  return eventRecord;
};

export const findOwnedPersonalEvent = (store: NexusStore, user: UserRecord, eventId: string) => {
  return store.userScheduleEvents.find((eventItem) => eventItem.id === eventId && eventItem.userId === user.userId) || null;
};

export const updatePersonalEvent = (
  store: NexusStore,
  user: UserRecord,
  eventId: string,
  input: PersonalEventInput,
) => {
  const item = findOwnedPersonalEvent(store, user, eventId);
  if (!item) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "title")) {
    const title = asString(input.title);
    if (!title) {
      return "title_required" as const;
    }
    item.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    item.description = asString(input.description);
  }
  if (Object.prototype.hasOwnProperty.call(input, "eventType")) {
    item.source = normalizeSource(input.eventType);
  }
  if (Object.prototype.hasOwnProperty.call(input, "weekday") || Object.prototype.hasOwnProperty.call(input, "day")) {
    item.day = Math.max(1, Math.min(7, Math.trunc(Number(input.weekday || input.day || item.day || 1))));
  }
  if (Object.prototype.hasOwnProperty.call(input, "startSection")) {
    item.startSection = Math.max(1, Math.trunc(Number(input.startSection || item.startSection || 1)));
  }
  if (Object.prototype.hasOwnProperty.call(input, "endSection")) {
    item.endSection = Math.max(item.startSection, Math.trunc(Number(input.endSection || item.endSection || item.startSection || 1)));
  }
  if (Object.prototype.hasOwnProperty.call(input, "weekExpr")) {
    item.weekExpr = asString(input.weekExpr) || item.weekExpr;
  }
  if (Object.prototype.hasOwnProperty.call(input, "date")) {
    item.examDate = asString(input.date);
  }
  if (Array.isArray(input.tags)) {
    item.tags = input.tags.map((tag) => asString(tag)).filter(Boolean);
  }
  if (input.priority === "high" || input.priority === "normal" || input.priority === "low") {
    item.priorityLabel = input.priority;
    item.priorityScore = priorityScore(input.priority);
  }
  item.updatedAt = storeHelpers.nowIso();
  return item;
};

export const archivePersonalEvent = (store: NexusStore, user: UserRecord, eventId: string) => {
  const item = findOwnedPersonalEvent(store, user, eventId);
  if (!item) {
    return null;
  }
  item.tags = Array.from(new Set([...(item.tags || []).filter((tag) => tag !== "done"), "archived"]));
  item.updatedAt = storeHelpers.nowIso();
  return item;
};

export const markPersonalEventDone = (store: NexusStore, user: UserRecord, eventId: string) => {
  const item = findOwnedPersonalEvent(store, user, eventId);
  if (!item) {
    return null;
  }
  item.tags = Array.from(new Set([...(item.tags || []), "done"]));
  item.updatedAt = storeHelpers.nowIso();
  return item;
};
