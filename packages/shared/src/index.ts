export const ADMIN_ROLES = ["super_admin", "operator", "none"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface StudentIdentity {
  studentNo: string;
  studentId?: string;
  name?: string;
}

export interface ClassSubscription {
  classId: string;
  classLabel: string;
  currentCode?: string;
  memberCount?: number;
  subscriberCount?: number;
}

export interface FoodCampaignVisibility {
  isAnonymous: boolean;
  revealAfterClose: boolean;
  revealScope: "share_token" | "public";
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
}
