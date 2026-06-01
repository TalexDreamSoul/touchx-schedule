import type { H3Event } from "h3";
import type {
  NexusStore,
  SocialNotificationRecord,
  SocialSubscriptionEdgeRecord,
  SocialSubscriptionRequestRecord,
  UserRecord,
} from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import {
  buildSocialRelationStatus,
  normalizeVisibilityScope,
  pickStrongerVisibilityScope,
  resolveEffectiveVisibilityScope,
  type SocialVisibilityScope,
} from "../../services/social-collaboration-core";
import { toLegacyCirclePayload } from "./legacy-circle-handler";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveSocialActorUser = (store: NexusStore, accountUser: UserRecord) => UserRecord;
type ResolveRecipientUserIds = (store: NexusStore, accountUser: UserRecord) => string[];
type FindUserByStudentId = (store: NexusStore, studentId: string) => UserRecord | null;
type IsAdminRole = (user: UserRecord) => boolean;
type UpsertSocialSubscriptionEdge = (
  store: NexusStore,
  input: {
    subscriberUserId: string;
    targetUser: UserRecord;
    visibilityScope: SocialVisibilityScope;
    source: SocialSubscriptionEdgeRecord["source"];
    circleId?: string;
  },
) => void;
type RevokeSocialSubscriptionBetweenUsers = (
  store: NexusStore,
  leftUser: UserRecord,
  rightUser: UserRecord,
  options?: { includeCircle?: boolean },
) => boolean;
type BlockSocialSubscriptionBetweenUsers = (store: NexusStore, leftUser: UserRecord, rightUser: UserRecord) => SocialSubscriptionEdgeRecord[];
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

export interface LegacySocialRelationState {
  randomCodeByUserId: Map<string, string>;
  notifyBoundUserIds: Set<string>;
  practiceCourseKeysByUserId: Map<string, Set<string>>;
  subscriptionTargetsByUserId: Map<string, Set<string>>;
}

export interface LegacySocialRelationHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  state: LegacySocialRelationState;
  getStoreRevision: () => number;
  toApiError: ApiError;
  readJsonBody: ReadJsonBody;
  requireLegacyAuth: RequireLegacyAuth;
  resolveSocialActorUser: ResolveSocialActorUser;
  resolveRecipientUserIds: ResolveRecipientUserIds;
  findUserByStudentId: FindUserByStudentId;
  isAdminRole: IsAdminRole;
  upsertSocialSubscriptionEdge: UpsertSocialSubscriptionEdge;
  revokeSocialSubscriptionBetweenUsers: RevokeSocialSubscriptionBetweenUsers;
  blockSocialSubscriptionBetweenUsers: BlockSocialSubscriptionBetweenUsers;
  createSocialNotification: CreateSocialNotification;
}

const asString = (value: unknown) => String(value || "").trim();

const findUserByUserId = (store: NexusStore, userId: string) => {
  const normalized = asString(userId);
  if (!normalized) {
    return null;
  }
  return store.users.find((item) => item.userId === normalized) || null;
};

const isPlaceholderIdentityText = (user: Pick<UserRecord, "studentNo" | "studentId">, value: unknown) => {
  const normalized = asString(value);
  if (!normalized) {
    return false;
  }
  if (normalized === asString(user.studentNo) || normalized === asString(user.studentId)) {
    return true;
  }
  return /^\d{6,32}$/.test(normalized);
};

const resolveMeaningfulUserName = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  const name = asString(user.name);
  if (name && !isPlaceholderIdentityText(user, name)) {
    return name;
  }
  const nickname = asString(user.nickname);
  if (nickname && !isPlaceholderIdentityText(user, nickname)) {
    return nickname;
  }
  return "";
};

const resolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => {
  return resolveMeaningfulUserName(user) || asString(user.studentNo) || asString(user.studentId) || "未命名用户";
};

