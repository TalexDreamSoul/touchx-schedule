<template>
  <PartyGameLayout
    title="阿瓦隆（10人标准）"
    subtitle="任务投票 + 刺杀阶段，支持联机房间同步。"
    player-range="10人"
    duration="30-45 分钟"
    host-tip="队长发言控时 30 秒，减少长回合。"
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
      start-text="分配角色"
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
        <view class="title">任务进度</view>
        <view class="quest-chip">Q{{ questNo }}</view>
      </view>
      <view class="meta">成功 {{ successCount }} · 失败 {{ failCount }} · 连续否决 {{ rejectCount }}</view>
      <view v-if="winnerText" class="winner">{{ winnerText }}</view>

      <view v-if="started && !winnerText" class="action-row">
        <view class="btn" @click="recordQuestResult('success')">本轮成功</view>
        <view class="btn danger" @click="recordQuestResult('fail')">本轮失败</view>
        <view class="btn ghost" @click="addReject">队伍被否决</view>
      </view>

      <view v-if="started && assassinMode && !winnerText" class="assassin-box">
        <view class="block-title">刺杀阶段</view>
        <picker :range="alivePlayerNames" @change="onAssassinTargetChange">
          <view class="picker">{{ assassinTargetLabel }}</view>
        </picker>
        <view class="btn primary" :class="{ disabled: !assassinTargetId }" @click="confirmAssassin">确认刺杀</view>
      </view>

      <view v-if="started" class="role-box">
        <view class="block-title">角色查看（主持模式）</view>
        <view class="player-grid">
          <view v-for="item in players" :key="item.id" class="player-item" :class="{ dead: !item.alive }">
            <view class="player-main">
              <text class="player-name">{{ item.name }}</text>
              <text class="player-tag">{{ item.alive ? "在场" : "出局" }}</text>
            </view>
            <view class="player-sub">{{ roleMap[item.id] || "忠臣" }}</view>
          </view>
        </view>
      </view>

      <view v-if="history.length > 0" class="history-box">
        <view class="block-title">任务历史</view>
        <view v-for="(item, index) in history" :key="`history-${index}`" class="history-item">
          Q{{ item.questNo }} · {{ item.resultLabel }}
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

interface QuestHistoryItem {
  questNo: number;
  resultLabel: string;
}

interface AvalonSyncState {
  started: boolean;
  questNo: number;
  successCount: number;
  failCount: number;
  rejectCount: number;
  assassinMode: boolean;
  assassinTargetId: string;
  roleMap: Record<string, string>;
  history: QuestHistoryItem[];
  winnerText: string;
  players: Array<{ id: string; name: string; alive: boolean }>;
}

const howToPlay = [
  "开局后系统随机分配角色，主持人可查看角色。",
  "每轮记录任务成功/失败，自动推进任务轮次。",
  "任意阵营先达成 3 次即进入终局判定。",
  "支持联机房间，房主控盘并同步全员状态。",
];

const ROLE_DECK = ["梅林", "派西维尔", "忠臣", "忠臣", "忠臣", "莫甘娜", "刺客", "爪牙", "爪牙", "忠臣"];

const { themeKey } = usePartyGameTheme();
const { players, newPlayerName, addPlayer, removePlayer, toggleAlive, markAllAlive, shufflePlayers, resetPlayers } = usePartyGamePlayers(10);
const roomSync = usePartyGameRoomSync("avalon");

const started = ref(false);
const questNo = ref(1);
const successCount = ref(0);
const failCount = ref(0);
const rejectCount = ref(0);
const assassinMode = ref(false);
const assassinTargetId = ref("");
const roleMap = ref<Record<string, string>>({});
const history = ref<QuestHistoryItem[]>([]);
const winnerText = ref("");
const joinCodeInput = ref("");
const roomTitleInput = ref("阿瓦隆标准局");
const autoJoinRoomCode = ref("");
const autoJoinRoomId = ref("");

