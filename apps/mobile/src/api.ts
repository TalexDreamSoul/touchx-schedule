export const TOUCHX_API_BASE_URL = "https://schedule.wc1.tagzxia.com/api/v1";

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

export interface MiniappUser {
  userId: string;
  accountName?: string;
  studentNo: string;
  studentId?: string;
  name?: string;
  nickname?: string;
  classLabel?: string;
  avatarUrl?: string;
  adminRole?: string;
  reminderEnabled?: boolean;
  reminderWindowMinutes?: number[];
}

export interface AuthSession {
  sessionToken: string;
  expiresAt: number;
  mode?: string;
  user: MiniappUser;
}

export interface EffectiveCalendarItem {
  id: string;
  originType?: string;
  originId?: string;
  sourceId?: string;
  title: string;
  description?: string;
  eventType?: "course" | "exam" | "todo" | "activity" | "holiday" | "deadline" | "custom";
  date?: string;
  weekday?: number;
  weekExpr?: string;
  parity?: string;
  startTime?: string;
  endTime?: string;
  startSection?: number;
  endSection?: number;
  location?: string;
  tags?: string[];
  reminderEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PersonalEventRow {
  id: string;
  title: string;
  description?: string;
  source?: string;
  day?: number;
  weekday?: number;
  weekExpr?: string;
  startSection?: number;
  endSection?: number;
  examDate?: string;
  priorityLabel?: "low" | "normal" | "high";
  tags?: string[];
  updatedAt?: string;
}

export interface CalendarSourceRow {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  eventCount?: number;
  subscriptionCount?: number;
  classLabel?: string;
  ownerId?: string;
  currentVersionNo?: number;
}

export interface CalendarSubscriptionRow {
  id: string;
  sourceId: string;
  sourceTitle?: string;
  sourceType?: string;
  visibility?: string;
  classLabel?: string;
}

export interface ReminderRuleRow {
  id: string;
  targetType: "subscription" | "source_event" | "personal_event" | "global";
  targetId: string;
  enabled: boolean;
  offsetMinutes: number;
  templateKey: string;
  channelStrategy: "both" | "primary_then_fallback" | "primary_only";
  quietHoursRespect: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface NotificationBindingRow {
  id: string;
  userId: string;
  channelType: "wechat_clawdbot" | "feishu";
  externalUserId: string;
  externalOpenId?: string;
  status: "active" | "disabled" | "expired";
  createdAt?: string;
  updatedAt?: string;
}

const TOKEN_KEY = "touchx_mobile_session_token_v1";
const USER_KEY = "touchx_mobile_user_v1";

type SettingsLike = {
  get?: (key: string) => unknown;
  set?: (settings: Record<string, unknown>) => void;
};

type ReactNativeWithSettings = typeof import("react-native") & { Settings?: SettingsLike };

const getSettings = (): SettingsLike | null => {
  try {
    const rn = require("react-native") as ReactNativeWithSettings;
    return rn.Settings || null;
  } catch {
    return null;
  }
};

const readSetting = (key: string) => {
  try {
    return getSettings()?.get?.(key);
  } catch {
    return null;
  }
};

const writeSetting = (key: string, value: unknown) => {
  try {
    getSettings()?.set?.({ [key]: value });
  } catch {
    // In-memory auth still works if platform settings are unavailable.
  }
};

const readStoredUser = () => {
  const raw = readSetting(USER_KEY);
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as MiniappUser;
    } catch {
      return null;
    }
  }
  return raw as MiniappUser;
};

let sessionToken = String(readSetting(TOKEN_KEY) || "").trim();
let currentUser: MiniappUser | null = readStoredUser();

export const getSessionToken = () => sessionToken;
export const setSessionToken = (token: string) => {
  sessionToken = String(token || "").trim();
  writeSetting(TOKEN_KEY, sessionToken);
};
export const getStoredUser = () => currentUser;
export const setStoredUser = (user: MiniappUser | null) => {
  currentUser = user;
  writeSetting(USER_KEY, user ? JSON.stringify(user) : "");
};
export const clearAuthState = () => {
  sessionToken = "";
  currentUser = null;
  writeSetting(TOKEN_KEY, "");
  writeSetting(USER_KEY, "");
};

const buildQueryString = (params: Record<string, string | number | undefined>) => {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
};

