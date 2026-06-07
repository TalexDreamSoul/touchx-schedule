import { createTouchXApiClient, resolveTouchXApiBaseUrl, type ApiRequestOptions } from "@touchx/api-client";
import type {
  CalendarSettings,
  CalendarSourceRow,
  CalendarSubscriptionRow,
  EffectiveCalendarItem,
  NotificationBindingRow,
  PersonalEventRow,
  ReminderRuleRow,
  TouchXAuthSession,
  TouchXTodayBrief,
  TouchXUser,
} from "@touchx/api-client";

export const TOUCHX_API_BASE_URL = resolveTouchXApiBaseUrl({
  envKeys: ["REACT_NATIVE_TOUCHX_API_BASE_URL"],
});
export type MiniappUser = TouchXUser;
export type AuthSession = TouchXAuthSession;
export type {
  CalendarSettings,
  CalendarSourceRow,
  CalendarSubscriptionRow,
  EffectiveCalendarItem,
  NotificationBindingRow,
  PersonalEventRow,
  ReminderRuleRow,
  TouchXTodayBrief,
};

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

const apiClient = createTouchXApiClient({
  baseUrl: TOUCHX_API_BASE_URL,
  token: getSessionToken,
  fetcher: fetch,
});

export function request<T>(path: string, options: ApiRequestOptions = {}) {
  return apiClient.request<T>(path, options);
}

export function register(input: { accountName: string; password: string; confirmPassword?: string; name?: string; nickname?: string }) {
  return apiClient.register(input);
}

export function login(input: { accountName?: string; username?: string; password?: string; studentNo?: string; name?: string; nickname?: string; classLabel?: string }) {
  return apiClient.login(input);
}

export function updateAuthProfile(input: { nickname?: string; name?: string; avatarUrl?: string; wallpaperUrl?: string; password?: string; oldPassword?: string }) {
  return apiClient.updateAuthProfile(input);
}

export function getAuthMe() {
  return apiClient.getAuthMe();
}

export function logout() {
  return apiClient.logout();
}

export function listMyEffectiveCalendar(params: { week?: number; date?: string } = {}) {
  return apiClient.listMyEffectiveCalendar(params) as Promise<{ week?: number; items: EffectiveCalendarItem[]; total: number }>;
}

export function getTodayBrief() {
  return apiClient.getTodayBrief();
}

export function listCalendarSources() {
  return apiClient.request<{ items: CalendarSourceRow[]; total: number }>("calendar/sources", { auth: false });
}

export function subscribeCalendarSource(sourceId: string) {
  return apiClient.subscribeCalendarSource(sourceId);
}

export function cancelCalendarSubscription(subscriptionId: string) {
  return apiClient.cancelCalendarSubscription(subscriptionId);
}

export function listMyCalendarSubscriptions() {
  return apiClient.listMyCalendarSubscriptions();
}

export function listMyReminderRules() {
  return apiClient.listMyReminderRules();
}

export function upsertMyReminderRule(input: Partial<ReminderRuleRow>) {
  return apiClient.upsertMyReminderRule(input);
}

export function getCalendarSettings() {
  return apiClient.getCalendarSettings() as Promise<CalendarSettings>;
}

export function updateCalendarSettings(input: { reminderEnabled?: boolean; reminderWindowMinutes?: number[]; nickname?: string }) {
  return apiClient.updateCalendarSettings(input);
}

export function listNotificationBindings() {
  return apiClient.listNotificationBindings();
}

export function createWechatClawDBotBindingQr() {
  return apiClient.createWechatClawDBotBindingQr();
}

export function unbindWechatClawDBot() {
  return apiClient.unbindWechatClawDBot();
}

export function listPersonalEvents() {
  return apiClient.listPersonalEvents();
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
  return apiClient.createPersonalEvent(input);
}

export function markPersonalEventDone(eventId: string) {
  return apiClient.markPersonalEventDone(eventId);
}

export function archivePersonalEvent(eventId: string) {
  return apiClient.archivePersonalEvent(eventId);
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
  return apiClient.upsertCalendarSource(input);
}
