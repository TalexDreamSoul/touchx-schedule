import { readMultipartFormData, type H3Event } from "h3";
import {
  storeHelpers,
  type MediaAssetRecord,
  type NexusStore,
  type UserRecord,
} from "../../services/domain-store";
import {
  buildR2MediaId,
  resolveImageExtension,
  resolveImageMimeType,
  resolveMediaBucket,
} from "../../utils/media-storage";

type ApiError = (statusCode: number, code: string, message: string) => never;
type RequireLegacyAuth = (event: H3Event) => { user: UserRecord };
type GetStoreRevision = () => number;

export interface LegacyUploadHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  store: NexusStore;
  toApiError: ApiError;
  requireLegacyAuth: RequireLegacyAuth;
  getStoreRevision: GetStoreRevision;
}

const LEGACY_AI_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const LEGACY_FOOD_CANDIDATE_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const LEGACY_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const LEGACY_WALLPAPER_MAX_BYTES = 5 * 1024 * 1024;

const asString = (value: unknown) => String(value || "").trim();

const randomSuffix = () => {
  return Math.random().toString(36).slice(2, 8);
};

const sanitizeStoragePart = (value: string) => {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
};

const ensureValue = <T>(value: T | null | undefined, statusCode: number, code: string, message: string, toApiError: ApiError): T => {
  if (value === null || value === undefined) {
    return toApiError(statusCode, code, message);
  }
  return value as T;
};

const readLegacyUploadFile = async (event: H3Event, maxBytes: number, toApiError: ApiError) => {
  const parts = await readMultipartFormData(event);
  const filePart = ensureValue(
    (parts || []).find((part) => part?.name === "file" && part.data instanceof Uint8Array) || null,
    400,
    "UPLOAD_FILE_REQUIRED",
    "请上传图片文件",
    toApiError,
  );
  const fileData = filePart.data;
  if (fileData.length <= 0) {
    return toApiError(400, "UPLOAD_FILE_EMPTY", "上传文件为空");
  }
  if (fileData.length > maxBytes) {
    return toApiError(400, "UPLOAD_FILE_TOO_LARGE", `文件过大，限制 ${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }
  const fileName = asString(filePart.filename) || `upload_${Date.now()}.jpg`;
  const extension = resolveImageExtension(fileName, asString(filePart.type), fileData);
  const mimeType = resolveImageMimeType(extension, asString(filePart.type) || "application/octet-stream");
  return {
    fileData,
    fileName,
    extension,
    mimeType,
    size: fileData.length,
  };
};

export const persistLegacyMediaUpload = async (
  event: H3Event,
  store: NexusStore,
  user: UserRecord,
  options: {
    usage: MediaAssetRecord["usage"];
    maxBytes: number;
    objectPrefix: string;
    toApiError: ApiError;
  },
) => {
  const bucket = ensureValue(resolveMediaBucket(event), 500, "MEDIA_BUCKET_MISSING", "媒体存储未配置，请联系管理员", options.toApiError);
  const upload = await readLegacyUploadFile(event, options.maxBytes, options.toApiError);
  const owner = sanitizeStoragePart(user.studentNo || user.studentId || user.userId || "anonymous");
  const objectKey = `${options.objectPrefix}/${owner}/${Date.now()}_${randomSuffix()}.${upload.extension}`;
  await bucket.put(objectKey, upload.fileData, {
    httpMetadata: {
      contentType: upload.mimeType,
    },
  });
  const mediaId = buildR2MediaId(objectKey, upload.extension);
  const mediaUrl = `/media/${mediaId}`;
  const existed = store.mediaAssets.find((item) => item.id === mediaId) || null;
  const nowIso = storeHelpers.nowIso();
  if (existed) {
    existed.ownerUserId = user.userId;
    existed.usage = options.usage;
    existed.objectKey = objectKey;
    existed.url = mediaUrl;
    existed.mime = upload.mimeType;
    existed.size = upload.size;
    existed.referenced = true;
    existed.updatedAt = nowIso;
  } else {
    const asset: MediaAssetRecord = {
      id: mediaId,
      ownerUserId: user.userId,
      usage: options.usage,
      objectKey,
      url: mediaUrl,
      mime: upload.mimeType,
      size: upload.size,
      referenced: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.mediaAssets.unshift(asset);
  }
  return {
    assetId: mediaId,
    url: mediaUrl,
  };
};

export const persistLegacyUserMediaUpload = async (
  event: H3Event,
  store: NexusStore,
  user: UserRecord,
  usage: "avatar" | "wallpaper",
  maxBytes: number,
  toApiError: ApiError,
) => {
  const upload = await persistLegacyMediaUpload(event, store, user, {
    usage,
    maxBytes,
    objectPrefix: `touchx/social/${usage}`,
    toApiError,
  });
  return upload.url;
};

export const isLegacyUploadPath = (path: string) => {
  return path === "ai/attachments" || path === "social/food-candidates/evidence";
};

export const handleLegacyUploadApi = async (context: LegacyUploadHandlerContext) => {
  const {
    event,
    method,
    path,
    store,
    toApiError,
    requireLegacyAuth,
    getStoreRevision,
  } = context;

  if (!isLegacyUploadPath(path)) {
    return null;
  }

  if (method === "POST" && path === "ai/attachments") {
    const { user } = requireLegacyAuth(event);
    const upload = await persistLegacyMediaUpload(event, store, user, {
      usage: "other",
      maxBytes: LEGACY_AI_ATTACHMENT_MAX_BYTES,
      objectPrefix: "touchx/ai/attachments",
      toApiError,
    });
    return {
      ok: true,
      asset: upload,
      stateRevision: getStoreRevision(),
    };
  }

  if (method === "POST" && path === "social/food-candidates/evidence") {
    const { user } = requireLegacyAuth(event);
    const upload = await persistLegacyMediaUpload(event, store, user, {
      usage: "other",
      maxBytes: LEGACY_FOOD_CANDIDATE_EVIDENCE_MAX_BYTES,
      objectPrefix: "touchx/social/food-candidate",
      toApiError,
    });
    return {
      ok: true,
      asset: upload,
    };
  }

  return null;
};
