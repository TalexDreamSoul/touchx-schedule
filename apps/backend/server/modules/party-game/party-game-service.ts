import {
  storeHelpers,
  type HeartOpenDifficulty,
  type NexusStore,
  type PartyGameEventRecord,
  type PartyGameHeartOpenWordRecord,
  type PartyGameRoomRecord,
} from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

const PARTY_GAME_KEYS = new Set(["werewolf", "undercover", "avalon", "telephone", "drawguess", "turtle"]);
const PARTY_GAME_OFFLINE_TTL_MS = 45 * 1000;
const PARTY_GAME_MAX_EVENTS_PER_ROOM = 800;
const HEART_OPEN_DIFFICULTY_SET = new Set<HeartOpenDifficulty>(["easy", "medium", "hard"]);
const HEART_OPEN_DIFFICULTIES: HeartOpenDifficulty[] = ["easy", "medium", "hard"];

const HEART_OPEN_DIFFICULTY_LABEL_MAP: Record<HeartOpenDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const PARTY_GAME_DEFAULT_TITLE_MAP: Record<string, string> = {
  werewolf: "狼人杀快节奏局",
  undercover: "谁是卧底双卧底局",
  avalon: "阿瓦隆标准局",
  telephone: "传声筒剧情局",
  drawguess: "你画我猜接力局",
  turtle: "海龟汤速推理局",
};

export const isHeartOpenDifficulty = (value: unknown) => {
  return HEART_OPEN_DIFFICULTY_SET.has(asString(value).toLowerCase() as HeartOpenDifficulty);
};

export const sanitizePartyGameKey = (value: unknown) => {
  const key = asString(value).toLowerCase();
  if (!PARTY_GAME_KEYS.has(key)) {
    return "";
  }
  return key;
};

export const sanitizeHeartOpenDifficulty = (value: unknown, fallback: HeartOpenDifficulty = "medium"): HeartOpenDifficulty => {
  const difficulty = asString(value).toLowerCase() as HeartOpenDifficulty;
  if (!HEART_OPEN_DIFFICULTY_SET.has(difficulty)) {
    return fallback;
  }
  return difficulty;
};

export const normalizeHeartOpenCategory = (value: unknown) => {
  return asString(value).replace(/\s+/g, " ").trim();
};