const alivePlayers = computed(() => players.value.filter((item) => item.alive));
const alivePlayerNames = computed(() => alivePlayers.value.map((item) => item.name));

const assassinTargetLabel = computed(() => {
  const target = alivePlayers.value.find((item) => item.id === assassinTargetId.value);
  return target ? `刺杀目标：${target.name}` : "选择刺杀目标";
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

const assertCanControl = () => {
  if (roomSync.roomId.value && !roomSync.isHost.value) {
    uni.showToast({ title: "仅房主可操作对局", icon: "none" });
    return false;
  }
  return true;
};

const buildGameState = (): Record<string, unknown> => {
  const state: AvalonSyncState = {
    started: started.value,
    questNo: questNo.value,
    successCount: successCount.value,
    failCount: failCount.value,
    rejectCount: rejectCount.value,
    assassinMode: assassinMode.value,
    assassinTargetId: assassinTargetId.value,
    roleMap: { ...roleMap.value },
    history: [...history.value],
    winnerText: winnerText.value,
    players: players.value.map((item) => ({ id: item.id, name: item.name, alive: item.alive })),
  };
  return state as unknown as Record<string, unknown>;
};

const applyGameState = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const state = payload as Partial<AvalonSyncState>;
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
  questNo.value = Math.max(1, Number(state.questNo || 1));
  successCount.value = Math.max(0, Number(state.successCount || 0));
  failCount.value = Math.max(0, Number(state.failCount || 0));
  rejectCount.value = Math.max(0, Number(state.rejectCount || 0));
  assassinMode.value = Boolean(state.assassinMode);
  assassinTargetId.value = String(state.assassinTargetId || "");
  roleMap.value = state.roleMap && typeof state.roleMap === "object" ? { ...state.roleMap } : {};
  history.value = Array.isArray(state.history)
    ? state.history.map((item) => ({
        questNo: Math.max(1, Number(item.questNo || 1)),
        resultLabel: String(item.resultLabel || ""),
      }))
    : [];
  winnerText.value = String(state.winnerText || "");
};

const syncRoomState = async (eventType: string) => {
  if (!roomSync.roomId.value) {
    return;
  }
  const status = !started.value ? "waiting" : winnerText.value ? "finished" : "playing";
  await roomSync.syncState(buildGameState(), status, eventType);
  if (status === "finished" && roomSync.isHost.value) {
    await roomSync.finishRoom().catch(() => undefined);
  }
};

const assignRoles = () => {
  const deck = ROLE_DECK.slice();
  while (deck.length < players.value.length) {
    deck.push("忠臣");
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = deck[index];
    deck[index] = deck[randomIndex];
    deck[randomIndex] = temp;
  }
  const map: Record<string, string> = {};
  players.value.forEach((item, index) => {
    map[item.id] = deck[index] || "忠臣";
  });
  roleMap.value = map;
};

const handleAddPlayer = async () => {
  if (!assertCanControl()) {
    return;
  }
  addPlayer();
  await syncRoomState("avalon.player.add");
};

const handleRemovePlayer = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  removePlayer(playerId);
  await syncRoomState("avalon.player.remove");
};

const handleToggleAlive = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  toggleAlive(playerId);
  await syncRoomState("avalon.player.toggle_alive");
};

const handleShufflePlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  shufflePlayers();
  await syncRoomState("avalon.player.shuffle");
};

const startGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (players.value.length < 8) {
    uni.showToast({ title: "至少 8 人", icon: "none" });
    return;
  }
  markAllAlive();
  assignRoles();
  started.value = true;
  questNo.value = 1;
  successCount.value = 0;
  failCount.value = 0;
  rejectCount.value = 0;
  assassinMode.value = false;
  assassinTargetId.value = "";
  history.value = [];
  winnerText.value = "";
  if (roomSync.roomId.value && roomSync.isHost.value) {
    await roomSync.startRoom().catch(() => undefined);
  }
  await syncRoomState("avalon.game.start");
};

