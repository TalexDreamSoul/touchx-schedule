import Taro from "@tarojs/taro";

export const TOUCHX_API_BASE_URL = "https://schedule.wc1.tagzxia.com/api/v1";
const TOKEN_KEY = "touchx_miniapp_session_token_v1";
const USER_KEY = "touchx_miniapp_user_v1";

export interface MiniappApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

export const getSessionToken = () => String(Taro.getStorageSync(TOKEN_KEY) || "").trim();
export const setSessionToken = (token: string) => Taro.setStorageSync(TOKEN_KEY, token);
export const clearSessionToken = () => Taro.removeStorageSync(TOKEN_KEY);

export const getStoredUser = <T = unknown>() => Taro.getStorageSync(USER_KEY) as T | "";
export const setStoredUser = (user: unknown) => Taro.setStorageSync(USER_KEY, user);
export const clearStoredUser = () => Taro.removeStorageSync(USER_KEY);

export async function request<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; auth?: boolean } = {}) {
  const token = getSessionToken();
  const response = await Taro.request<MiniappApiEnvelope<T>>({
    url: `${TOUCHX_API_BASE_URL}/${path.replace(/^\/+/, "")}`,
    method: options.method || "GET",
    data: options.body,
    header: {
      "content-type": "application/json",
      ...(options.auth !== false && token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload = response.data;
  if (response.statusCode < 200 || response.statusCode >= 300 || !payload?.ok) {
    throw new Error(payload?.error?.message || `请求失败 ${response.statusCode}`);
  }
  return payload.data as T;
}

export function mockLogin(input: { studentNo: string; nickname?: string; classLabel?: string }) {
  return request<{ sessionToken: string; expiresAt: number; user: unknown }>("auth/login", {
    method: "POST",
    auth: false,
    body: input,
  });
}

export function listMyEffectiveCalendar(params: { week?: number; date?: string } = {}) {
  const query = new URLSearchParams();
  if (params.week) query.set("week", String(params.week));
  if (params.date) query.set("date", params.date);
  return request<{ items: any[]; total: number }>(`calendar/me/effective${query.toString() ? `?${query}` : ""}`);
}

export function listCalendarSources() {
  return request<{ items: any[]; total: number }>("calendar/sources", { auth: false });
}
