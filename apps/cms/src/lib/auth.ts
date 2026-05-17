export const NEXUS_SESSION_STORAGE_KEY = "touchx_nexus_admin_session_v1";

export const getSessionToken = () => localStorage.getItem(NEXUS_SESSION_STORAGE_KEY) || "";
export const setSessionToken = (token: string) => localStorage.setItem(NEXUS_SESSION_STORAGE_KEY, token);
export const clearSessionToken = () => localStorage.removeItem(NEXUS_SESSION_STORAGE_KEY);
