import { getRequestURL, sendRedirect } from "h3";

export default defineEventHandler((event) => {
  const requestUrl = getRequestURL(event);
  const suffix = requestUrl.pathname.replace(/^\/admin/, "");
  const target = suffix ? `/nexus${suffix}` : "/nexus";
  const search = requestUrl.search || "";
  return sendRedirect(event, `${target}${search}`, 302);
});
