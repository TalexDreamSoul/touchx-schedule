import type { NotificationChannelType, NotificationDelivery } from "@touchx/shared";
import type { NexusStore } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import { resolveNotificationAdapter } from "./notification-adapters";

const asString = (value: unknown) => String(value || "").trim();
const QUIET_HOUR_START = 23;
const QUIET_HOUR_END = 7;

const toLocalHour = (date: Date, timeZone = "Asia/Shanghai") => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
    });
    const hour = Number(formatter.format(date));
    return Number.isFinite(hour) ? hour : date.getHours();
  } catch {
    return date.getHours();
  }
};

const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

const isWithinQuietHours = (date: Date, timeZone = "Asia/Shanghai") => {
  const hour = toLocalHour(date, timeZone);
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
};

const resolveQuietHourEnd = (date: Date, timeZone = "Asia/Shanghai") => {
  let next = new Date(date.getTime());
  for (let index = 0; index < 30; index += 1) {
    if (!isWithinQuietHours(next, timeZone)) {
      return next;
    }
    next = addHours(next, 1);
  }
  return date;
};

export const applyQuietHoursToDelivery = (delivery: NotificationDelivery, now = new Date()) => {
  if (!delivery.payload?.quietHoursRespect) {
    return false;
  }
  const scheduledAt = Date.parse(delivery.scheduledAt);
  const scheduledDate = Number.isFinite(scheduledAt) ? new Date(scheduledAt) : now;
  if (!isWithinQuietHours(scheduledDate)) {
    return false;
  }
  const next = resolveQuietHourEnd(scheduledDate);
  delivery.scheduledAt = next.toISOString();
  delivery.updatedAt = storeHelpers.nowIso();
  delivery.errorMessage = "已避开免打扰时段，延后至 07:00 后投递";
  return true;
};

const resolveFallbackChannelType = (store: NexusStore, delivery: NotificationDelivery): NotificationChannelType | "" => {
  if (delivery.payload?.channelStrategy !== "primary_then_fallback") {
    return "";
  }
  const tried = new Set<string>(Array.isArray(delivery.payload?.triedChannelTypes) ? delivery.payload.triedChannelTypes.map((item) => asString(item)) : []);
  tried.add(delivery.channelType);
  const fallback = store.notificationChannels.find((item) => item.enabled && !tried.has(item.type)) || null;
  return fallback?.type || "";
};

const createFallbackDelivery = (store: NexusStore, source: NotificationDelivery, channelType: NotificationChannelType) => {
  const dedupeKey = `${source.dedupeKey}:fallback:${channelType}`;
  const existing = store.notificationDeliveries.find((item) => item.dedupeKey === dedupeKey && item.status !== "cancelled") || null;
  if (existing) {
    return existing;
  }
  return createNotificationDelivery(store, {
    userId: source.userId,
    channelType,
    templateKey: source.templateKey,
    title: source.title,
    body: source.body,
    payload: {
      ...source.payload,
      fallbackFromDeliveryId: source.id,
      triedChannelTypes: [
        ...(Array.isArray(source.payload?.triedChannelTypes) ? source.payload.triedChannelTypes.map((item) => asString(item)) : []),
        source.channelType,
      ],
    },
    scheduledAt: storeHelpers.nowIso(),
    dedupeKey,
  });
};