export const toLegacyRelationSocialUser = (
  user: UserRecord,
  state: LegacySocialRelationState,
  options?: { accountUser?: UserRecord; randomCodeOwnerUserId?: string },
) => {
  const accountUser = options?.accountUser || user;
  const randomCodeOwnerUserId = options?.randomCodeOwnerUserId || user.userId;
  const practiceCourseKeys = Array.from(state.practiceCourseKeysByUserId.get(accountUser.userId) || []);
  return {
    studentId: user.studentId || "",
    studentNo: user.studentNo || "",
    name: resolveUserDisplayLabel(user),
    classLabel: user.classLabel || "",
    avatarUrl: accountUser.avatarUrl || user.avatarUrl || "",
    wallpaperUrl: accountUser.wallpaperUrl || user.wallpaperUrl || "",
    randomCode: state.randomCodeByUserId.get(randomCodeOwnerUserId) || "",
    isAdmin: accountUser.adminRole === "super_admin" || accountUser.adminRole === "operator",
    notifyBound: state.notifyBoundUserIds.has(accountUser.userId),
    practiceCourseKeys,
  };
};

const findActiveSocialEdges = (store: NexusStore, subscriberUserId: string, targetUserId: string) => {
  return store.socialSubscriptionEdges.filter((item) => {
    return item.subscriberUserId === subscriberUserId && item.targetUserId === targetUserId && item.status === "active";
  });
};

const findActiveSocialEdge = (store: NexusStore, subscriberUserId: string, targetUserId: string) => {
  const edges = findActiveSocialEdges(store, subscriberUserId, targetUserId);
  const effectiveVisibility = resolveEffectiveVisibilityScope(edges);
  if (effectiveVisibility === "hidden") {
    return null;
  }
  return edges.find((item) => normalizeVisibilityScope(item.visibilityScope, "hidden") === effectiveVisibility) || edges[0] || null;
};

const getActiveSocialEdgeSources = (store: NexusStore, subscriberUserId: string, targetUserId: string) => {
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

const hasCircleAccessBetweenUsers = (store: NexusStore, leftUserId: string, rightUserId: string) => {
  const activeByUserId = new Map<string, Set<string>>();
  store.socialCircleMembers
    .filter((item) => item.status === "active")
    .forEach((item) => {
      if (!activeByUserId.has(item.userId)) {
        activeByUserId.set(item.userId, new Set<string>());
      }
      activeByUserId.get(item.userId)?.add(item.circleId);
    });
  const leftCircleIds = activeByUserId.get(leftUserId) || new Set<string>();
  const rightCircleIds = activeByUserId.get(rightUserId) || new Set<string>();
  return Array.from(leftCircleIds).some((circleId) => rightCircleIds.has(circleId));
};

export const resolveLegacyViewerVisibilityScope = (
  store: NexusStore,
  viewer: UserRecord,
  target: UserRecord,
  isAdminRole: IsAdminRole = (user) => user.adminRole === "super_admin" || user.adminRole === "operator",
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

const buildSocialRelationStatusPayload = (
  store: NexusStore,
  viewer: UserRecord,
  target: UserRecord,
  isAdminRole: IsAdminRole,
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
    effectiveVisibility: resolveLegacyViewerVisibilityScope(store, viewer, target, isAdminRole),
    activeSources: getActiveSocialEdgeSources(store, viewer.userId, target.userId),
  });
};

export const toLegacySocialUserWithRelation = (
  store: NexusStore,
  state: LegacySocialRelationState,
  viewer: UserRecord,
  target: UserRecord,
  isAdminRole: IsAdminRole = (user) => user.adminRole === "super_admin" || user.adminRole === "operator",
) => {
  const relationStatus = buildSocialRelationStatusPayload(store, viewer, target, isAdminRole);
  return {
    ...toLegacyRelationSocialUser(target, state),
    relationStatus,
    visibilityScope: relationStatus.visibilityScope,
    relationSources: relationStatus.sources,
    canUnsubscribe: relationStatus.canUnsubscribe,
    canBlock: relationStatus.canBlock,
  };
};

