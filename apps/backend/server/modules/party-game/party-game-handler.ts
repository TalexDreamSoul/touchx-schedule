import type { H3Event } from "h3";
import {
  storeHelpers,
  type HeartOpenDifficulty,
  type NexusStore,
  type PartyGameHeartOpenWordRecord,
  type PartyGameMemberRecord,
  type PartyGameRoomRecord,
  type PartyGameStateRecord,
  type UserRecord,
} from "../../services/domain-store";
import {
  appendPartyGameEvent,
  buildHeartOpenOptions,
  filterHeartOpenWords,
  getPartyGameRoomMembers,
  getPartyGameRoomState,
  isHeartOpenDifficulty,
  normalizeHeartOpenCategory,
  resolvePartyGameTitle,
  sanitizeHeartOpenDifficulty,
  sanitizePartyGameKey,
  serializePartyGameRoomSnapshot,
  toHeartOpenWordPayload,
  toPartyGameRoomSummary,
} from "./party-game-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { user: UserRecord };
type RequireAdmin = (event: H3Event) => { user: UserRecord };
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface PartyGameHandlerContext {
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
}

const asString = (value: unknown) => String(value || "").trim();

export const isPartyGamePath = (path: string) => {
  return path.startsWith("party-games/") || path.startsWith("admin/party-games/");
};

