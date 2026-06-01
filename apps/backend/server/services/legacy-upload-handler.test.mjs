import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const transpileModuleToTemp = (sourcePath, fileName, replacements = []) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [needle, replacement] of replacements) {
    source = source.split(needle).join(replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-legacy-upload-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadLegacyUploadHandler = async () => {
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/legacy/legacy-upload-handler.ts"),
    "legacy-upload-handler.mjs",
    [
      [
        "from \"h3\";",
        `from ${JSON.stringify(dataModule(`
          export const readMultipartFormData = async (event) => event.multipartFormData || [];
        `))};`,
      ],
      [
        "from \"../../services/domain-store\";",
        `from ${JSON.stringify(dataModule(`
          export const storeHelpers = { nowIso: () => "2026-06-01T08:00:00.000Z" };
        `))};`,
      ],
      [
        "from \"../../utils/media-storage\";",
        `from ${JSON.stringify(dataModule(`
          export const buildR2MediaId = (objectKey, extension) => "r2_" + objectKey.replace(/[^a-zA-Z0-9]+/g, "_") + "." + extension;
          export const resolveImageExtension = (fileName) => String(fileName || "").endsWith(".png") ? "png" : "jpg";
          export const resolveImageMimeType = (extension) => extension === "png" ? "image/png" : "image/jpeg";
          export const resolveMediaBucket = (event) => event.bucket || null;
        `))};`,
      ],
    ],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-06-01T08:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  studentNo: "2305200101",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "一班",
  classIds: [],
  avatarUrl: "",
  wallpaperUrl: "",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createStore = () => ({
  mediaAssets: [],
});

const createContext = (handler, overrides = {}) => {
  const puts = [];
  const store = overrides.store || createStore();
  const user = overrides.user || createUser();
  const context = {
    event: {
      multipartFormData: overrides.multipartFormData || [
        {
          name: "file",
          filename: "evidence.png",
          type: "image/png",
          data: new Uint8Array([1, 2, 3]),
        },
      ],
      bucket: overrides.bucket === undefined
        ? {
            put: async (objectKey, data, options) => puts.push({ objectKey, size: data.length, options }),
          }
        : overrides.bucket,
    },
    method: overrides.method || "POST",
    path: overrides.path || "social/food-candidates/evidence",
    store,
    toApiError: (statusCode, code, message) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code });
      throw error;
    },
    requireLegacyAuth: () => ({ user }),
    getStoreRevision: () => 17,
  };
  return { context, store, puts, handleLegacyUploadApi: handler.handleLegacyUploadApi };
};

test("uploads food candidate evidence and records media asset", async () => {
  const handler = await loadLegacyUploadHandler();
  const { context, store, puts, handleLegacyUploadApi } = createContext(handler);

  const response = await handleLegacyUploadApi(context);

  assert.equal(response.ok, true);
  assert.match(response.asset.url, /^\/media\/r2_touchx_social_food_candidate_/);
  assert.equal(store.mediaAssets.length, 1);
  assert.equal(store.mediaAssets[0].usage, "other");
  assert.equal(store.mediaAssets[0].mime, "image/png");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].options.httpMetadata.contentType, "image/png");
});

test("uploads AI attachments with state revision", async () => {
  const handler = await loadLegacyUploadHandler();
  const { context, handleLegacyUploadApi } = createContext(handler, {
    path: "ai/attachments",
    multipartFormData: [{ name: "file", filename: "notes.jpg", type: "image/jpeg", data: new Uint8Array([9, 8]) }],
  });

  const response = await handleLegacyUploadApi(context);

  assert.equal(response.ok, true);
  assert.equal(response.stateRevision, 17);
  assert.match(response.asset.url, /^\/media\/r2_touchx_ai_attachments_/);
});

test("persists user media uploads through shared helper", async () => {
  const handler = await loadLegacyUploadHandler();
  const { context, store } = createContext(handler);

  const url = await handler.persistLegacyUserMediaUpload(context.event, store, createUser(), "avatar", handler.LEGACY_AVATAR_MAX_BYTES, context.toApiError);

  assert.match(url, /^\/media\/r2_touchx_social_avatar_/);
  assert.equal(store.mediaAssets[0].usage, "avatar");
});

test("rejects missing bucket, missing file, empty file, and oversized uploads", async () => {
  const handler = await loadLegacyUploadHandler();
  const missingBucket = createContext(handler, { bucket: null });
  await assert.rejects(() => missingBucket.handleLegacyUploadApi(missingBucket.context), {
    code: "MEDIA_BUCKET_MISSING",
  });

  const missingFile = createContext(handler, { multipartFormData: [] });
  await assert.rejects(() => missingFile.handleLegacyUploadApi(missingFile.context), {
    code: "UPLOAD_FILE_REQUIRED",
  });

  const emptyFile = createContext(handler, { multipartFormData: [{ name: "file", filename: "x.jpg", type: "image/jpeg", data: new Uint8Array([]) }] });
  await assert.rejects(() => emptyFile.handleLegacyUploadApi(emptyFile.context), {
    code: "UPLOAD_FILE_EMPTY",
  });

  const oversized = createContext(handler, {
    path: "social/food-candidates/evidence",
    multipartFormData: [{ name: "file", filename: "x.jpg", type: "image/jpeg", data: new Uint8Array(5 * 1024 * 1024 + 1) }],
  });
  await assert.rejects(() => oversized.handleLegacyUploadApi(oversized.context), {
    code: "UPLOAD_FILE_TOO_LARGE",
  });
});

test("ignores unrelated upload paths", async () => {
  const handler = await loadLegacyUploadHandler();
  const { context, handleLegacyUploadApi } = createContext(handler, { path: "social/foods" });

  assert.equal(handler.isLegacyUploadPath("ai/attachments"), true);
  assert.equal(handler.isLegacyUploadPath("social/food-candidates/evidence"), true);
  assert.equal(handler.isLegacyUploadPath("social/foods"), false);
  assert.equal(await handleLegacyUploadApi(context), null);
});
