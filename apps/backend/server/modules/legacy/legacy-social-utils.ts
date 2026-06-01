import {
  storeHelpers,
  type NexusStore,
  type SocialNotificationRecord,
  type SocialSubscriptionEdgeRecord,
  type UserRecord,
  type UserScheduleEventRecord,
} from "../../services/domain-store";
import {
  getEffectiveScheduleEntriesForUser,
  getUserReminderTimezone,
  isScheduleEntryInWeek,
  resolveCurrentWeekForDate,
} from "../../services/schedule-calendar";
import {
  buildSocialRelationStatus,
  normalizeVisibilityScope,
  pickStrongerVisibilityScope,
  resolveEffectiveVisibilityScope,
  type SocialVisibilityScope,
} from "../../services/social-collaboration-core";
import type { LegacyCompatState } from "./legacy-state";
import { isAdminRole } from "./legacy-user-utils";

const ensureSet = <K, V>(map: Map<K, Set<V>>, key: K) => {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const created = new Set<V>();
  map.set(key, created);
  return created;
};

export const createSocialNotification = (
  store: NexusStore,
  input: {
    type: SocialNotificationRecord["type"];
    recipientUserId: string;
    actorUserId: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  },
) => {
  const existing = store.socialNotifications.find((item) => {
    return (
      item.type === input.type &&
      item.recipientUserId === input.recipientUserId &&
      item.actorUserId === input.actorUserId &&
      JSON.stringify(item.payload || {}) === JSON.stringify(input.payload || {}) &&
      item.status === "unread"
    );
  });
  if (existing) {
    return existing;
  }
  const notification: SocialNotificationRecord = {
    id: storeHelpers.createId("notify"),
    type: input.type,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    title: input.title,
    body: input.body,
    payload: input.payload || {},
    status: "unread",
    createdAt: storeHelpers.nowIso(),
    readAt: "",
  };
  store.socialNotifications.unshift(notification);
  return notification;
};

export const findActiveSocialEdges = (
  store: NexusStore,
  subscriberUserId: string,
  targetUserId: string,
) => {
  return store.socialSubscriptionEdges.filter((item) => {
    return item.subscriberUserId === subscriberUserId && item.targetUserId === targetUserId && item.status === "active";
  });
};

const findActiveSocialEdge = (
  store: NexusStore,
  subscriberUserId: string,
  targetUserId: string,
) => {
  const edges = findActiveSocialEdges(store, subscriberUserId, targetUserId);
  const effectiveVisibility = resolveEffectiveVisibilityScope(edges);
  if (effectiveVisibility === "hidden") {
    return null;
  }
  return edges.find((item) => normalizeVisibilityScope(item.visibilityScope, "hidden") === effectiveVisibility) || edges[0] || null;
};

const getActiveSocialEdgeSources = (
  store: NexusStore,
  subscriberUserId: string,
  targetUserId: string,
) => {
  return Array.from(
    new Set(
      findActiveSocialEdges(store, subscriberUserId, targetUserId)
        .filter((item) => {
          const scope = normalizeVisibilityScope(item.visibilityScope, "hidden");
          return scope === "busy_free" || scope === "detail" || scope === "blocked";
        })
        .map((item) => item.source),
    ),
  );
};

const removeScheduleSubscriptionsByTarget = (
  store: NexusStore,
  subscriberUserId: string,
  targetUser: UserRecord,
) => {
  const targetClassIds = new Set(targetUser.classIds);
  const targetScheduleIds = store.schedules.filter((item) => targetClassIds.has(item.classId)).map((item) => item.id);
  if (targetScheduleIds.length === 0) {
    return;
  }
  store.scheduleSubscriptions = store.scheduleSubscriptions.filter((item) => {
    if (item.subscriberUserId !== subscriberUserId) {
      return true;
    }
    return !targetScheduleIds.includes(item.sourceScheduleId);
  });
};

const ensureScheduleSubscriptionsByTarget = (
  store: NexusStore,
  subscriberUserId: string,
  targetUser: UserRecord,
) => {
  const targetClassIds = new Set(targetUser.classIds);
  const targetScheduleIds = store.schedules.filter((item) => targetClassIds.has(item.classId)).map((item) => item.id);
  targetScheduleIds.forEach((scheduleId) => {
    const existing = store.scheduleSubscriptions.find(
      (item) => item.subscriberUserId === subscriberUserId && item.sourceScheduleId === scheduleId,
    );
    if (existing) {
      return;
    }
    store.scheduleSubscriptions.push({
      id: storeHelpers.createId("schedule_sub"),
      subscriberUserId,
      sourceScheduleId: scheduleId,
      baseVersionNo: 1,
      followMode: "following",
      createdAt: storeHelpers.nowIso(),
    });
  });
};

