<template>
  <PartyGameLayout
    title="海龟汤（速推理）"
    subtitle="限量提问 + 快速回答，支持联机房间同步。"
    player-range="6-10人"
    duration="20-30 分钟"
    host-tip="先上短汤热场，再上复杂题。"
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
      :min-players="5"
      :max-players="12"
      :started="started"
      :start-disabled="players.length < 5 || !storyTitle.trim() || !answer.trim() || (Boolean(roomSync.roomId.value) && !roomSync.isHost.value)"
      start-text="开始问答"
      @update:new-player-name="newPlayerName = $event"
      @add="handleAddPlayer"
      @remove="handleRemovePlayer"
      @toggle-alive="handleToggleAlive"
      @shuffle="handleShufflePlayers"
      @reset="handleResetPlayers"
      @start="startGame"
    />

    <view class="card">
      <view class="title">题面与问答</view>
      <view class="meta">剩余提问 {{ remainingQuestions }} 次</view>

      <view class="input-block">
        <view class="label">题面</view>
        <input
          v-model="storyTitle"
          class="text-input"
          :disabled="started"
          maxlength="80"
          placeholder="例如：一个人走进餐厅喝完汤后自杀"
          placeholder-class="text-input-ph"
        />
      </view>

      <view class="input-block">
        <view class="label">标准答案（主持人可见）</view>
        <input
          v-model="answer"
          class="text-input"
          :disabled="started"
          maxlength="160"
          placeholder="输入完整答案，用于判定"
          placeholder-class="text-input-ph"
        />
      </view>

      <view v-if="started" class="qa-box">
        <view class="block-title">提问区</view>
        <view class="qa-row">
          <picker :range="playerNameList" @change="onAskerChange">
            <view class="picker">{{ askerLabel }}</view>
          </picker>
          <input
            v-model="questionInput"
            class="text-input"
            maxlength="80"
            placeholder="输入问题"
            placeholder-class="text-input-ph"
          />
        </view>
        <view class="qa-row response-row">
          <picker :range="replyOptions" @change="onReplyChange">
            <view class="picker">回答：{{ currentReply }}</view>
          </picker>
          <view class="btn" :class="{ disabled: remainingQuestions <= 0 || !canControl }" @click="submitQA">记录问答</view>
        </view>
      </view>

      <view v-if="started" class="guess-box">
        <view class="block-title">终局猜测</view>
        <input
          v-model="finalGuess"
          class="text-input"
          maxlength="160"
          placeholder="输入你们的最终猜测"
          placeholder-class="text-input-ph"
        />
        <view class="action-row two">
          <view class="btn primary" :class="{ disabled: !canControl }" @click="submitFinalGuess">提交猜测</view>
          <view class="btn ghost" :class="{ disabled: !canControl }" @click="toggleAnswerVisible">{{ showAnswer ? "隐藏答案" : "揭晓答案" }}</view>
        </view>
        <view v-if="guessResultText" class="guess-result">{{ guessResultText }}</view>
        <view v-if="showAnswer" class="answer-text">标准答案：{{ answer }}</view>
      </view>

      <view v-if="qaLogs.length > 0" class="log-box">
        <view class="block-title">问答记录</view>
        <view v-for="(item, index) in qaLogs" :key="`qa-${index}`" class="log-item">
          {{ index + 1 }}. {{ item.asker }}：{{ item.question }} -> {{ item.reply }}
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

interface QaLogItem {
  asker: string;
  question: string;
  reply: string;
}

interface TurtleSyncState {
  started: boolean;
  storyTitle: string;
  answer: string;
  askerId: string;
  currentReply: "是" | "否" | "无关";
  qaLogs: QaLogItem[];
  remainingQuestions: number;
  finalGuess: string;
  guessResultText: string;
  showAnswer: boolean;
  players: Array<{ id: string; name: string; alive: boolean }>;
}

const howToPlay = [
  "主持人输入题面和标准答案后开局。",
  "玩家轮流提问，主持人仅可回答“是/否/无关”。",
  "记录每次问答并扣减提问次数，便于回放。",
  "任意时刻可提交终局猜测并揭晓答案。",
];

const QUESTION_LIMIT = 20;

const { themeKey } = usePartyGameTheme();
const { players, newPlayerName, addPlayer, removePlayer, toggleAlive, shufflePlayers, resetPlayers } = usePartyGamePlayers(6);
const roomSync = usePartyGameRoomSync("turtle");

