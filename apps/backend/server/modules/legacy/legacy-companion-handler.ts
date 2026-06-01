import type { H3Event } from "h3";
import { storeHelpers, type NexusStore, type ScheduleCorrectionRecord, type ScheduleEntryRecord, type SocialActivityRecord, type UserRecord, type UserScheduleEventRecord } from "../../services/domain-store";
import {
  addDaysToDateKey,
  getEffectiveScheduleEntriesForUser,
  getSectionTimeBySection,
  getUserReminderTimezone,
  isScheduleEntryInWeek,
  resolveCurrentWeekForDate,
  resolveScheduleClassDateContext,
  SCHEDULE_DEFAULT_TIMEZONE,
  SCHEDULE_TERM_META,
  SCHEDULE_WEEKDAY_LABELS,
  toDateTimeParts,
  zonedDateTimeToUtc,
} from "../../services/schedule-calendar";
import {
  buildExamCountdownState,
  resolveCalendarViewKey,
  sortDailyPriorityItems,
} from "../../services/social-collaboration-core";

type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveSocialActorUser = (store: NexusStore, accountUser: UserRecord) => UserRecord;
type FindUserByStudentId = (store: NexusStore, studentId: string) => UserRecord | null;
type FindUserByUserId = (store: NexusStore, userId: string) => UserRecord | null;

export interface LegacyCompanionHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  getStoreRevision: () => number;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  resolveSocialActorUser: ResolveSocialActorUser;
  findUserByStudentId: FindUserByStudentId;
  findUserByUserId: FindUserByUserId;
  resolveUserDisplayLabel: (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => string;
  resolveMeaningfulUserName: (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => string;
}

type CalendarViewBucketKey = ReturnType<typeof resolveCalendarViewKey>;

const CALENDAR_VIEW_LABELS: Record<CalendarViewBucketKey, string> = {
  learning: "学习日历",
  social: "社交日历",
  personal: "个人日历",
};

const asString = (value: unknown) => String(value || "").trim();

const isExamText = (text: unknown) => /(考试|期末|期中|补考|考后)/.test(asString(text));

const resolveFirstWeekFromExpr = (weekExpr: unknown) => {
  const matched = asString(weekExpr).match(/\d{1,2}/);
  const week = Number(matched?.[0] || 0);
  return Number.isFinite(week) && week > 0 ? Math.min(SCHEDULE_TERM_META.maxWeek, week) : 0;
};

const buildSectionRangeLabel = (startSection: number, endSection: number) => {
  const startSlot = getSectionTimeBySection(startSection);
  const endSlot = getSectionTimeBySection(endSection);
  return startSlot && endSlot ? `${startSlot.start}-${endSlot.end}` : `第 ${startSection}-${endSection} 节`;
};

const isEventInWeek = (event: Pick<UserScheduleEventRecord, "weekExpr" | "parity">, week: number) => {
  return isScheduleEntryInWeek(
    {
      weekExpr: event.weekExpr,
      parity: event.parity,
    } as ScheduleEntryRecord,
    week,
  );
};

const toSocialUserBrief = (
  context: LegacyCompanionHandlerContext,
  user: UserRecord | null,
) => {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    studentId: user.studentId || "",
    studentNo: user.studentNo || "",
    name: context.resolveUserDisplayLabel(user),
    classLabel: user.classLabel || "",
    avatarUrl: user.avatarUrl || "",
  };
};

const buildActivityTimeLabel = (activity: Pick<SocialActivityRecord, "week" | "day" | "startSection" | "endSection">) => {
  const startSlot = getSectionTimeBySection(activity.startSection);
  const endSlot = getSectionTimeBySection(activity.endSection);
  const weekday = SCHEDULE_WEEKDAY_LABELS[Math.max(1, activity.day) - 1] || "一";
  const timeRange = startSlot && endSlot ? `${startSlot.start}-${endSlot.end}` : `第 ${activity.startSection}-${activity.endSection} 节`;
  return `第 ${activity.week} 周 周${weekday} ${timeRange}`;
};

