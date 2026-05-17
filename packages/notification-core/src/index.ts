import type {
  NotificationChannelType,
  NotificationDelivery,
  ReminderChannelStrategy,
} from "@touchx/shared";
export * from "./adapters";

export interface NotificationMessage {
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export const renderNotificationTemplate = (
  template: string,
  params: Record<string, unknown> = {},
) => {
  return String(template || "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split(".").reduce<unknown>((acc, part) => {
      if (!acc || typeof acc !== "object") {
        return undefined;
      }
      return (acc as Record<string, unknown>)[part];
    }, params);
    return value === undefined || value === null ? "" : String(value);
  });
};

export const resolveChannelOrder = (
  primaryType: NotificationChannelType,
  availableTypes: NotificationChannelType[],
  strategy: ReminderChannelStrategy,
) => {
  const unique = Array.from(new Set(availableTypes));
  if (strategy === "both") {
    return unique;
  }
  if (strategy === "primary_only") {
    return unique.includes(primaryType) ? [primaryType] : [];
  }
  return [primaryType, ...unique.filter((item) => item !== primaryType)].filter((item) => unique.includes(item));
};

export const createDeliveryRecord = (input: {
  id: string;
  userId: string;
  channelType: NotificationChannelType;
  templateKey: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  dedupeKey: string;
  scheduledAt: string;
  nowIso: string;
}): NotificationDelivery => {
  return {
    id: input.id,
    userId: input.userId,
    channelType: input.channelType,
    templateKey: input.templateKey,
    title: input.title,
    body: input.body,
    payload: input.payload || {},
    status: "pending",
    dedupeKey: input.dedupeKey,
    scheduledAt: input.scheduledAt,
    attemptCount: 0,
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };
};

export const markDeliverySending = (delivery: NotificationDelivery, nowIso: string): NotificationDelivery => ({
  ...delivery,
  status: "sending",
  attemptCount: delivery.attemptCount + 1,
  updatedAt: nowIso,
});

export const markDeliverySent = (
  delivery: NotificationDelivery,
  nowIso: string,
  externalMessageId = "",
): NotificationDelivery => ({
  ...delivery,
  status: "sent",
  sentAt: nowIso,
  externalMessageId,
  errorMessage: "",
  updatedAt: nowIso,
});

export const markDeliveryFailed = (
  delivery: NotificationDelivery,
  nowIso: string,
  errorMessage: string,
): NotificationDelivery => ({
  ...delivery,
  status: "failed",
  errorMessage,
  updatedAt: nowIso,
});

export const shouldDedupeDelivery = (deliveries: NotificationDelivery[], dedupeKey: string) => {
  return deliveries.some((item) => item.dedupeKey === dedupeKey && item.status !== "failed" && item.status !== "cancelled");
};
