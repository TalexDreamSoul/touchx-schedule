import { onUnmounted, ref } from "vue";
import {
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  type AuthSessionState,
} from "@/utils/profile-service";

interface PartyRoomMember {
  memberId: string;
  userId: string;
  studentNo: string;
  nickname: string;
  ready: boolean;
  online: boolean;
  joinedAt: string;
  lastHeartbeatAt: string;
  isMe: boolean;
  isHost: boolean;
}

interface PartyRoomEvent {
  eventId: string;
  seq: number;
  type: string;
  actorUserId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  clientActionId: string;
}

interface PartyRoomStateSnapshot {
  room: {
    roomId: string;
    roomCode: string;
    gameKey: string;
    title: string;
    status: "waiting" | "playing" | "finished" | "closed";
    hostUserId: string;
    isHost: boolean;
  };
  members: PartyRoomMember[];
  state: {
    version: number;
    data: Record<string, unknown>;
    updatedByUserId: string;
    updatedAt: string;
  };
  events?: PartyRoomEvent[];
  latestSeq: number;
  serverTime?: string;
}

const POLL_INTERVAL_MS = 2500;
const HEARTBEAT_INTERVAL_MS = 15000;
const POLL_FULL_SNAPSHOT_TICKS = 8;
const PARTY_GAME_ROOM_HISTORY_KEY = "__touchx_party_game_room_history__";
const MAX_RECENT_ROOM_CODES = 6;

interface PartyGameRoomHistoryItem {
  roomId: string;
  roomCode: string;
  title: string;
  gameKey: string;
  updatedAt: string;
}

interface PartyGameRoomHistoryStore {
  byGameRecentCodes: Record<string, string[]>;
  byGameLastRoom: Record<string, PartyGameRoomHistoryItem>;
}

