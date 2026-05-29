import { createHmac } from "node:crypto";
import type { NotificationChannel, NotificationChannelType } from "@touchx/shared";
import {
  buildFeishuTenantAccessTokenPayload,
  buildFeishuTenantAccessTokenUrl,
  buildFeishuTenantAppMessagePayload,
  buildFeishuTenantMessageUrl,
  buildFeishuWebhookPayload,
  buildWechatClawDBotWebhookPayload,
  parseFeishuMessageSendResponse,
  parseFeishuTenantAccessTokenResponse,
  resolveFeishuProviderType,
  resolveFeishuReceiveId,
  validateNotificationChannelReady,
  type NotificationAdapter,
  type NotificationAdapterMessage,
  type NotificationAdapterResult,
} from "@touchx/notification-core";

const readResponsePayload = async (response: Response) => {
  const text = await response.text().catch(() => "");
  if (!text) {
    return { text: "", json: null as unknown };
  }
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: null as unknown };
  }
};

const postJson = async (url: string, body: unknown, headers: Record<string, string> = {}): Promise<NotificationAdapterResult & { json?: unknown }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    return {
      ok: false,
      errorMessage: payload.text || `HTTP ${response.status}`,
    };
  }
  return {
    ok: true,
    externalMessageId: payload.text.slice(0, 120),
    json: payload.json,
  };
};

const buildFeishuWebhookSignedPayload = (channel: NotificationChannel, payload: ReturnType<typeof buildFeishuWebhookPayload>) => {
  const secret = String(channel.config.signingSecret || "").trim();
  if (!secret) {
    return payload;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sign = createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
  return {
    ...payload,
    timestamp,
    sign,
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

const sendFeishuTenantAppMessage = async (
  channel: NotificationChannel,
  message: NotificationAdapterMessage,
): Promise<NotificationAdapterResult> => {
  const readyError = validateNotificationChannelReady(channel);
  if (readyError) {
    return {
      ok: false,
      errorMessage: readyError,
    };
  }
  const receiveId = resolveFeishuReceiveId(channel, message);
  if (!receiveId) {
    return {
      ok: false,
      errorMessage: `${channel.name || channel.type} 飞书应用 receiveId 未配置`,
    };
  }
  const tokenResponse = await postJson(
    buildFeishuTenantAccessTokenUrl(),
    buildFeishuTenantAccessTokenPayload(channel),
  );
  if (!tokenResponse.ok) {
    return {
      ok: false,
      errorMessage: tokenResponse.errorMessage || "飞书 tenant_access_token 获取失败",
    };
  }
  const tokenResult = parseFeishuTenantAccessTokenResponse(tokenResponse.json);
  if (!tokenResult.ok || !tokenResult.token) {
    return {
      ok: false,
      errorMessage: tokenResult.errorMessage || "飞书 tenant_access_token 无效",
    };
  }
  const messageResponse = await postJson(
    buildFeishuTenantMessageUrl(channel),
    buildFeishuTenantAppMessagePayload(channel, message, receiveId),
    {
      Authorization: `Bearer ${tokenResult.token}`,
    },
  );
  if (!messageResponse.ok) {
    return {
      ok: false,
      errorMessage: messageResponse.errorMessage || "飞书应用消息发送失败",
    };
  }
  return parseFeishuMessageSendResponse(messageResponse.json);
};

export const feishuAdapter: NotificationAdapter = {
  type: "feishu",
  async send(channel, message: NotificationAdapterMessage) {
    if (resolveFeishuProviderType(channel) === "tenant_app") {
      return await sendFeishuTenantAppMessage(channel, message);
    }
    return await sendWebhookPayload(channel, buildFeishuWebhookSignedPayload(channel, buildFeishuWebhookPayload(message)));
  },
};

const adapters: NotificationAdapter[] = [wechatClawDBotAdapter, feishuAdapter];

export const resolveNotificationAdapter = (type: NotificationChannelType) => {
  return adapters.find((item) => item.type === type) || null;
};
