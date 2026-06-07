import type { ApiEnvelope, CalendarSource, CalendarSourceEvent, CalendarSourceVersion, EffectiveCalendarEvent, NotificationChannel } from "@touchx/shared";

export interface TouchXApiClientOptions {
  baseUrl?: string;
  token?: string | (() => string | Promise<string>);
  fetcher?: typeof fetch;
}

export interface TouchXApiBaseUrlOptions {
  defaultBaseUrl?: string;
  envKeys?: string[];
  runtime?: typeof globalThis & {
    __TOUCHX_API_BASE_URL__?: string;
    process?: { env?: Record<string, string | undefined> };
  };
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}

export interface ScheduleImportUploadFile {
  file: File | Blob;
  fileName: string;
  studentNo?: string;
  term?: string;
}

export type AdminCalendarSource = CalendarSource & {
  scheduleId?: string;
  classId?: string;
  classLabel?: string;
  versionCount: number;
  currentVersionNo: number;
  eventCount: number;
  subscriptionCount: number;
};

export interface CalendarSourceDetail {
  item: AdminCalendarSource;
  source: CalendarSource;
  versions: CalendarSourceVersion[];
  events: CalendarSourceEvent[];
  eventCount: number;
}

export interface TouchXUser {
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

export interface TouchXAuthSession {
  sessionToken: string;
  expiresAt: number;
  mode?: string;
  user: TouchXUser;
}

export interface TouchXTodayBrief {
  serverNowIso: string;
  serverTimezone?: string;
  currentWeek?: number;
  weekNo?: number;
  dayNo?: number;
  dayLabel?: string;
  greeting?: string;
  termMeta?: unknown;
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
  externalUnionId?: string;
  status: "active" | "disabled" | "expired";
  createdAt?: string;
  updatedAt?: string;
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

export interface CalendarSettings {
  reminderEnabled: boolean;
  reminderWindowMinutes: number[];
  defaultViewMode?: string;
  showWeekends?: boolean;
  syncToSystemCalendar?: boolean;
}

export type EffectiveCalendarItem = EffectiveCalendarEvent;

export const DEFAULT_TOUCHX_API_BASE_URL = "https://schedule.wc1.tagzxia.com/api/v1";

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");
const normalizeConfigValue = (value: unknown) => String(value || "").trim();

export const resolveTouchXApiBaseUrl = (options: TouchXApiBaseUrlOptions = {}) => {
  const runtime = options.runtime || (globalThis as TouchXApiBaseUrlOptions["runtime"]);
  const env = runtime?.process?.env || {};
  const keys = ["TOUCHX_API_BASE_URL", ...(options.envKeys || [])];
  const globalOverride = normalizeConfigValue(runtime?.__TOUCHX_API_BASE_URL__);
  if (globalOverride) return globalOverride;
  for (const key of keys) {
    const value = normalizeConfigValue(env[key]);
    if (value) return value;
  }
  return normalizeConfigValue(options.defaultBaseUrl) || DEFAULT_TOUCHX_API_BASE_URL;
};

export class TouchXApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(message: string, options: { status: number; code?: string; details?: unknown }) {
    super(message);
    this.name = "TouchXApiError";
    this.status = options.status;
    this.code = options.code || "REQUEST_FAILED";
    this.details = options.details;
  }
}

const parseApiEnvelope = async <T>(response: Response) => {
  let payload: ApiEnvelope<T>;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch (error) {
    throw new TouchXApiError(`Invalid API response (${response.status})`, {
      status: response.status,
      code: "INVALID_RESPONSE",
      details: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok || !payload?.ok) {
    throw new TouchXApiError(payload?.error?.message || `HTTP ${response.status}`, {
      status: response.status,
      code: payload?.error?.code,
      details: payload?.error?.details,
    });
  }
  return payload.data as T;
};

export class TouchXApiClient {
  private readonly baseUrl: string;
  private readonly token?: TouchXApiClientOptions["token"];
  private readonly fetcher: typeof fetch;

  constructor(options: TouchXApiClientOptions = {}) {
    this.baseUrl = options.baseUrl || "/api/v1";
    this.token = options.token;
    this.fetcher = options.fetcher || fetch;
  }

  private resolveUrl(path: string) {
    const normalizedPath = trimSlashes(path);
    if (/^https?:\/\//i.test(normalizedPath)) {
      return normalizedPath;
    }
    return `${this.baseUrl.replace(/\/+$/, "")}/${normalizedPath}`;
  }

  private async resolveToken() {
    if (typeof this.token === "function") {
      return String(await this.token()).trim();
    }
    return String(this.token || "").trim();
  }

  async request<T = unknown>(path: string, options: ApiRequestOptions = {}) {
    const method = options.method || "GET";
    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    const token = options.auth === false ? "" : await this.resolveToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (method !== "GET" && options.body !== undefined) {
      headers["content-type"] = headers["content-type"] || "application/json";
    }
    const response = await this.fetcher(this.resolveUrl(path), {
      method,
      headers,
      body: method === "GET" || options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "omit",
    });
    return parseApiEnvelope<T>(response);
  }

  get<T = unknown>(path: string) {
    return this.request<T>(path, { method: "GET" });
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  register(input: { accountName: string; password: string; confirmPassword?: string; name?: string; nickname?: string }) {
    return this.request<TouchXAuthSession>("auth/register", { method: "POST", body: input, auth: false });
  }

  login(input: { accountName?: string; username?: string; password?: string; studentNo?: string; name?: string; nickname?: string; classLabel?: string }) {
    return this.request<TouchXAuthSession>("auth/login", { method: "POST", body: input, auth: false });
  }

  updateAuthProfile(input: { nickname?: string; name?: string; avatarUrl?: string; wallpaperUrl?: string; password?: string; oldPassword?: string }) {
    return this.post<{ user: TouchXUser }>("auth/profile", input);
  }

  getAuthMe() {
    return this.get<{ mode?: string; role?: string; expiresAt?: number; user: TouchXUser }>("auth/me");
  }

  logout() {
    return this.post<{ loggedOut?: boolean }>("auth/logout", {});
  }

  async uploadScheduleImportJob(files: ScheduleImportUploadFile[]) {
    const formData = new FormData();
    const mappings = files.map((item) => ({
      fileName: item.fileName,
      studentNo: item.studentNo || "",
      term: item.term || "",
    }));
    files.forEach((item) => {
      const appendFile = formData.append as (name: string, value: Blob, fileName?: string) => void;
      appendFile.call(formData, "files[]", item.file, item.fileName);
    });
    formData.append("mappings", JSON.stringify(mappings));
    const token = await this.resolveToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await this.fetcher(this.resolveUrl("admin/schedule-import/jobs"), {
      method: "POST",
      headers,
      body: formData,
      credentials: "omit",
    });
    return parseApiEnvelope<{
      jobId: string;
      totalFiles: number;
    }>(response);
  }

  listCalendarSources() {
    return this.get<{ items: CalendarSourceRow[]; total: number }>("calendar/sources");
  }

  upsertCalendarSource(input: {
    sourceId?: string;
    title: string;
    description?: string;
    type?: string;
    visibility?: string;
    publish?: boolean;
    events?: unknown[];
  }) {
    return this.post<{ item: CalendarSourceRow }>("calendar/sources", input);
  }

  getCalendarSource(sourceId: string) {
    return this.get<CalendarSourceDetail>(`calendar/sources/${encodeURIComponent(sourceId)}`);
  }

  publishCalendarSourceVersion(sourceId: string, versionNo: number) {
    return this.post(`admin/calendar/sources/${encodeURIComponent(sourceId)}/versions/${versionNo}/publish`, {});
  }

  listMyEffectiveCalendar(params: { week?: number; date?: string } = {}) {
    const query = new URLSearchParams();
    if (params.week) {
      query.set("week", String(params.week));
    }
    if (params.date) {
      query.set("date", params.date);
    }
    const suffix = query.toString();
    return this.get<{ items: EffectiveCalendarEvent[]; total: number }>(`calendar/me/effective${suffix ? `?${suffix}` : ""}`);
  }

  getTodayBrief() {
    return this.get<TouchXTodayBrief>("today-brief");
  }

  listMyCalendarSubscriptions() {
    return this.get<{ items: CalendarSubscriptionRow[]; total: number }>("calendar/me/subscriptions");
  }

  subscribeCalendarSource(sourceId: string) {
    return this.post<{ subscription: CalendarSubscriptionRow; duplicated?: boolean }>(`calendar/sources/${encodeURIComponent(sourceId)}/subscribe`, {});
  }

  cancelCalendarSubscription(subscriptionId: string) {
    return this.post<{ cancelled: boolean; subscriptionId: string }>(`calendar/me/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {});
  }

  listMyReminderRules() {
    return this.get<{ items: ReminderRuleRow[]; total: number }>("calendar/me/reminder-rules");
  }

  upsertMyReminderRule(input: Partial<ReminderRuleRow>) {
    return this.post<{ item: ReminderRuleRow }>("calendar/me/reminder-rules", input);
  }

  deleteMyReminderRule(ruleId: string) {
    return this.post<{ item?: ReminderRuleRow }>(`calendar/me/reminder-rules/${encodeURIComponent(ruleId)}/delete`, {});
  }

  getCalendarSettings() {
    return this.get<CalendarSettings>("calendar/me/settings");
  }

  updateCalendarSettings(input: { reminderEnabled?: boolean; reminderWindowMinutes?: number[]; nickname?: string }) {
    return this.post<{ user: TouchXUser }>("calendar/me/settings", input);
  }

  listReminderCandidates(params: { week?: number; date?: string } = {}) {
    const query = new URLSearchParams();
    if (params.week) {
      query.set("week", String(params.week));
    }
    if (params.date) {
      query.set("date", params.date);
    }
    const suffix = query.toString();
    return this.get(`calendar/me/reminder-candidates${suffix ? `?${suffix}` : ""}`);
  }

  enqueueReminderCandidates(body: { week?: number; date?: string; limit?: number } = {}) {
    return this.post("calendar/me/reminder-candidates/enqueue", body);
  }

  listPersonalEvents() {
    return this.get<{ items: PersonalEventRow[]; total: number }>("calendar/me/personal-events");
  }

  createPersonalEvent(body: {
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
    return this.post<{ item: PersonalEventRow }>("calendar/me/personal-events", body);
  }

  updatePersonalEvent(eventId: string, body: {
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
    return this.request<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}`, { method: "PATCH", body });
  }

  markPersonalEventDone(eventId: string) {
    return this.post<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}/done`, {});
  }

  archivePersonalEvent(eventId: string) {
    return this.post<{ item: PersonalEventRow }>(`calendar/me/personal-events/${encodeURIComponent(eventId)}/delete`, {});
  }

  listNotificationBindings() {
    return this.get<{ items: NotificationBindingRow[]; total: number }>("calendar/me/notification-bindings");
  }

  createWechatClawDBotBindingQr() {
    return this.post<{ bindingToken: string; expiresAt: string; qrPayload: string; qrImageUrl: string; binding?: NotificationBindingRow }>(
      "calendar/me/notification-bindings/wechat-clawdbot/qr",
      {},
    );
  }

  unbindWechatClawDBot() {
    return this.post<{ unbound: boolean }>("calendar/me/notification-bindings/wechat-clawdbot/unbind", {});
  }

  listNotificationChannels() {
    return this.get<{ items: NotificationChannel[]; total: number }>("admin/notification-channels");
  }

  upsertNotificationChannel(body: unknown) {
    return this.post("admin/notification-channels", body);
  }

  testNotificationChannel(channelType: string) {
    return this.post(`admin/notification-channels/${encodeURIComponent(channelType)}/test`, {});
  }

  dispatchPendingNotificationDeliveries(limit = 20) {
    return this.post("admin/notification-deliveries/dispatch-pending", { limit });
  }

  listNotificationDeliveries(params: { limit?: number; offset?: number; status?: string; sourceQueue?: string } = {}) {
    const query = new URLSearchParams();
    if (params.limit) {
      query.set("limit", String(params.limit));
    }
    if (params.offset) {
      query.set("offset", String(params.offset));
    }
    if (params.status) {
      query.set("status", params.status);
    }
    if (params.sourceQueue) {
      query.set("sourceQueue", params.sourceQueue);
    }
    const suffix = query.toString();
    return this.get(`admin/notification-deliveries${suffix ? `?${suffix}` : ""}`);
  }

  listReminderRules() {
    return this.get("admin/reminder-rules");
  }

  upsertReminderRule(body: unknown) {
    return this.post("admin/reminder-rules", body);
  }

  deleteReminderRule(ruleId: string) {
    return this.post(`admin/reminder-rules/${encodeURIComponent(ruleId)}/delete`, {});
  }

  listImportCandidateJobs() {
    return this.get("admin/import-candidate-jobs");
  }

  createImportCandidateJob(body: unknown) {
    return this.post("admin/import-candidate-jobs", body);
  }

  createImportCandidateJobFromScheduleImport(legacyJobId: string, body: { targetSourceId?: string; itemId?: string } = {}) {
    return this.post(`admin/import-candidate-jobs/from-schedule-import/${encodeURIComponent(legacyJobId)}`, body);
  }

  listImportCandidates(jobId: string) {
    return this.get(`admin/import-candidate-jobs/${encodeURIComponent(jobId)}/candidates`);
  }

  acceptImportCandidate(candidateId: string, body: unknown = {}) {
    return this.post(`admin/import-candidates/${encodeURIComponent(candidateId)}/accept`, body);
  }

  rejectImportCandidate(candidateId: string, body: unknown = {}) {
    return this.post(`admin/import-candidates/${encodeURIComponent(candidateId)}/reject`, body);
  }

  correctImportCandidate(candidateId: string, body: unknown = {}) {
    return this.post(`admin/import-candidates/${encodeURIComponent(candidateId)}/correct`, body);
  }

  commitImportCandidateToPersonal(candidateId: string) {
    return this.post(`admin/import-candidates/${encodeURIComponent(candidateId)}/commit-personal`, {});
  }

  commitImportCandidateToCalendar(candidateId: string, body: { sourceId?: string; publish?: boolean } = {}) {
    return this.post(`admin/import-candidates/${encodeURIComponent(candidateId)}/commit-calendar`, body);
  }

  listImportJobs(params: { limit?: number } = {}) {
    const query = new URLSearchParams();
    if (params.limit) {
      query.set("limit", String(params.limit));
    }
    const suffix = query.toString();
    return this.get(`admin/import-jobs${suffix ? `?${suffix}` : ""}`);
  }

  getImportJob(jobId: string) {
    return this.get(`admin/import-jobs/${encodeURIComponent(jobId)}`);
  }

  listAuditLogs(params: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams();
    if (params.limit) {
      query.set("limit", String(params.limit));
    }
    if (params.offset) {
      query.set("offset", String(params.offset));
    }
    const suffix = query.toString();
    return this.get(`admin/audit${suffix ? `?${suffix}` : ""}`);
  }
}

export const createTouchXApiClient = (options: TouchXApiClientOptions = {}) => new TouchXApiClient(options);
