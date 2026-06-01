import type { H3Event } from "h3";
import type { NotificationChannelType } from "@touchx/shared";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import {
  createNotificationTestDelivery,
  listNotificationChannels,
  upsertNotificationChannel,
} from "./notification-channel-service";
import { dispatchPendingNotificationDeliveries, retryFailedNotificationDelivery } from "./notification-delivery-service";
import {
  deleteAdminNotificationBinding,
  listAdminNotificationBindings,
  upsertAdminNotificationBinding,
} from "./notification-binding-service";
import { deleteReminderRule, listReminderRules, upsertReminderRule } from "./reminder-rule-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface NotificationAdminHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireAdmin: RequireAdmin;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
}

const asString = (value: unknown) => String(value || "").trim();
const DELIVERY_STATUSES = new Set(["pending", "sending", "sent", "failed", "cancelled"]);

const parsePagination = (query: Record<string, unknown>) => {
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100)));
  const offset = Math.max(0, Number(query.offset || 0));
  return { limit, offset };
};

export const handleNotificationAdminApi = async (context: NotificationAdminHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireAdmin, readJsonBody, appendAudit } = context;

  if (method === "GET" && path === "admin/notification-channels") {
    requireAdmin(event);
    return ok(listNotificationChannels(store));
  }

  if (method === "POST" && path === "admin/notification-channels") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      id?: string;
      type?: NotificationChannelType;
      name?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    }>(event);
    const channel = upsertNotificationChannel(store, {
      id: asString(body.id),
      type: body.type as NotificationChannelType,
      name: body.name,
      enabled: body.enabled,
      config: body.config,
    });
    if (!channel) {
      return toApiError(400, "NOTIFICATION_CHANNEL_TYPE_INVALID", "通知通道类型不合法");
    }
    appendAudit("notification_channel_upsert", user.userId, { channelId: channel.id, type: channel.type, enabled: channel.enabled });
    return ok({ item: channel });
  }

  if (method === "GET" && path === "admin/notification-bindings") {
    requireAdmin(event);
    const { limit, offset } = parsePagination(query);
    return ok(listAdminNotificationBindings(store, { limit, offset, channelType: query.channelType, userId: query.userId }));
  }

  if (method === "POST" && path === "admin/notification-bindings") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      id?: string;
      userId?: string;
      channelType?: string;
      externalUserId?: string;
      externalOpenId?: string;
      externalUnionId?: string;
      status?: string;
    }>(event);
    const result = upsertAdminNotificationBinding(store, body);
    if (!result.ok) {
      if (result.reason === "user_not_found") {
        return toApiError(404, "NOTIFICATION_BINDING_USER_NOT_FOUND", "绑定用户不存在");
      }
      if (result.reason === "channel_invalid") {
        return toApiError(400, "NOTIFICATION_BINDING_CHANNEL_INVALID", "通知绑定通道类型不合法");
      }
      return toApiError(400, "NOTIFICATION_BINDING_RECEIVE_ID_REQUIRED", "请至少填写一个外部接收人 ID");
    }
    appendAudit("notification_binding_upsert", user.userId, {
      bindingId: result.item.id,
      targetUserId: result.item.userId,
      channelType: result.item.channelType,
      status: result.item.status,
    });
    return ok({ item: result.item });
  }

  const notificationBindingDeleteMatch = path.match(/^admin\/notification-bindings\/([^/]+)\/delete$/);
  if (method === "POST" && notificationBindingDeleteMatch) {
    const { user } = requireAdmin(event);
    const bindingId = decodeURIComponent(notificationBindingDeleteMatch[1]);
    const removed = deleteAdminNotificationBinding(store, bindingId);
    if (!removed) {
      return toApiError(404, "NOTIFICATION_BINDING_NOT_FOUND", "通知绑定不存在");
    }
    appendAudit("notification_binding_delete", user.userId, { bindingId: removed.id, targetUserId: removed.userId, channelType: removed.channelType });
    return ok({ item: removed, deleted: true });
  }

  const notificationChannelTestMatch = path.match(/^admin\/notification-channels\/([^/]+)\/test$/);
  if (method === "POST" && notificationChannelTestMatch) {
    const { user } = requireAdmin(event);
    const channelType = decodeURIComponent(notificationChannelTestMatch[1]) as NotificationChannelType;
    const body = await readJsonBody<{ title?: string; body?: string }>(event);
    const delivery = await createNotificationTestDelivery(store, {
      userId: user.userId,
      channelType,
      title: body.title,
      body: body.body,
    });
    if (!delivery) {
      return toApiError(404, "NOTIFICATION_CHANNEL_NOT_FOUND", "通知通道不存在");
    }
    appendAudit("notification_channel_test", user.userId, { channelType, deliveryId: delivery.id, status: delivery.status });
    return ok({ delivery });
  }

  if (method === "GET" && path === "admin/notification-deliveries") {
    requireAdmin(event);
    const { limit, offset } = parsePagination(query);
    const status = asString(query.status);
    const sourceQueue = asString(query.sourceQueue);
    const filtered = store.notificationDeliveries.filter((item) => {
      if (status && status !== "all" && DELIVERY_STATUSES.has(status) && item.status !== status) {
        return false;
      }
      if (sourceQueue && sourceQueue !== "all") {
        const itemSourceQueue = asString(item.payload?.sourceQueue);
        if (sourceQueue === "standard" && itemSourceQueue) {
          return false;
        }
        if (sourceQueue !== "standard" && itemSourceQueue !== sourceQueue) {
          return false;
        }
      }
      return true;
    });
    const items = filtered.slice(offset, offset + limit);
    return ok({ items, total: filtered.length, limit, offset });
  }

  if (method === "GET" && path === "admin/reminder-rules") {
    requireAdmin(event);
    return ok(listReminderRules(store));
  }

  if (method === "POST" && path === "admin/reminder-rules") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      id?: string;
      targetType?: "subscription" | "source_event" | "personal_event" | "global";
      targetId?: string;
      enabled?: boolean;
      offsetMinutes?: number;
      templateKey?: string;
      channelStrategy?: "both" | "primary_then_fallback" | "primary_only";
      quietHoursRespect?: boolean;
    }>(event);
    const rule = upsertReminderRule(store, body);
    appendAudit("reminder_rule_upsert", user.userId, { ruleId: rule.id, targetType: rule.targetType, targetId: rule.targetId });
    return ok({ item: rule });
  }

  const reminderRuleDeleteMatch = path.match(/^admin\/reminder-rules\/([^/]+)\/delete$/);
  if (method === "POST" && reminderRuleDeleteMatch) {
    const { user } = requireAdmin(event);
    const ruleId = decodeURIComponent(reminderRuleDeleteMatch[1]);
    const removed = deleteReminderRule(store, ruleId);
    if (!removed) {
      return toApiError(404, "REMINDER_RULE_NOT_FOUND", "提醒规则不存在");
    }
    appendAudit("reminder_rule_delete", user.userId, { ruleId });
    return ok({ item: removed });
  }

  if (method === "POST" && path === "admin/notification-deliveries/dispatch-pending") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ limit?: number }>(event);
    const result = await dispatchPendingNotificationDeliveries(store, { limit: body.limit });
    appendAudit("notification_delivery_dispatch_pending", user.userId, { count: result.total });
    return ok(result);
  }

  const notificationDeliveryRetryMatch = path.match(/^admin\/notification-deliveries\/([^/]+)\/retry$/);
  if (method === "POST" && notificationDeliveryRetryMatch) {
    const { user } = requireAdmin(event);
    const deliveryId = decodeURIComponent(notificationDeliveryRetryMatch[1]);
    const result = await retryFailedNotificationDelivery(store, deliveryId);
    if (!result.item) {
      return toApiError(404, "NOTIFICATION_DELIVERY_NOT_FOUND", "投递记录不存在");
    }
    if (!result.retried) {
      return toApiError(400, "NOTIFICATION_DELIVERY_RETRY_NOT_FAILED", "仅 failed 状态的投递记录可手动重试");
    }
    appendAudit("notification_delivery_retry", user.userId, {
      deliveryId,
      status: result.item.status,
      attemptCount: result.item.attemptCount,
      channelType: result.item.channelType,
    });
    return ok({ item: result.item, retried: result.retried });
  }

  return null;
};
