export const ADMIN_ROLES = ["super_admin", "operator", "none"] as const;
export const CLASS_ROLES = ["class_owner", "class_admin", "class_editor", "class_viewer"] as const;
export const FOLLOW_MODES = ["following", "patched"] as const;
export const DISTANCE_LEVELS = ["near", "medium", "far"] as const;
export const DEFAULT_SCHEDULE_TERM_TIMEZONE = "Asia/Shanghai" as const;
export const DEFAULT_SCHEDULE_TERM_META = {
  name: "2025-2026-2",
  week1Monday: "2026-03-02",
  maxWeek: 25,
  timezone: DEFAULT_SCHEDULE_TERM_TIMEZONE,
} as const;
export const DEFAULT_SCHEDULE_TERM_HOLIDAYS = [
  { date: "2026-04-04", label: "休" },
  { date: "2026-04-05", label: "休" },
  { date: "2026-04-06", label: "休" },
  { date: "2026-05-01", label: "休" },
  { date: "2026-05-02", label: "休" },
  { date: "2026-05-03", label: "休" },
  { date: "2026-05-04", label: "休" },
  { date: "2026-05-05", label: "休" },
  { date: "2026-06-19", label: "休" },
  { date: "2026-06-20", label: "休" },
  { date: "2026-06-21", label: "休" },
] as const;
export const DEFAULT_SCHEDULE_WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;
export const DEFAULT_SCHEDULE_SECTION_TIMES = [
  { section: 1, start: "08:30", end: "09:15", part: "上午" },
  { section: 2, start: "09:20", end: "10:05", part: "上午" },
  { section: 3, start: "10:25", end: "11:10", part: "上午" },
  { section: 4, start: "11:15", end: "12:00", part: "上午" },
  { section: 5, start: "14:30", end: "15:15", part: "下午" },
  { section: 6, start: "15:20", end: "16:05", part: "下午" },
  { section: 7, start: "16:25", end: "17:10", part: "下午" },
  { section: 8, start: "17:15", end: "18:00", part: "下午" },
  { section: 9, start: "19:00", end: "19:45", part: "晚上" },
  { section: 10, start: "19:50", end: "20:35", part: "晚上" },
  { section: 11, start: "20:40", end: "21:25", part: "晚上" },
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type ClassRole = (typeof CLASS_ROLES)[number];
export type FollowMode = (typeof FOLLOW_MODES)[number];
export type DistanceLevel = (typeof DISTANCE_LEVELS)[number];
export type ScheduleTermHoliday = (typeof DEFAULT_SCHEDULE_TERM_HOLIDAYS)[number];

export interface StudentIdentity {
  userId: string;
  studentNo: string;
  studentId?: string;
  name?: string;
  classLabel?: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiMetaPayload {
  requestId: string;
  schemaVersion: "v1";
}

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ApiErrorPayload;
  meta: ApiMetaPayload;
}

export interface ClassSubscription {
  classId: string;
  classLabel: string;
  currentCode?: string;
  memberCount?: number;
  subscriberCount?: number;
}

export interface ScheduleSubscription {
  id: string;
  subscriberUserId: string;
  sourceScheduleId: string;
  baseVersionNo: number;
  followMode: FollowMode;
  createdAt: string;
}

export interface SchedulePatch {
  id: string;
  subscriptionId: string;
  entryId: string;
  opType: "add" | "update" | "remove";
  patchPayload: Record<string, unknown>;
  createdAt: string;
}

export interface ScheduleConflict {
  id: string;
  subscriptionId: string;
  entryId: string;
  sourceVersionNo: number;
  conflictType: "source_changed_after_patch" | "source_removed_after_patch";
  resolutionStatus: "pending" | "kept_patch" | "relinked";
  createdAt: string;
}

export interface LocationGrid {
  gridId: string;
  latitudeApprox: number;
  longitudeApprox: number;
  updatedAt: string;
  stale: boolean;
}

export interface SmartSuggestionItem {
  code: string;
  title: string;
  content: string;
  priority: number;
  reasonCodes: string[];
}

export interface FoodCampaignVisibility {
  isAnonymous: boolean;
  revealAfterClose: boolean;
  revealScope: "share_token" | "public";
}
