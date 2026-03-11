<template>
  <PartyGameLayout
    title="谁是卧底（双卧底版）"
    subtitle="8-10 人快推理，支持多人房间实时同步。"
    player-range="8-10人"
    duration="20-30 分钟"
    host-tip="前两局先用简单词条，节奏更稳。"
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
      :start-disabled="players.length < 6 || (Boolean(roomSync.roomId.value) && !roomSync.isHost.value)"
      start-text="发词开局"
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
        <view class="title">对局面板</view>
        <view class="round-chip">第 {{ roundNo }} 轮</view>
      </view>
      <view class="meta">在场 {{ alivePlayers.length }} 人 · 盲投{{ roundNo >= 3 ? "开启" : "未开启" }}</view>
      <view v-if="winnerText" class="winner">{{ winnerText }}</view>

      <view v-if="started" class="action-row">
        <view class="btn ghost" @click="toggleWordVisible">{{ showWords ? "隐藏词条" : "查看词条" }}</view>
        <view class="btn" @click="nextRound">手动下一轮</view>
      </view>

      <view v-if="started" class="word-card">
        <view class="word-item">平民词：{{ showWords ? civilianWord : "••••" }}</view>
        <view class="word-item">卧底词：{{ showWords ? undercoverWord : "••••" }}</view>
      </view>

      <view v-if="started" class="clue-card">
        <view class="block-title">发言记录</view>
        <view class="clue-input-row">
          <picker :range="alivePlayerNames" @change="onClueSpeakerChange">
            <view class="picker">{{ currentSpeakerLabel }}</view>
          </picker>
          <input
            v-model="clueInput"
            class="text-input"
            maxlength="24"
            placeholder="输入一句描述"
            placeholder-class="text-input-ph"
          />
          <view class="btn" @click="submitClue">记录</view>
        </view>
        <view v-if="clueLogs.length === 0" class="empty">暂无描述记录</view>
        <view v-else class="clue-list">
          <view v-for="(item, index) in clueLogs" :key="`clue-${index}`" class="clue-item">
            <text class="clue-main">R{{ item.round }} · {{ item.speaker }}：{{ item.text }}</text>
          </view>
        </view>
      </view>

      <view v-if="started" class="vote-box">
        <picker :range="voteTargetOptions" range-key="label" @change="onVoteTargetChange">
          <view class="picker">{{ voteTargetLabel }}</view>
        </picker>
        <view class="btn primary" :class="{ disabled: !selectedVoteTargetId || hasWinner }" @click="submitVote">淘汰该玩家</view>
      </view>

      <view v-if="started" class="player-grid">
        <view v-for="item in players" :key="item.id" class="player-item" :class="{ dead: !item.alive }">
          <view class="player-main">
            <text class="player-name">{{ item.name }}</text>
            <text class="player-tag">{{ item.alive ? "在场" : "出局" }}</text>
          </view>
          <view class="player-sub">
            {{ showWords ? (undercoverSet.has(item.id) ? "卧底" : "平民") : "身份隐藏" }}
          </view>
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

interface ClueLogItem {
  round: number;
  speaker: string;
  text: string;
}

interface UndercoverSyncState {
  started: boolean;
  roundNo: number;
  civilianWord: string;
  undercoverWord: string;
  undercoverIds: string[];
  showWords: boolean;
  clueLogs: ClueLogItem[];
  players: Array<{ id: string; name: string; alive: boolean }>;
}

const WORD_PAIRS = [
  ["奶茶", "果茶"],
  ["地铁", "高铁"],
  ["篮球", "足球"],
  ["火锅", "麻辣烫"],
  ["电影", "电视剧"],
];

const howToPlay = [
  "点击“发词开局”后，系统随机发平民词与卧底词（双卧底）。",
  "每轮每人说一句描述，尽量暴露别人不暴露自己。",
  "描述后投票淘汰 1 人，系统自动推进轮次。",
  "支持联机房间，房主操作会同步给全房间。",
];

const { themeKey } = usePartyGameTheme();
const { players, newPlayerName, addPlayer, removePlayer, toggleAlive, markAllAlive, shufflePlayers, resetPlayers } = usePartyGamePlayers(8);
const roomSync = usePartyGameRoomSync("undercover");