export const toHeartOpenWordPayload = (item: PartyGameHeartOpenWordRecord) => {
  return {
    wordId: item.id,
    word: item.word,
    punishment: item.punishment,
    category: item.category,
    difficulty: item.difficulty,
    difficultyLabel: HEART_OPEN_DIFFICULTY_LABEL_MAP[item.difficulty],
    enabled: item.enabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

export const filterHeartOpenWords = (
  words: PartyGameHeartOpenWordRecord[],
  options: {
    category?: string;
    difficulty?: string;
    keyword?: string;
    enabled?: boolean;
  },
) => {
  const category = normalizeHeartOpenCategory(options.category).toLowerCase();
  const difficulty = asString(options.difficulty).toLowerCase();
  const keyword = asString(options.keyword).toLowerCase();
  return words
    .filter((item) => (typeof options.enabled === "boolean" ? item.enabled === options.enabled : true))
    .filter((item) => (!category ? true : item.category.toLowerCase() === category))
    .filter((item) => {
      if (!difficulty) {
        return true;
      }
      return item.difficulty === difficulty;
    })
    .filter((item) => {
      if (!keyword) {
        return true;
      }
      const bag = `${item.word} ${item.punishment} ${item.category}`.toLowerCase();
      return bag.includes(keyword);
    });
};

export const buildHeartOpenOptions = (items: PartyGameHeartOpenWordRecord[]) => {
  const categorySet = new Set<string>();
  items.forEach((item) => {
    if (item.category) {
      categorySet.add(item.category);
    }
  });
  return {
    categories: Array.from(categorySet.values()).sort((left, right) => left.localeCompare(right, "zh-CN")),
    difficulties: HEART_OPEN_DIFFICULTIES.map((difficulty) => ({
      value: difficulty,
      label: HEART_OPEN_DIFFICULTY_LABEL_MAP[difficulty],
    })),
  };
};

export const resolvePartyGameTitle = (gameKey: string, rawTitle: unknown) => {
  const title = asString(rawTitle);
  if (title) {
    return title;
  }
  return PARTY_GAME_DEFAULT_TITLE_MAP[gameKey] || "聚会游戏房间";
};

export const refreshPartyGameMemberOnlineState = (
  store: NexusStore,
  roomId: string,
  nowTs = Date.now(),
) => {
  store.partyGameMembers.forEach((member) => {
    if (member.roomId !== roomId) {
      return;
    }
    const lastTs = Date.parse(member.lastHeartbeatAt || "");
    if (!Number.isFinite(lastTs)) {
      member.online = false;
      return;
    }
    member.online = nowTs - lastTs <= PARTY_GAME_OFFLINE_TTL_MS;
  });
};

export const getPartyGameRoomMembers = (store: NexusStore, roomId: string) => {
  return store.partyGameMembers
    .filter((item) => item.roomId === roomId)
    .sort((left, right) => Date.parse(left.joinedAt) - Date.parse(right.joinedAt));
};

export const getPartyGameRoomState = (store: NexusStore, roomId: string) => {
  return store.partyGameStates.find((item) => item.roomId === roomId) || null;
};

export const appendPartyGameEvent = (
  store: NexusStore,
  input: {
    roomId: string;
    type: string;
    actorUserId: string;
    payload?: Record<string, unknown>;
    clientActionId?: string;
  },
) => {
  const maxSeq = store.partyGameEvents
    .filter((item) => item.roomId === input.roomId)
    .reduce((acc, item) => Math.max(acc, item.seq), 0);
  const event: PartyGameEventRecord = {
    id: storeHelpers.createId("pg_event"),
    roomId: input.roomId,
    seq: maxSeq + 1,
    type: asString(input.type) || "party_game.event",
    actorUserId: input.actorUserId,
    clientActionId: asString(input.clientActionId),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    createdAt: storeHelpers.nowIso(),
  };
  store.partyGameEvents.push(event);
  const roomEventIds = store.partyGameEvents
    .filter((item) => item.roomId === input.roomId)
    .sort((left, right) => left.seq - right.seq);
  if (roomEventIds.length > PARTY_GAME_MAX_EVENTS_PER_ROOM) {
    const removeCount = roomEventIds.length - PARTY_GAME_MAX_EVENTS_PER_ROOM;
    const removeIdSet = new Set(roomEventIds.slice(0, removeCount).map((item) => item.id));
    store.partyGameEvents = store.partyGameEvents.filter((item) => !removeIdSet.has(item.id));
  }
  return event;
};

export const toPartyGameRoomSummary = (
  store: NexusStore,
  room: PartyGameRoomRecord,
  currentUserId: string,
) => {
  refreshPartyGameMemberOnlineState(store, room.id);
  const members = getPartyGameRoomMembers(store, room.id);
  const hostUser = store.users.find((item) => item.userId === room.hostUserId) || null;
  const meMember = members.find((item) => item.userId === currentUserId) || null;
  return {
    roomId: room.id,
    roomCode: room.roomCode,
    gameKey: room.gameKey,
    title: room.title,
    status: room.status,
    hostUserId: room.hostUserId,
    hostName: hostUser?.name || hostUser?.nickname || "",
    maxPlayers: room.maxPlayers,
    memberCount: members.length,
    onlineCount: members.filter((item) => item.online).length,
    readyCount: members.filter((item) => item.ready).length,
    joined: Boolean(meMember),
    isHost: room.hostUserId === currentUserId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
};

export const serializePartyGameRoomSnapshot = (
  store: NexusStore,
  room: PartyGameRoomRecord,
  currentUserId: string,
  afterSeq = 0,
) => {
  refreshPartyGameMemberOnlineState(store, room.id);
  const members = getPartyGameRoomMembers(store, room.id).map((item) => {
    const user = store.users.find((userItem) => userItem.userId === item.userId) || null;
    return {
      memberId: item.id,
      userId: item.userId,
      studentNo: user?.studentNo || "",
      nickname: item.nickname || user?.nickname || user?.name || "",
      ready: item.ready,
      online: item.online,
      joinedAt: item.joinedAt,
      lastHeartbeatAt: item.lastHeartbeatAt,
      isMe: item.userId === currentUserId,
      isHost: item.userId === room.hostUserId,
    };
  });
  const state = getPartyGameRoomState(store, room.id);
  const events = store.partyGameEvents
    .filter((item) => item.roomId === room.id && item.seq > Math.max(0, Math.floor(afterSeq)))
    .sort((left, right) => left.seq - right.seq)
    .slice(-200)
    .map((item) => ({
      eventId: item.id,
      seq: item.seq,
      type: item.type,
      actorUserId: item.actorUserId,
      payload: item.payload,
      createdAt: item.createdAt,
      clientActionId: item.clientActionId,
    }));
  const latestSeq = store.partyGameEvents
    .filter((item) => item.roomId === room.id)
    .reduce((acc, item) => Math.max(acc, item.seq), 0);
  return {
    room: toPartyGameRoomSummary(store, room, currentUserId),
    members,
    state: {
      version: state?.version || 0,
      data: state?.data || {},
      updatedAt: state?.updatedAt || room.updatedAt,
      updatedByUserId: state?.updatedByUserId || room.hostUserId,
    },
    events,
    latestSeq,
    serverTime: storeHelpers.nowIso(),
  };
};
