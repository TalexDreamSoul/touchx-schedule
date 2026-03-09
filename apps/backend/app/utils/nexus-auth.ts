export const NEXUS_SESSION_STORAGE_KEY = "touchx_nexus_admin_session_v1";
export const NEXUS_SESSION_COOKIE_KEY = "touchx_nexus_admin_session_v1_cookie";

const normalizeToken = (value: unknown) => {
  return String(value || "").trim();
};

const getSessionCookie = () => {
  return useCookie<string | null>(NEXUS_SESSION_COOKIE_KEY, {
    sameSite: "lax",
    path: "/",
    default: () => null,
  });
};

export const getNexusSessionToken = () => {
  const cookie = getSessionCookie();
  const cookieToken = normalizeToken(cookie.value);
  if (import.meta.client) {
    const localToken = normalizeToken(localStorage.getItem(NEXUS_SESSION_STORAGE_KEY));
    if (localToken) {
      if (!cookieToken || cookieToken !== localToken) {
        cookie.value = localToken;
      }
      return localToken;
    }
    if (cookieToken) {
      localStorage.setItem(NEXUS_SESSION_STORAGE_KEY, cookieToken);
      return cookieToken;
    }
    return "";
  }
  return cookieToken;
};

export const setNexusSessionToken = (token: string) => {
  const normalized = normalizeToken(token);
  const cookie = getSessionCookie();
  cookie.value = normalized || null;
  if (import.meta.client) {
    if (normalized) {
      localStorage.setItem(NEXUS_SESSION_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(NEXUS_SESSION_STORAGE_KEY);
    }
  }
};

export const clearNexusSessionToken = () => {
  setNexusSessionToken("");
};

export const resolveNexusRedirectPath = (rawTarget: unknown, fallback = "/nexus") => {
  const target = String(rawTarget || "").trim();
  if (!target) {
    return fallback;
  }
  if (!target.startsWith("/") || target.startsWith("//")) {
    return fallback;
  }
  if (!target.startsWith("/nexus")) {
    return fallback;
  }
  return target;
};

export const buildNexusLoginPath = (redirectPath?: string) => {
  const redirect = resolveNexusRedirectPath(redirectPath, "/nexus");
  if (redirect === "/nexus") {
    return "/nexus/login";
  }
  return `/nexus/login?redirect=${encodeURIComponent(redirect)}`;
};
