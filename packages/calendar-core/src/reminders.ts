import type { EffectiveCalendarEvent, ReminderCandidate, ReminderRule } from "@touchx/shared";

const minuteMs = 60 * 1000;

const parseDateTime = (dateKey: string | undefined, timeText: string | undefined) => {
  if (!dateKey || !timeText) {
    return null;
  }
  const timestamp = Date.parse(`${dateKey}T${timeText.length === 5 ? `${timeText}:00` : timeText}`);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp);
};

const resolveEventStartDate = (event: EffectiveCalendarEvent) => {
  const explicit = parseDateTime(event.date, event.startTime);
  if (explicit) {
    return explicit;
  }
  if (event.date) {
    const timestamp = Date.parse(`${event.date}T00:00:00`);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }
  return null;
};

const isRuleMatched = (rule: ReminderRule, event: EffectiveCalendarEvent) => {
  if (!rule.enabled) {
    return false;
  }
  if (rule.targetType === "global") {
    return true;
  }
  if (rule.targetType === "source_event") {
    return rule.targetId === event.originId;
  }
  if (rule.targetType === "personal_event") {
    return event.originType === "personal" && rule.targetId === event.originId;
  }
  if (rule.targetType === "subscription") {
    return Boolean(event.subscriptionId && rule.targetId === event.subscriptionId);
  }
  return false;
};

export const resolveReminderCandidates = (input: {
  userId: string;
  events: EffectiveCalendarEvent[];
  rules?: ReminderRule[];
  defaultOffsets?: number[];
  now?: Date;
}) => {
  const rules = input.rules || [];
  const defaultOffsets = input.defaultOffsets && input.defaultOffsets.length > 0 ? input.defaultOffsets : [30, 15];
  const now = input.now || new Date();
  const candidates: ReminderCandidate[] = [];
  input.events
    .filter((event) => event.reminderEnabled && event.overrideState !== "hidden")
    .forEach((event) => {
      const startDate = resolveEventStartDate(event);
      if (!startDate) {
        return;
      }
      const matchedRules = rules.filter((rule) => isRuleMatched(rule, event));
      const ruleLikeItems = matchedRules.length > 0
        ? matchedRules.map((rule) => ({
            offsetMinutes: rule.offsetMinutes,
            templateKey: rule.templateKey || "calendar.event.reminder",
            ruleId: rule.id,
            targetType: rule.targetType,
            targetId: rule.targetId,
            channelStrategy: rule.channelStrategy,
            quietHoursRespect: rule.quietHoursRespect,
          }))
        : defaultOffsets.map((offsetMinutes) => ({
            offsetMinutes,
            templateKey: "calendar.event.reminder",
            ruleId: "",
            targetType: "global" as const,
            targetId: "global",
            channelStrategy: "primary_then_fallback" as const,
            quietHoursRespect: true,
          }));
      ruleLikeItems.forEach((rule) => {
        const scheduledAt = new Date(startDate.getTime() - Math.max(0, Number(rule.offsetMinutes || 0)) * minuteMs);
        if (scheduledAt.getTime() < now.getTime()) {
          return;
        }
        candidates.push({
          id: `reminder:${event.id}:${rule.offsetMinutes}`,
          eventId: event.id,
          userId: input.userId,
          scheduledAt: scheduledAt.toISOString(),
          offsetMinutes: Math.max(0, Number(rule.offsetMinutes || 0)),
          templateKey: rule.templateKey || "calendar.event.reminder",
          title: event.title,
          body: event.startTime ? `${event.startTime} ${event.location || ""}`.trim() : event.description,
          metadata: {
            originType: event.originType,
            originId: event.originId,
            sourceId: event.sourceId || "",
            subscriptionId: event.subscriptionId || "",
            ruleId: rule.ruleId,
            ruleTargetType: rule.targetType,
            ruleTargetId: rule.targetId,
            channelStrategy: rule.channelStrategy,
            quietHoursRespect: rule.quietHoursRespect,
          },
        });
      });
    });
  return candidates.sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
};