const started = ref(false);
const storyTitle = ref("一个人走进餐厅喝完汤后自杀");
const answer = ref("他曾在海上遇难，被救后才知道之前喝到的是人肉汤。再次喝到真正海龟汤后意识到真相，于是自杀。");
const questionInput = ref("");
const finalGuess = ref("");
const askerId = ref("");
const replyOptions = ["是", "否", "无关"];
const currentReply = ref<"是" | "否" | "无关">("是");
const qaLogs = ref<QaLogItem[]>([]);
const remainingQuestions = ref(QUESTION_LIMIT);
const guessResultText = ref("");
const showAnswer = ref(false);
const joinCodeInput = ref("");
const roomTitleInput = ref("海龟汤速推理局");
const autoJoinRoomCode = ref("");
const autoJoinRoomId = ref("");

const canControl = computed(() => !roomSync.roomId.value || roomSync.isHost.value);
const playerNameList = computed(() => players.value.map((item) => item.name));

const askerLabel = computed(() => {
  const player = players.value.find((item) => item.id === askerId.value);
  return player ? `提问人：${player.name}` : "选择提问人";
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
  return roomSync.isHost.value ? "你是房主，可控制问答并同步" : "你是成员，当前由房主控制问答";
});

const normalizeText = (value: string) => {
  return value.replace(/\s+/g, "").toLowerCase();
};

const assertCanControl = () => {
  if (roomSync.roomId.value && !roomSync.isHost.value) {
    uni.showToast({ title: "仅房主可操作", icon: "none" });
    return false;
  }
  return true;
};

const buildGameState = (): Record<string, unknown> => {
  const state: TurtleSyncState = {
    started: started.value,
    storyTitle: storyTitle.value,
    answer: answer.value,
    askerId: askerId.value,
    currentReply: currentReply.value,
    qaLogs: [...qaLogs.value],
    remainingQuestions: remainingQuestions.value,
    finalGuess: finalGuess.value,
    guessResultText: guessResultText.value,
    showAnswer: showAnswer.value,
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
  const state = payload as Partial<TurtleSyncState>;
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
  storyTitle.value = String(state.storyTitle || "");
  answer.value = String(state.answer || "");
  askerId.value = String(state.askerId || "");
  const nextReply = String(state.currentReply || "是");
  currentReply.value = nextReply === "否" || nextReply === "无关" ? nextReply : "是";
  qaLogs.value = Array.isArray(state.qaLogs)
    ? state.qaLogs.map((item) => ({
        asker: String(item.asker || ""),
        question: String(item.question || ""),
        reply: String(item.reply || "是"),
      }))
    : [];
  remainingQuestions.value = Math.max(0, Number(state.remainingQuestions ?? QUESTION_LIMIT));
  finalGuess.value = String(state.finalGuess || "");
  guessResultText.value = String(state.guessResultText || "");
  showAnswer.value = Boolean(state.showAnswer);
  if (!askerId.value && players.value.length > 0) {
    askerId.value = players.value[0].id;
  }
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
  await syncRoomState("turtle.player.add");
};

const handleRemovePlayer = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  removePlayer(playerId);
  if (askerId.value === playerId) {
    askerId.value = players.value[0]?.id || "";
  }
  await syncRoomState("turtle.player.remove");
};

const handleToggleAlive = async (playerId: string) => {
  if (!assertCanControl()) {
    return;
  }
  toggleAlive(playerId);
  await syncRoomState("turtle.player.toggle_alive");
};

const handleShufflePlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  shufflePlayers();
  if (!players.value.find((item) => item.id === askerId.value)) {
    askerId.value = players.value[0]?.id || "";
  }
  await syncRoomState("turtle.player.shuffle");
};

const startGame = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (players.value.length < 5) {
    uni.showToast({ title: "至少 5 人", icon: "none" });
    return;
  }
  if (!storyTitle.value.trim() || !answer.value.trim()) {
    uni.showToast({ title: "请先填写题面与答案", icon: "none" });
    return;
  }
  started.value = true;
  questionInput.value = "";
  finalGuess.value = "";
  askerId.value = players.value[0]?.id || "";
  currentReply.value = "是";
  qaLogs.value = [];
  remainingQuestions.value = QUESTION_LIMIT;
  guessResultText.value = "";
  showAnswer.value = false;
  if (roomSync.roomId.value && roomSync.isHost.value) {
    await roomSync.startRoom().catch(() => undefined);
  }
  await syncRoomState("turtle.game.start");
};

