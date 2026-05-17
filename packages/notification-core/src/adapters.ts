import type { NotificationChannel, NotificationChannelType } from "@touchx/shared";

export interface NotificationAdapterMessage {
  title: string;
  body: string;
  payload?: Record<string, unknown>;
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

export const validateNotificationChannelReady = (channel: NotificationChannel) => {
  if (!channel.enabled) {
    return "通知通道未启用";
  }
  if (!asString(channel.config.webhookUrl)) {
    return `${channel.name || channel.type} webhookUrl 未配置`;
  }
  return "";
};
