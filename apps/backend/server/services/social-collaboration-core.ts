export type SocialVisibilityScope = "busy_free" | "detail" | "hidden" | "blocked";
export type SocialActivityStatus = "draft" | "inviting" | "confirmed" | "cancelled" | "expired";
export type SocialActivityAction = "send" | "confirm" | "cancel" | "expire";
export type SchedulePriorityLabel = "low" | "normal" | "high";

const VISIBILITY_SCOPES = new Set<SocialVisibilityScope>(["busy_free", "detail", "hidden", "blocked"]);
const WEEKDAY_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

export interface ScheduleIntelligence {
  tags: string[];
  priorityLabel: SchedulePriorityLabel;
  priorityScore: number;
  examLike: boolean;
  repeatWeekdays: number[];
  suggestedDay: number;
  suggestedStartSection: number;
  suggestedEndSection: number;
  confidence: number;
}

export const normalizeVisibilityScope = (
  value: unknown,
  fallback: SocialVisibilityScope = "busy_free",
): SocialVisibilityScope => {
  const normalized = String(value || "").trim() as SocialVisibilityScope;
  if (VISIBILITY_SCOPES.has(normalized)) {
    return normalized;
  }
  return VISIBILITY_SCOPES.has(fallback) ? fallback : "busy_free";
};

export const compareVisibilityScope = (left: SocialVisibilityScope, right: SocialVisibilityScope) => {
  const score: Record<SocialVisibilityScope, number> = {
    blocked: 0,
    hidden: 1,
    busy_free: 2,
    detail: 3,
  };
  return score[left] - score[right];
};

export const pickStrongerVisibilityScope = (
  left: SocialVisibilityScope,
  right: SocialVisibilityScope,
): SocialVisibilityScope => {
  return compareVisibilityScope(left, right) >= 0 ? left : right;
};

export const resolveNextActivityStatus = (
  status: SocialActivityStatus,
  action: SocialActivityAction,
): SocialActivityStatus => {
  if (status === "cancelled" || status === "expired" || status === "confirmed") {
    return status;
  }
  if (action === "cancel") {
    return "cancelled";
  }
  if (action === "expire") {
    return status === "draft" ? "draft" : "expired";
  }
  if (status === "draft" && action === "send") {
    return "inviting";
  }
  if (status === "inviting" && action === "confirm") {
    return "confirmed";
  }
  return status;
};

const pushUnique = (items: string[], value: string) => {
  if (!value || items.includes(value)) {
    return;
  }
  items.push(value);
};

const extractRepeatWeekdays = (text: string) => {
  const weekdays: number[] = [];
  const matches = text.matchAll(/周([一二三四五六日天]+)/g);
  for (const matched of matches) {
    const chars = matched?.[1] || "";
    for (const char of chars) {
      const day = WEEKDAY_MAP[char];
      if (day && !weekdays.includes(day)) {
        weekdays.push(day);
      }
    }
  }
  return weekdays.sort((left, right) => left - right);
};

const normalizeHourByPeriod = (hour: number, period: string) => {
  if ((period === "下午" || period === "晚上") && hour < 12) {
    return hour + 12;
  }
  if (period === "中午" && hour < 11) {
    return hour + 12;
  }
  return hour;
};

const resolveSectionByHour = (hour: number) => {
  if (hour <= 8) {
    return 1;
  }
  if (hour <= 9) {
    return 2;
  }
  if (hour <= 10) {
    return 3;
  }
  if (hour <= 12) {
    return 4;
  }
  if (hour <= 14) {
    return 5;
  }
  if (hour <= 15) {
    return 6;
  }
  if (hour <= 16) {
    return 7;
  }
  if (hour <= 18) {
    return 8;
  }
  if (hour <= 19) {
    return 9;
  }
  if (hour <= 20) {
    return 10;
  }
  return 11;
};

const extractSuggestedSections = (text: string) => {
  const match = text.match(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})(?:点|:|：)?(?:\s*(?:-|到|至|~)\s*(\d{1,2})(?:点)?)?/);
  if (!match) {
    return {
      suggestedStartSection: 1,
      suggestedEndSection: 1,
    };
  }
  const period = match[1] || "";
  const rawStartHour = Number(match[2]);
  const rawEndHour = Number(match[3] || match[2]);
  const startHour = normalizeHourByPeriod(rawStartHour, period);
  const endHour = normalizeHourByPeriod(rawEndHour, period);
  const startSection = resolveSectionByHour(startHour);
  const endSection = resolveSectionByHour(Math.max(startHour, endHour));
  return {
    suggestedStartSection: startSection,
    suggestedEndSection: Math.max(startSection, endSection),
  };
};

export const buildScheduleIntelligence = (text: unknown): ScheduleIntelligence => {
  const normalized = String(text || "").trim();
  const tags: string[] = [];
  if (/(考试|复习|课程|课|作业|ddl|DDL|论文|实验|自习)/.test(normalized)) {
    pushUnique(tags, "学习");
  }
  if (/(训练|运动|跑步|健身|球|舞蹈)/.test(normalized)) {
    pushUnique(tags, "运动");
  }
  if (/(社团|会议|开会|讨论|组会|班会)/.test(normalized)) {
    pushUnique(tags, "社团");
  }
  if (/(聚餐|吃饭|电影|娱乐|游戏|唱歌)/.test(normalized)) {
    pushUnique(tags, "娱乐");
  }
  if (tags.length === 0) {
    pushUnique(tags, "个人");
  }

  const urgent = /(考试|ddl|DDL|截止|答辩|面试)/.test(normalized);
  const important = /(复习|作业|会议|训练|实验|论文)/.test(normalized);
  const priorityScore = urgent ? 90 : important ? 65 : 45;
  const priorityLabel: SchedulePriorityLabel = priorityScore >= 80 ? "high" : priorityScore >= 55 ? "normal" : "low";
  const repeatWeekdays = extractRepeatWeekdays(normalized);
  const suggestedSections = extractSuggestedSections(normalized);

  return {
    tags,
    priorityLabel,
    priorityScore,
    examLike: /(考试|期末|期中|补考|考后)/.test(normalized),
    repeatWeekdays,
    suggestedDay: repeatWeekdays[0] || 1,
    ...suggestedSections,
    confidence: normalized ? 0.72 : 0,
  };
};
