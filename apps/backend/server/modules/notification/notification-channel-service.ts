import type { FeishuProviderType, FeishuReceiveIdType, NotificationChannel, NotificationChannelType } from "@touchx/shared";
import type { NexusStore } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import { createNotificationDelivery, dispatchNotificationDelivery } from "./notification-delivery-service";

const asString = (value: unknown) => String(value || "").trim();

const normalizeFeishuProvider = (value: unknown): FeishuProviderType | undefined => {
  const text = asString(value) as FeishuProviderType;
  if (text === "webhook_bot" || text === "tenant_app") {
    return text;
  }
  return undefined;
};

const normalizeFeishuReceiveIdType = (value: unknown): FeishuReceiveIdType | undefined => {
  const text = asString(value) as FeishuReceiveIdType;
  if (text === "open_id" || text === "user_id" || text === "union_id" || text === "email" || text === "chat_id") {
    return text;
  }
  return undefined;
};

export const sanitizeNotificationChannelConfig = (value: unknown): NotificationChannel["config"] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const config: NotificationChannel["config"] = {};
  const setString = (key: keyof NotificationChannel["config"], rawValue: unknown) => {
    const valueText = asString(rawValue);
    // CMS 列表接口会返回掩码值；保存时如果用户没有重新填写真实密钥，不能用掩码覆盖原密钥。
    if (!valueText || valueText.includes("***")) {
      return;
    }
    if (key === "provider") {
      const normalized = normalizeFeishuProvider(valueText);
      if (normalized) config.provider = normalized;
      return;
    }
    if (key === "receiveIdType") {
      const normalized = normalizeFeishuReceiveIdType(valueText);
      if (normalized) config.receiveIdType = normalized;
      return;
    }
    (config as Record<string, string | undefined>)[key] = valueText;
  };
  const provider = normalizeFeishuProvider(raw.provider);
  const receiveIdType = normalizeFeishuReceiveIdType(raw.receiveIdType);
  if (provider) {
    config.provider = provider;
  }
  if (receiveIdType) {
    config.receiveIdType = receiveIdType;
  }
  setString("webhookUrl", raw.webhookUrl);
  setString("defaultReceiveId", raw.defaultReceiveId);
  setString("appId", raw.appId);
  setString("appSecret", raw.appSecret);
  setString("tenantKey", raw.tenantKey);
  setString("botToken", raw.botToken);
  setString("signingSecret", raw.signingSecret);
  return config;
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
      provider: channel.config.provider || "",
      receiveIdType: channel.config.receiveIdType || "",
      defaultReceiveId: channel.config.defaultReceiveId ? mask(channel.config.defaultReceiveId) : "",
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