const toActivityPayload = (
  context: LegacyCompanionHandlerContext,
  item: SocialActivityRecord,
  viewerUserId = "",
) => {
  const { store, findUserByUserId } = context;
  const invitations = store.socialActivityInvitations.filter((invite) => invite.activityId === item.id);
  const viewerInvitation = invitations.find((invite) => invite.inviteeUserId === viewerUserId) || null;
  const creator = findUserByUserId(store, item.createdByUserId);
  return {
    activityId: item.id,
    title: item.title,
    activityType: item.activityType,
    status: item.status,
    createdBy: toSocialUserBrief(context, creator),
    week: item.week,
    day: item.day,
    startSection: item.startSection,
    endSection: item.endSection,
    timeLabel: buildActivityTimeLabel(item),
    participantStudentIds: item.participantUserIds
      .map((userId) => findUserByUserId(store, userId)?.studentId || "")
      .filter((studentId) => studentId),
    participants: item.participantUserIds
      .map((userId) => toSocialUserBrief(context, findUserByUserId(store, userId)))
      .filter((user): user is NonNullable<typeof user> => Boolean(user)),
    invitations: invitations.map((invite) => ({
      invitationId: invite.id,
      status: invite.status,
      invitee: toSocialUserBrief(context, findUserByUserId(store, invite.inviteeUserId)),
      inviter: toSocialUserBrief(context, findUserByUserId(store, invite.inviterUserId)),
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      respondedAt: invite.respondedAt,
    })),
    viewerInvitation: viewerInvitation
      ? {
          invitationId: viewerInvitation.id,
          status: viewerInvitation.status,
          respondedAt: viewerInvitation.respondedAt,
        }
      : null,
    invitationStats: {
      pending: invitations.filter((invite) => invite.status === "pending").length,
      accepted: invitations.filter((invite) => invite.status === "accepted").length,
      declined: invitations.filter((invite) => invite.status === "declined").length,
    },
    calendarPath: `/api/v1/social/activities/calendar.ics?activityId=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.calendarToken)}`,
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const buildExamCountdowns = (store: NexusStore, user: UserRecord) => {
  const timezone = getUserReminderTimezone(store, user);
  const todayKey = toDateTimeParts(new Date(), timezone).dateKey;
  const eventItems = store.userScheduleEvents
    .filter((item) => item.userId === user.userId && (item.source === "exam" || isExamText(`${item.title} ${item.description}`)))
    .map((item) => {
      const state = buildExamCountdownState(item.examDate, todayKey);
      return {
        eventId: item.id,
        title: item.title,
        examDate: item.examDate,
        priorityLabel: item.priorityLabel,
        daysRemaining: state.daysRemaining,
        status: state.status,
        source: item.source,
      };
    });
  const scheduleItems = getEffectiveScheduleEntriesForUser(store, user)
    .filter((entry) => isExamText(`${entry.courseName} ${entry.teacher} ${entry.classroom}`))
    .map((entry) => {
      const week = resolveFirstWeekFromExpr(entry.weekExpr);
      const examDate = week > 0 ? addDaysToDateKey(SCHEDULE_TERM_META.week1Monday, (week - 1) * 7 + Math.max(0, entry.day - 1)) : "";
      const state = buildExamCountdownState(examDate, todayKey);
      return {
        eventId: `schedule_${entry.id}`,
        title: entry.courseName,
        examDate,
        priorityLabel: "high" as const,
        daysRemaining: state.daysRemaining,
        status: state.status,
        source: "schedule",
      };
    });
  return [...eventItems, ...scheduleItems]
    .filter((item, index, rows) => rows.findIndex((candidate) => candidate.title === item.title && candidate.examDate === item.examDate) === index)
    .sort((left, right) => {
      const leftDays = left.daysRemaining === null ? Number.POSITIVE_INFINITY : left.daysRemaining;
      const rightDays = right.daysRemaining === null ? Number.POSITIVE_INFINITY : right.daysRemaining;
      if (leftDays !== rightDays) {
        return leftDays - rightDays;
      }
      return left.title.localeCompare(right.title, "zh-CN");
    });
};

const buildTodayPriorityItems = (store: NexusStore, user: UserRecord, currentWeek: number, dayNo: number) => {
  const courseItems = getEffectiveScheduleEntriesForUser(store, user)
    .filter((entry) => entry.day === dayNo && isScheduleEntryInWeek(entry, currentWeek))
    .map((entry) => ({
      id: `course_${entry.id}`,
      source: "course",
      title: entry.courseName,
      subtitle: `${buildSectionRangeLabel(entry.startSection, entry.endSection)} · ${entry.classroom || "教室待定"}`,
      priorityScore: isExamText(entry.courseName) ? 92 : 50,
      priorityLabel: isExamText(entry.courseName) ? ("high" as const) : ("normal" as const),
      startSection: entry.startSection,
      tags: isExamText(entry.courseName) ? ["考试", "学习"] : ["学习"],
    }));
  const userEventItems = store.userScheduleEvents
    .filter((item) => item.userId === user.userId && item.day === dayNo && isEventInWeek(item, currentWeek))
    .map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      subtitle: `${buildSectionRangeLabel(item.startSection, item.endSection)} · ${item.description || "个人日程"}`,
      priorityScore: item.priorityScore,
      priorityLabel: item.priorityLabel,
      startSection: item.startSection,
      tags: item.tags,
    }));
  const activityItems = store.socialActivities
    .filter((activity) => activity.week === currentWeek && activity.day === dayNo && activity.status !== "cancelled" && activity.status !== "expired")
    .filter((activity) => {
      if (activity.createdByUserId === user.userId || activity.participantUserIds.includes(user.userId)) {
        return true;
      }
      return store.socialActivityInvitations.some((invite) => invite.activityId === activity.id && invite.inviteeUserId === user.userId);
    })
    .map((activity) => {
      const invitation = store.socialActivityInvitations.find((invite) => invite.activityId === activity.id && invite.inviteeUserId === user.userId) || null;
      const isPendingInvite = invitation?.status === "pending";
      return {
        id: activity.id,
        source: "activity",
        title: activity.title,
        subtitle: `${buildActivityTimeLabel(activity)} · ${isPendingInvite ? "待响应邀请" : "活动"}`,
        priorityScore: isPendingInvite ? 72 : 58,
        priorityLabel: isPendingInvite ? ("high" as const) : ("normal" as const),
        startSection: activity.startSection,
        tags: [activity.activityType || "社交"],
      };
    });
  return sortDailyPriorityItems([...courseItems, ...userEventItems, ...activityItems]).slice(0, 8);
};

