import { getMethod, getQuery, getRequestURL, H3Event, setResponseStatus } from "h3";
import {
  getNexusStore,
  resetNexusStore,
  storeHelpers,
} from "./domain-store";
import {
  appendV1Audit as appendAudit,
  normalizeReminderOffsets,
  toV1UserPayload as toUserPayload,
} from "./v1-api-context";
import {
  fail,
  getBearerToken,
  normalizeRoutePath,
  ok,
  readJsonBody,
  requireAdmin,
  requireUser,
  resolveSessionWithUser,
  toApiError,
} from "../utils/api-envelope";
import { handleSocialV1Api } from "./social-v1-api";
import { handleCoreAuthApi, isCoreAuthPath } from "../modules/auth/auth-handler";
import { handleCalendarUserApi, isCalendarUserPath } from "../modules/calendar/calendar-user-handler";
import { handleNotificationAdminApi } from "../modules/notification/notification-admin-handler";
import { handleNotificationBindingUserApi, isNotificationBindingUserPath } from "../modules/notification/notification-binding-user-handler";
import { handleReminderUserApi } from "../modules/notification/reminder-user-handler";
import { handleImportApi, isImportPath } from "../modules/import/import-handler";
import { handleAdminDashboardApi, isAdminDashboardPath } from "../modules/admin/admin-dashboard-handler";
import { handleAdminUserApi, isAdminUserPath } from "../modules/admin/admin-user-handler";
import { handleAdminPreviewApi, isAdminPreviewPath } from "../modules/admin/admin-preview-handler";
import { handleAdminAuditApi, isAdminAuditPath } from "../modules/admin/admin-audit-handler";
import { handleScheduleClassApi, isScheduleClassPath } from "../modules/schedule/schedule-class-handler";
import { handleMediaApi, isMediaPath } from "../modules/media/media-handler";
import { handleBotApi, isBotPath } from "../modules/bot/bot-handler";
import { handleCalendarIcsApi, isCalendarIcsPath } from "../modules/calendar/calendar-ics-handler";
import { handlePartyGameApi, isPartyGamePath } from "../modules/party-game/party-game-handler";
import { handleFoodApi, isFoodPath } from "../modules/food/food-handler";
import { handleDevApi, isDevPath } from "../modules/dev/dev-handler";

const asString = (value: unknown) => String(value || "").trim();

const isSocialCompatPath = (path: string) => {
  return (
    path.startsWith("social/") ||
    path.startsWith("notifications") ||
    path.startsWith("ai/") ||
    path.startsWith("bot/clawdbot/") ||
    path.startsWith("exams/") ||
    path === "calendar/views" ||
    path.startsWith("schedule-import/corrections") ||
    path.startsWith("admin/food-candidates") ||
    path === "auth/wechat-login" ||
    path === "auth/unbind" ||
    path === "today-brief" ||
    path === "theme-images" ||
    path === "schedules/student"
  );
};

const isNotificationAdminPath = (path: string) => {
  return (
    path.startsWith("admin/notification-channels") ||
    path.startsWith("admin/notification-bindings") ||
    path.startsWith("admin/notification-deliveries") ||
    path.startsWith("admin/reminder-rules")
  );
};

const isReminderUserPath = (path: string) => {
  return path.startsWith("calendar/me/reminder-rules") || path.startsWith("calendar/me/reminder-candidates");
};

