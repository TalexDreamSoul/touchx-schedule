import type { ReminderCandidate } from "@touchx/shared";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import { buildEffectiveCalendarForUser } from "../calendar/effective-calendar-service";
import { createNotificationDelivery } from "./notification-delivery-service";

export const listReminderCandidatesForUser = (
  store: NexusStore,
  user: UserRecord,
  options: {
    week?: number;
    date?: string;
  } = {},
) => {
  const calendar = buildEffectiveCalendarForUser(store, user, options);
  return {
    items: calendar.reminderCandidates,
    total: calendar.reminderCandidates.length,
    week: calendar.week,
  };
};

const resolveEnabledChannelTypes = (store: NexusStore) => {
  const enabled = store.notificationChannels.filter((item) => item.enabled).map((item) => item.type);
  if (enabled.length > 0) {
    return enabled;
  }
  return store.notificationChannels[0]?.type ? [store.notificationChannels[0].type] : ["wechat_clawdbot" as const];
};

const resolveCandidateChannelTypes = (store: NexusStore, candidate: ReminderCandidate) => {
  const enabled = resolveEnabledChannelTypes(store);
  const strategy = String(candidate.metadata.channelStrategy || "primary_then_fallback");
  if (strategy === "both") {
    return enabled;
  }
  if (strategy === "primary_only") {
    return enabled.slice(0, 1);
  }
  return enabled.slice(0, 1);
};

const createDeliveryForCandidate = (store: NexusStore, candidate: ReminderCandidate, channelType: "wechat_clawdbot" | "feishu") => {
  return createNotificationDelivery(store, {
    userId: candidate.userId,
    channelType,
    templateKey: candidate.templateKey,
    title: candidate.title,
    body: candidate.body,
    payload: {
      ...candidate.metadata,
      eventId: candidate.eventId,
      offsetMinutes: candidate.offsetMinutes,
    },
    scheduledAt: candidate.scheduledAt,
    dedupeKey: `${candidate.userId}:${candidate.eventId}:${candidate.offsetMinutes}:${channelType}`,
  });
};

export const enqueueReminderCandidatesForUser = (
  store: NexusStore,
  user: UserRecord,
  options: {
    week?: number;
    date?: string;
    limit?: number;
  } = {},
) => {
  const candidates = listReminderCandidatesForUser(store, user, options).items;
  const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
  const existingDedupeKeys = new Set(store.notificationDeliveries.map((item) => item.dedupeKey));
  const created = [];
  for (const candidate of candidates.slice(0, limit)) {
    const channelTypes = resolveCandidateChannelTypes(store, candidate);
    for (const channelType of channelTypes) {
      const dedupeKey = `${candidate.userId}:${candidate.eventId}:${candidate.offsetMinutes}:${channelType}`;
      if (existingDedupeKeys.has(dedupeKey)) {
        continue;
      }
      const delivery = createDeliveryForCandidate(store, candidate, channelType);
      existingDedupeKeys.add(delivery.dedupeKey);
      created.push(delivery);
    }
  }
  return {
    items: created,
    total: created.length,
    candidateTotal: candidates.length,
  };
};
