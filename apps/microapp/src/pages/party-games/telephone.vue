<template>
  <PartyGameLayout
    title="传声筒（剧情增强）"
    subtitle="接力传话，自动记录每一步偏差，支持联机同步。"
    player-range="8-12人"
    duration="15-25 分钟"
    host-tip="每轮结束直接复盘，笑点更集中。"
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
      :start-disabled="players.length < 6 || !seedText.trim() || (Boolean(roomSync.roomId.value) && !roomSync.isHost.value)"
      start-text="开始传递"
      @update:new-player-name="newPlayerName = $event"
      @add="handleAddPlayer"
      @remove="handleRemovePlayer"
      @toggle-alive="handleToggleAlive"
      @shuffle="handleShufflePlayers"
      @reset="handleResetPlayers"
      @start="startGame"
    />

    <view class="card">
      <view class="title">回合控制</view>
      <view class="meta">第 {{ roundNo }} 轮 · 当前 {{ currentPlayerName }}</view>

      <view class="input-block">
        <view class="label">初始短句</view>
        <input
          v-model="seedText"
          class="text-input"
          :disabled="started"
          maxlength="48"
          placeholder="例如：今晚八点操场集合"
          placeholder-class="text-input-ph"
        />
      </view>

      <view v-if="started" class="input-block">
        <view class="label">{{ currentPlayerName }} 的传递内容</view>
        <input
          v-model="roundInput"
          class="text-input"
          maxlength="60"
          placeholder="输入该玩家复述/改写后的句子"
          placeholder-class="text-input-ph"
        />
        <view class="action-row two">
          <view class="btn" :class="{ disabled: !canControl }" @click="submitRoundLine">提交并传给下一位</view>
          <view class="btn ghost" :class="{ disabled: !canControl }" @click="finishRoundByHost">提前揭晓本轮</view>
        </view>
      </view>

      <view v-if="roundChain.length > 0" class="chain-box">
        <view class="block-title">本轮链路</view>
        <view class="chain-item">起始：{{ roundSeedText }}</view>
        <view v-for="(item, index) in roundChain" :key="`chain-${index}`" class="chain-item">
          {{ index + 1 }}. {{ item.playerName }}：{{ item.text }}
        </view>
      </view>

      <view v-if="history.length > 0" class="history-box">
        <view class="block-title">历史回放</view>
        <view v-for="(item, index) in history" :key="`history-${index}`" class="history-item">
          第 {{ item.roundNo }} 轮：{{ item.seedText }} → {{ item.finalText }}
        </view>
      </view>
    </view>
  </PartyGameLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import PartyGameLayout from "./components/PartyGameLayout.vue";
import PartyGamePlayerPanel from "./components/PartyGamePlayerPanel.vue";
import PartyGameRoomPanel from "./components/PartyGameRoomPanel.vue";
import { usePartyGameTheme } from "./composables/usePartyGameTheme";
import { usePartyGamePlayers } from "./composables/usePartyGamePlayers";
import { usePartyGameRoomSync } from "./composables/usePartyGameRoomSync";

interface RoundLineItem {
  playerName: string;
  text: string;
}

interface RoundHistoryItem {
  roundNo: number;
  seedText: string;
  finalText: string;
}

interface TelephoneSyncState {
  started: boolean;
  roundNo: number;
  seedText: string;
  roundSeedText: string;
  currentTurnIndex: number;
  roundChain: RoundLineItem[];
  history: RoundHistoryItem[];
  players: Array<{ id: string; name: string; alive: boolean }>;
}

const howToPlay = [
  "输入初始短句后开始，本轮按玩家顺序依次传递。",
  "主持人记录每位玩家最终说出的句子，系统生成链路。",
  "当最后一位提交后自动揭晓本轮偏差。",
  "可继续下一轮，上一轮最终句会成为下一轮起始句。",
];