const pushCalendarViewItem = (
  buckets: Record<CalendarViewBucketKey, Array<Record<string, unknown>>>,
  item: Record<string, unknown> & { tags?: string[]; source?: string; title?: string },
) => {
  const viewKey = resolveCalendarViewKey({
    tags: item.tags,
    source: item.source,
    title: item.title,
  });
  buckets[viewKey].push(item);
};

const buildCalendarViewsPayload = (store: NexusStore, user: UserRecord, week: number) => {
  const buckets: Record<CalendarViewBucketKey, Array<Record<string, unknown>>> = {
    learning: [],
    social: [],
    personal: [],
  };
  getEffectiveScheduleEntriesForUser(store, user)
    .filter((entry) => isScheduleEntryInWeek(entry, week))
    .forEach((entry) => {
      const tags = isExamText(entry.courseName) ? ["学习", "考试"] : ["学习"];
      pushCalendarViewItem(buckets, {
        id: `course_${entry.id}`,
        source: "course",
        title: entry.courseName,
        subtitle: `周${SCHEDULE_WEEKDAY_LABELS[entry.day - 1] || entry.day} ${buildSectionRangeLabel(entry.startSection, entry.endSection)}`,
        day: entry.day,
        startSection: entry.startSection,
        endSection: entry.endSection,
        weekExpr: entry.weekExpr,
        parity: entry.parity,
        tags,
        location: entry.classroom,
        teacher: entry.teacher,
      });
    });
  store.userScheduleEvents
    .filter((item) => item.userId === user.userId && isEventInWeek(item, week))
    .forEach((item) => {
      pushCalendarViewItem(buckets, {
        id: item.id,
        source: item.source,
        title: item.title,
        subtitle: `周${SCHEDULE_WEEKDAY_LABELS[item.day - 1] || item.day} ${buildSectionRangeLabel(item.startSection, item.endSection)}`,
        day: item.day,
        startSection: item.startSection,
        endSection: item.endSection,
        weekExpr: item.weekExpr,
        parity: item.parity,
        tags: item.tags,
        priorityScore: item.priorityScore,
        priorityLabel: item.priorityLabel,
        description: item.description,
      });
    });
  store.socialActivities
    .filter((activity) => activity.week === week && activity.status !== "cancelled" && activity.status !== "expired")
    .filter((activity) => {
      if (activity.createdByUserId === user.userId || activity.participantUserIds.includes(user.userId)) {
        return true;
      }
      return store.socialActivityInvitations.some((invite) => invite.activityId === activity.id && invite.inviteeUserId === user.userId);
    })
    .forEach((activity) => {
      pushCalendarViewItem(buckets, {
        id: activity.id,
        source: "activity",
        title: activity.title,
        subtitle: buildActivityTimeLabel(activity),
        day: activity.day,
        startSection: activity.startSection,
        endSection: activity.endSection,
        weekExpr: String(activity.week),
        parity: "all",
        tags: [activity.activityType || "社交"],
        status: activity.status,
      });
    });
  return {
    week,
    views: (Object.keys(buckets) as CalendarViewBucketKey[]).map((key) => ({
      key,
      label: CALENDAR_VIEW_LABELS[key],
      count: buckets[key].length,
      items: sortDailyPriorityItems(
        buckets[key].map((item) => ({
          ...item,
          priorityScore: Number(item.priorityScore || (key === "learning" ? 60 : key === "social" ? 50 : 45)),
          startSection: Number(item.startSection || 99),
        })),
      ),
    })),
  };
};