export const handleV1Api = async (event: H3Event) => {
  const pathname = getRequestURL(event).pathname;
  const isExplicitV1Path = pathname === "/api/v1" || pathname.startsWith("/api/v1/");
  if (!isExplicitV1Path) {
    return toApiError(410, "API_V1_REQUIRED", "请使用 /api/v1/* 接口");
  }

  const requestPath = normalizeRoutePath(event);
  const path = requestPath.replace(/^\/+/, "");
  if (isSocialCompatPath(path)) {
    const socialResponse = await handleSocialV1Api(event);
    if (socialResponse) {
      return socialResponse;
    }
  }
  const method = getMethod(event).toUpperCase();
  const query = getQuery(event);
  const store = getNexusStore();

  if (method === "GET" && path === "") {
    return ok({
      service: "touchx-backend",
      mode: "api-v1",
      apiBase: "/api/v1",
      nexus: "/nexus",
      timestamp: storeHelpers.nowIso(),
    });
  }

  if (isDevPath(path)) {
    const devResponse = await handleDevApi({
      event,
      method,
      path,
      ok,
      requireAdmin,
      resetStore: resetNexusStore,
      appendAudit,
    });
    if (devResponse) {
      return devResponse;
    }
  }

  if (isCoreAuthPath(path)) {
    const authResponse = await handleCoreAuthApi({
      event,
      method,
      path,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      readJsonBody,
      appendAudit,
      getBearerToken,
      getRuntimeConfig: useRuntimeConfig,
      toUserPayload,
    });
    if (authResponse) {
      return authResponse;
    }
  }

  if (isAdminDashboardPath(path)) {
    const adminDashboardResponse = await handleAdminDashboardApi({
      event,
      method,
      path,
      store,
      ok,
      requireAdmin,
    });
    if (adminDashboardResponse) {
      return adminDashboardResponse;
    }
  }

  if (isAdminUserPath(path)) {
    const adminUserResponse = await handleAdminUserApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireAdmin,
      readJsonBody,
      appendAudit,
    });
    if (adminUserResponse) {
      return adminUserResponse;
    }
  }

  if (isCalendarUserPath(path)) {
    const calendarUserResponse = await handleCalendarUserApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      resolveSessionWithUser,
      readJsonBody,
      appendAudit,
      toUserPayload,
      normalizeReminderOffsets,
    });
    if (calendarUserResponse) {
      return calendarUserResponse;
    }
  }

  if (isNotificationBindingUserPath(path)) {
    const notificationBindingUserResponse = await handleNotificationBindingUserApi({
      event,
      method,
      path,
      store,
      ok,
      requireUser,
      appendAudit,
    });
    if (notificationBindingUserResponse) {
      return notificationBindingUserResponse;
    }
  }

  if (isReminderUserPath(path)) {
    const reminderUserResponse = await handleReminderUserApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireUser,
      readJsonBody,
      appendAudit,
    });
    if (reminderUserResponse) {
      return reminderUserResponse;
    }
  }

  if (isNotificationAdminPath(path)) {
    const notificationAdminResponse = await handleNotificationAdminApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireAdmin,
      readJsonBody,
      appendAudit,
    });
    if (notificationAdminResponse) {
      return notificationAdminResponse;
    }
  }

  if (isImportPath(path)) {
    const importResponse = await handleImportApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      resolveSessionWithUser,
      readJsonBody,
      appendAudit,
    });
    if (importResponse) {
      return importResponse;
    }
  }

  if (isScheduleClassPath(path)) {
    const scheduleClassResponse = await handleScheduleClassApi({
      event,
      method,
      path,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      readJsonBody,
      appendAudit,
    });
    if (scheduleClassResponse) {
      return scheduleClassResponse;
    }
  }

  if (isMediaPath(path)) {
    const mediaResponse = await handleMediaApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      readJsonBody,
      appendAudit,
      toUserPayload,
    });
    if (mediaResponse) {
      return mediaResponse;
    }
  }

  if (isBotPath(path)) {
    const botResponse = await handleBotApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireAdmin,
      readJsonBody,
      appendAudit,
      getBearerToken,
      getRuntimeConfig: useRuntimeConfig,
    });
    if (botResponse) {
      return botResponse;
    }
  }

  if (isCalendarIcsPath(path)) {
    const calendarIcsResponse = await handleCalendarIcsApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      toApiError,
      requireUser,
    });
    if (calendarIcsResponse) {
      return calendarIcsResponse;
    }
  }

  if (isPartyGamePath(path)) {
    const partyGameResponse = await handlePartyGameApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      readJsonBody,
      appendAudit,
    });
    if (partyGameResponse) {
      return partyGameResponse;
    }
  }

  if (isFoodPath(path)) {
    const foodResponse = await handleFoodApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireUser,
      requireAdmin,
      readJsonBody,
      appendAudit,
    });
    if (foodResponse) {
      return foodResponse;
    }
  }

  if (isAdminPreviewPath(path)) {
    const adminPreviewResponse = await handleAdminPreviewApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      toApiError,
      requireAdmin,
      resolveSessionWithUser,
      readJsonBody,
      appendAudit,
      toUserPayload,
    });
    if (adminPreviewResponse) {
      return adminPreviewResponse;
    }
  }

  if (isAdminAuditPath(path)) {
    const adminAuditResponse = await handleAdminAuditApi({
      event,
      method,
      path,
      query: query as Record<string, unknown>,
      store,
      ok,
      requireAdmin,
    });
    if (adminAuditResponse) {
      return adminAuditResponse;
    }
  }

  return toApiError(404, "API_ROUTE_NOT_FOUND", `未匹配 API 路由: ${method} ${path}`);
};

export const handleV1ApiWithErrorBoundary = async (event: H3Event) => {
  try {
    return await handleV1Api(event);
  } catch (error) {
    const candidate = error as {
      statusCode?: number;
      statusMessage?: string;
      message?: string;
      data?: { message?: string; detail?: string; error?: { message?: string } };
    };
    const statusCode = Number(candidate?.statusCode || 500);
    if (candidate?.data) {
      setResponseStatus(event, statusCode);
      return candidate.data;
    }
    const message =
      asString(candidate?.message) ||
      asString(candidate?.statusMessage) ||
      asString(candidate?.data?.message) ||
      asString(candidate?.data?.detail) ||
      asString(candidate?.data?.error?.message) ||
      "服务器内部错误";
    setResponseStatus(event, statusCode);
    return fail({
      code: statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED",
      message,
      details: {
        path: getRequestURL(event).pathname,
      },
    });
  }
};
