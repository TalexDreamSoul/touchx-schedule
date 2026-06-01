import { createError, getRequestURL, type H3Event } from "h3";
import { storeHelpers, type NexusStore, type UserRecord } from "../../services/domain-store";
import { getBearerToken, normalizeRoutePath, resolveSessionWithUser } from "../../utils/api-envelope";
import { createSignedSession } from "../../utils/session-token";
import { SCHEDULE_DEFAULT_TIMEZONE, toDateTimeParts } from "../../services/schedule-calendar";

const asString = (value: unknown) => String(value || "").trim();

export const createLegacyError = (statusCode: number, code: string, message: string): never => {
  throw createError({
    statusCode,
    statusMessage: message,
    data: {
      ok: false,
      code,
      message,
      detail: message,
    },
  });
};

const ensureValue = <T>(value: T | null | undefined, statusCode: number, code: string, message: string): T => {
  if (value === null || value === undefined) {
    createLegacyError(statusCode, code, message);
  }
  return value as T;
};

export const createLegacySession = (event: H3Event, user: UserRecord, role: "admin" | "user", ttlHours = 24 * 14) => {
  return createSignedSession(event, user, role, ttlHours);
};

export const registerLegacySession = (store: NexusStore, session: { token: string; expiresAt: number; role?: "admin" | "user" }, user: UserRecord) => {
  const normalizedToken = asString(session.token);
  if (!normalizedToken) {
    return;
  }
  const now = Date.now();
  store.sessions = [
    {
      token: normalizedToken,
      userId: user.userId,
      role: session.role || "user",
      expiresAt: session.expiresAt,
      createdAt: storeHelpers.nowIso(),
    },
    ...store.sessions.filter((item) => item.token !== normalizedToken && item.expiresAt > now),
  ]
    .sort((left, right) => right.expiresAt - left.expiresAt)
    .slice(0, 1000);
};

export const revokeLegacySession = (store: NexusStore, token: string) => {
  const normalizedToken = asString(token);
  if (!normalizedToken) {
    return;
  }
  const nowIso = storeHelpers.nowIso();
  const existing = store.sessions.find((item) => item.token === normalizedToken) || null;
  if (existing) {
    existing.revokedAt = nowIso;
    return;
  }
  store.sessions.unshift({
    token: normalizedToken,
    userId: "",
    role: "user",
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    createdAt: nowIso,
    revokedAt: nowIso,
  });
  if (store.sessions.length > 1000) {
    store.sessions.length = 1000;
  }
};

export const resolveLegacyAuthContext = (event: H3Event) => {
  const token = getBearerToken(event);
  if (!token) {
    createLegacyError(401, "AUTH_MISSING", "未登录或登录已失效");
  }
  const resolved = ensureValue(
    resolveSessionWithUser(event),
    401,
    "AUTH_INVALID",
    "未登录或登录已失效",
  );
  return {
    token,
    session: resolved.session,
    user: resolved.user,
  };
};

export const resolveCloudflareEnv = (event: H3Event): Record<string, unknown> => {
  const processEnv = typeof process !== "undefined" ? process.env : {};
  const env = (event.context as { cloudflare?: { env?: Record<string, unknown> } }).cloudflare?.env;
  return {
    ...processEnv,
    ...(env && typeof env === "object" ? env : {}),
  };
};

export const resolveAbsoluteRequestUrl = (event: H3Event, url: string) => {
  const value = asString(url);
  if (!value || /^https?:\/\//i.test(value)) {
    return value;
  }
  if (!value.startsWith("/")) {
    return value;
  }
  return `${getRequestURL(event).origin}${value}`;
};

export const appendLegacyAudit = (store: NexusStore, action: string, actorUserId: string, payload: Record<string, unknown>) => {
  store.auditLogs.unshift({
    id: storeHelpers.createId("audit"),
    action,
    actorUserId,
    payload,
    createdAt: storeHelpers.nowIso(),
  });
  if (store.auditLogs.length > 2000) {
    store.auditLogs.length = 2000;
  }
};

export const extractExamDateFromText = (text: unknown) => {
  const normalized = asString(text);
  if (!/(考试|期末|期中|补考|考后)/.test(normalized)) {
    return "";
  }
  const fullDate = normalized.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (fullDate) {
    const year = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const day = Number(fullDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const shortDate = normalized.match(/(\d{1,2})[-/.月](\d{1,2})日?/);
  if (shortDate) {
    const currentYear = toDateTimeParts(new Date(), SCHEDULE_DEFAULT_TIMEZONE).year || new Date().getFullYear();
    const month = Number(shortDate[1]);
    const day = Number(shortDate[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${currentYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
};

export const toLegacyPath = (event: H3Event) => {
  return normalizeRoutePath(event).replace(/^\/+/, "");
};
