import type { H3Event } from "h3";
import type {
  NexusStore,
  ScheduleEntryRecord,
  SocialActivityInvitationRecord,
  SocialActivityRecord,
  SocialNotificationRecord,
  UserRecord,
  UserScheduleEventRecord,
} from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import {
  buildActivitySplitDraft,
  buildActivitySnapshotPosterSvg,
  canUseSocialAccess,
  resolveNextActivityStatus,
  type SocialVisibilityScope,
} from "../../services/social-collaboration-core";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveSocialActorUser = (store: NexusStore, accountUser: UserRecord) => UserRecord;
type FindUserByUserId = (store: NexusStore, userId: string) => UserRecord | null;
type FindUserByStudentId = (store: NexusStore, studentId: string) => UserRecord | null;
type IsAdminRole = (user: UserRecord) => boolean;
type ResolveViewerVisibilityScope = (store: NexusStore, viewer: UserRecord, target: UserRecord) => SocialVisibilityScope;
type BuildSocialRelationStatusPayload = (store: NexusStore, viewer: UserRecord, target: UserRecord) => Record<string, unknown>;
type GetEffectiveScheduleEntriesForUser = (store: NexusStore, user: UserRecord) => ScheduleEntryRecord[];
type IsScheduleEntryInWeek = (entry: Pick<ScheduleEntryRecord, "weekExpr" | "parity">, week: number) => boolean;
type SetHeader = (event: H3Event, name: string, value: string) => void;
type CreateSocialNotification = (
  store: NexusStore,
  input: {
    type: SocialNotificationRecord["type"];
    recipientUserId: string;
    actorUserId: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  },
) => SocialNotificationRecord;

export interface LegacySocialActivityHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  getStoreRevision: () => number;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  resolveSocialActorUser: ResolveSocialActorUser;
  findUserByUserId: FindUserByUserId;
  findUserByStudentId: FindUserByStudentId;
  isAdminRole: IsAdminRole;
  resolveViewerVisibilityScope: ResolveViewerVisibilityScope;
  buildSocialRelationStatusPayload: BuildSocialRelationStatusPayload;
  getEffectiveScheduleEntriesForUser: GetEffectiveScheduleEntriesForUser;
  isScheduleEntryInWeek: IsScheduleEntryInWeek;
  setHeader: SetHeader;
  createSocialNotification: CreateSocialNotification;
}

const SECTION_TIMES = [
  { section: 1, start: "08:00", end: "08:45" },
  { section: 2, start: "08:50", end: "09:35" },
  { section: 3, start: "09:55", end: "10:40" },
  { section: 4, start: "10:45", end: "11:30" },
  { section: 5, start: "14:30", end: "15:15" },
  { section: 6, start: "15:20", end: "16:05" },
  { section: 7, start: "16:25", end: "17:10" },
  { section: 8, start: "17:15", end: "18:00" },
  { section: 9, start: "19:00", end: "19:45" },
  { section: 10, start: "19:50", end: "20:35" },
  { section: 11, start: "20:40", end: "21:25" },
] as const;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;
const WEEK1_MONDAY = "2026-03-02";
const MAX_WEEK = 25;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

const asString = (value: unknown) => String(value || "").trim();

const getSectionTimeBySection = (section: number) => SECTION_TIMES.find((item) => item.section === section) || null;

const addDaysToDateKey = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const zonedDateTimeToUtc = (dateKey: string, time: string, timezone: string) => {
  const [year, month, day] = dateKey.split("-").map((item) => Number(item));
  const [hour, minute] = time.split(":").map((item) => Number(item));
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (timezone !== "Asia/Shanghai") {
    return new Date(localAsUtc);
  }
  return new Date(localAsUtc - 8 * 60 * 60 * 1000);
};

const resolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  const name = asString(user.name);
  if (name && name !== asString(user.studentNo) && name !== asString(user.studentId)) {
    return name;
  }
  const nickname = asString(user.nickname);
  if (nickname && nickname !== asString(user.studentNo) && nickname !== asString(user.studentId)) {
    return nickname;
  }
  return asString(user.studentNo) || asString(user.studentId) || "未命名用户";
};

const toSocialUserBrief = (user: UserRecord | null) => {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    studentId: user.studentId || "",
    studentNo: user.studentNo || "",
    name: resolveUserDisplayLabel(user),
    classLabel: user.classLabel || "",
    avatarUrl: user.avatarUrl || "",
  };
};

const buildActivityTimeLabel = (activity: Pick<SocialActivityRecord, "week" | "day" | "startSection" | "endSection">) => {
  const startSlot = getSectionTimeBySection(activity.startSection);
  const endSlot = getSectionTimeBySection(activity.endSection);
  const weekday = WEEKDAY_LABELS[Math.max(1, activity.day) - 1] || "一";
  const timeRange = startSlot && endSlot ? `${startSlot.start}-${endSlot.end}` : `第 ${activity.startSection}-${activity.endSection} 节`;
  return `第 ${activity.week} 周 周${weekday} ${timeRange}`;
};

