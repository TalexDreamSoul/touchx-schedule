import { createHash, randomBytes } from "node:crypto";
import type { NotificationChannelType, UserNotificationBinding, UserNotificationBindingStatus } from "@touchx/shared";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import { storeHelpers } from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();
const WECHAT_BINDING_TTL_MS = 10 * 60 * 1000;

export interface AdminNotificationBindingListOptions {
  limit: number;
  offset: number;
  channelType?: unknown;
  userId?: unknown;
}

export interface AdminNotificationBindingUser {
  userId: string;
  studentNo: string;
  studentId?: string;
  accountName: string;
  name: string;
  nickname: string;
  classLabel: string;
}

export type AdminNotificationBindingRow = UserNotificationBinding & {
  user: AdminNotificationBindingUser | null;
};

export interface AdminNotificationBindingListPayload {
  items: AdminNotificationBindingRow[];
  total: number;
  limit: number;
  offset: number;
}

export type UpsertNotificationBindingReason =
  | "user_not_found"
  | "channel_invalid"
  | "receive_id_required";

export type UpsertNotificationBindingResult =
  | {
      ok: true;
      item: UserNotificationBinding;
      created: boolean;
    }
  | {
      ok: false;
      reason: UpsertNotificationBindingReason;
    };

export const normalizeNotificationChannelType = (value: unknown): NotificationChannelType | "" => {
  const type = asString(value) as NotificationChannelType;
  return type === "wechat_clawdbot" || type === "feishu" ? type : "";
};

const normalizeNotificationBindingStatus = (value: unknown): UserNotificationBindingStatus => {
  const status = asString(value) as UserNotificationBindingStatus;
  if (status === "active" || status === "disabled" || status === "expired") {
    return status;
  }
  return "active";
};

const toAdminNotificationBindingUser = (user: UserRecord | null): AdminNotificationBindingUser | null => {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    studentNo: user.studentNo,
    studentId: user.studentId,
    accountName: user.accountName || "",
    name: user.name || "",
    nickname: user.nickname || "",
    classLabel: user.classLabel || "",
  };
};

export const listAdminNotificationBindings = (
  store: NexusStore,
  options: AdminNotificationBindingListOptions,
): AdminNotificationBindingListPayload => {
  const channelType = normalizeNotificationChannelType(options.channelType);
  const userId = asString(options.userId);
  const filtered = store.userNotificationBindings.filter((item) => {
    if (channelType && item.channelType !== channelType) {
      return false;
    }
    if (userId && item.userId !== userId) {
      return false;
    }
    return true;
  });
  const items = filtered.slice(options.offset, options.offset + options.limit).map((item) => {
    const targetUser = store.users.find((candidate) => candidate.userId === item.userId) || null;
    return {
      ...item,
      user: toAdminNotificationBindingUser(targetUser),
    };
  });
  return {
    items,
    total: filtered.length,
    limit: options.limit,
    offset: options.offset,
  };
};

export const upsertAdminNotificationBinding = (
  store: NexusStore,
  input: {
    id?: unknown;
    userId?: unknown;
    channelType?: unknown;
    externalUserId?: unknown;
    externalOpenId?: unknown;
    externalUnionId?: unknown;
    status?: unknown;
  },
): UpsertNotificationBindingResult => {
  const targetUserId = asString(input.userId);
  const targetUser = store.users.find((item) => item.userId === targetUserId) || null;
  if (!targetUser) {
    return { ok: false, reason: "user_not_found" };
  }
  const channelType = normalizeNotificationChannelType(input.channelType || "feishu");
  if (!channelType) {
    return { ok: false, reason: "channel_invalid" };
  }
  const externalOpenId = asString(input.externalOpenId);
  const externalUnionId = asString(input.externalUnionId);
  const externalUserId = asString(input.externalUserId) || externalOpenId || externalUnionId;
  if (!externalUserId && !externalOpenId && !externalUnionId) {
    return { ok: false, reason: "receive_id_required" };
  }
  const status = normalizeNotificationBindingStatus(input.status);
  const now = storeHelpers.nowIso();
  const bindingId = asString(input.id);
  const existing = store.userNotificationBindings.find(
    (item) => (bindingId && item.id === bindingId) || (!bindingId && item.userId === targetUser.userId && item.channelType === channelType),
  ) || null;
  if (existing) {
    existing.userId = targetUser.userId;
    existing.channelType = channelType;
    existing.externalUserId = externalUserId;
    existing.externalOpenId = externalOpenId;
    existing.externalUnionId = externalUnionId;
    existing.status = status;
    existing.updatedAt = now;
    return { ok: true, item: existing, created: false };
  }
  const created: UserNotificationBinding = {
    id: bindingId || storeHelpers.createId("notification_binding"),
    userId: targetUser.userId,
    channelType,
    externalUserId,
    externalOpenId,
    externalUnionId,
    status,
    createdAt: now,
    updatedAt: now,
  };
  store.userNotificationBindings.unshift(created);
  return { ok: true, item: created, created: true };
};