const onAskerChange = async (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? -1);
  askerId.value = players.value[index]?.id || "";
  if (started.value && canControl.value) {
    await syncRoomState("turtle.qa.asker_change");
  }
};

const onReplyChange = async (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? 0);
  const reply = replyOptions[index] || "是";
  if (reply === "是" || reply === "否" || reply === "无关") {
    currentReply.value = reply;
  }
  if (started.value && canControl.value) {
    await syncRoomState("turtle.qa.reply_change");
  }
};

const submitQA = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value) {
    return;
  }
  if (remainingQuestions.value <= 0) {
    uni.showToast({ title: "提问次数已用完", icon: "none" });
    return;
  }
  const player = players.value.find((item) => item.id === askerId.value);
  const question = questionInput.value.trim();
  if (!player || !question) {
    uni.showToast({ title: "请选择提问人并输入问题", icon: "none" });
    return;
  }
  qaLogs.value.unshift({
    asker: player.name,
    question,
    reply: currentReply.value,
  });
  questionInput.value = "";
  remainingQuestions.value -= 1;
  await syncRoomState("turtle.qa.submit");
};

const submitFinalGuess = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value) {
    return;
  }
  const guess = finalGuess.value.trim();
  if (!guess) {
    uni.showToast({ title: "请先输入猜测", icon: "none" });
    return;
  }
  const normalizedGuess = normalizeText(guess);
  const normalizedAnswer = normalizeText(answer.value);
  if (normalizedGuess && (normalizedAnswer.includes(normalizedGuess) || normalizedGuess.includes(normalizedAnswer.slice(0, 10)))) {
    guessResultText.value = "命中关键答案，推理成功！";
  } else {
    guessResultText.value = "未命中完整答案，可继续提问或直接揭晓。";
  }
  await syncRoomState("turtle.guess.submit");
};

const toggleAnswerVisible = async () => {
  if (!assertCanControl()) {
    return;
  }
  if (!started.value) {
    return;
  }
  showAnswer.value = !showAnswer.value;
  await syncRoomState("turtle.answer.toggle");
};

const handleResetPlayers = async () => {
  if (!assertCanControl()) {
    return;
  }
  resetPlayers(6);
  started.value = false;
  storyTitle.value = "一个人走进餐厅喝完汤后自杀";
  answer.value = "他曾在海上遇难，被救后才知道之前喝到的是人肉汤。再次喝到真正海龟汤后意识到真相，于是自杀。";
  questionInput.value = "";
  finalGuess.value = "";
  askerId.value = "";
  currentReply.value = "是";
  qaLogs.value = [];
  remainingQuestions.value = QUESTION_LIMIT;
  guessResultText.value = "";
  showAnswer.value = false;
  await syncRoomState("turtle.game.reset");
};

const onRoomSnapshot = (snapshot: unknown) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const payload = snapshot as {
    room?: { gameKey?: string };
    state?: { data?: Record<string, unknown> };
  };
  if (String(payload.room?.gameKey || "") !== "turtle") {
    return;
  }
  applyGameState(payload.state?.data || {});
};

const createRoom = async () => {
  try {
    const snapshot = await roomSync.createRoom(roomTitleInput.value, Math.max(5, players.value.length), buildGameState());
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
.input-block,
.qa-box,
.guess-box {
  margin-top: 14rpx;
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

.qa-row {
  margin-top: 10rpx;
  display: grid;
  grid-template-columns: 1fr 1.8fr;
  gap: 8rpx;
}

.response-row {
  grid-template-columns: 1fr auto;
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

.guess-result {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: var(--accent);
}

.answer-text {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--text-main);
}

.log-box,
.room-info {
  margin-top: 16rpx;
}

.log-box {
  border-top: 1rpx dashed var(--line);
  padding-top: 12rpx;
}

.log-item {
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

.btn.primary {
  color: #ffffff;
  border-color: color-mix(in srgb, var(--accent) 72%, #111111 28%);
  background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 88%, #ffffff 12%), color-mix(in srgb, var(--accent) 74%, #111111 26%));
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
