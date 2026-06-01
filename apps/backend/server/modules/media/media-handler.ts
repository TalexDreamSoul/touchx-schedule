import type { H3Event } from "h3";
import type { NexusStore, UserRecord } from "../../services/domain-store";
import {
  cleanupMediaAssets,
  createMediaAsset,
  listMediaAssets,
  reconcileMediaAssets,
  updateProfileMedia,
} from "./media-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { user: UserRecord };
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;
type ToUserPayload = (user: UserRecord) => Record<string, unknown>;

export interface MediaHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireUser: RequireUser;
  requireAdmin: RequireAdmin;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
  toUserPayload: ToUserPayload;
}

export const isMediaPath = (path: string) => {
  return (
    path === "media/assets" ||
    path === "me/profile/media" ||
    path === "admin/media-assets" ||
    path.startsWith("admin/media-assets/")
  );
};

export const handleMediaApi = async (context: MediaHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireUser, requireAdmin, readJsonBody, appendAudit, toUserPayload } =
    context;

  if (method === "GET" && path === "admin/media-assets") {
    requireAdmin(event);
    return ok({
      items: listMediaAssets(store, {
        ownerUserId: query.ownerUserId || query.owner_user_id,
        usage: query.usage,
      }),
    });
  }

  if (method === "POST" && path === "media/assets") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      usage?: "avatar" | "wallpaper" | "other";
      mime?: string;
      size?: number;
      fileName?: string;
    }>(event);
    const asset = createMediaAsset(store, user, body);
    appendAudit("media_asset_create", user.userId, { mediaId: asset.id, usage: asset.usage });
    return ok({ asset });
  }

  if (method === "POST" && path === "me/profile/media") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ avatarAssetId?: string; wallpaperAssetId?: string }>(event);
    const result = updateProfileMedia(store, user, body);
    if (!result.ok && result.reason === "avatar_not_found") {
      return toApiError(404, "AVATAR_ASSET_NOT_FOUND", "头像资源不存在");
    }
    if (!result.ok) {
      return toApiError(404, "WALLPAPER_ASSET_NOT_FOUND", "壁纸资源不存在");
    }
    appendAudit("profile_media_update", user.userId, {
      avatarAssetId: result.avatarAssetId,
      wallpaperAssetId: result.wallpaperAssetId,
    });
    return ok({ user: toUserPayload(result.user) });
  }

  if (method === "POST" && path === "admin/media-assets/reconcile") {
    const { user } = requireAdmin(event);
    const result = reconcileMediaAssets(store);
    appendAudit("admin_media_reconcile", user.userId, { updated: result.updated });
    return ok(result);
  }

  if (method === "POST" && path === "admin/media-assets/cleanup") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ onlyOrphans?: boolean; olderThanHours?: number }>(event);
    const result = cleanupMediaAssets(store, body);
    appendAudit("admin_media_cleanup", user.userId, {
      removed: result.removed,
      onlyOrphans: result.onlyOrphans,
      olderThanHours: result.olderThanHours,
    });
    return ok({
      removed: result.removed,
      removedAssets: result.removedAssets,
    });
  }

  return null;
};