export const deleteAdminNotificationBinding = (store: NexusStore, bindingId: string) => {
  const index = store.userNotificationBindings.findIndex((item) => item.id === bindingId);
  if (index < 0) {
    return null;
  }
  const [removed] = store.userNotificationBindings.splice(index, 1);
  return removed;
};

export const listUserNotificationBindings = (store: NexusStore, user: UserRecord) => {
  const items = store.userNotificationBindings.filter((item) => item.userId === user.userId);
  return { items, total: items.length };
};

export const findActiveWechatClawdbotBinding = (store: NexusStore, userId: string) => {
  return store.userNotificationBindings.find((item) => item.userId === userId && item.channelType === "wechat_clawdbot" && item.status === "active") || null;
};

export const createWechatBindingQrSvg = (payload: string) => {
  const digest = createHash("sha256").update(payload).digest();
  const size = 29;
  const cell = 8;
  const margin = 16;
  const total = size * cell + margin * 2;
  const isFinder = (x: number, y: number, ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  const finderFill = (x: number, y: number, ox: number, oy: number) => {
    const dx = x - ox;
    const dy = y - oy;
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  const rects: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let fill = false;
      if (isFinder(x, y, 0, 0)) fill = finderFill(x, y, 0, 0);
      else if (isFinder(x, y, size - 7, 0)) fill = finderFill(x, y, size - 7, 0);
      else if (isFinder(x, y, 0, size - 7)) fill = finderFill(x, y, 0, size - 7);
      else {
        const byte = digest[(x * 7 + y * 13) % digest.length];
        fill = ((byte >> ((x + y) % 8)) & 1) === 1;
      }
      if (fill) {
        rects.push(`<rect x="${margin + x * cell}" y="${margin + y * cell}" width="${cell}" height="${cell}"/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" viewBox="0 0 ${total} ${total}"><rect width="100%" height="100%" rx="18" fill="#fff"/><g fill="#111827">${rects.join("")}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const createWechatClawdbotBindingQr = (store: NexusStore, user: UserRecord) => {
  const now = storeHelpers.nowIso();
  const token = `wxbind_${randomBytes(16).toString("hex")}`;
  const externalUserId = asString(user.accountName || user.studentNo || user.userId);
  const existing = store.userNotificationBindings.find((item) => item.userId === user.userId && item.channelType === "wechat_clawdbot") || null;
  if (existing) {
    existing.externalUserId = externalUserId;
    existing.externalOpenId = token;
    existing.status = "active";
    existing.updatedAt = now;
  } else {
    store.userNotificationBindings.push({
      id: storeHelpers.createId("notification_binding"),
      userId: user.userId,
      channelType: "wechat_clawdbot",
      externalUserId,
      externalOpenId: token,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }
  const qrPayload = `touchx://wechat-clawdbot/bind?token=${encodeURIComponent(token)}&uid=${encodeURIComponent(user.userId)}`;
  return {
    bindingToken: token,
    expiresAt: new Date(Date.now() + WECHAT_BINDING_TTL_MS).toISOString(),
    qrPayload,
    qrImageUrl: createWechatBindingQrSvg(qrPayload),
    binding: findActiveWechatClawdbotBinding(store, user.userId),
  };
};

export const disableWechatClawdbotBindings = (store: NexusStore, user: UserRecord) => {
  store.userNotificationBindings.forEach((item) => {
    if (item.userId === user.userId && item.channelType === "wechat_clawdbot") {
      item.status = "disabled";
      item.updatedAt = storeHelpers.nowIso();
    }
  });
  return { unbound: true };
};
