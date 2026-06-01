import { storeHelpers, type MediaAssetRecord, type NexusStore, type UserRecord } from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

export const listMediaAssets = (
  store: NexusStore,
  filters: {
    ownerUserId?: unknown;
    usage?: unknown;
  },
) => {
  const ownerUserId = asString(filters.ownerUserId);
  const usage = asString(filters.usage);
  return store.mediaAssets.filter((item) => {
    if (ownerUserId && item.ownerUserId !== ownerUserId) {
      return false;
    }
    if (usage && item.usage !== usage) {
      return false;
    }
    return true;
  });
};

export const createMediaAsset = (
  store: NexusStore,
  user: UserRecord,
  input: {
    usage?: unknown;
    mime?: unknown;
    size?: unknown;
    fileName?: unknown;
  },
) => {
  const usage: MediaAssetRecord["usage"] = input.usage === "avatar" || input.usage === "wallpaper" ? input.usage : "other";
  const fileName = asString(input.fileName) || `${storeHelpers.createId("upload")}.bin`;
  const mime = asString(input.mime) || "application/octet-stream";
  const size = Math.max(0, Number(input.size || 0));
  const id = storeHelpers.createId("media");
  const asset: MediaAssetRecord = {
    id,
    ownerUserId: user.userId,
    usage,
    objectKey: `${usage}/${id}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
    url: `/media/${id}`,
    mime,
    size,
    referenced: false,
    createdAt: storeHelpers.nowIso(),
    updatedAt: storeHelpers.nowIso(),
  };
  store.mediaAssets.unshift(asset);
  return asset;
};

export const updateProfileMedia = (
  store: NexusStore,
  user: UserRecord,
  input: {
    avatarAssetId?: unknown;
    wallpaperAssetId?: unknown;
  },
) => {
  const avatarAssetId = asString(input.avatarAssetId);
  const wallpaperAssetId = asString(input.wallpaperAssetId);

  if (avatarAssetId) {
    const avatar = store.mediaAssets.find((item) => item.id === avatarAssetId) || null;
    if (!avatar) {
      return { ok: false as const, reason: "avatar_not_found" as const, avatarAssetId, wallpaperAssetId };
    }
    user.avatarUrl = avatar.url;
    avatar.referenced = true;
    avatar.updatedAt = storeHelpers.nowIso();
  }

  if (wallpaperAssetId) {
    const wallpaper = store.mediaAssets.find((item) => item.id === wallpaperAssetId) || null;
    if (!wallpaper) {
      return { ok: false as const, reason: "wallpaper_not_found" as const, avatarAssetId, wallpaperAssetId };
    }
    user.wallpaperUrl = wallpaper.url;
    wallpaper.referenced = true;
    wallpaper.updatedAt = storeHelpers.nowIso();
  }

  user.updatedAt = storeHelpers.nowIso();
  return { ok: true as const, user, avatarAssetId, wallpaperAssetId };
};

export const reconcileMediaAssets = (store: NexusStore) => {
  const referencedSet = new Set<string>();
  store.users.forEach((item) => {
    if (item.avatarUrl) {
      referencedSet.add(item.avatarUrl);
    }
    if (item.wallpaperUrl) {
      referencedSet.add(item.wallpaperUrl);
    }
  });

  let updated = 0;
  store.mediaAssets.forEach((asset) => {
    const next = referencedSet.has(asset.url);
    if (asset.referenced !== next) {
      asset.referenced = next;
      asset.updatedAt = storeHelpers.nowIso();
      updated += 1;
    }
  });
  return { updated };
};

export const cleanupMediaAssets = (
  store: NexusStore,
  input: {
    onlyOrphans?: unknown;
    olderThanHours?: unknown;
  },
) => {
  const onlyOrphans = input.onlyOrphans !== false;
  const olderThanHours = Math.max(0, Number(input.olderThanHours || 24));
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  const before = store.mediaAssets.length;
  const removedAssets = store.mediaAssets.filter((item) => {
    const createdAt = Date.parse(item.createdAt);
    const expired = Number.isFinite(createdAt) ? createdAt <= cutoff : true;
    if (!expired) {
      return false;
    }
    if (onlyOrphans) {
      return !item.referenced;
    }
    return true;
  });
  store.mediaAssets = store.mediaAssets.filter((item) => !removedAssets.includes(item));
  return {
    removed: before - store.mediaAssets.length,
    removedAssets,
    onlyOrphans,
    olderThanHours,
  };
};