export const syncLegacySubscriptionTarget = (
  store: NexusStore,
  state: LegacyCompatState,
  subscriberUserId: string,
  targetUser: UserRecord,
) => {
  const effectiveScope = resolveEffectiveVisibilityScope(findActiveSocialEdges(store, subscriberUserId, targetUser.userId));
  if (effectiveScope === "busy_free" || effectiveScope === "detail") {
    ensureSet(state.subscriptionTargetsByUserId, subscriberUserId).add(targetUser.userId);
    ensureScheduleSubscriptionsByTarget(store, subscriberUserId, targetUser);
    return;
  }
  ensureSet(state.subscriptionTargetsByUserId, subscriberUserId).delete(targetUser.userId);
  removeScheduleSubscriptionsByTarget(store, subscriberUserId, targetUser);
};

export const upsertSocialSubscriptionEdge = (
  store: NexusStore,
  state: LegacyCompatState,
  input: {
    subscriberUserId: string;
    targetUser: UserRecord;
    visibilityScope: SocialVisibilityScope;
    source: SocialSubscriptionEdgeRecord["source"];
    circleId?: string;
  },
) => {
  const visibilityScope = normalizeVisibilityScope(input.visibilityScope);
  const sourceCircleId = input.source === "circle" ? input.circleId || "" : "";
  const existing =
    store.socialSubscriptionEdges.find((item) => {
      return (
        item.subscriberUserId === input.subscriberUserId &&
        item.targetUserId === input.targetUser.userId &&
        item.status === "active" &&
        item.source === input.source &&
        item.circleId === sourceCircleId
      );
    }) || null;
  if (existing) {
    existing.visibilityScope = pickStrongerVisibilityScope(existing.visibilityScope, visibilityScope);
    existing.updatedAt = storeHelpers.nowIso();
  } else {
    const edge: SocialSubscriptionEdgeRecord = {
      id: storeHelpers.createId("social_edge"),
      subscriberUserId: input.subscriberUserId,
      targetUserId: input.targetUser.userId,
      visibilityScope,
      source: input.source,
      circleId: sourceCircleId,
      status: "active",
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
      revokedAt: "",
    };
    store.socialSubscriptionEdges.push(edge);
  }
  syncLegacySubscriptionTarget(store, state, input.subscriberUserId, input.targetUser);
};

const upsertBlockedSocialEdge = (
  store: NexusStore,
  subscriberUserId: string,
  targetUserId: string,
) => {
  const existing = findActiveSocialEdge(store, subscriberUserId, targetUserId);
  if (existing) {
    existing.visibilityScope = "blocked";
    existing.source = "legacy";
    existing.updatedAt = storeHelpers.nowIso();
    return existing;
  }
  const edge: SocialSubscriptionEdgeRecord = {
    id: storeHelpers.createId("social_edge"),
    subscriberUserId,
    targetUserId,
    visibilityScope: "blocked",
    source: "legacy",
    circleId: "",
    status: "active",
    createdAt: storeHelpers.nowIso(),
    updatedAt: storeHelpers.nowIso(),
    revokedAt: "",
  };
  store.socialSubscriptionEdges.push(edge);
  return edge;
};

export const blockSocialSubscriptionBetweenUsers = (
  store: NexusStore,
  state: LegacyCompatState,
  leftUser: UserRecord,
  rightUser: UserRecord,
) => {
  const leftEdge = upsertBlockedSocialEdge(store, leftUser.userId, rightUser.userId);
  const rightEdge = upsertBlockedSocialEdge(store, rightUser.userId, leftUser.userId);
  syncLegacySubscriptionTarget(store, state, leftUser.userId, rightUser);
  syncLegacySubscriptionTarget(store, state, rightUser.userId, leftUser);
  return [leftEdge, rightEdge];
};

export const revokeSocialSubscriptionBetweenUsers = (
  store: NexusStore,
  state: LegacyCompatState,
  leftUser: UserRecord,
  rightUser: UserRecord,
  options: { includeCircle?: boolean } = {},
) => {
  const includeCircle = options.includeCircle !== false;
  let removed = false;
  store.socialSubscriptionEdges.forEach((edge) => {
    const matches =
      (edge.subscriberUserId === leftUser.userId && edge.targetUserId === rightUser.userId) ||
      (edge.subscriberUserId === rightUser.userId && edge.targetUserId === leftUser.userId);
    if (!matches || edge.status !== "active") {
      return;
    }
    if (!includeCircle && edge.source === "circle") {
      return;
    }
    edge.status = "revoked";
    edge.revokedAt = storeHelpers.nowIso();
    edge.updatedAt = edge.revokedAt;
    removed = true;
  });
  syncLegacySubscriptionTarget(store, state, leftUser.userId, rightUser);
  syncLegacySubscriptionTarget(store, state, rightUser.userId, leftUser);
  return removed;
};

