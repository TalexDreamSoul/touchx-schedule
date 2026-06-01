import type { BotJobRecord, BotTemplateRecord, NexusStore } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import { buildSmartSuggestions } from "../../services/suggestion-engine";
import { getPublishedScheduleVersion } from "../schedule/schedule-service";

const asString = (value: unknown) => String(value || "").trim();

const toAcademicWeekDay = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 7 : day;
};

const isLocationStale = (updatedAt: string, maxAgeHours = 24) => {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp > maxAgeHours * 60 * 60 * 1000;
};

export const listBotTemplates = (store: NexusStore) => {
  return store.botTemplates.map((item) => ({ ...item }));
};

export const saveBotTemplate = (
  store: NexusStore,
  input: {
    id?: unknown;
    key?: unknown;
    title?: unknown;
    body?: unknown;
    enabled?: unknown;
  },
) => {
  const id = asString(input.id);
  const key = asString(input.key);
  const title = asString(input.title);
  const content = asString(input.body);
  const enabled = input.enabled !== false;
  if (!key || !title || !content) {
    return null;
  }

  let template: BotTemplateRecord | null = id ? store.botTemplates.find((item) => item.id === id) || null : null;
  if (!template) {
    template = {
      id: storeHelpers.createId("bot_tpl"),
      key,
      title,
      body: content,
      enabled,
      updatedAt: storeHelpers.nowIso(),
    };
    store.botTemplates.push(template);
  } else {
    template.key = key;
    template.title = title;
    template.body = content;
    template.enabled = enabled;
    template.updatedAt = storeHelpers.nowIso();
  }
  return template;
};

export const collectNextDaySuggestions = (
  store: NexusStore,
  options: {
    targetDate: Date;
    rainy?: boolean;
  },
) => {
  const targetDay = toAcademicWeekDay(options.targetDate);
  const enabledUsers = store.users.filter((item) => item.reminderEnabled);
  const suggestions = enabledUsers.flatMap((targetUser) => {
    const classIdSet = new Set(store.classMembers.filter((member) => member.userId === targetUser.userId).map((member) => member.classId));
    const schedules = store.schedules.filter((schedule) => classIdSet.has(schedule.classId));
    const entries = schedules.flatMap((schedule) => {
      const publishedVersion = getPublishedScheduleVersion(store, schedule.id, schedule.publishedVersionNo);
      if (!publishedVersion) {
        return [];
      }
      return publishedVersion.entries.filter((entry) => entry.day === targetDay);
    });
    const location = store.locationGrids.find((item) => item.userId === targetUser.userId) || null;
    const items = buildSmartSuggestions({
      user: targetUser,
      nextDayCourses: entries,
      hasRainWeather: Boolean(options.rainy),
      hasLocation: Boolean(location && !isLocationStale(location.updatedAt)),
      longDistanceCourseCount: entries.length >= 3 ? 1 : 0,
    });
    return items.map((item) => ({
      ...item,
      code: `${targetUser.studentNo}_${item.code}`,
    }));
  });
  return {
    userCount: enabledUsers.length,
    suggestions,
  };
};

export const triggerNextDayBotJob = (
  store: NexusStore,
  actorUserId: string,
  input: {
    rainy?: unknown;
    date?: unknown;
  },
) => {
  const rawDate = asString(input.date);
  const targetDate = rawDate ? new Date(rawDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const nextDay = collectNextDaySuggestions(store, {
    targetDate,
    rainy: input.rainy === true,
  });
  const job: BotJobRecord = {
    id: storeHelpers.createId("bot_job"),
    type: "next_day_broadcast",
    status: "done",
    createdBy: actorUserId,
    createdAt: storeHelpers.nowIso(),
    finishedAt: storeHelpers.nowIso(),
    summary: `已生成 ${nextDay.userCount} 位用户的次日建议`,
    suggestions: nextDay.suggestions,
  };
  store.botJobs.unshift(job);
  return { job, userCount: nextDay.userCount };
};

export const listBotJobHistory = (
  store: NexusStore,
  options: {
    limit: number;
  },
) => {
  return {
    items: store.botJobs.slice(0, options.limit),
    total: store.botJobs.length,
  };
};

export const parseBotLimit = (value: unknown, fallback = 20) => {
  const parsedLimit = Number(value);
  return Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, Math.trunc(parsedLimit))) : fallback;
};
