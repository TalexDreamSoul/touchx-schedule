import { createError, getRequestURL, sendRedirect } from "h3";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const explicitOrigin = (config.adminWebOrigin || "").trim();
  const fallbackOrigin = (config.legacyApiBase || "").trim();
  const origin = (explicitOrigin || fallbackOrigin).replace(/\/+$/, "");
  if (!origin) {
    throw createError({
      statusCode: 503,
      statusMessage: "ADMIN_WEB_ORIGIN 与 LEGACY_API_BASE 均未配置，无法跳转管理后台",
    });
  }
  const requestUrl = getRequestURL(event);
  const targetUrl = `${origin}${requestUrl.pathname}${requestUrl.search}`;
  return sendRedirect(event, targetUrl, 302);
});
