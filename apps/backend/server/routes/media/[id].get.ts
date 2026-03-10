import { getRouterParam, setResponseHeader, type H3Event } from "h3";
import { getNexusStore, type MediaAssetRecord, type UserRecord } from "../../services/domain-store";
import { parseR2MediaId, resolveImageMimeType, resolveMediaBucket } from "../../utils/media-storage";

const escapeXml = (value: string) => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const toInitial = (value: string) => {
  const text = String(value || "").trim();
  if (!text) {
    return "T";
  }
  return text.slice(0, 1).toUpperCase();
};

const resolveUsageFromUser = (user: UserRecord, mediaId: string): "avatar" | "wallpaper" | "other" => {
  if (String(user.avatarUrl || "").trim().endsWith(`/${mediaId}`)) {
    return "avatar";
  }
  if (String(user.wallpaperUrl || "").trim().endsWith(`/${mediaId}`)) {
    return "wallpaper";
  }
  return "other";
};

const resolveMediaContext = (
  mediaId: string,
  assets: MediaAssetRecord[],
  users: UserRecord[],
) => {
  const asset = assets.find((item) => item.id === mediaId) || null;
  if (asset) {
    const owner = users.find((item) => item.userId === asset.ownerUserId) || null;
    const label = owner?.name || owner?.nickname || owner?.studentNo || "TouchX";
    return {
      usage: asset.usage,
      label,
    };
  }
  const matchedUser = users.find((item) => {
    const avatar = String(item.avatarUrl || "").trim();
    const wallpaper = String(item.wallpaperUrl || "").trim();
    return avatar.endsWith(`/${mediaId}`) || wallpaper.endsWith(`/${mediaId}`);
  }) || null;
  if (matchedUser) {
    return {
      usage: resolveUsageFromUser(matchedUser, mediaId),
      label: matchedUser.name || matchedUser.nickname || matchedUser.studentNo || "TouchX",
    };
  }
  return {
    usage: "other" as const,
    label: "TouchX",
  };
};

const buildAvatarSvg = (label: string) => {
  const title = escapeXml(label);
  const initial = escapeXml(toInitial(label));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${title}">`,
    "<defs>",
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#2563eb"/>',
    '<stop offset="100%" stop-color="#0f172a"/>',
    "</linearGradient>",
    "</defs>",
    '<rect width="256" height="256" rx="48" fill="url(#g)"/>',
    `<text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="116" font-family="Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-weight="700">${initial}</text>`,
    "</svg>",
  ].join("");
};

const buildWallpaperSvg = (label: string) => {
  const title = escapeXml(label);
  const safe = escapeXml(label);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="${title}">`,
    "<defs>",
    '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '<stop offset="0%" stop-color="#111827"/>',
    '<stop offset="50%" stop-color="#1f2937"/>',
    '<stop offset="100%" stop-color="#374151"/>',
    "</linearGradient>",
    "</defs>",
    '<rect width="1280" height="720" fill="url(#bg)"/>',
    '<circle cx="1040" cy="220" r="180" fill="rgba(59,130,246,0.2)"/>',
    '<circle cx="240" cy="520" r="220" fill="rgba(16,185,129,0.16)"/>',
    `<text x="80" y="612" fill="#f3f4f6" font-size="72" font-family="Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif" font-weight="600">${safe}</text>`,
    "</svg>",
  ].join("");
};

const buildOtherSvg = () => {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" role="img" aria-label="TouchX media">',
    '<rect width="400" height="240" fill="#f3f4f6"/>',
    '<rect x="20" y="20" width="360" height="200" rx="20" fill="#e5e7eb"/>',
    '<text x="200" y="130" dominant-baseline="middle" text-anchor="middle" fill="#111827" font-size="28" font-family="Inter, -apple-system, BlinkMacSystemFont, sans-serif">TouchX Media</text>',
    "</svg>",
  ].join("");
};

const resolveSvg = (event: H3Event) => {
  const mediaId = String(getRouterParam(event, "id") || "").trim();
  const store = getNexusStore();
  const context = resolveMediaContext(mediaId, store.mediaAssets, store.users);
  if (context.usage === "avatar") {
    return buildAvatarSvg(context.label);
  }
  if (context.usage === "wallpaper") {
    return buildWallpaperSvg(context.label);
  }
  return buildOtherSvg();
};

const resolveR2ObjectKey = (mediaId: string, assets: MediaAssetRecord[]) => {
  const asset = assets.find((item) => item.id === mediaId) || null;
  if (asset && String(asset.objectKey || "").trim()) {
    return {
      objectKey: asset.objectKey,
      extension: String(asset.objectKey || "").split(".").pop() || "",
    };
  }
  const parsed = parseR2MediaId(mediaId);
  if (!parsed) {
    return null;
  }
  return {
    objectKey: parsed.objectKey,
    extension: parsed.extension,
  };
};

export default defineEventHandler(async (event) => {
  const mediaId = String(getRouterParam(event, "id") || "").trim();
  const store = getNexusStore();
  const bucket = resolveMediaBucket(event);
  const objectRef = resolveR2ObjectKey(mediaId, store.mediaAssets);
  if (bucket && objectRef?.objectKey) {
    const object = await bucket.get(objectRef.objectKey);
    if (object?.body) {
      const headers = new Headers();
      headers.set("cache-control", "public, max-age=300, stale-while-revalidate=600");
      if (typeof object.writeHttpMetadata === "function") {
        object.writeHttpMetadata(headers);
      }
      if (!headers.get("content-type")) {
        headers.set("content-type", resolveImageMimeType(objectRef.extension, "application/octet-stream"));
      }
      return new Response(object.body, { headers });
    }
  }
  setResponseHeader(event, "content-type", "image/svg+xml; charset=utf-8");
  setResponseHeader(event, "cache-control", "public, max-age=300, stale-while-revalidate=600");
  return resolveSvg(event);
});