export async function request<T>(path: string, options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; auth?: boolean } = {}) {
  const method = options.method || "GET";
  const headers: Record<string, string> = {
    ...(method !== "GET" && options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.auth !== false && sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
  };
  const response = await fetch(`${TOUCHX_API_BASE_URL}/${path.replace(/^\/+/, "")}`, {
    method,
    headers,
    body: method === "GET" || options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || `请求失败 ${response.status}`);
  }
  return payload.data as T;
}

export function register(input: { accountName: string; password: string; confirmPassword?: string; name?: string; nickname?: string }) {
  return request<AuthSession>("auth/register", { method: "POST", auth: false, body: input });
}

export function login(input: { accountName?: string; username?: string; password?: string; studentNo?: string; name?: string; nickname?: string; classLabel?: string }) {
  return request<AuthSession>("auth/login", { method: "POST", auth: false, body: input });
}

export function updateAuthProfile(input: { nickname?: string; name?: string; avatarUrl?: string; wallpaperUrl?: string; password?: string; oldPassword?: string }) {
  return request<{ user: MiniappUser }>("auth/profile", { method: "POST", body: input });
}

export function getAuthMe() {
  return request<{ mode?: string; role?: string; expiresAt?: number; user: MiniappUser }>("auth/me");
}

export function logout() {
  return request<{ loggedOut?: boolean }>("auth/logout", { method: "POST" });
}

export function listMyEffectiveCalendar(params: { week?: number; date?: string } = {}) {
  return request<{ week?: number; items: EffectiveCalendarItem[]; total: number }>(
    `calendar/me/effective${buildQueryString({ week: params.week, date: params.date })}`,
  );
}

export function listCalendarSources() {
  return request<{ items: CalendarSourceRow[]; total: number }>("calendar/sources", { auth: false });
}

export function subscribeCalendarSource(sourceId: string) {
  return request<{ subscription: CalendarSubscriptionRow; duplicated?: boolean }>(
    `calendar/sources/${encodeURIComponent(sourceId)}/subscribe`,
    { method: "POST" },
  );
}

export function cancelCalendarSubscription(subscriptionId: string) {
  return request<{ cancelled: boolean; subscriptionId: string }>(`calendar/me/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: "POST" });
}

export function listMyCalendarSubscriptions() {
  return request<{ items: CalendarSubscriptionRow[]; total: number }>("calendar/me/subscriptions");
}

export function listMyReminderRules() {
  return request<{ items: ReminderRuleRow[]; total: number }>("calendar/me/reminder-rules");
}

export function upsertMyReminderRule(input: Partial<ReminderRuleRow>) {
  return request<{ item: ReminderRuleRow }>("calendar/me/reminder-rules", { method: "POST", body: input });
}

export function getCalendarSettings() {
  return request<{ reminderEnabled: boolean; reminderWindowMinutes: number[]; defaultViewMode?: string; showWeekends?: boolean; syncToSystemCalendar?: boolean }>("calendar/me/settings");
}

export function updateCalendarSettings(input: { reminderEnabled?: boolean; reminderWindowMinutes?: number[]; nickname?: string }) {
  return request<{ user: MiniappUser }>("calendar/me/settings", { method: "POST", body: input });
}

export function listNotificationBindings() {
  return request<{ items: NotificationBindingRow[]; total: number }>("calendar/me/notification-bindings");
}

export function createWechatClawDBotBindingQr() {
  return request<{ bindingToken: string; expiresAt: string; qrPayload: string; qrImageUrl: string; binding?: NotificationBindingRow }>("calendar/me/notification-bindings/wechat-clawdbot/qr", { method: "POST" });
}

export function unbindWechatClawDBot() {
  return request<{ unbound: boolean }>("calendar/me/notification-bindings/wechat-clawdbot/unbind", { method: "POST" });
}

export function listPersonalEvents() {
  return request<{ items: PersonalEventRow[]; total: number }>("calendar/me/personal-events");
}

export function createPersonalEvent(input: {
  title: string;
  description?: string;
  eventType?: "todo" | "exam" | "activity";
  date?: string;
  weekday?: number;
  startSection?: number;
  endSection?: number;
  weekExpr?: string;
  priority?: "low" | "normal" | "high";
  tags?: string[];
}) {
  return request<{ item: PersonalEventRow }>("calendar/me/personal-events", { method: "POST", body: input });
}

export function markPersonalEventDone(eventId: string) {
  return request<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}/done`, { method: "POST" });
}

export function archivePersonalEvent(eventId: string) {
  return request<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}/delete`, { method: "POST" });
}

export function upsertCalendarSource(input: {
  sourceId?: string;
  title: string;
  description?: string;
  type?: string;
  visibility?: string;
  publish?: boolean;
  events?: unknown[];
}) {
  return request<{ item: CalendarSourceRow }>("calendar/sources", { method: "POST", body: input });
}
