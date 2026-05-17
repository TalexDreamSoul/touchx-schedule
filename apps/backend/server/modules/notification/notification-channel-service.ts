import type { NotificationChannel, NotificationChannelType } from "@touchx/shared";
import type { NexusStore } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import { createNotificationDelivery, dispatchNotificationDelivery } from "./notification-delivery-service";

const asString = (value: unknown) => String(value || "").trim();

export const sanitizeNotificationChannelConfig = (value: unknown): NotificationChannel["config"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  return {
    webhookUrl: asString(raw.webhookUrl),
    appId: asString(raw.appId),
    appSecret: asString(raw.appSecret),
    tenantKey: asString(raw.tenantKey),
    botToken: asString(raw.botToken),
    signingSecret: asString(raw.signingSecret),
  };
};

export const maskNotificationChannel = (channel: NotificationChannel) => {
  const mask = (value: unknown) => {
    const raw = asString(value);
    if (!raw) {
      return "";
    }
    if (raw.length <= 8) {
      return "***";
    }
    return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
  };
  return {
    ...channel,
    config: {
      webhookUrl: channel.config.webhookUrl ? mask(channel.config.webhookUrl) : "",
      appId: channel.config.appId || "",
      appSecret: channel.config.appSecret ? mask(channel.config.appSecret) : "",
      tenantKey: channel.config.tenantKey || "",
      botToken: channel.config.botToken ? mask(channel.config.botToken) : "",
      signingSecret: channel.config.signingSecret ? mask(channel.config.signingSecret) : "",
    },
  };
};

export const listNotificationChannels = (store: NexusStore) => {
  const items = store.notificationChannels.map((item) => maskNotificationChannel(item));
  return {
    items,
    total: items.length,
  };
};

export const upsertNotificationChannel = (
  store: NexusStore,
  input: {
    id?: string;
    type: NotificationChannelType;
    name?: string;
    enabled?: boolean;
    config?: unknown;
  },
) => {
  const type = input.type;
  if (type !== "wechat_clawdbot" && type !== "feishu") {
    return null;
  }
  const now = storeHelpers.nowIso();
  const existing = store.notificationChannels.find((item) => item.type === type || (input.id && item.id === input.id)) || null;
  if (existing) {
    existing.name = asString(input.name) || existing.name;
    if (typeof input.enabled === "boolean") {
      existing.enabled = input.enabled;
    }
    existing.config = {
      ...existing.config,
      ...sanitizeNotificationChannelConfig(input.config),
    };
    existing.updatedAt = now;
    return existing;
  }
  const created: NotificationChannel = {
    id: input.id || storeHelpers.createId("notification_channel"),
    type,
    name: asString(input.name) || (type === "wechat_clawdbot" ? "微信 ClawDBot" : "飞书"),
    enabled: Boolean(input.enabled),
    config: sanitizeNotificationChannelConfig(input.config),
    createdAt: now,
    updatedAt: now,
  };
  store.notificationChannels.push(created);
  return created;
};

export const createNotificationTestDelivery = async (
  store: NexusStore,
  input: {
    userId: string;
    channelType: NotificationChannelType;
    title?: string;
    body?: string;
  },
) => {
  const channel = store.notificationChannels.find((item) => item.type === input.channelType) || null;
  if (!channel) {
    return null;
  }
  const delivery = createNotificationDelivery(store, {
    userId: input.userId,
    channelType: channel.type,
    templateKey: "cms.test",
    title: asString(input.title) || "TouchX 测试通知",
    body: asString(input.body) || `${channel.name} 测试消息已创建。`,
    payload: {
      source: "cms",
      channelId: channel.id,
    },
    dedupeKey: `cms.test:${channel.type}:${Date.now()}`,
  });
  return await dispatchNotificationDelivery(store, delivery.id);
};
