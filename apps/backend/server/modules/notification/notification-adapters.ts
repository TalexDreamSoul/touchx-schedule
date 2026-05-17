import type { NotificationChannel, NotificationChannelType } from "@touchx/shared";
import {
  buildFeishuWebhookPayload,
  buildWechatClawDBotWebhookPayload,
  validateNotificationChannelReady,
  type NotificationAdapter,
  type NotificationAdapterMessage,
  type NotificationAdapterResult,
} from "@touchx/notification-core";

const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    return {
      ok: false,
      errorMessage: text || `HTTP ${response.status}`,
    };
  }
  return {
    ok: true,
    externalMessageId: text.slice(0, 120),
  };
};

const sendWebhookPayload = async (
  channel: NotificationChannel,
  payload: unknown,
): Promise<NotificationAdapterResult> => {
  const readyError = validateNotificationChannelReady(channel);
  if (readyError) {
    return {
      ok: false,
      errorMessage: readyError,
    };
  }
  return await postJson(String(channel.config.webhookUrl || ""), payload);
};

export const wechatClawDBotAdapter: NotificationAdapter = {
  type: "wechat_clawdbot",
  async send(channel, message: NotificationAdapterMessage) {
    return await sendWebhookPayload(channel, buildWechatClawDBotWebhookPayload(message));
  },
};

export const feishuAdapter: NotificationAdapter = {
  type: "feishu",
  async send(channel, message: NotificationAdapterMessage) {
    return await sendWebhookPayload(channel, buildFeishuWebhookPayload(message));
  },
};

const adapters: NotificationAdapter[] = [wechatClawDBotAdapter, feishuAdapter];

export const resolveNotificationAdapter = (type: NotificationChannelType) => {
  return adapters.find((item) => item.type === type) || null;
};
