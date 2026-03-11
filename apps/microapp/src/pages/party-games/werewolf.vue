<template>
  <PartyGameLayout
    title="狼人杀（快节奏局）"
    subtitle="10 人快节奏推理局，支持房间联机同步。"
    player-range="10人"
    duration="35-50 分钟"
    host-tip="白天发言限时 45 秒，减少拉扯。"
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
      :min-players="8"
      :max-players="12"
      :started="started"
      :start-disabled="players.length < 8 || (Boolean(roomSync.roomId.value) && !roomSync.isHost.value)"
      start-text="发牌开局"
      @update:new-player-name="newPlayerName = $event"
      @add="handleAddPlayer"
      @remove="handleRemovePlayer"
      @toggle-alive="handleToggleAlive"
      @shuffle="handleShufflePlayers"
      @reset="handleResetPlayers"
      @start="startGame"
    />

    <view class="card">
      <view class="row-head">
        <view class="title">对局控制台</view>
        <view class="phase-chip">{{ phaseLabel }}</view>
      </view>
      <view class="meta">第 {{ dayNo }} 天 · 在场 {{ alivePlayers.length }} 人</view>
      <view v-if="winnerText" class="winner">{{ winnerText }}</view>

      <view v-if="started" class="action-row">
        <view class="btn" @click="nextPhase">切换阶段</view>
        <view class="btn ghost" @click="toggleRoleVisible">{{ showRoles ? "隐藏身份" : "查看身份" }}</view>
        <view class="btn ghost" @click="resetVotes">清空投票</view>
      </view>

      <view v-if="started" class="vote-box">
        <picker :range="voteTargetOptions" range-key="label" @change="onVoteTargetChange">
          <view class="picker">{{ voteTargetLabel }}</view>
        </picker>
        <view class="btn primary" :class="{ disabled: !selectedVoteTargetId || hasWinner }" @click="submitVote">提交放逐</view>
      </view>

      <view v-if="started" class="player-grid">
        <view v-for="item in players" :key="item.id" class="player-item" :class="{ dead: !item.alive }">
          <view class="player-main">
            <text class="player-name">{{ item.name }}</text>
            <text class="player-tag">{{ item.alive ? "在场" : "出局" }}</text>
          </view>
          <view class="player-sub">{{ showRoles ? roleMap[item.id] || "平民" : "身份隐藏" }}</view>
        </view>
      </view>

      <view v-if="started && eliminationLog.length > 0" class="log-box">
        <view class="log-title">放逐记录</view>
        <view v-for="(item, index) in eliminationLog" :key="`log-${index}`" class="log-item">{{ item }}</view>
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

type GamePhase = "night" | "discussion" | "vote" | "finished";

interface WerewolfSyncState {
  started: boolean;
  dayNo: number;
  phase: GamePhase;
  showRoles: boolean;
  roleMap: Record<string, string>;
  eliminationLog: string[];
  players: Array<{ id: string; name: string; alive: boolean }>;
}

const howToPlay = [
  "点击“发牌开局”后，系统会随机发身份。",
  "夜晚阶段主持人线下引导行动，白天阶段按顺序发言。",
  "投票阶段选择放逐对象并提交，系统自动更新存活状态。",
  "可创建联机房间，房主操作后会同步给所有房间成员。",
];

const { themeKey } = usePartyGameTheme();
const { players, newPlayerName, addPlayer, removePlayer, toggleAlive, markAllAlive, shufflePlayers, resetPlayers } = usePartyGamePlayers(10);
const roomSync = usePartyGameRoomSync("werewolf");

const started = ref(false);
const dayNo = ref(1);
const phase = ref<GamePhase>("night");
const roleMap = ref<Record<string, string>>({});
const selectedVoteTargetId = ref("");
const eliminationLog = ref<string[]>([]);
const showRoles = ref(false);
const joinCodeInput = ref("");
const roomTitleInput = ref("狼人杀快节奏局");
const autoJoinRoomCode = ref("");
const autoJoinRoomId = ref("");

const phaseLabel = computed(() => {
  if (phase.value === "night") {
    return "夜晚";
  }
  if (phase.value === "discussion") {
    return "白天发言";
  }
  if (phase.value === "vote") {
    return "白天投票";
  }
  return "对局结束";
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
  return roomSync.isHost.value ? "你是房主，可控制对局并同步" : "你是成员，当前由房主控制对局";
});

const alivePlayers = computed(() => players.value.filter((item) => item.alive));