export const resolveViewerVisibilityScope = (
  store: NexusStore,
  viewer: UserRecord,
  target: UserRecord,
): SocialVisibilityScope => {
  if (viewer.userId === target.userId || isAdminRole(viewer)) {
    return "detail";
  }
  const directEdges = findActiveSocialEdges(store, viewer.userId, target.userId);
  if (directEdges.some((item) => normalizeVisibilityScope(item.visibilityScope, "hidden") === "blocked")) {
    return "blocked";
  }
  let scope = resolveEffectiveVisibilityScope(directEdges);
  const viewerCircleIds = new Set(
    store.socialCircleMembers
      .filter((item) => item.userId === viewer.userId && item.status === "active")
      .map((item) => item.circleId),
  );
  store.socialCircleMembers
    .filter((item) => item.userId === target.userId && item.status === "active" && viewerCircleIds.has(item.circleId))
    .forEach((item) => {
      scope = pickStrongerVisibilityScope(scope, normalizeVisibilityScope(item.visibilityScope, "hidden"));
    });
  return scope;
};

export const buildSocialRelationStatusPayload = (
  store: NexusStore,
  viewer: UserRecord,
  target: UserRecord,
) => {
  const pendingRequests = store.socialSubscriptionRequests.filter((item) => {
    return (
      item.status === "pending" &&
      ((item.requesterUserId === viewer.userId && item.targetUserId === target.userId) ||
        (item.requesterUserId === target.userId && item.targetUserId === viewer.userId))
    );
  });
  const outboundPending = pendingRequests.some((item) => item.requesterUserId === viewer.userId);
  const inboundPending = pendingRequests.some((item) => item.targetUserId === viewer.userId);
  return buildSocialRelationStatus({
    isSelf: viewer.userId === target.userId,
    outboundPending,
    inboundPending,
    effectiveVisibility: resolveViewerVisibilityScope(store, viewer, target),
    activeSources: getActiveSocialEdgeSources(store, viewer.userId, target.userId),
  });
};

const eventMatchesWeekAndCell = (
  event: Pick<UserScheduleEventRecord, "weekExpr" | "parity" | "day" | "startSection" | "endSection">,
  week: number,
  day: number,
  section: number,
) => {
  return (
    event.day === day &&
    event.startSection <= section &&
    event.endSection >= section &&
    isScheduleEntryInWeek({ weekExpr: event.weekExpr, parity: event.parity }, week)
  );
};

export const isUserBusyAtCell = (store: NexusStore, user: UserRecord, week: number, day: number, section: number) => {
  const courseBusy = getEffectiveScheduleEntriesForUser(store, user).some((entry) => {
    return (
      entry.day === day &&
      entry.startSection <= section &&
      entry.endSection >= section &&
      isScheduleEntryInWeek(entry, week)
    );
  });
  if (courseBusy) {
    return true;
  }
  return store.userScheduleEvents
    .filter((item) => item.userId === user.userId)
    .some((item) => eventMatchesWeekAndCell(item, week, day, section));
};

export const isUserFreeForRange = (
  store: NexusStore,
  user: UserRecord,
  week: number,
  day: number,
  startSection: number,
  endSection: number,
) => {
  for (let section = startSection; section <= endSection; section += 1) {
    if (isUserBusyAtCell(store, user, week, day, section)) {
      return false;
    }
  }
  return true;
};

export const buildScheduleCandidateConflictPayload = (
  store: NexusStore,
  user: UserRecord,
  candidate: { day: number; startSection: number; endSection: number },
) => {
  const week = resolveCurrentWeekForDate(new Date(), getUserReminderTimezone(store, user));
  const day = Math.max(1, Math.min(7, Math.trunc(Number(candidate.day || 1))));
  const startSection = Math.max(1, Math.trunc(Number(candidate.startSection || 1)));
  const endSection = Math.max(startSection, Math.trunc(Number(candidate.endSection || startSection)));
  const hasConflict = !isUserFreeForRange(store, user, week, day, startSection, endSection);
  const alternatives: Array<{ week: number; day: number; startSection: number; endSection: number; reason: string }> = [];
  if (hasConflict) {
    const duration = endSection - startSection;
    for (let dayOffset = 0; dayOffset < 7 && alternatives.length < 3; dayOffset += 1) {
      const nextDay = ((day + dayOffset - 1) % 7) + 1;
      for (let start = 1; start + duration <= 11 && alternatives.length < 3; start += 1) {
        const end = start + duration;
        if (isUserFreeForRange(store, user, week, nextDay, start, end)) {
          alternatives.push({
            week,
            day: nextDay,
            startSection: start,
            endSection: end,
            reason: "避开你当前课表和个人日程冲突",
          });
        }
      }
    }
  }
  return {
    conflicts: hasConflict
      ? [
          {
            scope: "self",
            week,
            day,
            startSection,
            endSection,
            message: "该时间与你当前课表或个人日程冲突",
          },
        ]
      : [],
    alternatives,
  };
};