const toGreeting = (now = new Date(), timeZone = SCHEDULE_DEFAULT_TIMEZONE) => {
  const hour = toDateTimeParts(now, timeZone).hour;
  if (hour < 6) {
    return "夜深了，注意休息";
  }
  if (hour < 12) {
    return "早上好，开启高效学习";
  }
  if (hour < 18) {
    return "下午好，继续保持状态";
  }
  return "晚上好，记得规划明天";
};

const toTodayBriefPayload = (context: LegacyCompanionHandlerContext, studentId: string) => {
  const { store } = context;
  const user = context.findUserByStudentId(store, studentId) || store.users[0] || null;
  const serverNow = new Date();
  const serverTimezone = user ? getUserReminderTimezone(store, user) : SCHEDULE_DEFAULT_TIMEZONE;
  const dateContext = resolveScheduleClassDateContext(serverNow, serverTimezone);
  const currentWeek = dateContext.currentWeek;
  if (!user) {
    return {
      studentId: "",
      studentName: "",
      weekNo: currentWeek,
      dayNo: 1,
      dayLabel: "周一",
      greeting: toGreeting(serverNow, serverTimezone),
      tips: ["暂无可用课表数据"],
      serverNowIso: serverNow.toISOString(),
      serverTimezone,
      termMeta: SCHEDULE_TERM_META,
      currentWeek,
      generatedAt: storeHelpers.nowIso(),
    };
  }
  const now = serverNow;
  const nowParts = dateContext.nowParts;
  const dayNo = dateContext.weekday;
  const dayLabel = `周${SCHEDULE_WEEKDAY_LABELS[dayNo - 1] || "一"}`;
  const entries = getEffectiveScheduleEntriesForUser(store, user).filter((item) => {
    return item.day === dayNo && isScheduleEntryInWeek(item, currentWeek);
  });
  const sorted = [...entries].sort((left, right) => left.startSection - right.startSection);
  const nowTs = now.getTime();
  const nextCandidate = sorted
    .map((entry) => {
      const entryTimezone = entry.timezone || serverTimezone;
      const startSlot = getSectionTimeBySection(entry.startSection) || null;
      const endSlot = getSectionTimeBySection(entry.endSection) || null;
      if (!startSlot || !endSlot) {
        return null;
      }
      const startTs = zonedDateTimeToUtc(nowParts.dateKey, startSlot.start, entryTimezone).getTime();
      const endTs = zonedDateTimeToUtc(nowParts.dateKey, endSlot.end, entryTimezone).getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
        return null;
      }
      return {
        entry,
        startSlot,
        endSlot,
        startTs,
        endTs,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.endTs > nowTs)
    .sort((left, right) => left.startTs - right.startTs)[0] || null;
  const tips: string[] = [];
  const examCountdowns = buildExamCountdowns(store, user);
  const priorityItems = buildTodayPriorityItems(store, user, currentWeek, dayNo);
  if (sorted.length === 0) {
    tips.push("今日无课，可安排复习或运动");
  } else if (sorted.length >= 4) {
    tips.push("今日课量较多，建议提前准备水和充电设备");
  } else {
    tips.push("按节奏推进，保持专注");
  }
  return {
    studentId: user.studentId || user.userId,
    studentName: context.resolveMeaningfulUserName(user) || context.resolveUserDisplayLabel(user),
    weekNo: currentWeek,
    dayNo,
    dayLabel,
    greeting: toGreeting(now, serverTimezone),
    weather: {
      status: "cloudy",
      summary: "天气平稳，适合出行",
      temperature: "18℃~24℃",
      advice: "建议携带水杯",
    },
    nextCourse: nextCandidate
      ? {
          name: nextCandidate.entry.courseName,
          startSection: nextCandidate.entry.startSection,
          endSection: nextCandidate.entry.endSection,
          startTime: nextCandidate.startSlot.start,
          endTime: nextCandidate.endSlot.end,
          minutesToStart: Math.max(1, Math.ceil((nextCandidate.startTs - nowTs) / (60 * 1000))),
          classroom: nextCandidate.entry.classroom || null,
          teacher: nextCandidate.entry.teacher || null,
          buildingLabel: "教学区",
          commuteMinutes: dayNo === 5 && nextCandidate.startSlot.start === "14:30" ? 60 : 12,
          prepMinutes: 10,
          leaveInMinutes: Math.max(
            0,
            Math.ceil((nextCandidate.startTs - nowTs) / (60 * 1000)) - (dayNo === 5 && nextCandidate.startSlot.start === "14:30" ? 60 : 12),
          ),
          prepareItems: ["学生卡", "水杯"],
          from: "cloud",
        }
      : null,
    tips,
    examCountdowns: examCountdowns.slice(0, 3),
    priorityItems,
    serverNowIso: now.toISOString(),
    serverTimezone,
    termMeta: SCHEDULE_TERM_META,
    currentWeek,
    generatedAt: storeHelpers.nowIso(),
  };
};

export const isLegacyCompanionPath = (path: string) => {
  return path === "exams/companion" ||
    path === "calendar/views" ||
    path === "schedule-import/corrections" ||
    path === "today-brief" ||
    path === "theme-images";
};

export const handleLegacyCompanionApi = async (context: LegacyCompanionHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    getStoreRevision,
    readJsonBody,
    requireLegacyAuth,
    resolveSocialActorUser,
  } = context;

  if (method === "GET" && path === "exams/companion") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const countdowns = buildExamCountdowns(store, actor);
    return {
      ok: true,
      countdowns,
      studyRoomRecommendations: [
        { label: "图书馆 3F 东区", timeRange: "08:30-10:00", reason: "历史低峰时段，适合早复习" },
        { label: "教学楼 B 区自习室", timeRange: "19:00-21:00", reason: "晚间稳定开放，距离教学区近" },
      ],
      precreatedActivities: store.socialActivities
        .filter((item) => item.createdByUserId === actor.userId && item.activityType === "exam-after")
        .map((item) => toActivityPayload(context, item, actor.userId)),
    };
  }

  if (method === "GET" && path === "calendar/views") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const week = Math.max(1, Math.min(SCHEDULE_TERM_META.maxWeek, Math.trunc(Number(query.week || resolveCurrentWeekForDate(new Date(), getUserReminderTimezone(store, actor))))));
    return {
      ok: true,
      ...buildCalendarViewsPayload(store, actor, week),
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "schedule-import/corrections") {
    const { user } = requireLegacyAuth(event);
    const body = await readJsonBody<{ jobId?: string; originalPayload?: Record<string, unknown>; correctedPayload?: Record<string, unknown> }>(event);
    const correction: ScheduleCorrectionRecord = {
      id: storeHelpers.createId("schedule_correction"),
      userId: user.userId,
      jobId: asString(body.jobId),
      originalPayload: body.originalPayload && typeof body.originalPayload === "object" ? body.originalPayload : {},
      correctedPayload: body.correctedPayload && typeof body.correctedPayload === "object" ? body.correctedPayload : {},
      createdAt: storeHelpers.nowIso(),
    };
    store.scheduleCorrections.push(correction);
    return { ok: true, correction, stateRevision: getStoreRevision() };
  }

  if (method === "GET" && path === "today-brief") {
    const studentId = asString(query.studentId || query.student_id);
    return toTodayBriefPayload(context, studentId);
  }

  if (method === "GET" && path === "theme-images") {
    return {
      ok: true,
      images: {},
      updatedAt: Date.now(),
    };
  }

  return null;
};
