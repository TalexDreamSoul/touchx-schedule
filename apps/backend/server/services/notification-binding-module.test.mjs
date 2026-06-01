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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-notification-binding-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadNotificationBindingModule = async () => {
  const domainStorePath = transpileModuleToTemp(
    join(import.meta.dirname, "domain-store.ts"),
    "domain-store.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["import legacyUsersData from \"../data/legacy/users.normalized.json\";", "const legacyUsersData = [];"],
      ["import legacyCoursesData from \"../data/legacy/courses.normalized.json\";", "const legacyCoursesData = [];"],
      ["import legacyFoodsSeedData from \"../data/legacy/foods.seed.json\";", "const legacyFoodsSeedData = [];"],
    ],
  );
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/notification/notification-binding-service.ts"),
    "notification-binding-service.mjs",
    [
      ["from \"@touchx/shared\";", "from \"data:text/javascript,export {};\";"],
      ["\"../../services/domain-store\"", JSON.stringify(pathToFileURL(domainStorePath).href)],
    ],
  );
  return import(pathToFileURL(servicePath).href);
};

const createStore = () => {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    users: [
      {
        userId: "user-1",
        studentNo: "2300000001",
        studentId: "student-1",
        accountName: "alice@example.test",
        name: "Alice",
        nickname: "Alice同学",
        classLabel: "测试一班",
      },
      {
        userId: "user-2",
        studentNo: "2300000002",
        studentId: "student-2",
        accountName: "bob@example.test",
        name: "Bob",
        nickname: "Bob同学",
        classLabel: "测试二班",
      },
    ],
    userNotificationBindings: [
      {
        id: "binding-1",
        userId: "user-1",
        channelType: "feishu",
        externalUserId: "user_feishu_1",
        externalOpenId: "ou_user_1",
        externalUnionId: "",
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "binding-2",
        userId: "user-2",
        channelType: "wechat_clawdbot",
        externalUserId: "wx_user_2",
        externalOpenId: "",
        externalUnionId: "",
        status: "disabled",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
};

test("lists admin notification bindings with filters and user payloads", async () => {
  const service = await loadNotificationBindingModule();
  const store = createStore();

  const result = service.listAdminNotificationBindings(store, {
    limit: 10,
    offset: 0,
    channelType: "feishu",
  });

  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, "binding-1");
  assert.equal(result.items[0].user.userId, "user-1");
  assert.equal(result.items[0].user.accountName, "alice@example.test");
});

test("upserts notification binding by user and channel", async () => {
  const service = await loadNotificationBindingModule();
  const store = createStore();

  const result = service.upsertAdminNotificationBinding(store, {
    userId: "user-1",
    channelType: "feishu",
    externalOpenId: "ou_user_1_new",
    status: "expired",
  });

  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.item.id, "binding-1");
  assert.equal(result.item.externalUserId, "ou_user_1_new");
  assert.equal(result.item.externalOpenId, "ou_user_1_new");
  assert.equal(result.item.status, "expired");
  assert.equal(store.userNotificationBindings.length, 2);
});

test("creates notification binding and validates required fields", async () => {
  const service = await loadNotificationBindingModule();
  const store = createStore();

  assert.deepEqual(service.upsertAdminNotificationBinding(store, { userId: "missing-user", channelType: "feishu", externalUserId: "x" }), {
    ok: false,
    reason: "user_not_found",
  });
  assert.deepEqual(service.upsertAdminNotificationBinding(store, { userId: "user-1", channelType: "email", externalUserId: "x" }), {
    ok: false,
    reason: "channel_invalid",
  });
  assert.deepEqual(service.upsertAdminNotificationBinding(store, { userId: "user-1", channelType: "feishu" }), {
    ok: false,
    reason: "receive_id_required",
  });

  const created = service.upsertAdminNotificationBinding(store, {
    userId: "user-2",
    channelType: "feishu",
    externalUnionId: "on_user_2",
  });

  assert.equal(created.ok, true);
  assert.equal(created.created, true);
  assert.equal(created.item.channelType, "feishu");
  assert.equal(created.item.externalUserId, "on_user_2");
  assert.equal(created.item.externalUnionId, "on_user_2");
  assert.equal(created.item.status, "active");
  assert.equal(store.userNotificationBindings[0].id, created.item.id);
});

test("deletes admin notification binding", async () => {
  const service = await loadNotificationBindingModule();
  const store = createStore();

  const removed = service.deleteAdminNotificationBinding(store, "binding-2");

  assert.equal(removed.id, "binding-2");
  assert.equal(store.userNotificationBindings.length, 1);
  assert.equal(service.deleteAdminNotificationBinding(store, "missing"), null);
});
