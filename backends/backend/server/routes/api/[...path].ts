import { createError, getMethod, getRequestHeaders, getRequestURL, readRawBody } from "h3";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const normalizeBaseUrl = (rawBaseUrl: string): string => {
  const value = (rawBaseUrl || "").trim();
  if (!value) {
    throw createError({
      statusCode: 500,
      statusMessage: "LEGACY_API_BASE 未配置",
    });
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

const buildProxyHeaders = (source: Record<string, string | undefined>): HeadersInit => {
  const nextHeaders: Record<string, string> = {};
  Object.entries(source).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase();
    if (!value || HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      return;
    }
    nextHeaders[normalizedKey] = value;
  });
  return nextHeaders;
};

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const legacyApiBase = normalizeBaseUrl(config.legacyApiBase);
  const requestUrl = getRequestURL(event);
  const method = getMethod(event).toUpperCase();
  const upstreamUrl = `${legacyApiBase}${requestUrl.pathname}${requestUrl.search}`;
  const headers = buildProxyHeaders(getRequestHeaders(event));
  const canHaveBody = !["GET", "HEAD"].includes(method);
  const rawBody = canHaveBody ? await readRawBody(event, false) : undefined;
  const requestBody = rawBody ? new Uint8Array(rawBody) : undefined;

  try {
    return await fetch(upstreamUrl, {
      method,
      headers,
      body: requestBody ?? undefined,
      redirect: "manual",
    });
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "legacy-fastapi 网关不可达",
    });
  }
});
