import { createError, getHeader, getRequestURL, H3Event, readBody } from "h3";
import type { ApiEnvelope, ApiErrorPayload } from "@touchx/shared";
import { getNexusStore, type AuthSessionRecord, type UserRecord } from "../services/domain-store";
import { resolveSignedSession } from "./session-token";

const createRequestId = () => {
  return `req_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
};

const withMeta = <T>(payload: Omit<ApiEnvelope<T>, "meta">): ApiEnvelope<T> => {
  return {
    ...payload,
    meta: {
      requestId: createRequestId(),
      schemaVersion: "v1",
    },
  };
};

export const ok = <T>(data: T): ApiEnvelope<T> => {
  return withMeta({ ok: true, data });
};

export const fail = (error: ApiErrorPayload): ApiEnvelope => {
  return withMeta({ ok: false, error });
};

export const toApiError = (statusCode: number, code: string, message: string, details?: unknown): never => {
  throw createError({
    statusCode,
    statusMessage: message,
    data: fail({
      code,
      message,
      details,
    }),
  });
};

export const normalizeRoutePath = (event: H3Event) => {
  const pathname = getRequestURL(event).pathname;
  if (pathname.startsWith("/api/v1/")) {
    return pathname.slice("/api/v1/".length);
  }
  if (pathname === "/api/v1") {
    return "";
  }
  if (pathname.startsWith("/api/")) {
    return pathname.slice("/api/".length);
  }
  return pathname.replace(/^\/+/, "");
};

export const readJsonBody = async <T>(event: H3Event) => {
  const payload = await readBody<T>(event);
  return payload || ({} as T);
};

export const getBearerToken = (event: H3Event) => {
  const authHeader = String(getHeader(event, "authorization") || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice("bearer ".length).trim();
};

interface ResolvedSessionWithHint {
  session: AuthSessionRecord;
  studentNoHint: string;
}

const resolveSession = (event: H3Event, token: string): ResolvedSessionWithHint | null => {
  const signedSession = resolveSignedSession(event, token);
  if (!signedSession) {
    return null;
  }
  return {
    session: signedSession.session,
    studentNoHint: signedSession.studentNo,
  };
};

const resolveUserBySession = (resolved: ResolvedSessionWithHint | null) => {
  if (!resolved) {
    return null;
  }
  const store = getNexusStore();
  const studentNoHint = String(resolved.studentNoHint || "").trim();
  if (studentNoHint) {
    const byStudentNo = store.users.find((item) => item.studentNo === studentNoHint) || null;
    if (byStudentNo) {
      return byStudentNo;
    }
  }
  return store.users.find((item) => item.userId === resolved.session.userId) || null;
};

export const requireUser = (event: H3Event): { session: AuthSessionRecord; user: UserRecord } => {
  const token = getBearerToken(event);
  if (!token) {
    return toApiError(401, "AUTH_MISSING", "未登录或登录已失效");
  }
  const resolved = resolveSession(event, token);
  if (!resolved) {
    return toApiError(401, "AUTH_INVALID", "未登录或登录已失效");
  }
  const user = resolveUserBySession(resolved);
  if (!user) {
    return toApiError(401, "AUTH_USER_NOT_FOUND", "用户不存在或登录态失效");
  }
  return { session: resolved.session, user };
};

export const requireAdmin = (event: H3Event): { session: AuthSessionRecord; user: UserRecord } => {
  const token = getBearerToken(event);
  if (!token) {
    return toApiError(401, "ADMIN_AUTH_MISSING", "管理员未登录");
  }
  const resolved = resolveSession(event, token);
  if (!resolved || resolved.session.role !== "admin") {
    return toApiError(401, "ADMIN_AUTH_INVALID", "管理员未登录");
  }
  const user = resolveUserBySession(resolved);
  if (!user) {
    return toApiError(401, "ADMIN_USER_NOT_FOUND", "管理员账号无效");
  }
  return { session: resolved.session, user };
};

export const resolveSessionWithUser = (event: H3Event): { session: AuthSessionRecord; user: UserRecord } | null => {
  const token = getBearerToken(event);
  if (!token) {
    return null;
  }
  const resolved = resolveSession(event, token);
  if (!resolved) {
    return null;
  }
  const user = resolveUserBySession(resolved);
  if (!user) {
    return null;
  }
  return { session: resolved.session, user };
};
