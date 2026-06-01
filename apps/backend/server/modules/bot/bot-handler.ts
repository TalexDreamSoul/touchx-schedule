import { getHeader, type H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import {
  ackNotificationReminderDelivery,
  ackReminderDelivery,
  getBotDeliveryTokenHeader,
  pullPendingNotificationReminderDeliveries,
  pullPendingReminderDeliveries,
  requireBotDeliveryToken,
  resolveReminderDeliveryQueue,
  resolveReminderDbFromEvent,
  runReminderHeartbeat,
} from "../../services/reminder-delivery-service";
import {
  listBotJobHistory,
  listBotTemplates,
  parseBotLimit,
  saveBotTemplate,
  triggerNextDayBotJob,
} from "./bot-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;
type GetBearerToken = (event: H3Event) => string;
type GetRuntimeConfig = (event: H3Event) => Record<string, unknown>;

export interface BotHandlerContext {
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
  getBearerToken: GetBearerToken;
  getRuntimeConfig: GetRuntimeConfig;
}

const HEARTBEAT_TOKEN_HEADER = "x-heartbeat-token";

const asString = (value: unknown) => String(value || "").trim();

const parsePagination = (query: Record<string, unknown>) => {
  const limit = Math.max(1, Math.min(500, Number(query.limit || 100)));
  const offset = Math.max(0, Number(query.offset || 0));
  return { limit, offset };
};

export const isBotPath = (path: string) => {
  return path === "bot/templates" || path.startsWith("bot/jobs/") || path.startsWith("bot/deliveries/");
};

export const handleBotApi = async (context: BotHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    ok,
    toApiError,
    requireAdmin,
    readJsonBody,
    appendAudit,
    getBearerToken,
    getRuntimeConfig,
  } = context;

  if (method === "GET" && path === "bot/templates") {
    requireAdmin(event);
    return ok({ items: listBotTemplates(store) });
  }

  if (method === "POST" && path === "bot/templates") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ id?: string; key?: string; title?: string; body?: string; enabled?: boolean }>(event);
    const template = saveBotTemplate(store, body);
    if (!template) {
      return toApiError(400, "BOT_TEMPLATE_INVALID", "模板需要 key/title/body");
    }
    appendAudit("bot_template_save", user.userId, { templateId: template.id, key: template.key });
    return ok({ template });
  }

  if (method === "POST" && path === "bot/jobs/trigger-next-day") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ rainy?: boolean; date?: string }>(event);
    const result = triggerNextDayBotJob(store, user.userId, body);
    appendAudit("bot_job_trigger_next_day", user.userId, { jobId: result.job.id, userCount: result.userCount });
    return ok({ job: result.job });
  }

  if (method === "POST" && path === "bot/jobs/heartbeat") {
    const body = await readJsonBody<{
      timezone?: string;
      nowIso?: string;
      rainy?: boolean;
      force?: boolean;
      dryRun?: boolean;
      runNextDay?: boolean;
    }>(event);
    const config = getRuntimeConfig(event);
    const deliveryQueue = resolveReminderDeliveryQueue(config.reminderDeliveryQueue);
    const heartbeatToken = asString(getHeader(event, HEARTBEAT_TOKEN_HEADER));
    const configuredHeartbeatToken = asString(config.heartbeatToken);
    const hasBearerAuth = Boolean(getBearerToken(event));
    const db = resolveReminderDbFromEvent(event);
    if (!db) {
      return toApiError(500, "REMINDER_DB_NOT_CONFIGURED", "提醒数据库未配置");
    }

    let caller: "cron" | "admin" = "cron";
    let actorUserId = store.users.find((item) => item.adminRole === "super_admin")?.userId || store.users[0]?.userId || "system_cron";
    if (configuredHeartbeatToken) {
      if (heartbeatToken === configuredHeartbeatToken) {
        caller = "cron";
      } else if (heartbeatToken && heartbeatToken !== configuredHeartbeatToken && !hasBearerAuth) {
        return toApiError(401, "HEARTBEAT_TOKEN_INVALID", "heartbeat token 无效");
      } else {
        const adminContext = requireAdmin(event);
        caller = "admin";
        actorUserId = adminContext.user.userId;
      }
    } else {
      const adminContext = requireAdmin(event);
      caller = "admin";
      actorUserId = adminContext.user.userId;
    }

    const timezone = asString(body.timezone || config.heartbeatTimezone || "Asia/Shanghai");
    let result;
    try {
      result = await runReminderHeartbeat(db, {
        nowIso: body.nowIso,
        timezone,
        rainy: body.rainy,
        force: body.force === true,
        dryRun: body.dryRun === true,
        runNextDay: body.runNextDay === true,
        actorUserId,
        caller,
        deliveryQueue,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "HEARTBEAT_NOW_INVALID") {
        return toApiError(400, "HEARTBEAT_NOW_INVALID", "nowIso 无效");
      }
      throw error;
    }

    if (!result.dryRun && !result.skipped) {
      appendAudit("bot_job_heartbeat", actorUserId, {
        triggerKey: result.triggerKey,
        caller,
        timezone: result.timezone,
        inWindow: result.inWindow,
        shouldRunNextDay: result.shouldRunNextDay,
        dryRun: result.dryRun,
        queuedCounts: result.queuedCounts,
      });
    }

    return ok({
      ...result,
      window: "08:00-23:59",
    });
  }

  if (method === "GET" && path === "bot/deliveries/pending") {
    const config = getRuntimeConfig(event);
    const configuredToken = asString(config.botDeliveryToken);
    if (!configuredToken) {
      return toApiError(503, "BOT_DELIVERY_TOKEN_NOT_CONFIGURED", "机器人投递 token 未配置");
    }
    if (!requireBotDeliveryToken(event, configuredToken)) {
      return toApiError(401, "BOT_DELIVERY_TOKEN_INVALID", `${getBotDeliveryTokenHeader()} 无效`);
    }
    const deliveryQueue = resolveReminderDeliveryQueue(config.reminderDeliveryQueue);
    const db = resolveReminderDbFromEvent(event);
    if (!db && deliveryQueue === "legacy") {
      return toApiError(500, "REMINDER_DB_NOT_CONFIGURED", "提醒数据库未配置");
    }
    const limit = parseBotLimit(query.limit, 20);
    const items =
      deliveryQueue === "notification"
        ? pullPendingNotificationReminderDeliveries(store, { limit })
        : await pullPendingReminderDeliveries(db!, { limit });
    return ok({ items, total: items.length, limit });
  }

  const botDeliveryAckMatch = path.match(/^bot\/deliveries\/([^/]+)\/ack$/);
  if (method === "POST" && botDeliveryAckMatch) {
    const config = getRuntimeConfig(event);
    const configuredToken = asString(config.botDeliveryToken);
    if (!configuredToken) {
      return toApiError(503, "BOT_DELIVERY_TOKEN_NOT_CONFIGURED", "机器人投递 token 未配置");
    }
    if (!requireBotDeliveryToken(event, configuredToken)) {
      return toApiError(401, "BOT_DELIVERY_TOKEN_INVALID", `${getBotDeliveryTokenHeader()} 无效`);
    }
    const deliveryQueue = resolveReminderDeliveryQueue(config.reminderDeliveryQueue);
    const db = resolveReminderDbFromEvent(event);
    if (!db && deliveryQueue === "legacy") {
      return toApiError(500, "REMINDER_DB_NOT_CONFIGURED", "提醒数据库未配置");
    }
    const body = await readJsonBody<{
      success?: boolean;
      status?: "sent" | "failed";
      externalMessageId?: string;
      errorMessage?: string;
    }>(event);
    const deliveryId = decodeURIComponent(botDeliveryAckMatch[1]);
    const updated =
      deliveryQueue === "notification"
        ? ackNotificationReminderDelivery(store, deliveryId, body)
        : await ackReminderDelivery(db!, deliveryId, body);
    if (!updated) {
      return toApiError(404, "BOT_DELIVERY_NOT_FOUND", "待发送消息不存在");
    }
    return ok({ deliveryId, status: body.status || (body.success === false ? "failed" : "sent") });
  }

  if (method === "GET" && path === "bot/jobs/history") {
    requireAdmin(event);
    const { limit } = parsePagination(query);
    return ok(listBotJobHistory(store, { limit }));
  }

  return null;
};
