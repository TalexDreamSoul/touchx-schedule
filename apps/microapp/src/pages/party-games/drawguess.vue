<template>
  <PartyGameLayout
    title="你画我猜（接力版）"
    subtitle="联机共享画板，边画边猜。"
    player-range="8-10人"
    duration="20-35 分钟"
    host-tip="词条别太生僻，节奏会更顺。"
    :how-to-play="howToPlay"
    :theme-key="themeKey"
  >
    <PartyGameRoomPanel
      :connected="roomSync.connected.value"
      :room-id="roomSync.roomId.value"
      :room-code="roomSync.roomCode.value"
      :room-status-label="roomStatusLabel"
      :meta-text="roomMetaText"
      :members="roomSync.members.value"
      :room-title-input="roomTitleInput"
      :join-code-input="joinCodeInput"
      :recent-room-codes="roomSync.recentRoomCodes.value"
      :last-room="roomSync.lastRoom.value"
      @update:room-title-input="roomTitleInput = $event"
      @update:join-code-input="joinCodeInput = $event"
      @create="createRoom"
      @join="joinByCode"
      @refresh="refreshRoom"
      @leave="leaveRoom"
      @copy="copyRoomCode"
      @pick-recent-code="joinCodeInput = $event"
      @reconnect-last="reconnectLastRoom"
    />

    <PartyGamePlayerPanel
      :players="players"
      :new-player-name="newPlayerName"
      :min-players="6"
      :max-players="12"
      :started="started"
      :start-disabled="players.length < 6 || !sourceWord.trim() || (Boolean(roomSync.roomId.value) && !roomSync.isHost.value)"
      start-text="开始接力"
      @update:new-player-name="newPlayerName = $event"
      @add="handleAddPlayer"
      @remove="handleRemovePlayer"
      @toggle-alive="handleToggleAlive"
      @shuffle="handleShufflePlayers"
      @reset="handleResetPlayers"
      @start="startGame"
    />

    <view class="card">
      <view class="title">接力控制</view>
      <view class="meta">第 {{ roundNo }} 轮 / {{ maxRounds }} · 当前 {{ turnLabel }}</view>

      <view class="input-block">
        <view class="label">初始词条</view>
        <input
          v-model="sourceWord"
          class="text-input"
          :disabled="started"
          maxlength="20"
          placeholder="例如：雪山缆车"
          placeholder-class="text-input-ph"
        />
      </view>

      <view class="board-block">
        <view class="board-head">
          <view class="label">共享画板</view>
          <view class="board-status">{{ canDrawBoard ? "可绘制" : "只读预览" }}</view>
        </view>
        <view class="color-row">
          <view v-for="color in brushColors" :key="color" class="color-dot" :class="{ active: brushColor === color }" :style="{ backgroundColor: color }" @click="selectBrushColor(color)" />
          <view class="size-chip">笔宽 {{ brushSize }}</view>
          <slider class="size-slider" :value="brushSize" :min="2" :max="12" :step="1" :disabled="!canDrawBoard" activeColor="#1f4ad4" backgroundColor="#d4dae7" @change="onBrushSizeChange" />
        </view>
        <view class="canvas-wrap">
          <canvas
            canvas-id="drawguessBoard"
            class="draw-board"
            :style="{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }"
            :width="canvasWidth"
            :height="canvasHeight"
            disable-scroll
            @touchstart="onBoardTouchStart"
            @touchmove="onBoardTouchMove"
            @touchend="onBoardTouchEnd"
            @touchcancel="onBoardTouchEnd"
          />
        </view>
        <view class="action-row">
          <view class="btn ghost" @click="undoStroke">撤销一步</view>
          <view class="btn ghost" @click="clearBoard">清空画板</view>
        </view>
      </view>

      <view v-if="started && !finished" class="input-block">
        <view class="label">{{ inputLabel }}</view>
        <input
          v-model="turnInput"
          class="text-input"
          maxlength="32"
          :placeholder="turnType === 'draw' ? '画完后点击提交' : '输入你猜到的词'"
          placeholder-class="text-input-ph"
          :disabled="turnType === 'draw'"
        />
        <view class="action-row">
          <view class="btn" @click="submitTurn">提交本步</view>
          <view class="btn ghost" @click="finishGame">提前结束</view>
        </view>
      </view>

      <view v-if="finished" class="result-box">
        <view class="result-title">接力完成</view>
        <view class="result-text">原词：{{ sourceWord }}</view>
        <view class="result-text">最终词：{{ latestWord }}</view>
      </view>

      <view v-if="chainLogs.length > 0" class="log-box">
        <view class="block-title">接力链路</view>
        <view v-for="(item, index) in chainLogs" :key="`log-${index}`" class="log-item">
          R{{ item.round }} · {{ item.playerName }} · {{ item.typeLabel }}：{{ item.value }}
        </view>
      </view>
    </view>
  </PartyGameLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import * as Y from "yjs";