const enterAssassinMode = () => {
  assassinMode.value = true;
  assassinTargetId.value = alivePlayers.value[0]?.id || "";
};

const recordQuestResult = async (result: "success" | "fail") => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || winnerText.value) {
    return;
  }
  if (assassinMode.value) {
    uni.showToast({ title: "当前为刺杀阶段", icon: "none" });
    return;
  }
  if (result === "success") {
    successCount.value += 1;
    history.value.push({ questNo: questNo.value, resultLabel: "任务成功" });
  } else {
    failCount.value += 1;
    history.value.push({ questNo: questNo.value, resultLabel: "任务失败" });
  }
  rejectCount.value = 0;

  if (failCount.value >= 3) {
    winnerText.value = "邪恶阵营胜利";
    await syncRoomState("avalon.quest.fail_win");
    return;
  }
  if (successCount.value >= 3) {
    enterAssassinMode();
    await syncRoomState("avalon.assassin.enter");
    return;
  }
  questNo.value += 1;
  await syncRoomState(`avalon.quest.${result}`);
};

const addReject = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || winnerText.value || assassinMode.value) {
    return;
  }
  rejectCount.value += 1;
  if (rejectCount.value >= 5) {
    winnerText.value = "连续否决 5 次，邪恶阵营胜利";
    await syncRoomState("avalon.reject.win");
    return;
  }
  await syncRoomState("avalon.reject.add");
};

const onAssassinTargetChange = (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? -1);
  const target = alivePlayers.value[index];
  assassinTargetId.value = target?.id || "";
};

const confirmAssassin = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!assassinMode.value || winnerText.value) {
    return;
  }
  const targetRole = roleMap.value[assassinTargetId.value] || "";
  if (targetRole === "梅林") {
    winnerText.value = "刺客命中梅林，邪恶阵营胜利";
  } else {
    winnerText.value = "刺杀失败，正义阵营胜利";
  }
  await syncRoomState("avalon.assassin.resolve");
};

const handleResetPlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  resetPlayers(10);
  started.value = false;
  questNo.value = 1;
  successCount.value = 0;
  failCount.value = 0;
  rejectCount.value = 0;
  assassinMode.value = false;
  assassinTargetId.value = "";
  roleMap.value = {};
  history.value = [];
  winnerText.value = "";
  await syncRoomState("avalon.game.reset");
};

const onRoomSnapshot = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const payload = snapshot as {
    room?: { gameKey?: string };
    state?: { data?: Record<string, unknown> };
  };
  if (String(payload.room?.gameKey || "") !== "avalon") {
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
  justify-content: space-between;
  align-items: center;
  gap: 10rpx;
}

.title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.quest-chip {
  font-size: 22rpx;
  color: var(--accent);
  border: 1rpx solid color-mix(in srgb, var(--accent) 55%, var(--line) 45%);
  border-radius: 999rpx;
  padding: 6rpx 14rpx;
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

.text-input,
.picker {
  margin-top: 8rpx;
  height: 62rpx;
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

.winner {
  margin-top: 10rpx;
  font-size: 24rpx;
  color: var(--accent);
  font-weight: 700;
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

.assassin-box,
.role-box,
.history-box {
  margin-top: 14rpx;
}

.block-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--text-main);
}

.player-grid {
  margin-top: 10rpx;
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
  opacity: 0.56;
}

.player-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
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

.history-item {
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
  margin-top: 10rpx;
  color: #ffffff;
  border-color: color-mix(in srgb, var(--accent) 72%, #111111 28%);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 88%, #ffffff 12%), color-mix(in srgb, var(--accent) 74%, #111111 26%));
}

.btn.danger {
  color: #ffffff;
  border-color: color-mix(in srgb, var(--danger) 72%, #111111 28%);
  background: linear-gradient(145deg, color-mix(in srgb, var(--danger) 86%, #ffffff 14%), color-mix(in srgb, var(--danger) 72%, #111111 28%));
}

.btn.disabled {
  opacity: 0.4;
}
</style>
