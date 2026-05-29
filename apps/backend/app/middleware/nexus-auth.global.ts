import { buildNexusLoginPath, getNexusSessionToken } from "../utils/nexus-auth";

export default defineNuxtRouteMiddleware((to) => {
  const isMainCmsPage = to.path === "/";
  const isNexusPage = to.path.startsWith("/nexus");
  if (!isMainCmsPage && !isNexusPage) {
    return;
  }
  if (to.path === "/nexus/login") {
    return;
  }
  const token = getNexusSessionToken();
  if (!token) {
    return navigateTo(buildNexusLoginPath(to.fullPath), { replace: true });
  }
});