import PartyGameLayout from "./components/PartyGameLayout.vue";
import PartyGamePlayerPanel from "./components/PartyGamePlayerPanel.vue";
import PartyGameRoomPanel from "./components/PartyGameRoomPanel.vue";
import { usePartyGameTheme } from "./composables/usePartyGameTheme";
import { usePartyGamePlayers } from "./composables/usePartyGamePlayers";
import { usePartyGameRoomSync } from "./composables/usePartyGameRoomSync";

interface ChainLogItem {
  round: number;
  playerName: string;
  typeLabel: string;
  value: string;
}

interface DrawPoint {
  x: number;
  y: number;
}

interface DrawStroke {
  id: string;
  color: string;
  size: number;
  points: DrawPoint[];
}

type TurnType = "draw" | "guess";

interface DrawGuessSyncState {
  started: boolean;
  finished: boolean;
  sourceWord: string;
  latestWord: string;
  roundNo: number;
  turnType: TurnType;
  chainLogs: ChainLogItem[];
  strokes: DrawStroke[];
  brushColor: string;
  brushSize: number;
  players: Array<{ id: string; name: string; alive: boolean }>;
}

interface PartyGameRoomEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

const howToPlay = [
  "创建或加入房间后，所有成员看到同一块共享画板。",
  "画图阶段在画板作画，提交后进入猜词阶段。",
  "猜词阶段输入猜测词，系统推进到下一轮。",
  "达到最大轮次后结算，查看原词到最终词偏差。",
];

const { themeKey } = usePartyGameTheme();
const { players, newPlayerName, addPlayer, removePlayer, toggleAlive, shufflePlayers, resetPlayers } = usePartyGamePlayers(8);
const roomSync = usePartyGameRoomSync("drawguess");

const started = ref(false);
const finished = ref(false);
const sourceWord = ref("雪山缆车");
const latestWord = ref("");
const roundNo = ref(1);
const turnType = ref<TurnType>("draw");
const turnInput = ref("");
const chainLogs = ref<ChainLogItem[]>([]);
const joinCodeInput = ref("");
const roomTitleInput = ref("你画我猜接力局");
const autoJoinRoomCode = ref("");
const autoJoinRoomId = ref("");

const brushColors = ["#111111", "#1f4ad4", "#d42f45", "#0ea56a", "#c97900"];
const brushColor = ref("#111111");
const brushSize = ref(5);
const strokes = ref<DrawStroke[]>([]);
const drawing = ref(false);
const currentStroke = ref<DrawStroke | null>(null);
const canvasWidth = ref(320);
const canvasHeight = ref(220);
const yDoc = new Y.Doc();
const yStrokeArray = yDoc.getArray<unknown>("strokes");
const lastAppliedEventSeq = ref(0);
const BOARD_SNAPSHOT_SYNC_DELAY_MS = 8000;
let boardSnapshotTimer: ReturnType<typeof setTimeout> | null = null;

const maxRounds = computed(() => {
  return Math.max(3, Math.min(6, players.value.length));
});

const drawPlayer = computed(() => {
  const index = (roundNo.value - 1) % players.value.length;
  return players.value[index];
});

const guessPlayer = computed(() => {
  const index = roundNo.value % players.value.length;
  return players.value[index];
});

