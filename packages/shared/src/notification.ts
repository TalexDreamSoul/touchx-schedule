export const NOTIFICATION_CHANNEL_TYPES = ["wechat_clawdbot", "feishu"] as const;
export const NOTIFICATION_BINDING_STATUSES = ["active", "disabled", "expired"] as const;
export const REMINDER_TARGET_TYPES = ["subscription", "source_event", "personal_event", "global"] as const;
export const REMINDER_CHANNEL_STRATEGIES = ["both", "primary_then_fallback", "primary_only"] as const;
export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "sending", "sent", "failed", "cancelled"] as const;

export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];
export type UserNotificationBindingStatus = (typeof NOTIFICATION_BINDING_STATUSES)[number];
export type ReminderTargetType = (typeof REMINDER_TARGET_TYPES)[number];
export type ReminderChannelStrategy = (typeof REMINDER_CHANNEL_STRATEGIES)[number];
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export interface NotificationChannelConfig {
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
  tenantKey?: string;
  botToken?: string;
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