const started = ref(false);
const roundNo = ref(1);
const civilianWord = ref("");
const undercoverWord = ref("");
const undercoverSet = ref(new Set<string>());
const showWords = ref(false);
const clueInput = ref("");
const clueSpeakerId = ref("");
const clueLogs = ref<ClueLogItem[]>([]);
const selectedVoteTargetId = ref("");
const joinCodeInput = ref("");
const roomTitleInput = ref("谁是卧底双卧底局");
const autoJoinRoomCode = ref("");
const autoJoinRoomId = ref("");

const alivePlayers = computed(() => players.value.filter((item) => item.alive));

const alivePlayerNames = computed(() => alivePlayers.value.map((item) => item.name));

const currentSpeakerLabel = computed(() => {
  const speaker = alivePlayers.value.find((item) => item.id === clueSpeakerId.value);
  return speaker ? `发言人：${speaker.name}` : "选择发言人";
});

const voteTargetOptions = computed(() => alivePlayers.value.map((item) => ({ value: item.id, label: item.name })));

const voteTargetLabel = computed(() => {
  const target = voteTargetOptions.value.find((item) => item.value === selectedVoteTargetId.value);
  return target ? `投票目标：${target.label}` : "选择要淘汰的玩家";
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

const undercoverAliveCount = computed(() => {
  return alivePlayers.value.filter((item) => undercoverSet.value.has(item.id)).length;
});

const civilianAliveCount = computed(() => {
  return alivePlayers.value.length - undercoverAliveCount.value;
});

const winnerText = computed(() => {
  if (!started.value) {
    return "";
  }
  if (undercoverAliveCount.value <= 0) {
    return "平民胜利";
  }
  if (undercoverAliveCount.value >= civilianAliveCount.value) {
    return "卧底胜利";
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
  const state: UndercoverSyncState = {
    started: started.value,
    roundNo: roundNo.value,
    civilianWord: civilianWord.value,
    undercoverWord: undercoverWord.value,
    undercoverIds: Array.from(undercoverSet.value),
    showWords: showWords.value,
    clueLogs: [...clueLogs.value],
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
  const state = payload as Partial<UndercoverSyncState>;
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
  civilianWord.value = String(state.civilianWord || "");
  undercoverWord.value = String(state.undercoverWord || "");
  undercoverSet.value = new Set(Array.isArray(state.undercoverIds) ? state.undercoverIds.map((item) => String(item || "")) : []);
  showWords.value = Boolean(state.showWords);
  clueLogs.value = Array.isArray(state.clueLogs)
    ? state.clueLogs.map((item) => ({
        round: Math.max(1, Number(item.round || 1)),
        speaker: String(item.speaker || ""),
        text: String(item.text || ""),
      }))
    : [];
  clueSpeakerId.value = alivePlayers.value[0]?.id || "";
};

const syncRoomState = async (eventType: string) => {
  if (!roomSync.roomId.value) {
    return;
  }
  const status = !started.value ? "waiting" : hasWinner.value ? "finished" : "playing";
  await roomSync.syncState(buildGameState(), status, eventType);
  if (status === "finished" && roomSync.isHost.value) {
    await roomSync.finishRoom().catch(() => undefined);
  }
};

const pickWordPair = () => {
  const index = Math.floor(Math.random() * WORD_PAIRS.length);
  return WORD_PAIRS[index] || WORD_PAIRS[0];
};

const assignUndercover = () => {
  const ids = players.value.map((item) => item.id);
  const copied = [...ids];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = copied[index];
    copied[index] = copied[randomIndex];
    copied[randomIndex] = temp;
  }
  const undercoverIds = copied.slice(0, Math.min(2, copied.length));
  undercoverSet.value = new Set(undercoverIds);
};

const handleAddPlayer = async () => {
  if (!assertCanControl()) {
    return;
  }
  addPlayer();
  await syncRoomState("undercover.player.add");
};

const handleRemovePlayer = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  removePlayer(playerId);
  await syncRoomState("undercover.player.remove");
};

const handleToggleAlive = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  toggleAlive(playerId);
  await syncRoomState("undercover.player.toggle_alive");
};

const handleShufflePlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  shufflePlayers();
  await syncRoomState("undercover.player.shuffle");
};

const startGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (players.value.length < 6) {
    uni.showToast({ title: "至少 6 人", icon: "none" });
    return;
  }
  const pair = pickWordPair();
  civilianWord.value = pair[0] || "平民词";
  undercoverWord.value = pair[1] || "卧底词";
  markAllAlive();
  assignUndercover();
  started.value = true;
  roundNo.value = 1;
  showWords.value = false;
  clueInput.value = "";
  clueLogs.value = [];
  selectedVoteTargetId.value = "";
  clueSpeakerId.value = alivePlayers.value[0]?.id || "";
  if (roomSync.roomId.value && roomSync.isHost.value) {
    await roomSync.startRoom().catch(() => undefined);
  }
  await syncRoomState("undercover.game.start");
};