const turnLabel = computed(() => {
  if (!started.value) {
    return "未开始";
  }
  if (finished.value) {
    return "已结束";
  }
  if (turnType.value === "draw") {
    return `${drawPlayer.value?.name || "-"} 画图中`;
  }
  return `${guessPlayer.value?.name || "-"} 猜词中`;
});

const inputLabel = computed(() => {
  return turnType.value === "draw" ? "画图阶段（共享画板）" : "猜词阶段";
});

const roomStatusLabel = computed(() => {
  if (roomSync.roomStatus.value === "playing") {
    return "进行中";
  }
  if (roomSync.roomStatus.value === "finished") {
    return "已结束";
  }
  if (roomSync.roomStatus.value === "closed") {
    return "已关闭";
  }
  return "等待中";
});

const roomMetaText = computed(() => {
  if (!roomSync.authSession.value.token) {
    return "登录后可创建或加入联机房间";
  }
  if (!roomSync.roomId.value) {
    return "当前未加入房间，可创建新房间或输入房间码加入";
  }
  return roomSync.isHost.value ? "你是房主，可控盘并同步共享画板" : "你是成员，实时查看共享画板";
});

const canDrawBoard = computed(() => {
  if (!started.value || finished.value || turnType.value !== "draw") {
    return false;
  }
  if (!roomSync.roomId.value) {
    return true;
  }
  return roomSync.isHost.value;
});

const assertCanControl = () => {
  if (roomSync.roomId.value && !roomSync.isHost.value) {
    uni.showToast({ title: "仅房主可操作对局", icon: "none" });
    return false;
  }
  return true;
};

