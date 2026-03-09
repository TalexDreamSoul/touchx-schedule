import { buildNexusLoginPath, getNexusSessionToken } from "../utils/nexus-auth";

export default defineNuxtRouteMiddleware((to) => {
  if (!to.path.startsWith("/nexus")) {
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