const voteTargetOptions = computed(() => {
  return alivePlayers.value.map((item) => ({
    value: item.id,
    label: item.name,
  }));
});

const voteTargetLabel = computed(() => {
  const target = voteTargetOptions.value.find((item) => item.value === selectedVoteTargetId.value);
  return target ? `放逐目标：${target.label}` : "请选择放逐目标";
});

const wolvesAliveCount = computed(() => {
  return alivePlayers.value.filter((item) => roleMap.value[item.id] === "狼人").length;
});

const goodAliveCount = computed(() => {
  return alivePlayers.value.length - wolvesAliveCount.value;
});

const winnerText = computed(() => {
  if (!started.value) {
    return "";
  }
  if (wolvesAliveCount.value === 0) {
    return "好人阵营获胜";
  }
  if (wolvesAliveCount.value >= goodAliveCount.value) {
    return "狼人阵营获胜";
  }
  return "";
});

const hasWinner = computed(() => winnerText.value !== "");

const assertCanControl = () => {
  if (roomSync.roomId.value && !roomSync.isHost.value) {
    uni.showToast({ title: "仅房主可操作对局", icon: "none" });
    return false;
  }
  return true;
};

const buildGameState = (): Record<string, unknown> => {
  const state: WerewolfSyncState = {
    started: started.value,
    dayNo: dayNo.value,
    phase: phase.value,
    showRoles: showRoles.value,
    roleMap: { ...roleMap.value },
    eliminationLog: [...eliminationLog.value],
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
  const state = payload as Partial<WerewolfSyncState>;
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
  dayNo.value = Math.max(1, Number(state.dayNo || 1));
  const nextPhase = String(state.phase || "night") as GamePhase;
  if (nextPhase === "night" || nextPhase === "discussion" || nextPhase === "vote" || nextPhase === "finished") {
    phase.value = nextPhase;
  }
  showRoles.value = Boolean(state.showRoles);
  roleMap.value = state.roleMap && typeof state.roleMap === "object" ? { ...state.roleMap } : {};
  eliminationLog.value = Array.isArray(state.eliminationLog) ? state.eliminationLog.map((item) => String(item || "")) : [];
};

const syncRoomState = async (eventType: string) => {
  if (!roomSync.roomId.value) {
    return;
  }
  const status = !started.value ? "waiting" : phase.value === "finished" || hasWinner.value ? "finished" : "playing";
  await roomSync.syncState(buildGameState(), status, eventType);
  if (status === "finished" && roomSync.isHost.value) {
    await roomSync.finishRoom().catch(() => undefined);
  }
};

const buildRoleDeck = (count: number) => {
  const base = ["狼人", "狼人", "预言家", "女巫", "猎人", "平民", "平民", "平民", "平民", "平民"];
  const next = base.slice(0, Math.min(base.length, count));
  while (next.length < count) {
    next.push("平民");
  }
  if (!next.includes("狼人") && next.length > 0) {
    next[0] = "狼人";
  }
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = next[index];
    next[index] = next[randomIndex];
    next[randomIndex] = temp;
  }
  return next;
};

const assignRoles = () => {
  const deck = buildRoleDeck(players.value.length);
  const map: Record<string, string> = {};
  players.value.forEach((item, index) => {
    map[item.id] = deck[index] || "平民";
  });
  roleMap.value = map;
};

const handleAddPlayer = async () => {
  if (!assertCanControl()) {
    return;
  }
  addPlayer();
  await syncRoomState("werewolf.player.add");
};

const handleRemovePlayer = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  removePlayer(playerId);
  await syncRoomState("werewolf.player.remove");
};

const handleToggleAlive = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  toggleAlive(playerId);
  await syncRoomState("werewolf.player.toggle_alive");
};

const handleShufflePlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  shufflePlayers();
  await syncRoomState("werewolf.player.shuffle");
};

const startGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (players.value.length < 8) {
    uni.showToast({ title: "至少 8 人才能开局", icon: "none" });
    return;
  }
  if (roomSync.roomId.value && roomSync.isHost.value) {
    await roomSync.startRoom().catch(() => undefined);
  }
  markAllAlive();
  assignRoles();
  started.value = true;
  dayNo.value = 1;
  phase.value = "night";
  selectedVoteTargetId.value = "";
  eliminationLog.value = [];
  showRoles.value = false;
  await syncRoomState("werewolf.game.start");
};

