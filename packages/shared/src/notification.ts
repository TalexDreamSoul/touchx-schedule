export const NOTIFICATION_CHANNEL_TYPES = ["wechat_clawdbot", "feishu"] as const;
export const FEISHU_PROVIDER_TYPES = ["webhook_bot", "tenant_app"] as const;
export const FEISHU_RECEIVE_ID_TYPES = ["open_id", "user_id", "union_id", "email", "chat_id"] as const;
export const NOTIFICATION_BINDING_STATUSES = ["active", "disabled", "expired"] as const;
export const REMINDER_TARGET_TYPES = ["subscription", "source_event", "personal_event", "global"] as const;
export const REMINDER_CHANNEL_STRATEGIES = ["both", "primary_then_fallback", "primary_only"] as const;
export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "sending", "sent", "failed", "cancelled"] as const;

export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];
export type FeishuProviderType = (typeof FEISHU_PROVIDER_TYPES)[number];
export type FeishuReceiveIdType = (typeof FEISHU_RECEIVE_ID_TYPES)[number];
export type UserNotificationBindingStatus = (typeof NOTIFICATION_BINDING_STATUSES)[number];
export type ReminderTargetType = (typeof REMINDER_TARGET_TYPES)[number];
export type ReminderChannelStrategy = (typeof REMINDER_CHANNEL_STRATEGIES)[number];
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export interface NotificationChannelConfig {
  /** 通用 webhook 地址；ClawDBot 和飞书自定义机器人使用。 */
  webhookUrl?: string;
  /** 飞书接入模式：自定义机器人 webhook，或企业自建应用。 */
  provider?: FeishuProviderType;
  /** 飞书应用消息接收 ID 类型。 */
  receiveIdType?: FeishuReceiveIdType;
  /** 飞书应用默认接收 ID；没有用户绑定时用于后台测试或全局通知。 */
  defaultReceiveId?: string;
  appId?: string;
  appSecret?: string;
  tenantKey?: string;
  botToken?: string;
  /** 飞书自定义机器人签名密钥。 */
  signingSecret?: string;
}

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: NotificationChannelConfig;
  createdAt: string;
  updatedAt: string;
}

export interface UserNotificationBinding {
  id: string;
  userId: string;
  channelType: NotificationChannelType;
  externalUserId: string;
  externalOpenId?: string;
  externalUnionId?: string;
  status: UserNotificationBindingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRule {
  id: string;
  targetType: ReminderTargetType;
  targetId: string;
  enabled: boolean;
  offsetMinutes: number;
  templateKey: string;
  channelStrategy: ReminderChannelStrategy;
  quietHoursRespect: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: string;
  userId: string;
  channelType: NotificationChannelType;
  templateKey: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: NotificationDeliveryStatus;
  dedupeKey: string;
  scheduledAt: string;
  sentAt?: string;
  externalMessageId?: string;
  errorMessage?: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplateInput {
  templateKey: string;
  locale?: string;
  titleParams?: Record<string, unknown>;
  bodyParams?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}
