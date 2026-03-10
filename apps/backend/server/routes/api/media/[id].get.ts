import { getRequestURL, getRouterParam, sendRedirect } from "h3";

export default defineEventHandler((event) => {
  const mediaId = encodeURIComponent(String(getRouterParam(event, "id") || "").trim());
  const search = getRequestURL(event).search || "";
  const target = mediaId ? `/media/${mediaId}${search}` : `/media${search}`;
  return sendRedirect(event, target, 302);
});