const toggleWordVisible = async () => {
  if (!assertCanControl()) {
    return;
  }
  showWords.value = !showWords.value;
  await syncRoomState("undercover.word.toggle_visible");
};

const onClueSpeakerChange = (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? -1);
  const speaker = alivePlayers.value[index];
  clueSpeakerId.value = speaker?.id || "";
};

const submitClue = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || hasWinner.value) {
    return;
  }
  const speaker = alivePlayers.value.find((item) => item.id === clueSpeakerId.value);
  const text = clueInput.value.trim();
  if (!speaker || !text) {
    uni.showToast({ title: "请先选择发言人并输入描述", icon: "none" });
    return;
  }
  clueLogs.value.unshift({
    round: roundNo.value,
    speaker: speaker.name,
    text,
  });
  clueInput.value = "";
  await syncRoomState("undercover.clue.submit");
};

const onVoteTargetChange = (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? -1);
  selectedVoteTargetId.value = voteTargetOptions.value[index]?.value || "";
};

const submitVote = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || hasWinner.value) {
    return;
  }
  const target = players.value.find((item) => item.id === selectedVoteTargetId.value);
  if (!target || !target.alive) {
    uni.showToast({ title: "目标无效", icon: "none" });
    return;
  }
  players.value = players.value.map((item) => {
    if (item.id !== target.id) {
      return item;
    }
    return {
      ...item,
      alive: false,
    };
  });
  selectedVoteTargetId.value = "";
  clueSpeakerId.value = alivePlayers.value[0]?.id || "";
  if (!winnerText.value) {
    roundNo.value += 1;
  }
  await syncRoomState("undercover.vote.submit");
};

const nextRound = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value || hasWinner.value) {
    return;
  }
  roundNo.value += 1;
  await syncRoomState("undercover.round.next");
};

const handleResetPlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  resetPlayers(8);
  started.value = false;
  roundNo.value = 1;
  civilianWord.value = "";
  undercoverWord.value = "";
  undercoverSet.value = new Set<string>();
  showWords.value = false;
  clueInput.value = "";
  clueSpeakerId.value = "";
  clueLogs.value = [];
  selectedVoteTargetId.value = "";
  await syncRoomState("undercover.game.reset");
};

const onRoomSnapshot = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const payload = snapshot as {
    room?: { gameKey?: string };
    state?: { data?: Record<string, unknown> };
  };
  if (String(payload.room?.gameKey || "") !== "undercover") {
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

.round-chip {
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

.action-row {
  margin-top: 14rpx;
  display: flex;
  gap: 10rpx;
}

.action-row.four {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.word-card {
  margin-top: 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 12rpx;
  background: color-mix(in srgb, var(--muted-bg) 80%, var(--card-bg) 20%);
}

.word-item {
  font-size: 23rpx;
  color: var(--text-main);
}

.word-item + .word-item {
  margin-top: 8rpx;
}

.clue-card {
  margin-top: 14rpx;
}

.block-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--text-main);
}

.clue-input-row {
  margin-top: 10rpx;
  display: grid;
  grid-template-columns: 1fr 1.2fr auto;
  gap: 8rpx;
}

.empty {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.clue-list {
  margin-top: 10rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.clue-item {
  font-size: 22rpx;
  color: var(--text-main);
}

.vote-box {
  margin-top: 14rpx;
  display: flex;
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
  opacity: 0.56;
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

.winner {
  margin-top: 10rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--accent);
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

.btn.disabled {
  opacity: 0.4;
}
</style>
