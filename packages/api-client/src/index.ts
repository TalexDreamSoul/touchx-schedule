import type { ApiEnvelope, CalendarSource, CalendarSourceEvent, CalendarSourceVersion, EffectiveCalendarEvent, NotificationChannel } from "@touchx/shared";

export interface TouchXApiClientOptions {
  baseUrl?: string;
  token?: string | (() => string | Promise<string>);
  fetcher?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
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

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");

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
    const token = await this.resolveToken();
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
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || !payload.ok) {
      throw new TouchXApiError(payload.error?.message || `HTTP ${response.status}`, {
        status: response.status,
        code: payload.error?.code,
        details: payload.error?.details,
      });
    }
    return payload.data as T;
  }

  get<T = unknown>(path: string) {
    return this.request<T>(path, { method: "GET" });
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  async uploadScheduleImportJob(files: ScheduleImportUploadFile[]) {
    const formData = new FormData();
    const mappings = files.map((item) => ({
      fileName: item.fileName,
      studentNo: item.studentNo || "",
      term: item.term || "",
    }));
    files.forEach((item) => {
      formData.append("files[]", item.file, item.fileName);
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
    const payload = (await response.json()) as ApiEnvelope<{
      jobId: string;
      totalFiles: number;
    }>;
    if (!response.ok || !payload.ok) {
      throw new TouchXApiError(payload.error?.message || `HTTP ${response.status}`, {
        status: response.status,
        code: payload.error?.code,
        details: payload.error?.details,
      });
    }
    return payload.data;
  }

  listCalendarSources() {
    return this.get<{ items: AdminCalendarSource[]; total: number }>("calendar/sources");
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

  listMyCalendarSubscriptions() {
    return this.get("calendar/me/subscriptions");
  }

  subscribeCalendarSource(sourceId: string) {
    return this.post(`calendar/sources/${encodeURIComponent(sourceId)}/subscribe`, {});
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
    return this.get("calendar/me/personal-events");
  }

  createPersonalEvent(body: unknown) {
    return this.post("calendar/me/personal-events", body);
  }

  updatePersonalEvent(eventId: string, body: unknown) {
    return this.request(`calendar/me/personal-events/${encodeURIComponent(eventId)}`, { method: "PATCH", body });
  }

  markPersonalEventDone(eventId: string) {
    return this.post(`calendar/me/personal-events/${encodeURIComponent(eventId)}/done`, {});
  }

  archivePersonalEvent(eventId: string) {
    return this.post(`calendar/me/personal-events/${encodeURIComponent(eventId)}/delete`, {});
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

  listNotificationDeliveries(params: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams();
    if (params.limit) {
      query.set("limit", String(params.limit));
    }
    if (params.offset) {
      query.set("offset", String(params.offset));
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
