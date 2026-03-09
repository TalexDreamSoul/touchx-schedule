export const ADMIN_ROLES = ["super_admin", "operator", "none"] as const;
export const CLASS_ROLES = ["class_owner", "class_admin", "class_editor", "class_viewer"] as const;
export const FOLLOW_MODES = ["following", "patched"] as const;
export const DISTANCE_LEVELS = ["near", "medium", "far"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type ClassRole = (typeof CLASS_ROLES)[number];
export type FollowMode = (typeof FOLLOW_MODES)[number];
export type DistanceLevel = (typeof DISTANCE_LEVELS)[number];

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