const createStrokeId = () => {
  return `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const cloneStroke = (stroke: DrawStroke): DrawStroke => {
  return {
    id: stroke.id,
    color: stroke.color,
    size: stroke.size,
    points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
  };
};

const initCanvasSize = () => {
  const info = uni.getSystemInfoSync();
  const width = Math.max(280, Math.floor(Number(info.windowWidth || 375) - 40));
  const height = Math.max(180, Math.round(width * 0.58));
  canvasWidth.value = width;
  canvasHeight.value = height;
};

const normalizePoint = (rawX: number, rawY: number): DrawPoint => {
  const x = Math.max(0, Math.min(canvasWidth.value, Number(rawX || 0)));
  const y = Math.max(0, Math.min(canvasHeight.value, Number(rawY || 0)));
  return { x, y };
};

const normalizeStroke = (value: unknown): DrawStroke | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as { id?: unknown; color?: unknown; size?: unknown; points?: unknown };
  const points = Array.isArray(row.points)
    ? row.points
        .filter((point) => point && typeof point === "object")
        .map((point) => {
          const next = point as { x?: unknown; y?: unknown };
          return normalizePoint(Number(next.x || 0), Number(next.y || 0));
        })
    : [];
  return {
    id: String(row.id || createStrokeId()),
    color: String(row.color || "#111111"),
    size: Math.max(2, Math.min(12, Math.round(Number(row.size || 5)))),
    points,
  };
};

const toBase64 = (bytes: Uint8Array) => {
  const start = bytes.byteOffset;
  const end = bytes.byteOffset + bytes.byteLength;
  const buffer = bytes.buffer.slice(start, end);
  return uni.arrayBufferToBase64(buffer);
};

const fromBase64 = (encoded: string) => {
  const value = String(encoded || "").trim();
  if (!value) {
    return null;
  }
  try {
    const buffer = uni.base64ToArrayBuffer(value);
    return new Uint8Array(buffer);
  } catch (error) {
    return null;
  }
};

const parseTouchPoint = (event: unknown): DrawPoint | null => {
  const payload = event as {
    changedTouches?: Array<{ x?: number; y?: number; clientX?: number; clientY?: number }>;
    touches?: Array<{ x?: number; y?: number; clientX?: number; clientY?: number }>;
  };
  const touch = payload?.changedTouches?.[0] || payload?.touches?.[0];
  if (!touch) {
    return null;
  }
  const rawX = Number(touch.x ?? touch.clientX ?? 0);
  const rawY = Number(touch.y ?? touch.clientY ?? 0);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return null;
  }
  return normalizePoint(rawX, rawY);
};

const drawStrokeToContext = (ctx: UniApp.CanvasContext, stroke: DrawStroke) => {
  if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
    return;
  }
  ctx.setStrokeStyle(stroke.color || "#111111");
  ctx.setLineWidth(Math.max(1, Number(stroke.size || 4)));
  ctx.setLineCap("round");
  ctx.setLineJoin("round");
  ctx.beginPath();
  const firstPoint = stroke.points[0];
  ctx.moveTo(firstPoint.x, firstPoint.y);
  stroke.points.slice(1).forEach((point) => {
    ctx.lineTo(point.x, point.y);
  });
  if (stroke.points.length === 1) {
    ctx.lineTo(firstPoint.x + 0.1, firstPoint.y + 0.1);
  }
  ctx.stroke();
};

const redrawBoard = () => {
  const ctx = uni.createCanvasContext("drawguessBoard");
  ctx.setFillStyle("#ffffff");
  ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value);
  strokes.value.forEach((stroke) => drawStrokeToContext(ctx, stroke));
  if (currentStroke.value) {
    drawStrokeToContext(ctx, currentStroke.value);
  }
  ctx.draw();
};

const syncBoardFromYjs = () => {
  const nextStrokes = yStrokeArray.toArray().map((item) => normalizeStroke(item)).filter((item): item is DrawStroke => Boolean(item));
  strokes.value = nextStrokes;
  nextTick(() => redrawBoard());
};

const resetYjsBoard = (nextStrokes: DrawStroke[], origin: string) => {
  yDoc.transact(() => {
    if (yStrokeArray.length > 0) {
      yStrokeArray.delete(0, yStrokeArray.length);
    }
    if (nextStrokes.length > 0) {
      yStrokeArray.push(nextStrokes.map((item) => cloneStroke(item)));
    }
  }, origin);
};

const appendStrokeToYjs = (stroke: DrawStroke) => {
  yDoc.transact(() => {
    yStrokeArray.push([cloneStroke(stroke)]);
  }, "local");
};

const clearYjsBoard = () => {
  yDoc.transact(() => {
    if (yStrokeArray.length > 0) {
      yStrokeArray.delete(0, yStrokeArray.length);
    }
  }, "local");
};

const undoYjsStroke = () => {
  yDoc.transact(() => {
    if (yStrokeArray.length > 0) {
      yStrokeArray.delete(yStrokeArray.length - 1, 1);
    }
  }, "local");
};

const applyRemoteYjsUpdate = (encoded: string) => {
  const update = fromBase64(encoded);
  if (!update) {
    return;
  }
  Y.applyUpdate(yDoc, update, "remote");
};

yStrokeArray.observe(() => {
  syncBoardFromYjs();
});

const clearBoardSnapshotTimer = () => {
  if (boardSnapshotTimer) {
    clearTimeout(boardSnapshotTimer);
    boardSnapshotTimer = null;
  }
};

const scheduleBoardSnapshotSync = () => {
  if (boardSnapshotTimer) {
    return;
  }
  boardSnapshotTimer = setTimeout(() => {
    boardSnapshotTimer = null;
    if (!roomSync.roomId.value || !roomSync.isHost.value) {
      return;
    }
    if (!started.value || finished.value) {
      return;
    }
    syncRoomState("drawguess.board.snapshot")
      .then(() => undefined)
      .catch(() => undefined);
  }, BOARD_SNAPSHOT_SYNC_DELAY_MS);
};

yDoc.on("update", (update, origin) => {
  const source = String(origin || "");
  if (source === "remote" || source === "snapshot") {
    return;
  }
  if (!roomSync.roomId.value) {
    return;
  }
  const updateBase64 = toBase64(update);
  if (!updateBase64) {
    return;
  }
  roomSync
    .sendAction("drawguess.yjs.update", { updateBase64 })
    .then(() => undefined)
    .catch(() => undefined);
  scheduleBoardSnapshotSync();
});

const buildGameState = (): Record<string, unknown> => {
  const state: DrawGuessSyncState = {
    started: started.value,
    finished: finished.value,
    sourceWord: sourceWord.value,
    latestWord: latestWord.value,
    roundNo: roundNo.value,
    turnType: turnType.value,
    chainLogs: [...chainLogs.value],
    strokes: strokes.value.map((stroke) => ({
      id: stroke.id,
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    })),
    brushColor: brushColor.value,
    brushSize: brushSize.value,
    players: players.value.map((item) => ({
      id: item.id,
      name: item.name,
      alive: item.alive,
    })),
  };
  return state as unknown as Record<string, unknown>;
};

const applyGameState = (payload: unknown, options?: { hydrateBoard?: boolean }) => {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const hydrateBoard = options?.hydrateBoard !== false;
  const state = payload as Partial<DrawGuessSyncState>;
  if (Array.isArray(state.players) && state.players.length > 0) {
    players.value = state.players
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = item as { id?: unknown; name?: unknown; alive?: unknown };
        return {
          id: String(row.id || ""),
          name: String(row.name || "玩家"),
          alive: Boolean(row.alive),
        };
      })
      .filter((item) => item.id && item.name);
  }
  started.value = Boolean(state.started);
  finished.value = Boolean(state.finished);
  sourceWord.value = String(state.sourceWord || sourceWord.value || "");
  latestWord.value = String(state.latestWord || "");
  roundNo.value = Math.max(1, Number(state.roundNo || 1));
  turnType.value = state.turnType === "guess" ? "guess" : "draw";
  chainLogs.value = Array.isArray(state.chainLogs)
    ? state.chainLogs.map((item) => ({
        round: Math.max(1, Number(item.round || 1)),
        playerName: String(item.playerName || "-"),
        typeLabel: String(item.typeLabel || ""),
        value: String(item.value || ""),
      }))
    : [];
  brushColor.value = brushColors.includes(String(state.brushColor || "")) ? String(state.brushColor) : brushColor.value;
  const parsedSize = Math.round(Number(state.brushSize || brushSize.value));
  brushSize.value = Math.max(2, Math.min(12, Number.isFinite(parsedSize) ? parsedSize : 5));
  if (hydrateBoard) {
    const parsedStrokes = Array.isArray(state.strokes)
      ? state.strokes.map((stroke) => normalizeStroke(stroke)).filter((item): item is DrawStroke => Boolean(item))
      : [];
    resetYjsBoard(parsedStrokes, "snapshot");
  }
};

const syncRoomState = async (eventType: string) => {
  if (!roomSync.roomId.value) {
    return;
  }
  const status = !started.value ? "waiting" : finished.value ? "finished" : "playing";
  await roomSync.syncState(buildGameState(), status, eventType);
  if (status === "finished" && roomSync.isHost.value) {
    await roomSync.finishRoom().catch(() => undefined);
  }
};

const onBrushSizeChange = (event: { detail?: { value?: number } }) => {
  const value = Math.round(Number(event?.detail?.value || 5));
  brushSize.value = Math.max(2, Math.min(12, value));
};

const selectBrushColor = (color: string) => {
  if (!canDrawBoard.value) {
    return;
  }
  if (!brushColors.includes(color)) {
    return;
  }
  brushColor.value = color;
};

const onBoardTouchStart = (event: unknown) => {
  if (!canDrawBoard.value) {
    return;
  }
  const point = parseTouchPoint(event);
  if (!point) {
    return;
  }
  drawing.value = true;
  currentStroke.value = {
    id: createStrokeId(),
    color: brushColor.value,
    size: brushSize.value,
    points: [point],
  };
  redrawBoard();
};

const onBoardTouchMove = (event: unknown) => {
  if (!drawing.value || !currentStroke.value || !canDrawBoard.value) {
    return;
  }
  const point = parseTouchPoint(event);
  if (!point) {
    return;
  }
  currentStroke.value.points.push(point);
  redrawBoard();
};

const onBoardTouchEnd = async () => {
  if (!drawing.value || !currentStroke.value || !canDrawBoard.value) {
    return;
  }
  drawing.value = false;
  const stroke = currentStroke.value;
  currentStroke.value = null;
  if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
    redrawBoard();
    return;
  }
  appendStrokeToYjs(stroke);
};

const clearBoard = async () => {
  if (!assertCanControl()) {
    return;
  }
  currentStroke.value = null;
  clearYjsBoard();
};

const undoStroke = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (yStrokeArray.length <= 0) {
    return;
  }
  undoYjsStroke();
};

const handleAddPlayer = async () => {
  if (!assertCanControl()) {
    return;
  }
  addPlayer();
  await syncRoomState("drawguess.player.add");
};

const handleRemovePlayer = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  removePlayer(playerId);
  await syncRoomState("drawguess.player.remove");
};

const handleToggleAlive = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  toggleAlive(playerId);
  await syncRoomState("drawguess.player.toggle_alive");
};

const handleShufflePlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  shufflePlayers();
  await syncRoomState("drawguess.player.shuffle");
};

const startGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (players.value.length < 6) {
    uni.showToast({ title: "至少 6 人", icon: "none" });
    return;
  }
  const seed = sourceWord.value.trim();
  if (!seed) {
    uni.showToast({ title: "请输入初始词条", icon: "none" });
    return;
  }
  started.value = true;
  finished.value = false;
  roundNo.value = 1;
  turnType.value = "draw";
  turnInput.value = "";
  chainLogs.value = [];
  latestWord.value = seed;
  resetYjsBoard([], "snapshot");
  currentStroke.value = null;
  if (roomSync.roomId.value && roomSync.isHost.value) {
    await roomSync.startRoom().catch(() => undefined);
  }
  await syncRoomState("drawguess.game.start");
};

const finishGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  finished.value = true;
  await syncRoomState("drawguess.game.finish");
};

const submitTurn = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || finished.value) {
    return;
  }

  if (turnType.value === "draw") {
    if (strokes.value.length <= 0) {
      uni.showToast({ title: "请先在画板上作画", icon: "none" });
      return;
    }
    chainLogs.value.push({
      round: roundNo.value,
      playerName: drawPlayer.value?.name || "-",
      typeLabel: "画图",
      value: `提交了 ${strokes.value.length} 笔画`,
    });
    turnType.value = "guess";
    turnInput.value = "";
    await syncRoomState("drawguess.turn.draw_submitted");
    return;
  }

  const value = turnInput.value.trim();
  if (!value) {
    uni.showToast({ title: "请输入猜词内容", icon: "none" });
    return;
  }

  chainLogs.value.push({
    round: roundNo.value,
    playerName: guessPlayer.value?.name || "-",
    typeLabel: "猜词",
    value,
  });
  latestWord.value = value;
  turnInput.value = "";

  if (roundNo.value >= maxRounds.value) {
    finished.value = true;
    await syncRoomState("drawguess.turn.guess_finish");
    return;
  }

  roundNo.value += 1;
  turnType.value = "draw";
  resetYjsBoard([], "snapshot");
  currentStroke.value = null;
  await syncRoomState("drawguess.turn.guess_next_round");
};

const handleResetPlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  resetPlayers(8);
  started.value = false;
  finished.value = false;
  sourceWord.value = "雪山缆车";
  latestWord.value = "";
  roundNo.value = 1;
  turnType.value = "draw";
  turnInput.value = "";
  chainLogs.value = [];
  brushColor.value = "#111111";
  brushSize.value = 5;
  resetYjsBoard([], "snapshot");
  currentStroke.value = null;
  await syncRoomState("drawguess.game.reset");
};

const applyRoomEvents = (events: unknown) => {
  if (!Array.isArray(events) || events.length <= 0) {
    return;
  }
  events
    .filter((item) => item && typeof item === "object")
    .map((item) => item as PartyGameRoomEvent)
    .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
    .forEach((event) => {
      const seq = Math.max(0, Number(event.seq || 0));
      if (seq <= lastAppliedEventSeq.value) {
        return;
      }
      lastAppliedEventSeq.value = seq;
      if (String(event.type || "") !== "drawguess.yjs.update") {
        return;
      }
      const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
      const updateBase64 = String(payload.updateBase64 || payload.update || "");
      if (!updateBase64) {
        return;
      }
      applyRemoteYjsUpdate(updateBase64);
    });
};

const onRoomSnapshot = (snapshot: unknown, context?: { fullSnapshot: boolean }) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const payload = snapshot as {
    room?: { gameKey?: string };
    state?: { data?: Record<string, unknown> };
    events?: unknown[];
  };
  if (String(payload.room?.gameKey || "") !== "drawguess") {
    return;
  }
  const forceReconcile = Boolean(context?.fullSnapshot);
  if (forceReconcile) {
    lastAppliedEventSeq.value = 0;
  }
  applyGameState(payload.state?.data || {}, { hydrateBoard: forceReconcile });
  applyRoomEvents(payload.events || []);
};

const createRoom = async () => {
  try {
    const snapshot = await roomSync.createRoom(roomTitleInput.value, Math.max(6, players.value.length), buildGameState());
    joinCodeInput.value = snapshot.room.roomCode || "";
    lastAppliedEventSeq.value = 0;
    applyRoomEvents(snapshot.events || []);
    roomSync.startPolling(onRoomSnapshot);
    uni.showToast({ title: `房间已创建：${snapshot.room.roomCode}`, icon: "none" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建房间失败";
    uni.showToast({ title: message, icon: "none" });
  }
};

const joinByCode = async () => {
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) {
    uni.showToast({ title: "请输入房间码", icon: "none" });
    return;
  }
  try {
    const snapshot = await roomSync.joinRoomByCode(code);
    applyGameState(snapshot.state.data || {});
    lastAppliedEventSeq.value = 0;
    applyRoomEvents(snapshot.events || []);
    roomSync.startPolling(onRoomSnapshot);
    uni.showToast({ title: "已加入房间", icon: "none" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "加入房间失败";
    uni.showToast({ title: message, icon: "none" });
  }
};

const reconnectLastRoom = async () => {
  try {
    const snapshot = await roomSync.reconnectLastRoom();
    if (!snapshot) {
      uni.showToast({ title: "暂无可重连房间", icon: "none" });
      return;
    }
    joinCodeInput.value = snapshot.room.roomCode || "";
    applyGameState(snapshot.state.data || {});
    lastAppliedEventSeq.value = 0;
    applyRoomEvents(snapshot.events || []);
    roomSync.startPolling(onRoomSnapshot);
    uni.showToast({ title: "已重连上次房间", icon: "none" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重连失败";
    uni.showToast({ title: message, icon: "none" });
  }
};

const refreshRoom = async () => {
  if (!roomSync.roomId.value) {
    return;
  }
  try {
    const snapshot = await roomSync.fetchRoomSnapshot(roomSync.roomId.value);
    applyGameState(snapshot.state.data || {});
    applyRoomEvents(snapshot.events || []);
  } catch (error) {
    const message = error instanceof Error ? error.message : "拉取失败";
    uni.showToast({ title: message, icon: "none" });
  }
};

const leaveRoom = async () => {
  try {
    clearBoardSnapshotTimer();
    await roomSync.leaveRoom();
    roomSync.stopPolling();
    lastAppliedEventSeq.value = 0;
    uni.showToast({ title: "已离开房间", icon: "none" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "离开失败";
    uni.showToast({ title: message, icon: "none" });
  }
};

const copyRoomCode = () => {
  const code = String(roomSync.roomCode.value || "").trim();
  if (!code) {
    return;
  }
  uni.setClipboardData({ data: code, success: () => uni.showToast({ title: "房间码已复制", icon: "none" }) });
};

onLoad((query) => {
  autoJoinRoomCode.value = String(query?.roomCode || query?.room_code || "").trim().toUpperCase();
  autoJoinRoomId.value = String(query?.roomId || query?.room_id || "").trim();
  if (autoJoinRoomCode.value) {
    joinCodeInput.value = autoJoinRoomCode.value;
  }
});

onMounted(async () => {
  initCanvasSize();
  await nextTick();
  redrawBoard();
  roomSync.loadSession();
  if (autoJoinRoomId.value) {
    try {
      const snapshot = await roomSync.joinRoomById(autoJoinRoomId.value);
      applyGameState(snapshot.state.data || {});
      lastAppliedEventSeq.value = 0;
      applyRoomEvents(snapshot.events || []);
      roomSync.startPolling(onRoomSnapshot);
    } catch (error) {
      // noop
    }
    return;
  }
  if (autoJoinRoomCode.value) {
    await joinByCode();
  }
});

onUnmounted(() => {
  clearBoardSnapshotTimer();
});
</script>

<style scoped>
.card {
  background: color-mix(in srgb, var(--card-bg) 92%, #ffffff 8%);
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  padding: 18rpx;
}

.row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10rpx;
}

.title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.sync-chip {
  font-size: 20rpx;
  color: var(--accent);
}

.sync-chip.offline {
  color: var(--text-sub);
}

.meta {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--text-sub);
}

.room-input-row {
  margin-top: 10rpx;
}

.input-block,
.board-block {
  margin-top: 14rpx;
}

.label {
  font-size: 23rpx;
  color: var(--text-main);
}

.text-input {
  margin-top: 8rpx;
  height: 66rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  color: var(--text-main);
  font-size: 22rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
}

.text-input-ph {
  color: color-mix(in srgb, var(--text-sub) 70%, #ffffff 30%);
}

.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.board-status {
  font-size: 20rpx;
  color: var(--text-sub);
}

.color-row {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.color-dot {
  width: 28rpx;
  height: 28rpx;
  border-radius: 999rpx;
  border: 2rpx solid transparent;
}

.color-dot.active {
  border-color: color-mix(in srgb, var(--accent) 58%, #111111 42%);
}

.size-chip {
  font-size: 20rpx;
  color: var(--text-sub);
}

.size-slider {
  flex: 1;
  min-width: 0;
}

.canvas-wrap {
  margin-top: 10rpx;
  border-radius: 12rpx;
  overflow: hidden;
  border: 1rpx solid var(--line);
  background: #ffffff;
}

.draw-board {
  display: block;
}

.action-row {
  margin-top: 10rpx;
  display: flex;
  gap: 10rpx;
}

.action-row.four {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.result-box {
  margin-top: 14rpx;
  border: 1rpx solid color-mix(in srgb, var(--accent) 24%, var(--line) 76%);
  border-radius: 12rpx;
  padding: 12rpx;
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
}

.result-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--text-main);
}

.result-text {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-main);
}

.log-box {
  margin-top: 16rpx;
  border-top: 1rpx dashed var(--line);
  padding-top: 12rpx;
}

.block-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--text-main);
}

.log-item {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-main);
}

.room-info {
  margin-top: 12rpx;
  border-top: 1rpx dashed var(--line);
  padding-top: 10rpx;
}

.room-line {
  font-size: 21rpx;
  color: var(--text-main);
}

.room-line + .room-line {
  margin-top: 6rpx;
}

.copy {
  color: var(--accent);
  margin-left: 10rpx;
}

.member-list {
  margin-top: 10rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.member-chip {
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  background: color-mix(in srgb, var(--muted-bg) 80%, var(--card-bg) 20%);
  padding: 8rpx 10rpx;
  font-size: 20rpx;
  color: var(--text-main);
  display: flex;
  gap: 8rpx;
}

.member-chip.offline {
  opacity: 0.55;
}

.btn {
  height: 62rpx;
  min-width: 132rpx;
  border-radius: 12rpx;
  border: 1rpx solid color-mix(in srgb, var(--accent) 24%, var(--line) 76%);
  color: var(--accent);
  background: color-mix(in srgb, var(--card-bg) 88%, var(--accent) 12%);
  font-size: 23rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn.ghost {
  color: var(--text-main);
  border-color: var(--line);
  background: var(--card-bg);
}

.btn.primary {
  color: #ffffff;
  border-color: color-mix(in srgb, var(--accent) 72%, #111111 28%);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 88%, #ffffff 12%), color-mix(in srgb, var(--accent) 74%, #111111 26%));
}
</style>