export const usePartyGameRoomSync = (gameKey: string) => {
  const backendBaseUrl = ref("");
  const authSession = ref<AuthSessionState>({
    token: "",
    expiresAt: 0,
    mode: "none",
    user: null,
  });

  const roomId = ref("");
  const roomCode = ref("");
  const roomStatus = ref<"waiting" | "playing" | "finished" | "closed">("waiting");
  const isHost = ref(false);
  const members = ref<PartyRoomMember[]>([]);
  const stateVersion = ref(0);
  const lastSeq = ref(0);
  const syncing = ref(false);
  const connected = ref(false);
  const latestEvents = ref<PartyRoomEvent[]>([]);
  const recentRoomCodes = ref<string[]>([]);
  const lastRoom = ref<PartyGameRoomHistoryItem | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let pollTick = 0;

  const readRoomHistoryStore = (): PartyGameRoomHistoryStore => {
    try {
      const raw = uni.getStorageSync(PARTY_GAME_ROOM_HISTORY_KEY);
      if (!raw) {
        return {
          byGameRecentCodes: {},
          byGameLastRoom: {},
        };
      }
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object") {
        return {
          byGameRecentCodes: {},
          byGameLastRoom: {},
        };
      }
      const row = parsed as {
        byGameRecentCodes?: Record<string, unknown>;
        byGameLastRoom?: Record<string, unknown>;
      };
      const byGameRecentCodes = row.byGameRecentCodes && typeof row.byGameRecentCodes === "object" ? row.byGameRecentCodes : {};
      const byGameLastRoom = row.byGameLastRoom && typeof row.byGameLastRoom === "object" ? row.byGameLastRoom : {};
      const normalizedRecentCodes: Record<string, string[]> = {};
      Object.keys(byGameRecentCodes).forEach((key) => {
        const codes = byGameRecentCodes[key];
        normalizedRecentCodes[key] = Array.isArray(codes)
          ? codes
              .map((item) => String(item || "").trim().toUpperCase())
              .filter((item) => Boolean(item))
              .slice(0, MAX_RECENT_ROOM_CODES)
          : [];
      });
      const normalizedLastRoom: Record<string, PartyGameRoomHistoryItem> = {};
      Object.keys(byGameLastRoom).forEach((key) => {
        const item = byGameLastRoom[key];
        if (!item || typeof item !== "object") {
          return;
        }
        const value = item as { roomId?: unknown; roomCode?: unknown; title?: unknown; gameKey?: unknown; updatedAt?: unknown };
        const roomId = String(value.roomId || "").trim();
        const roomCode = String(value.roomCode || "").trim().toUpperCase();
        if (!roomId && !roomCode) {
          return;
        }
        normalizedLastRoom[key] = {
          roomId,
          roomCode,
          title: String(value.title || ""),
          gameKey: String(value.gameKey || key || "").trim().toLowerCase(),
          updatedAt: String(value.updatedAt || ""),
        };
      });
      return {
        byGameRecentCodes: normalizedRecentCodes,
        byGameLastRoom: normalizedLastRoom,
      };
    } catch (error) {
      return {
        byGameRecentCodes: {},
        byGameLastRoom: {},
      };
    }
  };

  const writeRoomHistoryStore = (store: PartyGameRoomHistoryStore) => {
    uni.setStorageSync(PARTY_GAME_ROOM_HISTORY_KEY, store);
  };

  const refreshRoomHistoryRefs = () => {
    const store = readRoomHistoryStore();
    const codeList = store.byGameRecentCodes[gameKey];
    recentRoomCodes.value = Array.isArray(codeList) ? codeList : [];
    lastRoom.value = store.byGameLastRoom[gameKey] || null;
  };

  const persistRoomHistory = (snapshot: PartyRoomStateSnapshot) => {
    const nextRoomId = String(snapshot.room?.roomId || "").trim();
    const nextRoomCode = String(snapshot.room?.roomCode || "").trim().toUpperCase();
    if (!nextRoomId && !nextRoomCode) {
      return;
    }
    const store = readRoomHistoryStore();
    const previousCodes = Array.isArray(store.byGameRecentCodes[gameKey]) ? store.byGameRecentCodes[gameKey] : [];
    const nextCodes = [nextRoomCode, ...previousCodes.filter((item) => item !== nextRoomCode)]
      .filter((item) => Boolean(item))
      .slice(0, MAX_RECENT_ROOM_CODES);
    store.byGameRecentCodes[gameKey] = nextCodes;
    store.byGameLastRoom[gameKey] = {
      roomId: nextRoomId,
      roomCode: nextRoomCode,
      title: String(snapshot.room?.title || ""),
      gameKey,
      updatedAt: String(snapshot.serverTime || snapshot.state?.updatedAt || new Date().toISOString()),
    };
    writeRoomHistoryStore(store);
    refreshRoomHistoryRefs();
  };

  const loadSession = () => {
    backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
    authSession.value = readAuthSessionFromStorage();
    refreshRoomHistoryRefs();
  };

  const ensureAuth = () => {
    loadSession();
    if (!authSession.value.token) {
      throw new Error("请先登录账号后再进行联机");
    }
  };

  const applySnapshot = (snapshot: PartyRoomStateSnapshot) => {
    roomId.value = String(snapshot.room.roomId || "").trim();
    roomCode.value = String(snapshot.room.roomCode || "").trim();
    roomStatus.value = snapshot.room.status;
    isHost.value = Boolean(snapshot.room.isHost);
    members.value = Array.isArray(snapshot.members) ? snapshot.members : [];
    stateVersion.value = Math.max(0, Number(snapshot.state?.version || 0));
    lastSeq.value = Math.max(0, Number(snapshot.latestSeq || 0));
    latestEvents.value = Array.isArray(snapshot.events) ? snapshot.events : [];
    connected.value = true;
  };

  const fetchRoomSnapshot = async (targetRoomId = roomId.value, afterSeq = 0) => {
    ensureAuth();
    if (!targetRoomId) {
      throw new Error("roomId 为空，无法拉取房间状态");
    }
    const normalizedAfterSeq = Math.max(0, Number(afterSeq || 0));
    const snapshot = await requestBackendGet<PartyRoomStateSnapshot>(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(targetRoomId)}`,
      normalizedAfterSeq > 0 ? { afterSeq: String(normalizedAfterSeq) } : {},
      authSession.value.token,
    );
    applySnapshot(snapshot);
    return snapshot;
  };

  const createRoom = async (title: string, maxPlayers: number, initialState: Record<string, unknown>) => {
    ensureAuth();
    const snapshot = await requestBackendPost<PartyRoomStateSnapshot>(
      backendBaseUrl.value,
      "/api/v1/party-games/rooms",
      {
        gameKey,
        title,
        maxPlayers,
      },
      authSession.value.token,
    );
    applySnapshot(snapshot);
    persistRoomHistory(snapshot);
    await syncState(initialState, "waiting", "room.initial_state");
    return snapshot;
  };

  const joinRoomByCode = async (joinCode: string) => {
    ensureAuth();
    const snapshot = await requestBackendPost<PartyRoomStateSnapshot>(
      backendBaseUrl.value,
      "/api/v1/party-games/rooms/join-by-code",
      {
        roomCode: String(joinCode || "").trim().toUpperCase(),
      },
      authSession.value.token,
    );
    applySnapshot(snapshot);
    persistRoomHistory(snapshot);
    return snapshot;
  };

  const joinRoomById = async (targetRoomId: string) => {
    ensureAuth();
    const snapshot = await requestBackendPost<PartyRoomStateSnapshot>(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(targetRoomId)}/join`,
      {},
      authSession.value.token,
    );
    applySnapshot(snapshot);
    persistRoomHistory(snapshot);
    return snapshot;
  };

  const leaveRoom = async () => {
    ensureAuth();
    if (!roomId.value) {
      return;
    }
    await requestBackendPost(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(roomId.value)}/leave`,
      {},
      authSession.value.token,
    );
    roomId.value = "";
    roomCode.value = "";
    roomStatus.value = "waiting";
    isHost.value = false;
    members.value = [];
    stateVersion.value = 0;
    lastSeq.value = 0;
    latestEvents.value = [];
    connected.value = false;
  };

  const heartbeat = async (ready?: boolean) => {
    ensureAuth();
    if (!roomId.value) {
      return;
    }
    await requestBackendPost(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(roomId.value)}/heartbeat`,
      {
        ready,
      },
      authSession.value.token,
    );
  };

  const syncState = async (
    state: Record<string, unknown>,
    nextRoomStatus: "waiting" | "playing" | "finished" = "playing",
    eventType = "state.sync",
  ) => {
    ensureAuth();
    if (!roomId.value) {
      return null;
    }
    syncing.value = true;
    try {
      const result = await requestBackendPost<{
        roomId: string;
        version: number;
        updatedAt: string;
        updatedByUserId: string;
        roomStatus: "waiting" | "playing" | "finished" | "closed";
      }>(
        backendBaseUrl.value,
        `/api/v1/party-games/rooms/${encodeURIComponent(roomId.value)}/sync-state`,
        {
          state,
          baseVersion: stateVersion.value,
          roomStatus: nextRoomStatus,
          eventType,
          clientActionId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
        authSession.value.token,
      );
      stateVersion.value = Math.max(0, Number(result.version || stateVersion.value));
      roomStatus.value = result.roomStatus;
      return result;
    } finally {
      syncing.value = false;
    }
  };

  const sendAction = async (type: string, payload: Record<string, unknown> = {}) => {
    ensureAuth();
    if (!roomId.value) {
      return null;
    }
    const actionType = String(type || "").trim();
    if (!actionType) {
      throw new Error("action type 不能为空");
    }
    const result = await requestBackendPost<{
      duplicated: boolean;
      event: PartyRoomEvent;
      roomUpdatedAt: string;
    }>(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(roomId.value)}/actions`,
      {
        type: actionType,
        payload,
        clientActionId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      },
      authSession.value.token,
    );
    if (result?.event) {
      const seq = Math.max(0, Number(result.event.seq || 0));
      if (seq > 0) {
        lastSeq.value = Math.max(lastSeq.value, seq);
      }
      latestEvents.value = [result.event];
    }
    return result;
  };

  const reconnectLastRoom = async () => {
    ensureAuth();
    refreshRoomHistoryRefs();
    const target = lastRoom.value;
    if (!target) {
      return null;
    }
    if (target.roomId) {
      try {
        const snapshot = await joinRoomById(target.roomId);
        persistRoomHistory(snapshot);
        return snapshot;
      } catch (error) {
        // fallback below
      }
    }
    if (target.roomCode) {
      const snapshot = await joinRoomByCode(target.roomCode);
      persistRoomHistory(snapshot);
      return snapshot;
    }
    return null;
  };

  const startRoom = async () => {
    ensureAuth();
    if (!roomId.value) {
      return;
    }
    const snapshot = await requestBackendPost<PartyRoomStateSnapshot>(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(roomId.value)}/start`,
      {},
      authSession.value.token,
    );
    applySnapshot(snapshot);
    return snapshot;
  };

  const finishRoom = async () => {
    ensureAuth();
    if (!roomId.value) {
      return;
    }
    const snapshot = await requestBackendPost<PartyRoomStateSnapshot>(
      backendBaseUrl.value,
      `/api/v1/party-games/rooms/${encodeURIComponent(roomId.value)}/finish`,
      {},
      authSession.value.token,
    );
    applySnapshot(snapshot);
    return snapshot;
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startPolling = (onSnapshot: (snapshot: PartyRoomStateSnapshot, context: { fullSnapshot: boolean }) => void) => {
    stopPolling();
    pollTick = 0;
    pollTimer = setInterval(async () => {
      if (!roomId.value) {
        return;
      }
      try {
        pollTick += 1;
        const forceFullSnapshot = pollTick % POLL_FULL_SNAPSHOT_TICKS === 0;
        const snapshot = await fetchRoomSnapshot(roomId.value, forceFullSnapshot ? 0 : lastSeq.value);
        onSnapshot(snapshot, { fullSnapshot: forceFullSnapshot });
      } catch (error) {
        connected.value = false;
      }
    }, POLL_INTERVAL_MS);
    heartbeatTimer = setInterval(async () => {
      if (!roomId.value) {
        return;
      }
      try {
        await heartbeat();
      } catch (error) {
        connected.value = false;
      }
    }, HEARTBEAT_INTERVAL_MS);
  };

  onUnmounted(() => {
    stopPolling();
  });

  return {
    backendBaseUrl,
    authSession,
    roomId,
    roomCode,
    roomStatus,
    isHost,
    members,
    stateVersion,
    lastSeq,
    syncing,
    connected,
    latestEvents,
    recentRoomCodes,
    lastRoom,
    loadSession,
    fetchRoomSnapshot,
    createRoom,
    joinRoomByCode,
    joinRoomById,
    leaveRoom,
    heartbeat,
    syncState,
    sendAction,
    reconnectLastRoom,
    startRoom,
    finishRoom,
    startPolling,
    stopPolling,
  };
};
