import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-media-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadMediaHandler = async () => {
  const domainStoreStub = [
    "let seq = 0;",
    "export const storeHelpers = {",
    "  nowIso: () => '2026-05-18T00:00:00.000Z',",
    "  createId: (prefix) => `${prefix}-${++seq}`,",
    "};",
  ].join("\n");
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/media/media-service.ts"),
    "media-service.mjs",
    [["\"../../services/domain-store\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(domainStoreStub)}`)]],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/media/media-handler.ts"),
    "media-handler.mjs",
    [["\"./media-service\"", JSON.stringify(pathToFileURL(servicePath).href)]],
  );
  return import(pathToFileURL(handlerPath).href);
};

const now = "2026-05-01T00:00:00.000Z";

const createUser = (overrides = {}) => ({
  userId: "user-1",
  accountName: "alice@example.test",
  studentNo: "2300000001",
  studentId: "student-1",
  name: "Alice",
  nickname: "Alice同学",
  classLabel: "测试一班",
  classIds: ["class-1"],
  avatarUrl: "",
  wallpaperUrl: "",
  adminRole: "none",
  reminderEnabled: true,
  reminderWindowMinutes: [30, 15],
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createAsset = (overrides = {}) => ({
  id: "asset-1",
  ownerUserId: "user-1",
  usage: "avatar",
  objectKey: "avatar/asset-1_avatar.png",
  url: "/media/asset-1",
  mime: "image/png",
  size: 1024,
  referenced: false,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser(),
    createUser({
      userId: "admin-1",
      accountName: "admin@example.test",
      studentNo: "999999",
      studentId: "admin-student",
      name: "Admin",
      nickname: "Admin",
      adminRole: "super_admin",
      classIds: [],
    }),
  ],
  mediaAssets: [
    createAsset(),
    createAsset({
      id: "asset-wallpaper",
      usage: "wallpaper",
      objectKey: "wallpaper/asset-wallpaper_wallpaper.png",
      url: "/media/asset-wallpaper",
      referenced: false,
    }),
    createAsset({
      id: "asset-other",
      ownerUserId: "other-user",
      usage: "other",
      objectKey: "other/asset-other.bin",
      url: "/media/asset-other",
      createdAt: "2026-05-17T23:00:00.000Z",
    }),
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "admin/media-assets",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireUser: () => ({ user: overrides.user || store.users[0] }),
    requireAdmin: () => ({ user: overrides.adminUser || store.users[1] }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
    toUserPayload: (user) => ({
      userId: user.userId,
      avatarUrl: user.avatarUrl,
      wallpaperUrl: user.wallpaperUrl,
      updatedAt: user.updatedAt,
    }),
  };
  return { context, store, audits, handleMediaApi: handler.handleMediaApi };
};

test("lists admin media assets with owner and usage filters", async () => {
  const handler = await loadMediaHandler();
  const { context, handleMediaApi } = createContext(handler, {
    query: { owner_user_id: "user-1", usage: "wallpaper" },
  });

  const listed = await handleMediaApi(context);

  assert.deepEqual(
    listed.data.items.map((item) => item.id),
    ["asset-wallpaper"],
  );
});

test("creates a media asset and sanitizes object keys", async () => {
  const handler = await loadMediaHandler();
  const { context, store, audits, handleMediaApi } = createContext(handler, {
    method: "POST",
    path: "media/assets",
    body: {
      usage: "avatar",
      mime: "image/png",
      size: 2048,
      fileName: "hello avatar #1.png",
    },
  });

  const created = await handleMediaApi(context);

  assert.equal(created.data.asset.ownerUserId, "user-1");
  assert.equal(created.data.asset.usage, "avatar");
  assert.equal(created.data.asset.mime, "image/png");
  assert.equal(created.data.asset.size, 2048);
  assert.match(created.data.asset.objectKey, /^avatar\/media-\d+_hello_avatar__1\.png$/);
  assert.equal(store.mediaAssets[0].id, created.data.asset.id);
  assert.deepEqual(audits, [
    {
      action: "media_asset_create",
      actorUserId: "user-1",
      payload: { mediaId: created.data.asset.id, usage: "avatar" },
    },
  ]);
});

test("updates profile media and marks assets referenced", async () => {
  const handler = await loadMediaHandler();
  const { context, store, audits, handleMediaApi } = createContext(handler, {
    method: "POST",
    path: "me/profile/media",
    body: { avatarAssetId: "asset-1", wallpaperAssetId: "asset-wallpaper" },
  });

  const updated = await handleMediaApi(context);

  assert.equal(updated.data.user.avatarUrl, "/media/asset-1");
  assert.equal(updated.data.user.wallpaperUrl, "/media/asset-wallpaper");
  assert.equal(store.mediaAssets.find((item) => item.id === "asset-1").referenced, true);
  assert.equal(store.mediaAssets.find((item) => item.id === "asset-wallpaper").referenced, true);
  assert.equal(store.users[0].updatedAt, "2026-05-18T00:00:00.000Z");
  assert.deepEqual(audits, [
    {
      action: "profile_media_update",
      actorUserId: "user-1",
      payload: { avatarAssetId: "asset-1", wallpaperAssetId: "asset-wallpaper" },
    },
  ]);
});

test("returns typed errors for missing profile media assets", async () => {
  const handler = await loadMediaHandler();
  const { context, handleMediaApi } = createContext(handler, {
    method: "POST",
    path: "me/profile/media",
    body: { avatarAssetId: "missing" },
  });

  await assert.rejects(() => handleMediaApi(context), {
    statusCode: 404,
    code: "AVATAR_ASSET_NOT_FOUND",
  });
});

test("reconciles and cleans up media assets", async () => {
  const handler = await loadMediaHandler();
  const store = createStore();
  store.users[0].avatarUrl = "/media/asset-1";
  store.mediaAssets.find((item) => item.id === "asset-other").createdAt = new Date().toISOString();
  const { context, audits, handleMediaApi } = createContext(handler, {
    store,
    method: "POST",
    path: "admin/media-assets/reconcile",
  });

  const reconciled = await handleMediaApi(context);
  assert.equal(reconciled.data.updated, 1);
  assert.equal(store.mediaAssets.find((item) => item.id === "asset-1").referenced, true);

  context.path = "admin/media-assets/cleanup";
  context.readJsonBody = async () => ({ onlyOrphans: true, olderThanHours: 24 });
  const cleaned = await handleMediaApi(context);

  assert.equal(cleaned.data.removed, 1);
  assert.deepEqual(
    cleaned.data.removedAssets.map((item) => item.id),
    ["asset-wallpaper"],
  );
  assert.equal(store.mediaAssets.some((item) => item.id === "asset-other"), true);
  assert.deepEqual(
    audits.map((item) => item.action),
    ["admin_media_reconcile", "admin_media_cleanup"],
  );
});

test("ignores unrelated paths", async () => {
  const handler = await loadMediaHandler();
  const { context, handleMediaApi } = createContext(handler, { path: "admin/users" });

  assert.equal(handler.isMediaPath("media/assets"), true);
  assert.equal(handler.isMediaPath("me/profile/media"), true);
  assert.equal(handler.isMediaPath("admin/media-assets/reconcile"), true);
  assert.equal(handler.isMediaPath("admin/users"), false);
  assert.equal(await handleMediaApi(context), null);
});