const toActivityPayload = (
  store: NexusStore,
  findUserByUserId: FindUserByUserId,
  item: SocialActivityRecord,
  viewerUserId = "",
) => {
  const invitations = store.socialActivityInvitations.filter((invite) => invite.activityId === item.id);
  const viewerInvitation = invitations.find((invite) => invite.inviteeUserId === viewerUserId) || null;
  const creator = findUserByUserId(store, item.createdByUserId);
  return {
    activityId: item.id,
    title: item.title,
    activityType: item.activityType,
    status: item.status,
    createdBy: toSocialUserBrief(creator),
    week: item.week,
    day: item.day,
    startSection: item.startSection,
    endSection: item.endSection,
    timeLabel: buildActivityTimeLabel(item),
    participantStudentIds: item.participantUserIds
      .map((userId) => findUserByUserId(store, userId)?.studentId || "")
      .filter((studentId) => studentId),
    participants: item.participantUserIds
      .map((userId) => toSocialUserBrief(findUserByUserId(store, userId)))
      .filter((user): user is NonNullable<typeof user> => Boolean(user)),
    invitations: invitations.map((invite) => ({
      invitationId: invite.id,
      status: invite.status,
      invitee: toSocialUserBrief(findUserByUserId(store, invite.inviteeUserId)),
      inviter: toSocialUserBrief(findUserByUserId(store, invite.inviterUserId)),
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

const normalizeStudentIdList = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  value.forEach((item) => {
    const studentId = asString(item);
    if (!studentId || seen.has(studentId)) {
      return;
    }
    seen.add(studentId);
    result.push(studentId);
  });
  return result;
};

const toIcsDateTime = (iso: string) => {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

const buildActivityIcs = (activity: SocialActivityRecord) => {
  const startSlot = getSectionTimeBySection(activity.startSection) || SECTION_TIMES[0];
  const endSlot = getSectionTimeBySection(activity.endSection) || startSlot;
  const dateKey = addDaysToDateKey(WEEK1_MONDAY, (Math.max(1, activity.week) - 1) * 7 + Math.max(0, activity.day - 1));
  const startIso = zonedDateTimeToUtc(dateKey, startSlot.start, DEFAULT_TIMEZONE).toISOString();
  const endIso = zonedDateTimeToUtc(dateKey, endSlot.end, DEFAULT_TIMEZONE).toISOString();
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TouchX//Schedule Activity//CN",
    "BEGIN:VEVENT",
    `UID:${activity.id}@touchx-schedule`,
    `DTSTAMP:${toIcsDateTime(activity.createdAt)}`,
    `DTSTART:${toIcsDateTime(startIso)}`,
    `DTEND:${toIcsDateTime(endIso)}`,
    `SUMMARY:${activity.title}`,
    `DESCRIPTION:${asString(activity.metadata?.description) || "简程组局活动"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

const normalizeMoneyAmount = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return Number(amount.toFixed(2));
};

const eventMatchesWeekAndCell = (
  event: Pick<UserScheduleEventRecord, "weekExpr" | "parity" | "day" | "startSection" | "endSection">,
  week: number,
  day: number,
  section: number,
  isScheduleEntryInWeek: IsScheduleEntryInWeek,
) => {
  return (
    event.day === day &&
    event.startSection <= section &&
    event.endSection >= section &&
    isScheduleEntryInWeek({ weekExpr: event.weekExpr, parity: event.parity }, week)
  );
};

const isUserBusyAtCell = (
  context: LegacySocialActivityHandlerContext,
  user: UserRecord,
  week: number,
  day: number,
  section: number,
) => {
  const courseBusy = context.getEffectiveScheduleEntriesForUser(context.store, user).some((entry) => {
    return (
      entry.day === day &&
      entry.startSection <= section &&
      entry.endSection >= section &&
      context.isScheduleEntryInWeek(entry, week)
    );
  });
  if (courseBusy) {
    return true;
  }
  return context.store.userScheduleEvents
    .filter((item) => item.userId === user.userId)
    .some((item) => eventMatchesWeekAndCell(item, week, day, section, context.isScheduleEntryInWeek));
};

const resolveHeatmapUsers = (context: LegacySocialActivityHandlerContext, viewer: UserRecord) => {
  const { query, store, toApiError, findUserByStudentId, findUserByUserId, isAdminRole, resolveViewerVisibilityScope } = context;
  const circleId = asString(query.circleId || query.circle_id);
  if (circleId) {
    const circle = store.socialCircles.find((item) => item.id === circleId || item.inviteToken === circleId) || null;
    if (!circle) {
      return toApiError(404, "CIRCLE_NOT_FOUND", "圈子不存在");
    }
    const viewerMember = store.socialCircleMembers.find(
      (item) => item.circleId === circle.id && item.userId === viewer.userId && item.status === "active",
    );
    if (!viewerMember && !isAdminRole(viewer)) {
      return toApiError(403, "CIRCLE_FORBIDDEN", "无权查看该圈子热力图");
    }
    return store.socialCircleMembers
      .filter((item) => item.circleId === circle.id && item.status === "active")
      .map((item) => findUserByUserId(store, item.userId))
      .filter((item): item is UserRecord => Boolean(item))
      .slice(0, 80);
  }

  const studentIds = asString(query.studentIds || query.student_ids)
    .split(",")
    .map((item) => asString(item))
    .filter((item) => item);
  const users = [viewer, ...studentIds.map((studentId) => findUserByStudentId(store, studentId)).filter((item): item is UserRecord => Boolean(item))];
  const seen = new Set<string>();
  return users
    .filter((target) => {
      if (seen.has(target.userId)) {
        return false;
      }
      seen.add(target.userId);
      const scope = resolveViewerVisibilityScope(store, viewer, target);
      return scope === "busy_free" || scope === "detail";
    })
    .slice(0, 40);
};

const resolveAuthorizedParticipantUsers = (context: LegacySocialActivityHandlerContext, actor: UserRecord, studentIds: unknown) => {
  return normalizeStudentIdList(studentIds)
    .map((studentId) => context.findUserByStudentId(context.store, studentId))
    .filter((item): item is UserRecord => Boolean(item))
    .filter((target) => {
      if (target.userId === actor.userId) {
        return true;
      }
      return canUseSocialAccess({
        relationStatus: context.buildSocialRelationStatusPayload(context.store, actor, target),
      });
    });
};

const buildFreeHeatmapPayload = (context: LegacySocialActivityHandlerContext, users: UserRecord[], week: number) => {
  const cells = SECTION_TIMES.flatMap((slot) => {
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const day = dayIndex + 1;
      const busyUsers = users.filter((user) => isUserBusyAtCell(context, user, week, day, slot.section));
      const totalCount = users.length;
      const busyCount = busyUsers.length;
      const freeCount = Math.max(0, totalCount - busyCount);
      return {
        week,
        day,
        dayLabel: `周${WEEKDAY_LABELS[day - 1] || "一"}`,
        section: slot.section,
        startTime: slot.start,
        endTime: slot.end,
        totalCount,
        busyCount,
        freeCount,
        freeRatio: totalCount > 0 ? Number((freeCount / totalCount).toFixed(4)) : 0,
      };
    });
  });
  return {
    week,
    participantCount: users.length,
    participants: users.map((user) => toSocialUserBrief(user)),
    cells,
  };
};

const estimateActivitySuccess = (
  store: NexusStore,
  input: {
    activityType: string;
    day: number;
    startSection: number;
    participantUserIds: string[];
  },
) => {
  const sameTypeActivities = store.socialActivities.filter((item) => item.activityType === input.activityType);
  const historical = sameTypeActivities.filter((item) => {
    const participantSet = new Set(item.participantUserIds);
    return input.participantUserIds.some((userId) => participantSet.has(userId));
  });
  const confirmedCount = historical.filter((item) => item.status === "confirmed").length;
  const historicalRate = historical.length > 0 ? confirmedCount / historical.length : 0;
  let score = historical.length >= 3 ? historicalRate : 0.68;
  if (input.day >= 1 && input.day <= 5 && input.startSection >= 9) {
    score += 0.08;
  }
  if (input.startSection <= 2 || input.day >= 6) {
    score -= 0.08;
  }
  if (input.participantUserIds.length >= 6) {
    score -= 0.06;
  }
  const successRate = Math.max(0.2, Math.min(0.95, score));
  const suggestions: string[] = [];
  if (input.startSection <= 2) {
    suggestions.push("避开早八时段，改到晚间通常确认率更高");
  }
  if (input.participantUserIds.length >= 6) {
    suggestions.push("参与人数较多，建议先确认核心成员再扩散邀请");
  }
  if (input.day >= 6) {
    suggestions.push("周末安排建议提前一天提醒，降低临时爽约");
  }
  if (suggestions.length === 0) {
    suggestions.push("当前时间段适合直接发起，确认后可同步日历");
  }
  return {
    successRate: Number(successRate.toFixed(2)),
    confidence: historical.length >= 5 ? "medium" : "low",
    sampleCount: historical.length,
    suggestions,
  };
};

const buildSmartReminderLead = (input: { distanceMeters: number; activityType: string; locationLabel: string }) => {
  const walkingMinutes = Math.ceil(Math.max(0, input.distanceMeters) / 80);
  const lowerType = input.activityType.toLowerCase();
  const isExam = /exam|考试|期末|期中/.test(lowerType);
  const isMeal = /meal|food|聚餐|吃饭/.test(lowerType);
  const location = input.locationLabel;
  let bufferMinutes = 5;
  if (isExam) {
    bufferMinutes = 15;
  } else if (/教室|教学楼|实验室|library|图书馆/.test(location)) {
    bufferMinutes = 8;
  } else if (isMeal) {
    bufferMinutes = 3;
  }
  const leadMinutes = Math.max(5, Math.min(90, walkingMinutes + bufferMinutes));
  return {
    leadMinutes,
    walkingMinutes,
    bufferMinutes,
    reason: `按步行 ${walkingMinutes} 分钟 + 预留 ${bufferMinutes} 分钟计算`,
  };
};

export const isLegacySocialActivityPath = (path: string) => {
  return (
    path === "social/free-heatmap" ||
    path === "social/activities/predict" ||
    path === "social/reminders/smart-lead" ||
    path === "social/activities" ||
    path === "social/activities/calendar.ics" ||
    /^social\/activities\/[^/]+\/snapshot$/.test(path) ||
    /^social\/activities\/[^/]+\/splits$/.test(path) ||
    /^social\/activities\/[^/]+\/cancel$/.test(path) ||
    /^social\/activities\/[^/]+\/expire$/.test(path) ||
    /^social\/activities\/[^/]+\/invitations\/[^/]+\/respond$/.test(path)
  );
};

export const handleLegacySocialActivityApi = async (context: LegacySocialActivityHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    getStoreRevision,
    toApiError,
    readJsonBody,
    requireLegacyAuth,
    resolveSocialActorUser,
    findUserByUserId,
    isAdminRole,
    setHeader,
    createSocialNotification,
  } = context;

  if (method === "GET" && path === "social/free-heatmap") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const week = Math.max(1, Math.min(MAX_WEEK, Math.trunc(Number(query.week || 1))));
    const users = resolveHeatmapUsers(context, actor);
    return {
      ok: true,
      heatmap: buildFreeHeatmapPayload(context, users, week),
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/activities/predict") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{
      activityType?: string;
      activity_type?: string;
      day?: number;
      startSection?: number;
      start_section?: number;
      participantStudentIds?: string[];
      participant_student_ids?: string[];
    }>(event);
    const participantUsers = resolveAuthorizedParticipantUsers(context, actor, body.participantStudentIds || body.participant_student_ids);
    const participantUserIds = Array.from(new Set([actor.userId, ...participantUsers.map((item) => item.userId)]));
    const prediction = estimateActivitySuccess(store, {
      activityType: asString(body.activityType || body.activity_type) || "study",
      day: Math.max(1, Math.min(7, Math.trunc(Number(body.day || 1)))),
      startSection: Math.max(1, Math.trunc(Number(body.startSection || body.start_section || 1))),
      participantUserIds,
    });
    return {
      ok: true,
      prediction,
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/reminders/smart-lead") {
    requireLegacyAuth(event);
    const body = await readJsonBody<{
      distanceMeters?: number;
      distance_meters?: number;
      activityType?: string;
      activity_type?: string;
      locationLabel?: string;
      location_label?: string;
    }>(event);
    const reminder = buildSmartReminderLead({
      distanceMeters: Number(body.distanceMeters || body.distance_meters || 0),
      activityType: asString(body.activityType || body.activity_type),
      locationLabel: asString(body.locationLabel || body.location_label),
    });
    return {
      ok: true,
      reminder,
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "GET" && path === "social/activities") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const items = store.socialActivities
      .filter((item) => item.createdByUserId === actor.userId || item.participantUserIds.includes(actor.userId))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((item) => toActivityPayload(store, findUserByUserId, item, actor.userId));
    return { ok: true, items, stateRevision: getStoreRevision() };
  }

  if (method === "GET" && path === "social/activities/calendar.ics") {
    const activityId = asString(query.activityId || query.activity_id);
    const calendarToken = asString(query.token || query.calendarToken || query.calendar_token);
    const activity = store.socialActivities.find((item) => item.id === activityId) || null;
    if (!activity) {
      return toApiError(404, "ACTIVITY_NOT_FOUND", "活动不存在");
    }
    if (calendarToken !== activity.calendarToken) {
      const { user } = requireLegacyAuth(event);
      const actor = resolveSocialActorUser(store, user);
      if (activity.createdByUserId !== actor.userId && !activity.participantUserIds.includes(actor.userId) && !isAdminRole(user)) {
        return toApiError(403, "ACTIVITY_FORBIDDEN", "无权导出该活动");
      }
    }
    setHeader(event, "content-type", "text/calendar; charset=utf-8");
    setHeader(event, "content-disposition", `attachment; filename=\"${encodeURIComponent(activity.title)}.ics\"`);
    return buildActivityIcs(activity);
  }

  const activitySnapshotMatch = path.match(/^social\/activities\/([^/]+)\/snapshot$/);
  if (method === "GET" && activitySnapshotMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const activityId = decodeURIComponent(activitySnapshotMatch[1]);
    const activity = store.socialActivities.find((item) => item.id === activityId) || null;
    if (!activity) {
      return toApiError(404, "ACTIVITY_NOT_FOUND", "活动不存在");
    }
    if (activity.createdByUserId !== actor.userId && !activity.participantUserIds.includes(actor.userId) && !isAdminRole(user)) {
      return toApiError(403, "ACTIVITY_FORBIDDEN", "无权查看该活动");
    }
    const participants = activity.participantUserIds
      .map((userId) => findUserByUserId(store, userId))
      .filter((item): item is UserRecord => Boolean(item));
    const participantNames = participants.map((item) => resolveUserDisplayLabel(item));
    const statusLabel = activity.status === "confirmed" ? "已确认" : activity.status === "inviting" ? "邀请中" : "待发送";
    const timeLabel = buildActivityTimeLabel(activity);
    const posterSvg = buildActivitySnapshotPosterSvg({
      title: activity.title,
      statusLabel,
      timeLabel,
      participants: participantNames,
    });
    const card = {
      title: activity.title,
      status: activity.status,
      statusLabel,
      timeLabel,
      participants: participantNames,
      shareText: `「${activity.title}」${timeLabel}，参与人：${participantNames.join("、")}`,
      posterSvg,
      posterDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(posterSvg)}`,
      calendarPath: `/api/v1/social/activities/calendar.ics?activityId=${encodeURIComponent(activity.id)}&token=${encodeURIComponent(activity.calendarToken)}`,
    };
    return {
      ok: true,
      card,
      stateRevision: getStoreRevision(),
    };
  }

  const activitySplitMatch = path.match(/^social\/activities\/([^/]+)\/splits$/);
  if (method === "POST" && activitySplitMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const activityId = decodeURIComponent(activitySplitMatch[1]);
    const activity = store.socialActivities.find((item) => item.id === activityId) || null;
    if (!activity) {
      return toApiError(404, "ACTIVITY_NOT_FOUND", "活动不存在");
    }
    if (activity.createdByUserId !== actor.userId && !isAdminRole(user)) {
      return toApiError(403, "ACTIVITY_SPLIT_FORBIDDEN", "仅发起人可编辑分摊");
    }
    const body = await readJsonBody<{
      totalAmount?: number;
      total_amount?: number;
      currency?: string;
      perPerson?: Array<{ userId?: string; studentId?: string; amount?: number }>;
      per_person?: Array<{ userId?: string; studentId?: string; amount?: number }>;
    }>(event);
    const participantUsers = activity.participantUserIds
      .map((userId) => findUserByUserId(store, userId))
      .filter((item): item is UserRecord => Boolean(item));
    let split: ReturnType<typeof buildActivitySplitDraft> | null = null;
    try {
      split = buildActivitySplitDraft({
        activityId: activity.id,
        totalAmount: normalizeMoneyAmount(body.totalAmount || body.total_amount),
        currency: asString(body.currency) || "CNY",
        participants: participantUsers.map((item) => ({
          userId: item.userId,
          studentId: item.studentId || "",
          name: resolveUserDisplayLabel(item),
        })),
        perPerson: body.perPerson || body.per_person,
      });
    } catch (error) {
      return toApiError(400, "ACTIVITY_SPLIT_INVALID", error instanceof Error ? error.message : "分摊金额不合法");
    }
    if (!split) {
      return toApiError(400, "ACTIVITY_SPLIT_INVALID", "分摊金额不合法");
    }
    activity.metadata = {
      ...(activity.metadata || {}),
      split,
    };
    activity.updatedAt = storeHelpers.nowIso();
    return {
      ok: true,
      split,
      activity: toActivityPayload(store, findUserByUserId, activity, actor.userId),
      stateRevision: getStoreRevision(),
    };
  }

  const activityCancelMatch = path.match(/^social\/activities\/([^/]+)\/cancel$/);
  if (method === "POST" && activityCancelMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const activityId = decodeURIComponent(activityCancelMatch[1]);
    const activity = store.socialActivities.find((item) => item.id === activityId) || null;
    if (!activity) {
      return toApiError(404, "ACTIVITY_NOT_FOUND", "活动不存在");
    }
    if (activity.createdByUserId !== actor.userId && !isAdminRole(user)) {
      return toApiError(403, "ACTIVITY_CANCEL_FORBIDDEN", "仅发起人可取消活动");
    }
    const previousStatus = activity.status;
    activity.status = resolveNextActivityStatus(activity.status, "cancel");
    activity.updatedAt = storeHelpers.nowIso();
    if (previousStatus !== activity.status) {
      activity.participantUserIds.forEach((recipientUserId) => {
        if (recipientUserId === actor.userId) {
          return;
        }
        createSocialNotification(store, {
          type: "activity_cancelled",
          recipientUserId,
          actorUserId: actor.userId,
          title: "组局已取消",
          body: `「${activity.title}」已被发起人取消`,
          payload: { activityId: activity.id },
        });
      });
    }
    return {
      ok: true,
      activity: toActivityPayload(store, findUserByUserId, activity, actor.userId),
      stateRevision: getStoreRevision(),
    };
  }

  const activityExpireMatch = path.match(/^social\/activities\/([^/]+)\/expire$/);
  if (method === "POST" && activityExpireMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const activityId = decodeURIComponent(activityExpireMatch[1]);
    const activity = store.socialActivities.find((item) => item.id === activityId) || null;
    if (!activity) {
      return toApiError(404, "ACTIVITY_NOT_FOUND", "活动不存在");
    }
    if (activity.createdByUserId !== actor.userId && !isAdminRole(user)) {
      return toApiError(403, "ACTIVITY_EXPIRE_FORBIDDEN", "仅发起人可过期活动");
    }
    const previousStatus = activity.status;
    activity.status = resolveNextActivityStatus(activity.status, "expire");
    activity.updatedAt = storeHelpers.nowIso();
    if (previousStatus !== activity.status) {
      activity.participantUserIds.forEach((recipientUserId) => {
        createSocialNotification(store, {
          type: "activity_expired",
          recipientUserId,
          actorUserId: actor.userId,
          title: "组局已过期",
          body: `「${activity.title}」已过期，无法继续响应`,
          payload: { activityId: activity.id },
        });
      });
    }
    return {
      ok: true,
      activity: toActivityPayload(store, findUserByUserId, activity, actor.userId),
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/activities") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{
      title?: string;
      activityType?: string;
      activity_type?: string;
      week?: number;
      day?: number;
      startSection?: number;
      start_section?: number;
      endSection?: number;
      end_section?: number;
      participantStudentIds?: string[];
      participant_student_ids?: string[];
      description?: string;
      sendNow?: boolean;
    }>(event);
    const title = asString(body.title) || "新的组局";
    const activityType = asString(body.activityType || body.activity_type) || "study";
    const week = Math.max(1, Math.min(MAX_WEEK, Math.trunc(Number(body.week || 1))));
    const day = Math.max(1, Math.min(7, Math.trunc(Number(body.day || 1))));
    const startSection = Math.max(1, Math.trunc(Number(body.startSection || body.start_section || 1)));
    const endSection = Math.max(startSection, Math.trunc(Number(body.endSection || body.end_section || startSection)));
    const participantUsers = resolveAuthorizedParticipantUsers(context, actor, body.participantStudentIds || body.participant_student_ids);
    const participantUserIds = Array.from(new Set([actor.userId, ...participantUsers.map((item) => item.userId)]));
    const status = body.sendNow === false ? "draft" : resolveNextActivityStatus("draft", "send");
    const activity: SocialActivityRecord = {
      id: storeHelpers.createId("activity"),
      title,
      activityType,
      status,
      createdByUserId: actor.userId,
      participantUserIds,
      week,
      day,
      startSection,
      endSection,
      calendarToken: storeHelpers.generateShareToken(),
      metadata: { description: asString(body.description) },
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.socialActivities.push(activity);
    participantUsers.forEach((targetUser) => {
      const invitation: SocialActivityInvitationRecord = {
        id: storeHelpers.createId("activity_invite"),
        activityId: activity.id,
        inviterUserId: actor.userId,
        inviteeUserId: targetUser.userId,
        status: "pending",
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
        respondedAt: "",
      };
      store.socialActivityInvitations.push(invitation);
      createSocialNotification(store, {
        type: "activity_invite",
        recipientUserId: targetUser.userId,
        actorUserId: actor.userId,
        title: "新的组局邀请",
        body: `${resolveUserDisplayLabel(actor)} 邀请你参加「${title}」`,
        payload: { activityId: activity.id, invitationId: invitation.id },
      });
    });
    return { ok: true, activity: toActivityPayload(store, findUserByUserId, activity, actor.userId), stateRevision: getStoreRevision() };
  }

  const activityInvitationRespondMatch = path.match(/^social\/activities\/([^/]+)\/invitations\/([^/]+)\/respond$/);
  if (method === "POST" && activityInvitationRespondMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const activityId = decodeURIComponent(activityInvitationRespondMatch[1]);
    const invitationId = decodeURIComponent(activityInvitationRespondMatch[2]);
    const activity = store.socialActivities.find((item) => item.id === activityId) || null;
    if (!activity) {
      return toApiError(404, "ACTIVITY_NOT_FOUND", "活动不存在");
    }
    const invitation =
      store.socialActivityInvitations.find((item) => item.id === invitationId && item.activityId === activity.id) || null;
    if (!invitation) {
      return toApiError(404, "ACTIVITY_INVITATION_NOT_FOUND", "活动邀请不存在");
    }
    if (invitation.inviteeUserId !== actor.userId && !isAdminRole(user)) {
      return toApiError(403, "ACTIVITY_INVITATION_FORBIDDEN", "无权处理该活动邀请");
    }
    if (activity.status === "cancelled" || activity.status === "expired") {
      return toApiError(400, "ACTIVITY_NOT_RESPONDABLE", "活动已取消或过期，无法继续响应");
    }
    const body = await readJsonBody<{ action?: string }>(event);
    const action = asString(body.action);
    invitation.status = action === "decline" || action === "declined" ? "declined" : "accepted";
    invitation.respondedAt = storeHelpers.nowIso();
    invitation.updatedAt = invitation.respondedAt;
    activity.updatedAt = invitation.updatedAt;
    if (invitation.status === "declined") {
      createSocialNotification(store, {
        type: "activity_invite",
        recipientUserId: activity.createdByUserId,
        actorUserId: actor.userId,
        title: "组局邀请已拒绝",
        body: `${resolveUserDisplayLabel(actor)} 拒绝了「${activity.title}」`,
        payload: { activityId: activity.id, invitationId: invitation.id, status: "declined" },
      });
    }
    const invitations = store.socialActivityInvitations.filter((item) => item.activityId === activity.id);
    if (invitations.length > 0 && invitations.every((item) => item.status === "accepted")) {
      activity.status = resolveNextActivityStatus(activity.status, "confirm");
      activity.participantUserIds = Array.from(new Set([activity.createdByUserId, ...invitations.map((item) => item.inviteeUserId)]));
      activity.participantUserIds.forEach((recipientUserId) => {
        createSocialNotification(store, {
          type: "activity_confirmed",
          recipientUserId,
          actorUserId: actor.userId,
          title: "组局已确认",
          body: `「${activity.title}」已确认，可导出日历`,
          payload: { activityId: activity.id },
        });
      });
    }
    return {
      ok: true,
      invitation,
      activity: toActivityPayload(store, findUserByUserId, activity, actor.userId),
      stateRevision: getStoreRevision(),
    };
  }

  return null;
};
