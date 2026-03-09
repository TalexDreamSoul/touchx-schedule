interface ApiEnvelopeLike<T = unknown> {
  ok?: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const resolveEnvelopeErrorMessage = (payload: unknown) => {
  if (!isRecord(payload)) {
    return "";
  }
  const errorPayload = payload.error;
  if (!isRecord(errorPayload)) {
    return "";
  }
  const message = String(errorPayload.message || "").trim();
  if (message) {
    return message;
  }
  return "";
};

export const normalizeBackendApiPath = (path: string) => {
  const normalized = String(path || "").trim();
  if (!normalized) {
    return "/";
  }
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  if (withLeadingSlash === "/api/v1" || withLeadingSlash.startsWith("/api/v1/")) {
    return withLeadingSlash;
  }
  if (withLeadingSlash === "/api" || withLeadingSlash.startsWith("/api/")) {
    const suffix = withLeadingSlash.slice("/api/".length);
    return suffix ? `/api/v1/${suffix}` : "/api/v1";
  }
  return withLeadingSlash;
};

export const unwrapBackendApiPayload = <T>(payload: unknown): T => {
  if (!isRecord(payload)) {
    return payload as T;
  }
  const maybeOk = payload.ok;
  const hasEnvelopeShape = typeof maybeOk === "boolean" && ("data" in payload || "error" in payload);
  if (!hasEnvelopeShape) {
    return payload as T;
  }
  const envelope = payload as ApiEnvelopeLike<T>;
  if (envelope.ok) {
    return (envelope.data ?? ({} as T)) as T;
  }
  const errorMessage = resolveEnvelopeErrorMessage(envelope);
  throw new Error(errorMessage || "请求失败");
};

export const resolveBackendErrorMessageFromPayload = (statusCode: number, payload: unknown) => {
  const envelopeMessage = resolveEnvelopeErrorMessage(payload);
  if (envelopeMessage) {
    return envelopeMessage;
  }
  if (isRecord(payload)) {
    const detail = String(payload.detail || "").trim();
    if (detail) {
      return detail;
    }
    const message = String(payload.message || "").trim();
    if (message) {
      return message;
    }
  }
  return `HTTP ${statusCode}`;
};
