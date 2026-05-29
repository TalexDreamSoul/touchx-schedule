import Taro from "@tarojs/taro";

export const TOUCHX_API_BASE_URL = "https://schedule.wc1.tagzxia.com/api/v1";
const TOKEN_KEY = "touchx_miniapp_session_token_v1";
const USER_KEY = "touchx_miniapp_user_v1";

export interface MiniappApiEnvelope<T> {
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

export function register(input: { accountName: string; password: string; confirmPassword?: string; name?: string; nickname?: string }) {
  return request<AuthSession>("auth/register", {
    method: "POST",
    auth: false,
    body: input,
  });
}

export function login(input: { accountName?: string; username?: string; password?: string; studentNo?: string; name?: string; nickname?: string; classLabel?: string }) {
  return request<AuthSession>("auth/login", {
    method: "POST",
    auth: false,
    body: input,
  });
}

export function updateAuthProfile(input: { nickname?: string; name?: string; avatarUrl?: string; wallpaperUrl?: string; password?: string; oldPassword?: string }) {
  return request<{ user: MiniappUser }>("auth/profile", {
    method: "POST",
    body: input,
  });
}

export function getAuthMe() {
  return request<{ mode?: string; role?: string; expiresAt?: number; user: MiniappUser }>("auth/me");
}

export function logout() {
  return request<{ loggedOut?: boolean }>("auth/logout", { method: "POST" });
}

export function listMyEffectiveCalendar(params: { week?: number; date?: string } = {}) {
  const query = new URLSearchParams();
  if (params.week) query.set("week", String(params.week));
  if (params.date) query.set("date", params.date);
  return request<{ week?: number; items: EffectiveCalendarItem[]; total: number }>(`calendar/me/effective${query.toString() ? `?${query}` : ""}`);
}

export function listCalendarSources() {
  return request<{ items: CalendarSourceRow[]; total: number }>("calendar/sources", { auth: false });
}

export function subscribeCalendarSource(sourceId: string) {
  return request<{ subscription: CalendarSubscriptionRow; duplicated?: boolean }>(`calendar/sources/${encodeURIComponent(sourceId)}/subscribe`, {
    method: "POST",
  });
}

export function cancelCalendarSubscription(subscriptionId: string) {
  return request<{ cancelled: boolean; subscriptionId: string }>(`calendar/me/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: "POST",
  });
}

export function listMyCalendarSubscriptions() {
  return request<{ items: CalendarSubscriptionRow[]; total: number }>("calendar/me/subscriptions");
}

export function listMyReminderRules() {
  return request<{ items: ReminderRuleRow[]; total: number }>("calendar/me/reminder-rules");
}

export function upsertMyReminderRule(input: Partial<ReminderRuleRow>) {
  return request<{ item: ReminderRuleRow }>("calendar/me/reminder-rules", {
    method: "POST",
    body: input,
  });
}

export function deleteMyReminderRule(ruleId: string) {
  return request<{ item?: ReminderRuleRow }>(`calendar/me/reminder-rules/${encodeURIComponent(ruleId)}/delete`, {
    method: "POST",
  });
}

export function getCalendarSettings() {
  return request<{ reminderEnabled: boolean; reminderWindowMinutes: number[]; defaultViewMode?: string; showWeekends?: boolean; syncToSystemCalendar?: boolean }>("calendar/me/settings");
}

export function updateCalendarSettings(input: { reminderEnabled?: boolean; reminderWindowMinutes?: number[]; nickname?: string }) {
  return request<{ user: MiniappUser }>("calendar/me/settings", {
    method: "POST",
    body: input,
  });
}

export function listNotificationBindings() {
  return request<{ items: NotificationBindingRow[]; total: number }>("calendar/me/notification-bindings");
}

export function createWechatClawDBotBindingQr() {
  return request<{ bindingToken: string; expiresAt: string; qrPayload: string; qrImageUrl: string; binding?: NotificationBindingRow }>("calendar/me/notification-bindings/wechat-clawdbot/qr", {
    method: "POST",
  });
}

export function unbindWechatClawDBot() {
  return request<{ unbound: boolean }>("calendar/me/notification-bindings/wechat-clawdbot/unbind", {
    method: "POST",
  });
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
  return request<{ item: PersonalEventRow }>("calendar/me/personal-events", {
    method: "POST",
    body: input,
  });
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
  return request<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}`, {
    method: "POST",
    body: input,
  });
}

export function markPersonalEventDone(eventId: string) {
  return request<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}/done`, {
    method: "POST",
  });
}

export function archivePersonalEvent(eventId: string) {
  return request<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}/delete`, {
    method: "POST",
  });
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
