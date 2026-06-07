import Taro from "@tarojs/taro";
import { createTouchXApiClient, resolveTouchXApiBaseUrl, type ApiRequestOptions } from "@touchx/api-client";
import type {
  CalendarSourceRow,
  CalendarSubscriptionRow,
  CalendarSettings,
  EffectiveCalendarItem,
  NotificationBindingRow,
  PersonalEventRow,
  ReminderRuleRow,
  TouchXAuthSession,
  TouchXTodayBrief,
  TouchXUser,
} from "@touchx/api-client";

const TOKEN_KEY = "touchx_miniapp_session_token_v1";
const USER_KEY = "touchx_miniapp_user_v1";

export const TOUCHX_API_BASE_URL = resolveTouchXApiBaseUrl({
  envKeys: ["TARO_APP_TOUCHX_API_BASE_URL", "TARO_APP_API_BASE_URL"],
});

export interface MiniappApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

export type MiniappUser = TouchXUser;
export type AuthSession = TouchXAuthSession;
export type { CalendarSourceRow, CalendarSubscriptionRow, EffectiveCalendarItem, NotificationBindingRow, PersonalEventRow, ReminderRuleRow, TouchXTodayBrief };

export interface PdfImportPreviewResult {
  jobId: string;
  fileName: string;
  parsedName?: string;
  parsedStudentNo?: string;
  previewEntries: Array<{
    previewEntryId: string;
    courseName: string;
    day: number;
    startSection: number;
    endSection: number;
    weekExpr: string;
    classroom?: string;
    teacher?: string;
  }>;
  total: number;
}

export const getSessionToken = () => String(Taro.getStorageSync(TOKEN_KEY) || "").trim();
export const setSessionToken = (token: string) => Taro.setStorageSync(TOKEN_KEY, token);
export const clearSessionToken = () => Taro.removeStorageSync(TOKEN_KEY);

export const getStoredUser = <T = MiniappUser>() => {
  const value = Taro.getStorageSync(USER_KEY);
  return value ? (value as T) : null;
};
export const setStoredUser = (user: unknown) => Taro.setStorageSync(USER_KEY, user);
export const clearStoredUser = () => Taro.removeStorageSync(USER_KEY);
export const clearAuthState = () => {
  clearSessionToken();
  clearStoredUser();
};

const apiClient = createTouchXApiClient({
  baseUrl: TOUCHX_API_BASE_URL,
  token: getSessionToken,
  fetcher: async (input, init = {}) => {
    const method = String(init.method || "GET").toUpperCase() as "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";
    const response = await Taro.request<unknown>({
      url: String(input),
      method,
      data: init.body ? JSON.parse(String(init.body)) : undefined,
      header: init.headers as Record<string, string>,
    });
    return {
      ok: response.statusCode >= 200 && response.statusCode < 300,
      status: response.statusCode,
      json: async () => response.data,
    } as Response;
  },
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

export function deleteMyReminderRule(ruleId: string) {
  return apiClient.deleteMyReminderRule(ruleId);
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

export function updatePersonalEvent(eventId: string, input: {
  title?: string;
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
  return apiClient.updatePersonalEvent(eventId, input);
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

export async function uploadPdfImportPreview(filePath: string, fileName = "schedule.pdf") {
  const token = getSessionToken();
  const response = await Taro.uploadFile({
    url: `${TOUCHX_API_BASE_URL}/calendar/me/pdf-import/preview`,
    filePath,
    name: "file",
    fileName,
    header: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const payload = JSON.parse(String(response.data || "{}")) as MiniappApiEnvelope<PdfImportPreviewResult>;
  if (response.statusCode < 200 || response.statusCode >= 300 || !payload?.ok) {
    throw new Error(payload?.error?.message || `上传失败 ${response.statusCode}`);
  }
  return payload.data as PdfImportPreviewResult;
}
