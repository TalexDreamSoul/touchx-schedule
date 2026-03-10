import type { H3Event } from "h3";

const MEDIA_ID_PREFIX = "r2_";
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const sanitizeExtension = (value: string) => {
  const ext = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (ext in IMAGE_MIME_BY_EXTENSION) {
    return ext;
  }
  return "";
};

const resolveExtensionFromFileName = (fileName: string) => {
  const normalized = String(fileName || "").trim();
  if (!normalized.includes(".")) {
    return "";
  }
  return sanitizeExtension(normalized.split(".").pop() || "");
};

const resolveExtensionFromMime = (mimeType: string) => {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return "jpg";
  }
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  if (normalized === "image/gif") {
    return "gif";
  }
  return "";
};

const resolveExtensionFromBytes = (bytes: Uint8Array) => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "gif";
  }
  return "";
};

export const resolveImageExtension = (fileName: string, mimeType: string, bytes: Uint8Array) => {
  return (
    resolveExtensionFromFileName(fileName) ||
    resolveExtensionFromMime(mimeType) ||
    resolveExtensionFromBytes(bytes) ||
    "jpg"
  );
};

export const resolveImageMimeType = (extension: string, fallback = "application/octet-stream") => {
  return IMAGE_MIME_BY_EXTENSION[sanitizeExtension(extension)] || fallback;
};

export const buildR2MediaId = (objectKey: string, extension = "") => {
  const encodedKey = Buffer.from(String(objectKey || "").trim(), "utf8").toString("base64url");
  const suffix = sanitizeExtension(extension);
  return suffix ? `${MEDIA_ID_PREFIX}${encodedKey}_${suffix}` : `${MEDIA_ID_PREFIX}${encodedKey}`;
};

export const parseR2MediaId = (mediaId: string) => {
  const value = String(mediaId || "").trim();
  if (!value.startsWith(MEDIA_ID_PREFIX)) {
    return null;
  }
  const raw = value.slice(MEDIA_ID_PREFIX.length);
  if (!raw) {
    return null;
  }
  const splitIndex = raw.lastIndexOf("_");
  const encodedKey = splitIndex > 0 ? raw.slice(0, splitIndex) : raw;
  const extension = splitIndex > 0 ? sanitizeExtension(raw.slice(splitIndex + 1)) : "";
  if (!encodedKey) {
    return null;
  }
  try {
    const objectKey = Buffer.from(encodedKey, "base64url").toString("utf8");
    if (!objectKey) {
      return null;
    }
    return {
      objectKey,
      extension,
    };
  } catch (error) {
    return null;
  }
};

export const resolveMediaBucket = (event: H3Event) => {
  const candidate = (event.context as { cloudflare?: { env?: { MEDIA_BUCKET?: unknown } } }).cloudflare?.env?.MEDIA_BUCKET;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const bucket = candidate as {
    get?: unknown;
    put?: unknown;
  };
  if (typeof bucket.get !== "function" || typeof bucket.put !== "function") {
    return null;
  }
  return candidate as {
    get: (key: string) => Promise<{
      body: ReadableStream<Uint8Array> | null;
      httpMetadata?: { contentType?: string };
      writeHttpMetadata?: (headers: Headers) => void;
    } | null>;
    put: (
      key: string,
      value: Uint8Array,
      options?: {
        httpMetadata?: { contentType?: string };
      },
    ) => Promise<unknown>;
  };
};