export const handlePartyGameApi = async (context: PartyGameHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireUser, requireAdmin, readJsonBody, appendAudit } = context;

  if (method === "GET" && path === "party-games/heart-open/word-bank") {
    requireUser(event);
    const category = normalizeHeartOpenCategory(query.category || query.categoryName || query.category_name);
    const difficultyRaw = asString(query.difficulty || query.level).toLowerCase();
    if (difficultyRaw && !isHeartOpenDifficulty(difficultyRaw)) {
      return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
    }
    const keyword = asString(query.keyword);
    const filtered = filterHeartOpenWords(store.partyGameHeartOpenWords, {
      category,
      difficulty: difficultyRaw,
      keyword,
      enabled: true,
    }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return ok({
      items: filtered.map((item) => toHeartOpenWordPayload(item)),
      total: filtered.length,
      options: buildHeartOpenOptions(store.partyGameHeartOpenWords.filter((item) => item.enabled)),
      fetchedAt: storeHelpers.nowIso(),
    });
  }

  if (method === "GET" && path === "party-games/rooms") {
    const { user } = requireUser(event);
    const gameKey = sanitizePartyGameKey(query.gameKey || query.game_key);
    const mineOnly = String(query.mine || "").trim() === "1" || String(query.mine || "").trim().toLowerCase() === "true";
    const statusFilter = asString(query.status).toLowerCase();
    const items = store.partyGameRooms
      .filter((room) => {
        if (room.status === "closed") {
          return false;
        }
        if (gameKey && room.gameKey !== gameKey) {
          return false;
        }
        if (statusFilter && statusFilter !== "all" && room.status !== statusFilter) {
          return false;
        }
        if (!mineOnly) {
          return true;
        }
        return store.partyGameMembers.some((member) => member.roomId === room.id && member.userId === user.userId);
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 100)
      .map((room) => toPartyGameRoomSummary(store, room, user.userId));
    return ok({
      items,
      total: items.length,
    });
  }

  if (method === "POST" && path === "party-games/rooms") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{
      gameKey?: string;
      title?: string;
      maxPlayers?: number;
      nickname?: string;
    }>(event);
    const gameKey = sanitizePartyGameKey(body.gameKey);
    if (!gameKey) {
      return toApiError(400, "PARTY_GAME_KEY_INVALID", "gameKey 不合法");
    }
    const maxPlayers = Math.max(2, Math.min(12, Number(body.maxPlayers || 10)));
    const room: PartyGameRoomRecord = {
      id: storeHelpers.createId("pg_room"),
      roomCode: storeHelpers.generateJoinCode(),
      gameKey,
      title: resolvePartyGameTitle(gameKey, body.title),
      status: "waiting",
      hostUserId: user.userId,
      maxPlayers,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    const member: PartyGameMemberRecord = {
      id: storeHelpers.createId("pg_member"),
      roomId: room.id,
      userId: user.userId,
      nickname: asString(body.nickname) || user.nickname || user.name || user.studentNo,
      ready: true,
      online: true,
      joinedAt: storeHelpers.nowIso(),
      lastHeartbeatAt: storeHelpers.nowIso(),
    };
    const state: PartyGameStateRecord = {
      roomId: room.id,
      version: 1,
      data: {},
      updatedByUserId: user.userId,
      updatedAt: storeHelpers.nowIso(),
    };
    store.partyGameRooms.unshift(room);
    store.partyGameMembers.push(member);
    store.partyGameStates.push(state);
    appendPartyGameEvent(store, {
      roomId: room.id,
      type: "room.created",
      actorUserId: user.userId,
      payload: { gameKey: room.gameKey, roomCode: room.roomCode },
    });
    appendAudit("party_game_room_create", user.userId, {
      roomId: room.id,
      gameKey: room.gameKey,
      maxPlayers: room.maxPlayers,
    });
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  if (method === "POST" && path === "party-games/rooms/join-by-code") {
    const { user } = requireUser(event);
    const body = await readJsonBody<{ roomCode?: string; nickname?: string }>(event);
    const roomCode = asString(body.roomCode).toUpperCase();
    if (!roomCode) {
      return toApiError(400, "PARTY_GAME_ROOM_CODE_REQUIRED", "roomCode 不能为空");
    }
    const room = store.partyGameRooms.find((item) => item.roomCode === roomCode) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    let member = store.partyGameMembers.find((item) => item.roomId === room.id && item.userId === user.userId) || null;
    if (!member) {
      const memberCount = store.partyGameMembers.filter((item) => item.roomId === room.id).length;
      if (memberCount >= room.maxPlayers) {
        return toApiError(400, "PARTY_GAME_ROOM_FULL", "房间已满");
      }
      member = {
        id: storeHelpers.createId("pg_member"),
        roomId: room.id,
        userId: user.userId,
        nickname: asString(body.nickname) || user.nickname || user.name || user.studentNo,
        ready: false,
        online: true,
        joinedAt: storeHelpers.nowIso(),
        lastHeartbeatAt: storeHelpers.nowIso(),
      };
      store.partyGameMembers.push(member);
      room.updatedAt = storeHelpers.nowIso();
      appendPartyGameEvent(store, {
        roomId: room.id,
        type: "room.member_joined",
        actorUserId: user.userId,
        payload: { userId: user.userId },
      });
      appendAudit("party_game_room_join", user.userId, { roomId: room.id });
    } else {
      member.online = true;
      member.lastHeartbeatAt = storeHelpers.nowIso();
      if (asString(body.nickname)) {
        member.nickname = asString(body.nickname);
      }
    }
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomMatch = path.match(/^party-games\/rooms\/([^/]+)$/);
  if (method === "GET" && partyRoomMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    member.online = true;
    member.lastHeartbeatAt = storeHelpers.nowIso();
    const afterSeq = Math.max(0, Number(query.afterSeq || query.after_seq || 0));
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId, afterSeq));
  }

  const partyRoomJoinMatch = path.match(/^party-games\/rooms\/([^/]+)\/join$/);
  if (method === "POST" && partyRoomJoinMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomJoinMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const body = await readJsonBody<{ nickname?: string }>(event);
    let member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      const memberCount = store.partyGameMembers.filter((item) => item.roomId === roomId).length;
      if (memberCount >= room.maxPlayers) {
        return toApiError(400, "PARTY_GAME_ROOM_FULL", "房间已满");
      }
      member = {
        id: storeHelpers.createId("pg_member"),
        roomId,
        userId: user.userId,
        nickname: asString(body.nickname) || user.nickname || user.name || user.studentNo,
        ready: false,
        online: true,
        joinedAt: storeHelpers.nowIso(),
        lastHeartbeatAt: storeHelpers.nowIso(),
      };
      store.partyGameMembers.push(member);
      room.updatedAt = storeHelpers.nowIso();
      appendPartyGameEvent(store, {
        roomId,
        type: "room.member_joined",
        actorUserId: user.userId,
        payload: { userId: user.userId },
      });
      appendAudit("party_game_room_join", user.userId, { roomId });
    } else {
      member.online = true;
      member.lastHeartbeatAt = storeHelpers.nowIso();
      if (asString(body.nickname)) {
        member.nickname = asString(body.nickname);
      }
    }
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomLeaveMatch = path.match(/^party-games\/rooms\/([^/]+)\/leave$/);
  if (method === "POST" && partyRoomLeaveMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomLeaveMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(400, "PARTY_GAME_MEMBER_NOT_FOUND", "当前用户不在该房间");
    }
    store.partyGameMembers = store.partyGameMembers.filter((item) => item.id !== member.id);
    const remainMembers = getPartyGameRoomMembers(store, roomId);
    let roomClosed = false;
    if (remainMembers.length === 0) {
      room.status = "closed";
      room.updatedAt = storeHelpers.nowIso();
      roomClosed = true;
    } else if (room.hostUserId === user.userId) {
      room.hostUserId = remainMembers[0].userId;
      room.updatedAt = storeHelpers.nowIso();
    }
    appendPartyGameEvent(store, {
      roomId,
      type: "room.member_left",
      actorUserId: user.userId,
      payload: { userId: user.userId, roomClosed },
    });
    appendAudit("party_game_room_leave", user.userId, { roomId, roomClosed });
    return ok({
      left: true,
      roomId,
      roomClosed,
      hostUserId: room.hostUserId,
    });
  }

  const partyRoomHeartbeatMatch = path.match(/^party-games\/rooms\/([^/]+)\/heartbeat$/);
  if (method === "POST" && partyRoomHeartbeatMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomHeartbeatMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    member.online = true;
    member.lastHeartbeatAt = storeHelpers.nowIso();
    const body = await readJsonBody<{ ready?: boolean; nickname?: string }>(event);
    if (typeof body.ready === "boolean") {
      member.ready = body.ready;
    }
    if (asString(body.nickname)) {
      member.nickname = asString(body.nickname);
    }
    room.updatedAt = storeHelpers.nowIso();
    return ok({
      roomId,
      memberId: member.id,
      online: member.online,
      ready: member.ready,
      lastHeartbeatAt: member.lastHeartbeatAt,
    });
  }

  const partyRoomStartMatch = path.match(/^party-games\/rooms\/([^/]+)\/start$/);
  if (method === "POST" && partyRoomStartMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomStartMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    if (room.hostUserId !== user.userId) {
      return toApiError(403, "PARTY_GAME_ROOM_HOST_ONLY", "仅房主可开始对局");
    }
    room.status = "playing";
    room.updatedAt = storeHelpers.nowIso();
    appendPartyGameEvent(store, {
      roomId,
      type: "room.started",
      actorUserId: user.userId,
      payload: {},
    });
    appendAudit("party_game_room_start", user.userId, { roomId });
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomFinishMatch = path.match(/^party-games\/rooms\/([^/]+)\/finish$/);
  if (method === "POST" && partyRoomFinishMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomFinishMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    if (room.hostUserId !== user.userId) {
      return toApiError(403, "PARTY_GAME_ROOM_HOST_ONLY", "仅房主可结束对局");
    }
    room.status = "finished";
    room.updatedAt = storeHelpers.nowIso();
    appendPartyGameEvent(store, {
      roomId,
      type: "room.finished",
      actorUserId: user.userId,
      payload: {},
    });
    appendAudit("party_game_room_finish", user.userId, { roomId });
    return ok(serializePartyGameRoomSnapshot(store, room, user.userId));
  }

  const partyRoomSyncStateMatch = path.match(/^party-games\/rooms\/([^/]+)\/sync-state$/);
  if (method === "POST" && partyRoomSyncStateMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomSyncStateMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    const body = await readJsonBody<{
      state?: Record<string, unknown>;
      baseVersion?: number;
      roomStatus?: "waiting" | "playing" | "finished";
      eventType?: string;
      clientActionId?: string;
    }>(event);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
      return toApiError(400, "PARTY_GAME_STATE_INVALID", "state 必须为 JSON 对象");
    }
    let state = getPartyGameRoomState(store, roomId);
    if (!state) {
      state = {
        roomId,
        version: 1,
        data: {},
        updatedByUserId: room.hostUserId,
        updatedAt: storeHelpers.nowIso(),
      };
      store.partyGameStates.push(state);
    }
    const baseVersion = Number(body.baseVersion || 0);
    if (baseVersion > 0 && baseVersion !== state.version) {
      return toApiError(409, "PARTY_GAME_STATE_VERSION_CONFLICT", "房间状态版本冲突，请先拉取最新状态");
    }
    state.version += 1;
    state.data = { ...body.state };
    state.updatedAt = storeHelpers.nowIso();
    state.updatedByUserId = user.userId;
    if (body.roomStatus === "waiting" || body.roomStatus === "playing" || body.roomStatus === "finished") {
      room.status = body.roomStatus;
    }
    room.updatedAt = storeHelpers.nowIso();
    const nextEventType = asString(body.eventType) || "state.synced";
    const duplicatedEvent =
      body.clientActionId &&
      store.partyGameEvents.find(
        (item) =>
          item.roomId === roomId &&
          item.actorUserId === user.userId &&
          item.clientActionId === asString(body.clientActionId),
      );
    if (!duplicatedEvent) {
      appendPartyGameEvent(store, {
        roomId,
        type: nextEventType,
        actorUserId: user.userId,
        clientActionId: asString(body.clientActionId),
        payload: { version: state.version },
      });
    }
    return ok({
      roomId,
      version: state.version,
      updatedAt: state.updatedAt,
      updatedByUserId: state.updatedByUserId,
      roomStatus: room.status,
    });
  }

  const partyRoomActionMatch = path.match(/^party-games\/rooms\/([^/]+)\/actions$/);
  if (method === "POST" && partyRoomActionMatch) {
    const { user } = requireUser(event);
    const roomId = decodeURIComponent(partyRoomActionMatch[1]);
    const room = store.partyGameRooms.find((item) => item.id === roomId) || null;
    if (!room || room.status === "closed") {
      return toApiError(404, "PARTY_GAME_ROOM_NOT_FOUND", "房间不存在或已关闭");
    }
    const member = store.partyGameMembers.find((item) => item.roomId === roomId && item.userId === user.userId) || null;
    if (!member) {
      return toApiError(403, "PARTY_GAME_ROOM_ACCESS_DENIED", "请先加入房间");
    }
    const body = await readJsonBody<{
      type?: string;
      payload?: Record<string, unknown>;
      clientActionId?: string;
    }>(event);
    const actionType = asString(body.type);
    if (!actionType) {
      return toApiError(400, "PARTY_GAME_ACTION_TYPE_REQUIRED", "type 不能为空");
    }
    const clientActionId = asString(body.clientActionId);
    const duplicatedEvent =
      clientActionId &&
      store.partyGameEvents.find(
        (item) => item.roomId === roomId && item.actorUserId === user.userId && item.clientActionId === clientActionId,
      );
    if (duplicatedEvent) {
      return ok({
        duplicated: true,
        event: {
          eventId: duplicatedEvent.id,
          seq: duplicatedEvent.seq,
          type: duplicatedEvent.type,
          actorUserId: duplicatedEvent.actorUserId,
          payload: duplicatedEvent.payload,
          createdAt: duplicatedEvent.createdAt,
          clientActionId: duplicatedEvent.clientActionId,
        },
      });
    }
    room.updatedAt = storeHelpers.nowIso();
    const eventRecord = appendPartyGameEvent(store, {
      roomId,
      type: actionType,
      actorUserId: user.userId,
      clientActionId,
      payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    });
    return ok({
      duplicated: false,
      event: {
        eventId: eventRecord.id,
        seq: eventRecord.seq,
        type: eventRecord.type,
        actorUserId: eventRecord.actorUserId,
        payload: eventRecord.payload,
        createdAt: eventRecord.createdAt,
        clientActionId: eventRecord.clientActionId,
      },
      roomUpdatedAt: room.updatedAt,
    });
  }

  if (method === "GET" && path === "admin/party-games/heart-open/word-bank") {
    requireAdmin(event);
    const category = normalizeHeartOpenCategory(query.category || query.categoryName || query.category_name);
    const difficultyRaw = asString(query.difficulty || query.level).toLowerCase();
    if (difficultyRaw && !isHeartOpenDifficulty(difficultyRaw)) {
      return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
    }
    const enabledRaw = asString(query.enabled).toLowerCase();
    const enabledFilter =
      enabledRaw === "1" || enabledRaw === "true"
        ? true
        : enabledRaw === "0" || enabledRaw === "false"
          ? false
          : undefined;
    const keyword = asString(query.keyword);
    const filtered = filterHeartOpenWords(store.partyGameHeartOpenWords, {
      category,
      difficulty: difficultyRaw,
      keyword,
      enabled: enabledFilter,
    }).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return ok({
      items: filtered.map((item) => toHeartOpenWordPayload(item)),
      total: filtered.length,
      options: buildHeartOpenOptions(store.partyGameHeartOpenWords),
    });
  }

  if (method === "POST" && path === "admin/party-games/heart-open/word-bank") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{
      word?: string;
      punishment?: string;
      category?: string;
      difficulty?: HeartOpenDifficulty;
      enabled?: boolean;
    }>(event);
    const word = asString(body.word);
    const punishment = asString(body.punishment);
    if (!word) {
      return toApiError(400, "HEART_OPEN_WORD_REQUIRED", "word 不能为空");
    }
    if (!punishment) {
      return toApiError(400, "HEART_OPEN_PUNISHMENT_REQUIRED", "punishment 不能为空");
    }
    const difficultyRaw = asString(body.difficulty).toLowerCase();
    if (difficultyRaw && !isHeartOpenDifficulty(difficultyRaw)) {
      return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
    }
    const item: PartyGameHeartOpenWordRecord = {
      id: storeHelpers.createId("heart_open_word"),
      word,
      punishment,
      category: normalizeHeartOpenCategory(body.category) || "默认",
      difficulty: sanitizeHeartOpenDifficulty(body.difficulty, "medium"),
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      createdAt: storeHelpers.nowIso(),
      updatedAt: storeHelpers.nowIso(),
    };
    store.partyGameHeartOpenWords.unshift(item);
    appendAudit("heart_open_word_create", user.userId, {
      wordId: item.id,
      word: item.word,
      difficulty: item.difficulty,
      enabled: item.enabled,
    });
    return ok({
      item: toHeartOpenWordPayload(item),
    });
  }

  const adminHeartOpenWordUpdateMatch = path.match(/^admin\/party-games\/heart-open\/word-bank\/([^/]+)\/update$/);
  if (method === "POST" && adminHeartOpenWordUpdateMatch) {
    const { user } = requireAdmin(event);
    const wordId = decodeURIComponent(adminHeartOpenWordUpdateMatch[1]);
    const target = store.partyGameHeartOpenWords.find((item) => item.id === wordId) || null;
    if (!target) {
      return toApiError(404, "HEART_OPEN_WORD_NOT_FOUND", "词条不存在");
    }
    const body = await readJsonBody<{
      word?: string;
      punishment?: string;
      category?: string;
      difficulty?: HeartOpenDifficulty;
      enabled?: boolean;
    }>(event);
    if (Object.prototype.hasOwnProperty.call(body, "word")) {
      const word = asString(body.word);
      if (!word) {
        return toApiError(400, "HEART_OPEN_WORD_REQUIRED", "word 不能为空");
      }
      target.word = word;
    }
    if (Object.prototype.hasOwnProperty.call(body, "punishment")) {
      const punishment = asString(body.punishment);
      if (!punishment) {
        return toApiError(400, "HEART_OPEN_PUNISHMENT_REQUIRED", "punishment 不能为空");
      }
      target.punishment = punishment;
    }
    if (Object.prototype.hasOwnProperty.call(body, "category")) {
      target.category = normalizeHeartOpenCategory(body.category) || "默认";
    }
    if (Object.prototype.hasOwnProperty.call(body, "difficulty")) {
      const difficultyRaw = asString(body.difficulty).toLowerCase();
      if (difficultyRaw && !isHeartOpenDifficulty(difficultyRaw)) {
        return toApiError(400, "HEART_OPEN_DIFFICULTY_INVALID", "difficulty 仅支持 easy/medium/hard");
      }
      target.difficulty = sanitizeHeartOpenDifficulty(body.difficulty, target.difficulty);
    }
    if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
      target.enabled = Boolean(body.enabled);
    }
    target.updatedAt = storeHelpers.nowIso();
    appendAudit("heart_open_word_update", user.userId, {
      wordId: target.id,
      word: target.word,
      difficulty: target.difficulty,
      enabled: target.enabled,
    });
    return ok({
      item: toHeartOpenWordPayload(target),
    });
  }

  const adminHeartOpenWordDeleteMatch = path.match(/^admin\/party-games\/heart-open\/word-bank\/([^/]+)\/delete$/);
  if (method === "POST" && adminHeartOpenWordDeleteMatch) {
    const { user } = requireAdmin(event);
    const wordId = decodeURIComponent(adminHeartOpenWordDeleteMatch[1]);
    const target = store.partyGameHeartOpenWords.find((item) => item.id === wordId) || null;
    if (!target) {
      return toApiError(404, "HEART_OPEN_WORD_NOT_FOUND", "词条不存在");
    }
    store.partyGameHeartOpenWords = store.partyGameHeartOpenWords.filter((item) => item.id !== wordId);
    appendAudit("heart_open_word_delete", user.userId, {
      wordId,
      word: target.word,
    });
    return ok({
      deleted: true,
      wordId,
    });
  }

  return null;
};
