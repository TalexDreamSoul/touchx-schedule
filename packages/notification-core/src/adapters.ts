import type { FeishuProviderType, FeishuReceiveIdType, NotificationChannel, NotificationChannelType } from "@touchx/shared";

export interface NotificationAdapterMessage {
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export interface FeishuTenantAccessTokenResult {
  ok: boolean;
  token?: string;
  expireSeconds?: number;
  errorMessage?: string;
}

export interface NotificationAdapterResult {
  ok: boolean;
  externalMessageId?: string;
  errorMessage?: string;
}

export interface NotificationAdapter {
  type: NotificationChannelType;
  send(channel: NotificationChannel, message: NotificationAdapterMessage): Promise<NotificationAdapterResult>;
}

const asString = (value: unknown) => String(value || "").trim();
const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";

export const resolveFeishuProviderType = (channel: NotificationChannel): FeishuProviderType => {
  const provider = asString(channel.config.provider) as FeishuProviderType;
  if (provider === "tenant_app" || provider === "webhook_bot") {
    return provider;
  }
  return asString(channel.config.appId) && asString(channel.config.appSecret) ? "tenant_app" : "webhook_bot";
};

export const resolveFeishuReceiveIdType = (channel: NotificationChannel): FeishuReceiveIdType => {
  const value = asString(channel.config.receiveIdType) as FeishuReceiveIdType;
  if (value === "open_id" || value === "user_id" || value === "union_id" || value === "email" || value === "chat_id") {
    return value;
  }
  return "open_id";
};

export const resolveFeishuReceiveId = (channel: NotificationChannel, message: NotificationAdapterMessage) => {
  const payload = message.payload || {};
  return asString(payload.feishuReceiveId || payload.receiveId || payload.externalOpenId || payload.externalUserId || channel.config.defaultReceiveId);
};

export const buildWechatClawDBotWebhookPayload = (message: NotificationAdapterMessage) => ({
  msgtype: "text",
  text: {
    content: [message.title, message.body].filter(Boolean).join("\n"),
  },
  payload: message.payload || {},
});

export const buildFeishuWebhookPayload = (message: NotificationAdapterMessage) => ({
  msg_type: "text",
  content: {
    text: [message.title, message.body].filter(Boolean).join("\n"),
  },
});

export const buildFeishuTenantAppMessagePayload = (
  channel: NotificationChannel,
  message: NotificationAdapterMessage,
  receiveId?: string,
) => ({
  receive_id: asString(receiveId) || resolveFeishuReceiveId(channel, message),
  msg_type: "text",
  content: JSON.stringify({
    text: [message.title, message.body].filter(Boolean).join("\n"),
  }),
});

export const buildFeishuTenantAccessTokenUrl = () => `${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`;

export const buildFeishuTenantMessageUrl = (channel: NotificationChannel) => {
  const receiveIdType = resolveFeishuReceiveIdType(channel);
  return `${FEISHU_BASE_URL}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`;
};

export const buildFeishuTenantAccessTokenPayload = (channel: NotificationChannel) => ({
  app_id: asString(channel.config.appId),
  app_secret: asString(channel.config.appSecret),
});

export const parseFeishuTenantAccessTokenResponse = (value: unknown): FeishuTenantAccessTokenResult => {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = Number(payload.code ?? 0);
  const token = asString(payload.tenant_access_token);
  if (code !== 0 || !token) {
    return {
      ok: false,
      errorMessage: asString(payload.msg) || `飞书 tenant_access_token 获取失败 code=${Number.isFinite(code) ? code : "unknown"}`,
    };
  }
  return {
    ok: true,
    token,
    expireSeconds: Number(payload.expire || 0) || undefined,
  };
};

export const parseFeishuMessageSendResponse = (value: unknown): NotificationAdapterResult => {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = Number(payload.code ?? 0);
  if (code !== 0) {
    return {
      ok: false,
      errorMessage: asString(payload.msg) || `飞书消息发送失败 code=${Number.isFinite(code) ? code : "unknown"}`,
    };
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
  return {
    ok: true,
    externalMessageId: asString(data.message_id || data.messageId || data.msg_id || data.msgId),
  };
};

export const validateNotificationChannelReady = (channel: NotificationChannel) => {
  if (!channel.enabled) {
    return "通知通道未启用";
  }
  if (channel.type === "feishu" && resolveFeishuProviderType(channel) === "tenant_app") {
    if (!asString(channel.config.appId) || !asString(channel.config.appSecret)) {
      return `${channel.name || channel.type} 飞书应用 appId/appSecret 未配置`;
    }
    return "";
  }
  if (!asString(channel.config.webhookUrl)) {
    return `${channel.name || channel.type} webhookUrl 未配置`;
  }
  return "";
};