export const createNotificationDelivery = (
  store: NexusStore,
  input: {
    userId: string;
    channelType: NotificationChannelType;
    templateKey?: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    scheduledAt?: string;
    dedupeKey?: string;
  },
) => {
  const now = storeHelpers.nowIso();
  const delivery: NotificationDelivery = {
    id: storeHelpers.createId("notification_delivery"),
    userId: input.userId,
    channelType: input.channelType,
    templateKey: asString(input.templateKey) || "manual",
    title: asString(input.title) || "TouchX 通知",
    body: asString(input.body),
    payload: input.payload || {},
    status: "pending",
    dedupeKey: asString(input.dedupeKey) || `${input.channelType}:${input.userId}:${Date.now()}`,
    scheduledAt: asString(input.scheduledAt) || now,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  store.notificationDeliveries.unshift(delivery);
  if (store.notificationDeliveries.length > 2000) {
    store.notificationDeliveries.length = 2000;
  }
  return delivery;
};

export const dispatchNotificationDelivery = async (store: NexusStore, deliveryId: string) => {
  const delivery = store.notificationDeliveries.find((item) => item.id === deliveryId) || null;
  if (!delivery) {
    return null;
  }
  if (applyQuietHoursToDelivery(delivery)) {
    return delivery;
  }
  const channel = store.notificationChannels.find((item) => item.type === delivery.channelType) || null;
  const nowSending = storeHelpers.nowIso();
  delivery.status = "sending";
  delivery.attemptCount += 1;
  delivery.updatedAt = nowSending;
  if (!channel) {
    delivery.status = "failed";
    delivery.errorMessage = "通知通道不存在";
    delivery.updatedAt = storeHelpers.nowIso();
    return delivery;
  }
  if (!channel.enabled) {
    delivery.status = "failed";
    delivery.errorMessage = "通知通道未启用";
    delivery.updatedAt = storeHelpers.nowIso();
    return delivery;
  }
  const adapter = resolveNotificationAdapter(channel.type);
  if (!adapter) {
    delivery.status = "failed";
    delivery.errorMessage = "通知通道 adapter 未实现";
    delivery.updatedAt = storeHelpers.nowIso();
    return delivery;
  }
  try {
    const result = await adapter.send(channel, {
      title: delivery.title,
      body: delivery.body,
      payload: delivery.payload,
    });
    if (result.ok) {
      delivery.status = "sent";
      delivery.sentAt = storeHelpers.nowIso();
      delivery.externalMessageId = result.externalMessageId || "";
      delivery.errorMessage = "";
      delivery.updatedAt = delivery.sentAt;
      return delivery;
    }
    delivery.status = "failed";
    delivery.errorMessage = result.errorMessage || "发送失败";
    delivery.updatedAt = storeHelpers.nowIso();
    const fallbackType = resolveFallbackChannelType(store, delivery);
    if (fallbackType) {
      createFallbackDelivery(store, delivery, fallbackType);
    }
    return delivery;
  } catch (error) {
    delivery.status = "failed";
    delivery.errorMessage = error instanceof Error ? error.message : "发送异常";
    delivery.updatedAt = storeHelpers.nowIso();
    const fallbackType = resolveFallbackChannelType(store, delivery);
    if (fallbackType) {
      createFallbackDelivery(store, delivery, fallbackType);
    }
    return delivery;
  }
};

export const retryFailedNotificationDelivery = async (store: NexusStore, deliveryId: string) => {
  const delivery = store.notificationDeliveries.find((item) => item.id === deliveryId) || null;
  if (!delivery) {
    return {
      item: null,
      retried: false,
      reason: "not_found" as const,
    };
  }
  if (delivery.status !== "failed") {
    return {
      item: delivery,
      retried: false,
      reason: "not_failed" as const,
    };
  }
  const now = storeHelpers.nowIso();
  const retryCount = Number(delivery.payload?.manualRetryCount || 0);
  delivery.status = "pending";
  delivery.scheduledAt = now;
  delivery.errorMessage = "";
  delivery.externalMessageId = "";
  delete delivery.sentAt;
  delivery.payload = {
    ...delivery.payload,
    manualRetryCount: Number.isFinite(retryCount) ? retryCount + 1 : 1,
    lastManualRetryAt: now,
  };
  delivery.updatedAt = now;
  const dispatched = await dispatchNotificationDelivery(store, delivery.id);
  return {
    item: dispatched || delivery,
    retried: true,
    reason: "retried" as const,
  };
};

export const dispatchPendingNotificationDeliveries = async (
  store: NexusStore,
  options: {
    limit?: number;
    now?: Date;
  } = {},
) => {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  const now = options.now || new Date();
  const pending = store.notificationDeliveries
    .filter((item) => item.status === "pending")
    .filter((item) => {
      const scheduledAt = Date.parse(item.scheduledAt);
      return !Number.isFinite(scheduledAt) || scheduledAt <= now.getTime();
    })
    .slice(0, limit);
  const results: NotificationDelivery[] = [];
  for (const item of pending) {
    const dispatched = await dispatchNotificationDelivery(store, item.id);
    if (dispatched) {
      results.push({ ...dispatched, payload: { ...dispatched.payload } });
    }
  }
  return {
    items: results,
    total: results.length,
  };
};