export const toLegacySubscriptionRequestPayload = (
  store: NexusStore,
  state: LegacySocialRelationState,
  item: SocialSubscriptionRequestRecord,
) => {
  const requester = findUserByUserId(store, item.requesterUserId);
  const target = findUserByUserId(store, item.targetUserId);
  return {
    requestId: item.id,
    status: item.status,
    requestedVisibility: item.requestedVisibility,
    decidedVisibility: item.decidedVisibility,
    requester: requester ? toLegacyRelationSocialUser(requester, state) : null,
    target: target ? toLegacyRelationSocialUser(target, state) : null,
    decidedAt: item.decidedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

export const isLegacySocialRelationPath = (path: string) => {
  return (
    path === "social/me" ||
    path === "social/users/search" ||
    path === "social/subscribe" ||
    path === "social/subscribe/remove" ||
    path === "social/subscription-requests" ||
    /^social\/subscription-requests\/[^/]+\/decision$/.test(path) ||
    /^social\/subscriptions\/[^/]+$/.test(path) ||
    path === "social/subscriptions/block"
  );
};

export const handleLegacySocialRelationApi = async (context: LegacySocialRelationHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    state,
    getStoreRevision,
    toApiError,
    readJsonBody,
    requireLegacyAuth,
    resolveSocialActorUser,
    resolveRecipientUserIds,
    findUserByStudentId,
    isAdminRole,
    upsertSocialSubscriptionEdge,
    revokeSocialSubscriptionBetweenUsers,
    blockSocialSubscriptionBetweenUsers,
    createSocialNotification,
  } = context;

  if (method === "GET" && path === "social/me") {
    const { user } = requireLegacyAuth(event);
    const bindTarget = resolveSocialActorUser(store, user);
    const recipientUserIds = new Set(resolveRecipientUserIds(store, user));
    const me = toLegacyRelationSocialUser(bindTarget, state, {
      accountUser: user,
      randomCodeOwnerUserId: bindTarget.userId,
    });
    const targets = state.subscriptionTargetsByUserId.get(bindTarget.userId) || new Set<string>();
    const subscriptions = Array.from(targets.values())
      .map((targetUserId) => store.users.find((item) => item.userId === targetUserId) || null)
      .filter((item): item is UserRecord => Boolean(item))
      .filter((item) => item.studentId !== "")
      .map((item) => toLegacySocialUserWithRelation(store, state, bindTarget, item, isAdminRole));
    const subscribers = store.users
      .filter((candidate) => {
        const set = state.subscriptionTargetsByUserId.get(candidate.userId);
        return Boolean(set && set.has(bindTarget.userId));
      })
      .filter((item) => item.studentId !== "")
      .map((item) => toLegacySocialUserWithRelation(store, state, bindTarget, item, isAdminRole));
    const subscribedStudentIds = new Set(subscriptions.map((item) => item.studentId));
    const candidates = store.users
      .filter((item) => item.studentId !== "")
      .filter((item) => item.userId !== bindTarget.userId)
      .filter((item) => !subscribedStudentIds.has(item.studentId || ""))
      .map((item) => toLegacySocialUserWithRelation(store, state, bindTarget, item, isAdminRole));
    return {
      ok: true,
      me,
      subscriptions,
      subscribers,
      candidates,
      subscriptionRequests: store.socialSubscriptionRequests
        .filter((item) => item.requesterUserId === bindTarget.userId || item.targetUserId === bindTarget.userId)
        .map((item) => toLegacySubscriptionRequestPayload(store, state, item)),
      circles: store.socialCircleMembers
        .filter((item) => item.userId === bindTarget.userId && item.status === "active")
        .map((item) => store.socialCircles.find((circle) => circle.id === item.circleId) || null)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => toLegacyCirclePayload(store, item)),
      unreadNotificationCount: store.socialNotifications.filter(
        (item) => recipientUserIds.has(item.recipientUserId) && item.status === "unread",
      ).length,
      bound: Boolean(bindTarget.studentId),
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "GET" && path === "social/users/search") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const q = asString(query.q || query.keyword || query.search).toLowerCase();
    const limit = Math.max(1, Math.min(50, Math.trunc(Number(query.limit || 20))));
    if (!q) {
      return { ok: true, items: [], total: 0, stateRevision: getStoreRevision() };
    }
    const items = store.users
      .filter((item) => item.studentId !== "")
      .filter((item) => {
        const fields = [
          item.studentId,
          item.studentNo,
          item.name,
          item.nickname,
          item.classLabel,
          resolveMeaningfulUserName(item),
          resolveUserDisplayLabel(item),
        ];
        return fields.some((field) => asString(field).toLowerCase().includes(q));
      })
      .slice(0, limit)
      .map((item) => toLegacySocialUserWithRelation(store, state, actor, item, isAdminRole));
    return {
      ok: true,
      items,
      total: items.length,
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "GET" && path === "social/subscription-requests") {
    const { user } = requireLegacyAuth(event);
    const bindTarget = resolveSocialActorUser(store, user);
    const items = store.socialSubscriptionRequests
      .filter((item) => item.requesterUserId === bindTarget.userId || item.targetUserId === bindTarget.userId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map((item) => toLegacySubscriptionRequestPayload(store, state, item));
    return { ok: true, items, stateRevision: getStoreRevision() };
  }

  if (method === "POST" && path === "social/subscription-requests") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{
      targetStudentId?: string;
      target_student_id?: string;
      visibilityScope?: string;
      visibility_scope?: string;
    }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      return toApiError(400, "SUBSCRIBE_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = findUserByStudentId(store, targetStudentId);
    if (!targetUser) {
      return toApiError(404, "SUBSCRIBE_TARGET_NOT_FOUND", "目标课表不存在");
    }
    if (targetUser.userId === actor.userId) {
      return toApiError(400, "SUBSCRIBE_SELF_NOT_ALLOWED", "不能订阅自己");
    }
    const visibilityScope = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, "busy_free");
    const activeEdge = findActiveSocialEdge(store, actor.userId, targetUser.userId);
    if (activeEdge) {
      return {
        ok: true,
        alreadySubscribed: true,
        visibilityScope: activeEdge.visibilityScope,
        stateRevision: getStoreRevision(),
      };
    }
    const existing = store.socialSubscriptionRequests.find((item) => {
      return item.requesterUserId === actor.userId && item.targetUserId === targetUser.userId && item.status === "pending";
    });
    const request =
      existing ||
      ({
        id: storeHelpers.createId("sub_req"),
        requesterUserId: actor.userId,
        targetUserId: targetUser.userId,
        requestedVisibility: visibilityScope,
        status: "pending",
        decidedVisibility: "hidden",
        decidedAt: "",
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      } satisfies SocialSubscriptionRequestRecord);
    if (!existing) {
      store.socialSubscriptionRequests.push(request);
      createSocialNotification(store, {
        type: "subscription_request",
        recipientUserId: targetUser.userId,
        actorUserId: actor.userId,
        title: "新的订阅请求",
        body: `${resolveUserDisplayLabel(actor)} 想查看你的日程空闲状态`,
        payload: { requestId: request.id, visibilityScope },
      });
    }
    return {
      ok: true,
      pending: true,
      request: toLegacySubscriptionRequestPayload(store, state, request),
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/subscribe") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string; visibilityScope?: string; visibility_scope?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      return toApiError(400, "SUBSCRIBE_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = findUserByStudentId(store, targetStudentId);
    if (!targetUser) {
      return toApiError(404, "SUBSCRIBE_TARGET_NOT_FOUND", "目标课表不存在");
    }
    if (targetUser.userId === actor.userId) {
      return toApiError(400, "SUBSCRIBE_SELF_NOT_ALLOWED", "不能订阅自己");
    }
    const visibilityScope = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, "busy_free");
    if (isAdminRole(user)) {
      upsertSocialSubscriptionEdge(store, {
        subscriberUserId: actor.userId,
        targetUser,
        visibilityScope: "detail",
        source: "legacy",
      });
      return { ok: true, subscribed: true, visibilityScope: "detail", stateRevision: getStoreRevision() };
    }
    const existing = store.socialSubscriptionRequests.find((item) => {
      return item.requesterUserId === actor.userId && item.targetUserId === targetUser.userId && item.status === "pending";
    });
    const request =
      existing ||
      ({
        id: storeHelpers.createId("sub_req"),
        requesterUserId: actor.userId,
        targetUserId: targetUser.userId,
        requestedVisibility: visibilityScope,
        status: "pending",
        decidedVisibility: "hidden",
        decidedAt: "",
        createdAt: storeHelpers.nowIso(),
        updatedAt: storeHelpers.nowIso(),
      } satisfies SocialSubscriptionRequestRecord);
    if (!existing) {
      store.socialSubscriptionRequests.push(request);
      createSocialNotification(store, {
        type: "subscription_request",
        recipientUserId: targetUser.userId,
        actorUserId: actor.userId,
        title: "新的订阅请求",
        body: `${resolveUserDisplayLabel(actor)} 想查看你的日程空闲状态`,
        payload: { requestId: request.id, visibilityScope },
      });
    }
    return {
      ok: true,
      subscribed: false,
      pending: true,
      request: toLegacySubscriptionRequestPayload(store, state, request),
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/subscribe/remove") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      return toApiError(400, "UNSUBSCRIBE_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = findUserByStudentId(store, targetStudentId);
    if (!targetUser) {
      return { ok: true, removed: false, stateRevision: getStoreRevision() };
    }
    const removed = revokeSocialSubscriptionBetweenUsers(store, actor, targetUser, { includeCircle: false });
    const stillVisibleViaCircle = hasCircleAccessBetweenUsers(store, actor.userId, targetUser.userId);
    if (removed) {
      createSocialNotification(store, {
        type: "subscription_revoked",
        recipientUserId: targetUser.userId,
        actorUserId: actor.userId,
        title: "订阅关系已解除",
        body: `${resolveUserDisplayLabel(actor)} 解除了订阅关系`,
        payload: { targetStudentId },
      });
    }
    return { ok: true, removed, stillVisibleViaCircle, stateRevision: getStoreRevision() };
  }

  const subscriptionRequestDecisionMatch = path.match(/^social\/subscription-requests\/([^/]+)\/decision$/);
  if (method === "POST" && subscriptionRequestDecisionMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const requestId = decodeURIComponent(subscriptionRequestDecisionMatch[1]);
    const request = store.socialSubscriptionRequests.find((item) => item.id === requestId) || null;
    if (!request) {
      return toApiError(404, "SUBSCRIPTION_REQUEST_NOT_FOUND", "订阅请求不存在");
    }
    if (request.targetUserId !== actor.userId && !isAdminRole(user)) {
      return toApiError(403, "SUBSCRIPTION_REQUEST_FORBIDDEN", "仅被请求人可处理订阅请求");
    }
    if (request.status !== "pending") {
      return {
        ok: true,
        request: toLegacySubscriptionRequestPayload(store, state, request),
        stateRevision: getStoreRevision(),
      };
    }
    const body = await readJsonBody<{ decision?: string; visibilityScope?: string; visibility_scope?: string }>(event);
    const decision = asString(body.decision);
    const requester = findUserByUserId(store, request.requesterUserId);
    if (!requester) {
      return toApiError(404, "REQUESTER_NOT_FOUND", "请求人不存在");
    }
    const target = findUserByUserId(store, request.targetUserId);
    if (!target) {
      return toApiError(404, "TARGET_NOT_FOUND", "被请求人不存在");
    }
    request.updatedAt = storeHelpers.nowIso();
    request.decidedAt = request.updatedAt;
    if (decision === "reject" || decision === "rejected") {
      request.status = "rejected";
      request.decidedVisibility = "hidden";
      createSocialNotification(store, {
        type: "subscription_rejected",
        recipientUserId: requester.userId,
        actorUserId: target.userId,
        title: "订阅请求已拒绝",
        body: `${resolveUserDisplayLabel(target)} 拒绝了你的订阅请求`,
        payload: { requestId: request.id },
      });
      return {
        ok: true,
        request: toLegacySubscriptionRequestPayload(store, state, request),
        stateRevision: getStoreRevision(),
      };
    }
    const decidedVisibility = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, request.requestedVisibility);
    if (decidedVisibility === "hidden" || decidedVisibility === "blocked") {
      request.status = "rejected";
      request.decidedVisibility = decidedVisibility;
    } else {
      request.status = "accepted";
      request.decidedVisibility = decidedVisibility;
      upsertSocialSubscriptionEdge(store, {
        subscriberUserId: requester.userId,
        targetUser: target,
        visibilityScope: decidedVisibility,
        source: "request",
      });
      upsertSocialSubscriptionEdge(store, {
        subscriberUserId: target.userId,
        targetUser: requester,
        visibilityScope: "busy_free",
        source: "request",
      });
      createSocialNotification(store, {
        type: "subscription_accepted",
        recipientUserId: requester.userId,
        actorUserId: target.userId,
        title: "订阅请求已通过",
        body: `${resolveUserDisplayLabel(target)} 已同意你的订阅请求`,
        payload: { requestId: request.id, visibilityScope: decidedVisibility },
      });
    }
    return {
      ok: true,
      request: toLegacySubscriptionRequestPayload(store, state, request),
      stateRevision: getStoreRevision(),
    };
  }

  const socialSubscriptionDeleteMatch = path.match(/^social\/subscriptions\/([^/]+)$/);
  if (method === "DELETE" && socialSubscriptionDeleteMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const subscriptionId = decodeURIComponent(socialSubscriptionDeleteMatch[1]);
    const edge = store.socialSubscriptionEdges.find((item) => item.id === subscriptionId && item.status === "active") || null;
    if (!edge) {
      return toApiError(404, "SUBSCRIPTION_NOT_FOUND", "订阅关系不存在");
    }
    if (edge.subscriberUserId !== actor.userId && edge.targetUserId !== actor.userId && !isAdminRole(user)) {
      return toApiError(403, "SUBSCRIPTION_DELETE_FORBIDDEN", "无权解除该订阅关系");
    }
    const left = findUserByUserId(store, edge.subscriberUserId);
    if (!left) {
      return toApiError(404, "SUBSCRIBER_NOT_FOUND", "订阅人不存在");
    }
    const right = findUserByUserId(store, edge.targetUserId);
    if (!right) {
      return toApiError(404, "TARGET_NOT_FOUND", "被订阅人不存在");
    }
    const removed = revokeSocialSubscriptionBetweenUsers(store, left, right, { includeCircle: edge.source === "circle" });
    createSocialNotification(store, {
      type: "subscription_revoked",
      recipientUserId: actor.userId === left.userId ? right.userId : left.userId,
      actorUserId: actor.userId,
      title: "订阅关系已解除",
      body: `${resolveUserDisplayLabel(actor)} 解除了订阅关系`,
      payload: { subscriptionId },
    });
    return { ok: true, removed, stateRevision: getStoreRevision() };
  }

  if (method === "POST" && path === "social/subscriptions/block") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{ targetStudentId?: string; target_student_id?: string }>(event);
    const targetStudentId = asString(body.targetStudentId || body.target_student_id);
    if (!targetStudentId) {
      return toApiError(400, "BLOCK_TARGET_REQUIRED", "targetStudentId 不能为空");
    }
    const targetUser = findUserByStudentId(store, targetStudentId);
    if (!targetUser) {
      return toApiError(404, "BLOCK_TARGET_NOT_FOUND", "目标用户不存在");
    }
    if (targetUser.userId === actor.userId) {
      return toApiError(400, "BLOCK_SELF_NOT_ALLOWED", "不能屏蔽自己");
    }
    const edges = blockSocialSubscriptionBetweenUsers(store, actor, targetUser);
    createSocialNotification(store, {
      type: "subscription_revoked",
      recipientUserId: targetUser.userId,
      actorUserId: actor.userId,
      title: "订阅可见性已变更",
      body: `${resolveUserDisplayLabel(actor)} 已将订阅可见性设为不可见`,
      payload: { targetStudentId, visibilityScope: "blocked" },
    });
    return {
      ok: true,
      blocked: true,
      edges,
      stateRevision: getStoreRevision(),
    };
  }

  return null;
};