const nextPhase = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || phase.value === "finished") {
    return;
  }
  if (phase.value === "night") {
    phase.value = "discussion";
  } else if (phase.value === "discussion") {
    phase.value = "vote";
  } else if (phase.value === "vote") {
    dayNo.value += 1;
    phase.value = "night";
    selectedVoteTargetId.value = "";
  }
  await syncRoomState("werewolf.phase.change");
};

const resetVotes = async () => {
  if (!assertCanControl()) {
    return;
  }
  selectedVoteTargetId.value = "";
  await syncRoomState("werewolf.vote.reset");
};

const onVoteTargetChange = (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? -1);
  const option = voteTargetOptions.value[index];
  selectedVoteTargetId.value = option?.value || "";
};

const submitVote = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || hasWinner.value) {
    return;
  }
  if (phase.value !== "vote") {
    uni.showToast({ title: "请先切到投票阶段", icon: "none" });
    return;
  }
  const targetId = selectedVoteTargetId.value;
  if (!targetId) {
    uni.showToast({ title: "请选择放逐目标", icon: "none" });
    return;
  }
  const target = players.value.find((item) => item.id === targetId);
  if (!target || !target.alive) {
    uni.showToast({ title: "目标不可放逐", icon: "none" });
    return;
  }
  players.value = players.value.map((item) => {
    if (item.id !== targetId) {
      return item;
    }
    return {
      ...item,
      alive: false,
    };
  });
  eliminationLog.value.unshift(`第 ${dayNo.value} 天放逐：${target.name}`);
  selectedVoteTargetId.value = "";

  if (winnerText.value) {
    phase.value = "finished";
  } else {
    dayNo.value += 1;
    phase.value = "night";
  }
  await syncRoomState("werewolf.vote.submit");
};

const toggleRoleVisible = async () => {
  if (!assertCanControl()) {
    return;
  }
  showRoles.value = !showRoles.value;
  await syncRoomState("werewolf.role.toggle_visible");
};

const handleResetPlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  resetPlayers(10);
  started.value = false;
  dayNo.value = 1;
  phase.value = "night";
  roleMap.value = {};
  selectedVoteTargetId.value = "";
  eliminationLog.value = [];
  showRoles.value = false;
  await syncRoomState("werewolf.game.reset");
};

const onRoomSnapshot = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const payload = snapshot as {
    room?: { gameKey?: string };
    state?: { data?: Record<string, unknown> };
  };
  if (String(payload.room?.gameKey || "") !== "werewolf") {
    return;
  }
  applyGameState(payload.state?.data || {});
};

const createRoom = async () => {
  try {
    const snapshot = await roomSync.createRoom(roomTitleInput.value, Math.max(8, players.value.length), buildGameState());
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
  align-items: center;
  justify-content: space-between;
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

.phase-chip {
  font-size: 22rpx;
  color: var(--accent);
  border: 1rpx solid color-mix(in srgb, var(--accent) 55%, var(--line) 45%);
  border-radius: 999rpx;
  padding: 6rpx 14rpx;
}

.meta {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--text-sub);
}

.room-input-row {
  margin-top: 10rpx;
}

.text-input,
.picker {
  height: 62rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  color: var(--text-main);
  font-size: 23rpx;
  display: flex;
  align-items: center;
  padding: 0 14rpx;
  box-sizing: border-box;
}

.text-input-ph {
  color: color-mix(in srgb, var(--text-sub) 70%, #ffffff 30%);
}

.action-row {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
}

.action-row.four {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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

.btn.primary {
  color: #ffffff;
  border-color: color-mix(in srgb, var(--accent) 72%, #111111 28%);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 88%, #ffffff 12%), color-mix(in srgb, var(--accent) 74%, #111111 26%));
}

.btn.disabled {
  opacity: 0.4;
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

.winner {
  margin-top: 10rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--accent);
}

.vote-box {
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.player-grid {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10rpx;
}

.player-item {
  border: 1rpx solid var(--line);
  border-radius: 10rpx;
  background: color-mix(in srgb, var(--muted-bg) 82%, var(--card-bg) 18%);
  padding: 10rpx 12rpx;
}

.player-item.dead {
  opacity: 0.58;
}

.player-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8rpx;
}

.player-name {
  font-size: 23rpx;
  color: var(--text-main);
}

.player-tag,
.player-sub {
  font-size: 21rpx;
  color: var(--text-sub);
}

.log-box {
  margin-top: 14rpx;
  border-top: 1rpx dashed var(--line);
  padding-top: 12rpx;
}

.log-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--text-main);
}

.log-item {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}
</style>
