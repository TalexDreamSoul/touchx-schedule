import type { H3Event } from "h3";
import type { NexusStore, SocialNotificationRecord, UserRecord } from "../../services/domain-store";

type ApiError = (statusCode: number, code: string, message: string) => never;
type ResolveLegacyAuthContext = (event: H3Event) => { user: UserRecord };
type ResolveNotificationRecipientUserIds = (store: NexusStore, user: UserRecord) => string[];

export interface LegacyNotificationHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  getStoreRevision: () => number;
  toApiError: ApiError;
  requireLegacyAuth: ResolveLegacyAuthContext;
  resolveRecipientUserIds: ResolveNotificationRecipientUserIds;
  nowIso: () => string;
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
  return resolveMeaningfulUserName(user) || asString(user.studentNo || user.studentId) || "TouchX 用户";
};

export const toLegacySocialNotificationPayload = (store: NexusStore, item: SocialNotificationRecord) => {
  const actor = findUserByUserId(store, item.actorUserId);
  return {
    notificationId: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    status: item.status,
    actorUserId: item.actorUserId,
    actorName: actor ? resolveUserDisplayLabel(actor) : "",
    recipientUserId: item.recipientUserId,
    payload: item.payload || {},
    createdAt: item.createdAt,
    readAt: item.readAt || "",
  };
};

export const isLegacyNotificationPath = (path: string) => {
  return path === "notifications" || /^notifications\/[^/]+\/read$/.test(path);
};

export const handleLegacyNotificationApi = async (context: LegacyNotificationHandlerContext) => {
  const {
    event,
    method,
    path,
    query,
    store,
    getStoreRevision,
    toApiError,
    requireLegacyAuth,
    resolveRecipientUserIds,
    nowIso,
  } = context;

  if (method === "GET" && path === "notifications") {
    const { user } = requireLegacyAuth(event);
    const recipientUserIds = new Set(resolveRecipientUserIds(store, user));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 50)));
    const items = store.socialNotifications
      .filter((item) => recipientUserIds.has(item.recipientUserId))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit)
      .map((item) => toLegacySocialNotificationPayload(store, item));
    return {
      ok: true,
      unreadCount: items.filter((item) => item.status === "unread").length,
      items,
      stateRevision: getStoreRevision(),
    };
  }

  const notificationReadMatch = path.match(/^notifications\/([^/]+)\/read$/);
  if (method === "POST" && notificationReadMatch) {
    const { user } = requireLegacyAuth(event);
    const recipientUserIds = new Set(resolveRecipientUserIds(store, user));
    const notificationId = decodeURIComponent(notificationReadMatch[1]);
    const notification = store.socialNotifications.find((item) => item.id === notificationId && recipientUserIds.has(item.recipientUserId)) || null;
    if (!notification) {
      return toApiError(404, "NOTIFICATION_NOT_FOUND", "通知不存在");
    }
    notification.status = "read";
    notification.readAt = nowIso();
    return { ok: true, notification: toLegacySocialNotificationPayload(store, notification) };
  }

  return null;
};