const { themeKey } = usePartyGameTheme();
const { players, newPlayerName, addPlayer, removePlayer, toggleAlive, shufflePlayers, resetPlayers } = usePartyGamePlayers(8);
const roomSync = usePartyGameRoomSync("telephone");

const started = ref(false);
const roundNo = ref(1);
const seedText = ref("今晚八点操场集合，带一瓶水");
const roundSeedText = ref("");
const currentTurnIndex = ref(0);
const roundInput = ref("");
const roundChain = ref<RoundLineItem[]>([]);
const history = ref<RoundHistoryItem[]>([]);
const joinCodeInput = ref("");
const roomTitleInput = ref("传声筒剧情局");
const autoJoinRoomCode = ref("");
const autoJoinRoomId = ref("");

const currentPlayerName = computed(() => {
  const player = players.value[currentTurnIndex.value];
  return player?.name || "-";
});

const canControl = computed(() => !roomSync.roomId.value || roomSync.isHost.value);

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
  return roomSync.isHost.value ? "你是房主，可控制回合并同步" : "你是成员，当前由房主控制回合";
});

const assertCanControl = () => {
  if (roomSync.roomId.value && !roomSync.isHost.value) {
    uni.showToast({ title: "仅房主可操作", icon: "none" });
    return false;
  }
  return true;
};

const buildGameState = (): Record<string, unknown> => {
  const state: TelephoneSyncState = {
    started: started.value,
    roundNo: roundNo.value,
    seedText: seedText.value,
    roundSeedText: roundSeedText.value,
    currentTurnIndex: currentTurnIndex.value,
    roundChain: [...roundChain.value],
    history: [...history.value],
    players: players.value.map((item) => ({
      id: item.id,
      name: item.name,
      alive: item.alive,
    })),
  };
  return state as unknown as Record<string, unknown>;
};

const applyGameState = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const state = payload as Partial<TelephoneSyncState>;
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
  roundNo.value = Math.max(1, Number(state.roundNo || 1));
  seedText.value = String(state.seedText || "");
  roundSeedText.value = String(state.roundSeedText || "");
  roundChain.value = Array.isArray(state.roundChain)
    ? state.roundChain.map((item) => ({
        playerName: String(item.playerName || ""),
        text: String(item.text || ""),
      }))
    : [];
  history.value = Array.isArray(state.history)
    ? state.history.map((item) => ({
        roundNo: Math.max(1, Number(item.roundNo || 1)),
        seedText: String(item.seedText || ""),
        finalText: String(item.finalText || ""),
      }))
    : [];
  const nextTurn = Math.max(0, Number(state.currentTurnIndex || 0));
  const maxTurn = Math.max(0, players.value.length - 1);
  currentTurnIndex.value = Math.min(nextTurn, maxTurn);
};

const syncRoomState = async (eventType: string) => {
  if (!roomSync.roomId.value) {
    return;
  }
  const status = started.value ? "playing" : "waiting";
  await roomSync.syncState(buildGameState(), status, eventType);
};

const handleAddPlayer = async () => {
  if (!assertCanControl()) {
    return;
  }
  addPlayer();
  await syncRoomState("telephone.player.add");
};

const handleRemovePlayer = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  removePlayer(playerId);
  if (currentTurnIndex.value >= players.value.length) {
    currentTurnIndex.value = Math.max(0, players.value.length - 1);
  }
  await syncRoomState("telephone.player.remove");
};

const handleToggleAlive = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  toggleAlive(playerId);
  await syncRoomState("telephone.player.toggle_alive");
};

const handleShufflePlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  shufflePlayers();
  currentTurnIndex.value = Math.min(currentTurnIndex.value, Math.max(0, players.value.length - 1));
  await syncRoomState("telephone.player.shuffle");
};

const startGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (players.value.length < 6) {
    uni.showToast({ title: "至少 6 人", icon: "none" });
    return;
  }
  const firstSeed = seedText.value.trim();
  if (!firstSeed) {
    uni.showToast({ title: "请先输入初始短句", icon: "none" });
    return;
  }
  started.value = true;
  roundNo.value = 1;
  roundSeedText.value = firstSeed;
  currentTurnIndex.value = 0;
  roundInput.value = "";
  roundChain.value = [];
  history.value = [];
  seedText.value = firstSeed;
  if (roomSync.roomId.value && roomSync.isHost.value) {
    await roomSync.startRoom().catch(() => undefined);
  }
  await syncRoomState("telephone.game.start");
};

const finishRound = async (eventType = "telephone.round.finish") => {
  if (!started.value) {
    return;
  }
  const finalText = roundChain.value[roundChain.value.length - 1]?.text || roundSeedText.value;
  history.value.unshift({
    roundNo: roundNo.value,
    seedText: roundSeedText.value,
    finalText,
  });
  roundNo.value += 1;
  roundSeedText.value = finalText;
  currentTurnIndex.value = 0;
  roundInput.value = "";
  roundChain.value = [];
  seedText.value = finalText;
  await syncRoomState(eventType);
};

const finishRoundByHost = async () => {
  if (!assertCanControl()) {
    return;
  }
  await finishRound("telephone.round.finish_manual");
};

const submitRoundLine = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value) {
    return;
  }
  const text = roundInput.value.trim();
  if (!text) {
    uni.showToast({ title: "请输入传递内容", icon: "none" });
    return;
  }
  roundChain.value.push({
    playerName: currentPlayerName.value,
    text,
  });
  roundInput.value = "";

  if (currentTurnIndex.value >= players.value.length - 1) {
    await finishRound("telephone.round.auto_finish");
    return;
  }

  currentTurnIndex.value += 1;
  await syncRoomState("telephone.round.submit");
};

const handleResetPlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  resetPlayers(8);
  started.value = false;
  roundNo.value = 1;
  seedText.value = "今晚八点操场集合，带一瓶水";
  roundSeedText.value = "";
  currentTurnIndex.value = 0;
  roundInput.value = "";
  roundChain.value = [];
  history.value = [];
  await syncRoomState("telephone.game.reset");
};

const onRoomSnapshot = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const payload = snapshot as {
    room?: { gameKey?: string };
    state?: { data?: Record<string, unknown> };
  };
  if (String(payload.room?.gameKey || "") !== "telephone") {
    return;
  }
  applyGameState(payload.state?.data || {});
};

const createRoom = async () => {
  try {
    const snapshot = await roomSync.createRoom(roomTitleInput.value, Math.max(6, players.value.length), buildGameState());
    joinCodeInput.value = snapshot.room.roomCode || "";
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "拉取失败";
    uni.showToast({ title: message, icon: "none" });
  }
};

const leaveRoom = async () => {
  try {
    await roomSync.leaveRoom();
    roomSync.stopPolling();
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
  roomSync.loadSession();
  if (autoJoinRoomId.value) {
    try {
      const snapshot = await roomSync.joinRoomById(autoJoinRoomId.value);
      applyGameState(snapshot.state.data || {});
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

.room-input-row,
.input-block {
  margin-top: 12rpx;
}

.label,
.block-title {
  font-size: 24rpx;
  color: var(--text-main);
  font-weight: 700;
}

.text-input,
.picker {
  margin-top: 8rpx;
  height: 66rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  color: var(--text-main);
  font-size: 22rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}

.text-input-ph {
  color: color-mix(in srgb, var(--text-sub) 70%, #ffffff 30%);
}

.action-row {
  margin-top: 12rpx;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
}

.action-row.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.action-row.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chain-box,
.history-box,
.room-info {
  margin-top: 14rpx;
}

.chain-box,
.history-box {
  border-top: 1rpx dashed var(--line);
  padding-top: 10rpx;
}

.chain-item,
.history-item {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-main);
}

.room-info {
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

.btn.disabled {
  opacity: 0.45;
}
</style>
