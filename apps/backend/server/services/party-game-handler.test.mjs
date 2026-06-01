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
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-party-game-handler-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadPartyGameHandler = async () => {
  const domainStoreStub = [
    "let seq = 0;",
    "export const storeHelpers = {",
    "  nowIso: () => '2026-05-18T00:00:00.000Z',",
    "  createId: (prefix) => `${prefix}-${++seq}`,",
    "  generateJoinCode: () => `JOIN${++seq}`",
    "};",
  ].join("\n");
  const servicePath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/party-game/party-game-service.ts"),
    "party-game-service.mjs",
    [["\"../../services/domain-store\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(domainStoreStub)}`)]],
  );
  const handlerPath = transpileModuleToTemp(
    join(import.meta.dirname, "../modules/party-game/party-game-handler.ts"),
    "party-game-handler.mjs",
    [
      ["\"../../services/domain-store\"", JSON.stringify(`data:text/javascript,${encodeURIComponent(domainStoreStub)}`)],
      ["\"./party-game-service\"", JSON.stringify(pathToFileURL(servicePath).href)],
    ],
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

const createRoom = (overrides = {}) => ({
  id: "room-1",
  roomCode: "ROOM123",
  gameKey: "undercover",
  title: "谁是卧底",
  status: "waiting",
  hostUserId: "user-1",
  maxPlayers: 4,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createMember = (overrides = {}) => ({
  id: "member-1",
  roomId: "room-1",
  userId: "user-1",
  nickname: "Alice",
  ready: true,
  online: true,
  joinedAt: now,
  lastHeartbeatAt: now,
  ...overrides,
});

const createStore = () => ({
  users: [
    createUser(),
    createUser({ userId: "user-2", studentNo: "2300000002", nickname: "Bob", classIds: [] }),
    createUser({ userId: "admin-1", studentNo: "999999", nickname: "Admin", adminRole: "super_admin", classIds: [] }),
  ],
  partyGameRooms: [createRoom()],
  partyGameMembers: [createMember()],
  partyGameStates: [{ roomId: "room-1", version: 1, data: { round: 1 }, updatedByUserId: "user-1", updatedAt: now }],
  partyGameEvents: [
    { id: "event-1", roomId: "room-1", seq: 1, type: "room.created", actorUserId: "user-1", clientActionId: "", payload: {}, createdAt: now },
  ],
  partyGameHeartOpenWords: [
    { id: "word-1", word: "苹果", punishment: "唱歌", category: "默认", difficulty: "easy", enabled: true, createdAt: now, updatedAt: now },
    { id: "word-2", word: "香蕉", punishment: "跳舞", category: "水果", difficulty: "hard", enabled: false, createdAt: now, updatedAt: now },
  ],
});

const createContext = (handler, overrides = {}) => {
  const store = overrides.store || createStore();
  const audits = [];
  const context = {
    event: {},
    method: overrides.method || "GET",
    path: overrides.path || "party-games/rooms",
    query: overrides.query || {},
    store,
    ok: (data) => ({ ok: true, data }),
    toApiError: (statusCode, code, message, details) => {
      const error = new Error(message);
      Object.assign(error, { statusCode, code, details });
      throw error;
    },
    requireUser: () => ({ user: overrides.user || store.users[0] }),
    requireAdmin: () => ({ user: overrides.adminUser || store.users[2] }),
    readJsonBody: async () => overrides.body || {},
    appendAudit: (action, actorUserId, payload) => audits.push({ action, actorUserId, payload }),
  };
  return { context, store, audits, handlePartyGameApi: handler.handlePartyGameApi };
};

test("lists, creates, joins by code, and leaves party game rooms", async () => {
  const handler = await loadPartyGameHandler();
  const { context, store, audits, handlePartyGameApi } = createContext(handler, {
    query: { mine: "true" },
  });

  const listed = await handlePartyGameApi(context);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.items[0].joined, true);

  context.method = "POST";
  context.path = "party-games/rooms";
  context.query = {};
  context.readJsonBody = async () => ({ gameKey: "avalon", maxPlayers: 5, nickname: "房主" });
  const created = await handlePartyGameApi(context);
  assert.equal(created.data.room.gameKey, "avalon");
  assert.equal(created.data.members[0].ready, true);
  assert.equal(store.partyGameRooms[0].id, created.data.room.roomId);
  assert.equal(audits.at(-1).action, "party_game_room_create");

  context.requireUser = () => ({ user: store.users[1] });
  context.path = "party-games/rooms/join-by-code";
  context.readJsonBody = async () => ({ roomCode: created.data.room.roomCode, nickname: "Bob玩家" });
  const joined = await handlePartyGameApi(context);
  assert.equal(joined.data.members.some((item) => item.userId === "user-2" && item.nickname === "Bob玩家"), true);
  assert.equal(audits.at(-1).action, "party_game_room_join");

  const member = store.partyGameMembers.find((item) => item.roomId === created.data.room.roomId && item.userId === "user-2");
  context.path = `party-games/rooms/${created.data.room.roomId}/leave`;
  context.readJsonBody = async () => ({});
  const left = await handlePartyGameApi(context);
  assert.equal(left.data.left, true);
  assert.equal(store.partyGameMembers.some((item) => item.id === member.id), false);
});

test("handles room access, heartbeat, start, finish, state sync, and actions", async () => {
  const handler = await loadPartyGameHandler();
  const { context, store, audits, handlePartyGameApi } = createContext(handler, { path: "party-games/rooms/room-1" });

  const detail = await handlePartyGameApi(context);
  assert.equal(detail.data.room.roomId, "room-1");
  assert.equal(detail.data.latestSeq, 1);

  context.method = "POST";
  context.path = "party-games/rooms/room-1/heartbeat";
  context.readJsonBody = async () => ({ ready: false, nickname: "Alice新" });
  const heartbeat = await handlePartyGameApi(context);
  assert.equal(heartbeat.data.ready, false);
  assert.equal(store.partyGameMembers[0].nickname, "Alice新");

  context.path = "party-games/rooms/room-1/start";
  context.readJsonBody = async () => ({});
  const started = await handlePartyGameApi(context);
  assert.equal(started.data.room.status, "playing");
  assert.equal(audits.at(-1).action, "party_game_room_start");

  context.path = "party-games/rooms/room-1/sync-state";
  context.readJsonBody = async () => ({ state: { round: 2 }, baseVersion: 1, roomStatus: "playing", eventType: "round.synced", clientActionId: "sync-1" });
  const synced = await handlePartyGameApi(context);
  assert.equal(synced.data.version, 2);
  assert.equal(store.partyGameEvents.some((item) => item.clientActionId === "sync-1"), true);

  context.path = "party-games/rooms/room-1/actions";
  context.readJsonBody = async () => ({ type: "card.pick", payload: { card: 1 }, clientActionId: "act-1" });
  const action = await handlePartyGameApi(context);
  assert.equal(action.data.duplicated, false);

  const duplicated = await handlePartyGameApi(context);
  assert.equal(duplicated.data.duplicated, true);
  assert.equal(duplicated.data.event.clientActionId, "act-1");

  context.path = "party-games/rooms/room-1/finish";
  context.readJsonBody = async () => ({});
  const finished = await handlePartyGameApi(context);
  assert.equal(finished.data.room.status, "finished");
  assert.equal(audits.at(-1).action, "party_game_room_finish");
});

test("maps party game room errors", async () => {
  const handler = await loadPartyGameHandler();
  const invalidKey = createContext(handler, {
    method: "POST",
    path: "party-games/rooms",
    body: { gameKey: "bad" },
  });
  await assert.rejects(() => invalidKey.handlePartyGameApi(invalidKey.context), {
    statusCode: 400,
    code: "PARTY_GAME_KEY_INVALID",
  });

  const accessDenied = createContext(handler, {
    path: "party-games/rooms/room-1",
    user: createUser({ userId: "outsider", studentNo: "2300000099", classIds: [] }),
  });
  await assert.rejects(() => accessDenied.handlePartyGameApi(accessDenied.context), {
    statusCode: 403,
    code: "PARTY_GAME_ROOM_ACCESS_DENIED",
  });

  const conflict = createContext(handler, {
    method: "POST",
    path: "party-games/rooms/room-1/sync-state",
    body: { state: { round: 3 }, baseVersion: 99 },
  });
  await assert.rejects(() => conflict.handlePartyGameApi(conflict.context), {
    statusCode: 409,
    code: "PARTY_GAME_STATE_VERSION_CONFLICT",
  });
});

test("lists, creates, updates, and deletes heart-open words", async () => {
  const handler = await loadPartyGameHandler();
  const { context, store, audits, handlePartyGameApi } = createContext(handler, {
    path: "party-games/heart-open/word-bank",
    query: { keyword: "苹果" },
  });

  const publicWords = await handlePartyGameApi(context);
  assert.equal(publicWords.data.total, 1);
  assert.equal(publicWords.data.items[0].difficultyLabel, "简单");

  context.path = "admin/party-games/heart-open/word-bank";
  context.query = { enabled: "false" };
  const adminWords = await handlePartyGameApi(context);
  assert.equal(adminWords.data.items[0].wordId, "word-2");

  context.method = "POST";
  context.query = {};
  context.readJsonBody = async () => ({ word: "西瓜", punishment: "讲故事", category: "水果", difficulty: "hard", enabled: true });
  const created = await handlePartyGameApi(context);
  assert.equal(created.data.item.word, "西瓜");
  assert.equal(created.data.item.difficultyLabel, "困难");
  assert.equal(audits.at(-1).action, "heart_open_word_create");

  context.path = `admin/party-games/heart-open/word-bank/${created.data.item.wordId}/update`;
  context.readJsonBody = async () => ({ word: "西瓜更新", enabled: false });
  const updated = await handlePartyGameApi(context);
  assert.equal(updated.data.item.word, "西瓜更新");
  assert.equal(updated.data.item.enabled, false);

  context.path = `admin/party-games/heart-open/word-bank/${created.data.item.wordId}/delete`;
  context.readJsonBody = async () => ({});
  const deleted = await handlePartyGameApi(context);
  assert.equal(deleted.data.deleted, true);
  assert.equal(store.partyGameHeartOpenWords.some((item) => item.id === created.data.item.wordId), false);
});

test("maps heart-open word errors and ignores unrelated paths", async () => {
  const handler = await loadPartyGameHandler();
  const invalidDifficulty = createContext(handler, {
    path: "party-games/heart-open/word-bank",
    query: { difficulty: "impossible" },
  });
  await assert.rejects(() => invalidDifficulty.handlePartyGameApi(invalidDifficulty.context), {
    statusCode: 400,
    code: "HEART_OPEN_DIFFICULTY_INVALID",
  });

  const missingWord = createContext(handler, {
    method: "POST",
    path: "admin/party-games/heart-open/word-bank/missing/update",
    body: { word: "不存在" },
  });
  await assert.rejects(() => missingWord.handlePartyGameApi(missingWord.context), {
    statusCode: 404,
    code: "HEART_OPEN_WORD_NOT_FOUND",
  });

  const unrelated = createContext(handler, { path: "admin/users" });
  assert.equal(handler.isPartyGamePath("party-games/rooms"), true);
  assert.equal(handler.isPartyGamePath("admin/party-games/heart-open/word-bank"), true);
  assert.equal(handler.isPartyGamePath("admin/users"), false);
  assert.equal(await unrelated.handlePartyGameApi(unrelated.context), null);
});
