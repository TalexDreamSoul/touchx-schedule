import type { H3Event } from "h3";
import type {
  NexusStore,
  SocialCircleMemberRecord,
  SocialCircleRecord,
  SocialNotificationRecord,
  SocialSubscriptionEdgeRecord,
  UserRecord,
} from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";
import type { SocialVisibilityScope } from "@touchx/shared";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type ResolveSocialActorUser = (store: NexusStore, accountUser: UserRecord) => UserRecord;
type NormalizeVisibilityScope = (value: unknown, fallback?: SocialVisibilityScope) => SocialVisibilityScope;
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
type SyncLegacySubscriptionTarget = (store: NexusStore, subscriberUserId: string, targetUser: UserRecord) => void;
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
type ResolveUserDisplayLabel = (user: Pick<UserRecord, "name" | "nickname" | "studentNo" | "studentId">) => string;

export interface LegacyCircleHandlerContext {
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
  normalizeVisibilityScope: NormalizeVisibilityScope;
  upsertSocialSubscriptionEdge: UpsertSocialSubscriptionEdge;
  syncLegacySubscriptionTarget: SyncLegacySubscriptionTarget;
  createSocialNotification: CreateSocialNotification;
  resolveUserDisplayLabel: ResolveUserDisplayLabel;
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

export const toLegacyCirclePayload = (store: NexusStore, item: SocialCircleRecord) => {
  const members = store.socialCircleMembers.filter((member) => member.circleId === item.id && member.status === "active");
  const owner = findUserByUserId(store, item.ownerUserId);
  return {
    circleId: item.id,
    name: item.name,
    circleType: item.circleType,
    owner: toSocialUserBrief(owner),
    inviteToken: item.inviteToken,
    status: item.status,
    memberCount: members.length,
    members: members.map((member) => ({
      memberId: member.id,
      role: member.role,
      visibilityScope: member.visibilityScope,
      joinedAt: member.joinedAt,
      user: toSocialUserBrief(findUserByUserId(store, member.userId)),
    })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

export const isLegacyCirclePath = (path: string) => {
  return path === "social/circles" || path === "social/circles/join-preview" || /^social\/circles\/[^/]+\/(join|leave)$/.test(path);
};

export const handleLegacyCircleApi = async (context: LegacyCircleHandlerContext) => {
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
    normalizeVisibilityScope,
    upsertSocialSubscriptionEdge,
    syncLegacySubscriptionTarget,
    createSocialNotification,
    resolveUserDisplayLabel: displayLabel,
  } = context;

  if (method === "GET" && path === "social/circles") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const circles = store.socialCircleMembers
      .filter((item) => item.userId === actor.userId && item.status === "active")
      .map((item) => store.socialCircles.find((circle) => circle.id === item.circleId) || null)
      .filter((item): item is SocialCircleRecord => Boolean(item))
      .map((item) => toLegacyCirclePayload(store, item));
    return { ok: true, items: circles, stateRevision: getStoreRevision() };
  }

  if (method === "GET" && path === "social/circles/join-preview") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const inviteToken = asString(query.token || query.inviteToken || query.invite_token);
    if (!inviteToken) {
      return toApiError(400, "CIRCLE_INVITE_TOKEN_REQUIRED", "邀请 token 不能为空");
    }
    const circle =
      store.socialCircles.find((item) => item.inviteToken === inviteToken && item.status === "active") || null;
    if (!circle) {
      return toApiError(404, "CIRCLE_NOT_FOUND", "圈子不存在或已停用");
    }
    const member = store.socialCircleMembers.find((item) => item.circleId === circle.id && item.userId === actor.userId) || null;
    return {
      ok: true,
      circle: toLegacyCirclePayload(store, circle),
      inviteToken,
      joined: member?.status === "active",
      currentVisibilityScope: member?.visibilityScope || "",
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/circles") {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const body = await readJsonBody<{ name?: string; circleType?: "class" | "club" | "custom"; circle_type?: "class" | "club" | "custom" }>(event);
    const name = asString(body.name);
    if (!name) {
      return toApiError(400, "CIRCLE_NAME_REQUIRED", "圈子名称不能为空");
    }
    const circleType = body.circleType || body.circle_type || "custom";
    const circle: SocialCircleRecord = {
      id: storeHelpers.createId("circle"),
      name,
      circleType: circleType === "class" || circleType === "club" ? circleType : "custom",
      ownerUserId: actor.userId,
      inviteToken: storeHelpers.generateShareToken(),
      status: "active",
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    const member: SocialCircleMemberRecord = {
      id: storeHelpers.createId("circle_member"),
      circleId: circle.id,
      userId: actor.userId,
      role: "owner",
      visibilityScope: "detail",
      status: "active",
      joinedAt: circle.createdAt,
      leftAt: "",
      updatedAt: circle.createdAt,
    };
    store.socialCircles.push(circle);
    store.socialCircleMembers.push(member);
    return { ok: true, circle: toLegacyCirclePayload(store, circle), stateRevision: getStoreRevision() };
  }

  const circleJoinMatch = path.match(/^social\/circles\/([^/]+)\/join$/);
  if (method === "POST" && circleJoinMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const circleKey = decodeURIComponent(circleJoinMatch[1]);
    const body = await readJsonBody<{ inviteToken?: string; invite_token?: string; visibilityScope?: string; visibility_scope?: string }>(event);
    const inviteToken = asString(body.inviteToken || body.invite_token || circleKey);
    const circle = store.socialCircles.find((item) => item.id === circleKey || item.inviteToken === inviteToken) || null;
    if (!circle) {
      return toApiError(404, "CIRCLE_NOT_FOUND", "圈子不存在");
    }
    if (circle.status !== "active") {
      return toApiError(400, "CIRCLE_INACTIVE", "圈子已停用");
    }
    if (circle.inviteToken !== inviteToken && circle.id !== circleKey) {
      return toApiError(400, "CIRCLE_INVITE_INVALID", "邀请链接无效");
    }
    const visibilityScope = normalizeVisibilityScope(body.visibilityScope || body.visibility_scope, "busy_free");
    let member = store.socialCircleMembers.find((item) => item.circleId === circle.id && item.userId === actor.userId) || null;
    if (member) {
      member.status = "active";
      member.leftAt = "";
      member.visibilityScope = visibilityScope;
      member.updatedAt = storeHelpers.nowIso();
    } else {
      member = {
        id: storeHelpers.createId("circle_member"),
        circleId: circle.id,
        userId: actor.userId,
        role: "member",
        visibilityScope,
        status: "active",
        joinedAt: storeHelpers.nowIso(),
        leftAt: "",
        updatedAt: storeHelpers.nowIso(),
      };
      store.socialCircleMembers.push(member);
    }
    store.socialCircleMembers
      .filter((item) => item.circleId === circle.id && item.status === "active" && item.userId !== actor.userId)
      .forEach((item) => {
        const targetUser = findUserByUserId(store, item.userId);
        if (!targetUser) {
          return;
        }
        upsertSocialSubscriptionEdge(store, {
          subscriberUserId: actor.userId,
          targetUser,
          visibilityScope: item.visibilityScope,
          source: "circle",
          circleId: circle.id,
        });
        upsertSocialSubscriptionEdge(store, {
          subscriberUserId: targetUser.userId,
          targetUser: actor,
          visibilityScope,
          source: "circle",
          circleId: circle.id,
        });
      });
    store.socialCircleMembers
      .filter((item) => item.circleId === circle.id && item.status === "active" && item.userId !== actor.userId)
      .forEach((item) => {
        createSocialNotification(store, {
          type: "circle_joined",
          recipientUserId: item.userId,
          actorUserId: actor.userId,
          title: "圈子有新成员加入",
          body: `${displayLabel(actor)} 加入了 ${circle.name}`,
          payload: { circleId: circle.id },
        });
      });
    return { ok: true, circle: toLegacyCirclePayload(store, circle), member, stateRevision: getStoreRevision() };
  }

  const circleLeaveMatch = path.match(/^social\/circles\/([^/]+)\/leave$/);
  if (method === "POST" && circleLeaveMatch) {
    const { user } = requireLegacyAuth(event);
    const actor = resolveSocialActorUser(store, user);
    const circleId = decodeURIComponent(circleLeaveMatch[1]);
    const circle = store.socialCircles.find((item) => item.id === circleId || item.inviteToken === circleId) || null;
    if (!circle) {
      return toApiError(404, "CIRCLE_NOT_FOUND", "圈子不存在");
    }
    const member =
      store.socialCircleMembers.find((item) => item.circleId === circle.id && item.userId === actor.userId && item.status === "active") || null;
    if (!member) {
      return toApiError(404, "CIRCLE_MEMBER_NOT_FOUND", "你尚未加入该圈子");
    }
    member.status = "left";
    member.leftAt = storeHelpers.nowIso();
    member.updatedAt = member.leftAt;
    const affectedPairs: Array<{ subscriberUserId: string; targetUserId: string }> = [];
    store.socialSubscriptionEdges.forEach((edge) => {
      if (edge.circleId !== circle.id || edge.status !== "active") {
        return;
      }
      if (edge.subscriberUserId !== actor.userId && edge.targetUserId !== actor.userId) {
        return;
      }
      edge.status = "revoked";
      edge.revokedAt = storeHelpers.nowIso();
      edge.updatedAt = edge.revokedAt;
      affectedPairs.push({ subscriberUserId: edge.subscriberUserId, targetUserId: edge.targetUserId });
    });
    affectedPairs.forEach((pair) => {
      const targetUser = findUserByUserId(store, pair.targetUserId);
      if (!targetUser) {
        return;
      }
      syncLegacySubscriptionTarget(store, pair.subscriberUserId, targetUser);
    });
    store.socialCircleMembers
      .filter((item) => item.circleId === circle.id && item.status === "active" && item.userId !== actor.userId)
      .forEach((item) => {
        createSocialNotification(store, {
          type: "circle_left",
          recipientUserId: item.userId,
          actorUserId: actor.userId,
          title: "圈子成员已退出",
          body: `${displayLabel(actor)} 已退出 ${circle.name}`,
          payload: { circleId: circle.id },
        });
      });
    return { ok: true, left: true, circleId: circle.id, stateRevision: getStoreRevision() };
  }

  return null;
};
