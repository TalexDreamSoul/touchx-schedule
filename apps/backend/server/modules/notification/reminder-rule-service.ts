import type { ReminderChannelStrategy, ReminderRule, ReminderTargetType } from "@touchx/shared";
import type { NexusStore } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";

const TARGET_TYPES = new Set<ReminderTargetType>(["subscription", "source_event", "personal_event", "global"]);
const CHANNEL_STRATEGIES = new Set<ReminderChannelStrategy>(["both", "primary_then_fallback", "primary_only"]);
const asString = (value: unknown) => String(value || "").trim();

const normalizeTargetType = (value: unknown): ReminderTargetType => {
  const normalized = asString(value) as ReminderTargetType;
  return TARGET_TYPES.has(normalized) ? normalized : "global";
};

const normalizeChannelStrategy = (value: unknown): ReminderChannelStrategy => {
  const normalized = asString(value) as ReminderChannelStrategy;
  return CHANNEL_STRATEGIES.has(normalized) ? normalized : "primary_then_fallback";
};

const normalizeOffsetMinutes = (value: unknown) => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return 15;
  }
  return Math.max(0, Math.min(60 * 24 * 14, parsed));
};

export const listReminderRules = (store: NexusStore) => {
  const items = store.reminderRules
    .map((item) => ({ ...item }))
    .sort((left, right) => {
      if (left.targetType !== right.targetType) {
        return left.targetType.localeCompare(right.targetType);
      }
      if (left.offsetMinutes !== right.offsetMinutes) {
        return left.offsetMinutes - right.offsetMinutes;
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  return {
    items,
    total: items.length,
  };
};

export const upsertReminderRule = (
  store: NexusStore,
  input: {
    id?: string;
    targetType?: ReminderTargetType;
    targetId?: string;
    enabled?: boolean;
    offsetMinutes?: number;
    templateKey?: string;
    channelStrategy?: ReminderChannelStrategy;
    quietHoursRespect?: boolean;
  },
) => {
  const now = storeHelpers.nowIso();
  const id = asString(input.id);
  const existing = id ? store.reminderRules.find((item) => item.id === id) || null : null;
  if (existing) {
    existing.targetType = normalizeTargetType(input.targetType || existing.targetType);
    existing.targetId = asString(input.targetId) || existing.targetId || "global";
    if (typeof input.enabled === "boolean") {
      existing.enabled = input.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(input, "offsetMinutes")) {
      existing.offsetMinutes = normalizeOffsetMinutes(input.offsetMinutes);
    }
    existing.templateKey = asString(input.templateKey) || existing.templateKey || "calendar.event.reminder";
    existing.channelStrategy = normalizeChannelStrategy(input.channelStrategy || existing.channelStrategy);
    if (typeof input.quietHoursRespect === "boolean") {
      existing.quietHoursRespect = input.quietHoursRespect;
    }
    existing.updatedAt = now;
    return existing;
  }
  const targetType = normalizeTargetType(input.targetType);
  const rule: ReminderRule = {
    id: id || storeHelpers.createId("reminder_rule"),
    targetType,
    targetId: asString(input.targetId) || (targetType === "global" ? "global" : ""),
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    offsetMinutes: normalizeOffsetMinutes(input.offsetMinutes),
    templateKey: asString(input.templateKey) || "calendar.event.reminder",
    channelStrategy: normalizeChannelStrategy(input.channelStrategy),
    quietHoursRespect: typeof input.quietHoursRespect === "boolean" ? input.quietHoursRespect : true,
    createdAt: now,
    updatedAt: now,
  };
  store.reminderRules.push(rule);
  return rule;
};

export const deleteReminderRule = (store: NexusStore, ruleId: string) => {
  const id = asString(ruleId);
  const index = store.reminderRules.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  const [removed] = store.reminderRules.splice(index, 1);
  return removed || null;
};
