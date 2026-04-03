<template>
  <PartyGameLayout
    title="害你在心口难开"
    subtitle="词语 + 惩罚翻卡玩法，离线轮流即可开玩。"
    player-range="2-N人"
    duration="10-30 分钟"
    host-tip="建议先选简单难度热场，再逐步上强度。"
    :how-to-play="howToPlay"
    :theme-key="themeKey"
    intro-position="bottom"
  >
    <view class="card stage-card">
      <view class="title">当前卡片</view>
      <view class="card-face">
        <view v-if="currentCardState.phase === 'mask'" class="mask-view">
          <view class="mask-title">请把手机递给下一位</view>
          <view class="mask-sub">2 秒后自动显示下一词</view>
        </view>

        <view v-else-if="!currentWord" class="empty-view">
          当前筛选下暂无可用词条
        </view>

        <view v-else class="content-view">
          <view class="face-chip">{{ currentCardState.phase === "front" ? "词语面" : "惩罚面" }}</view>
          <view class="content-main" :class="{ back: currentCardState.phase === 'back' }">
            {{ currentCardState.phase === "front" ? currentWord.word : currentWord.punishment }}
          </view>
          <view v-if="currentCardState.phase === 'back'" class="content-sub">
            词语：{{ currentWord.word }} · {{ difficultyLabelMap[currentWord.difficulty] }} · {{ currentWord.category || "默认" }}
          </view>
          <view v-if="roundSkipped" class="skip-tip">
            已使用免死金牌，本轮惩罚已跳过。
          </view>
        </view>
      </view>

      <view class="action-row stage-action-row">
        <view
          v-if="currentCardState.phase === 'front'"
          class="btn primary"
          :class="{ disabled: !currentWord }"
          @click="showPunishment"
        >
          显示惩罚
        </view>

        <template v-else-if="currentCardState.phase === 'back'">
          <view class="btn warn" :class="{ disabled: !currentWord }" @click="addJokerForCurrentPlayer">无法完成 +1</view>
          <view class="btn ghost" :class="{ disabled: !canUseJoker }" @click="useJokerForCurrentPunishment">使用免死金牌</view>
          <view class="btn primary" :class="{ disabled: !currentWord }" @click="goNextCard">下一张</view>
        </template>
      </view>
    </view>

    <view class="card">
      <view class="title">词库设置</view>
      <view class="meta">{{ sourceLabel }} · 可抽 {{ filteredWords.length }} 条</view>
      <view class="filter-grid">
        <label class="field">
          <text class="label">分类</text>
          <picker :range="categoryOptions" @change="onCategoryChange">
            <view class="picker">{{ selectedCategoryLabel }}</view>
          </picker>
        </label>
        <label class="field">
          <text class="label">难度</text>
          <picker :range="difficultyOptions" range-key="label" @change="onDifficultyChange">
            <view class="picker">{{ selectedDifficultyLabel }}</view>
          </picker>
        </label>
      </view>
      <view class="action-row">
        <view class="btn" :class="{ disabled: loadingWordBank }" @click="refreshWordBankManually">
          {{ loadingWordBank ? "刷新中..." : "刷新词库" }}
        </view>
      </view>
    </view>

    <view class="card">
      <view class="title">当前玩家</view>
      <input
        v-model="playerNameInput"
        class="text-input"
        maxlength="20"
        placeholder="输入当前玩家名（会话内记账）"
        placeholder-class="text-input-ph"
      />
      <view class="meta">免死金牌：{{ currentPlayerJokerCount }}</view>
    </view>
  </PartyGameLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { onHide, onShow, onUnload } from "@dcloudio/uni-app";
import PartyGameLayout from "./components/PartyGameLayout.vue";
import { usePartyGameTheme } from "./composables/usePartyGameTheme";
import { readAuthSessionFromStorage, requestBackendGet, resolveBackendBaseUrlFromStorage } from "@/utils/profile-service";

type HeartOpenDifficulty = "easy" | "medium" | "hard";
type CardPhase = "front" | "back" | "mask";

interface HeartOpenWordItem {
  wordId: string;
  word: string;
  punishment: string;
  category: string;
  difficulty: HeartOpenDifficulty;
  enabled: boolean;
}

interface CurrentCardState {
  phase: CardPhase;
}

type PlayerJokerState = Record<string, number>;

interface HeartOpenWordBankResponse {
  items?: Array<{
    wordId?: string;
    word?: string;
    punishment?: string;
    category?: string;
    difficulty?: string;
    enabled?: boolean;
  }>;
}

const STORAGE_HEART_OPEN_WORD_BANK_KEY = "touchx_party_game_heart_open_word_bank_cache";
const STORAGE_HEART_OPEN_WORD_BANK_VERSION = 2;
const MASK_DURATION_MS = 2000;

const howToPlay = [
  "先看词语，点击“显示惩罚”后翻到惩罚面。",
  "惩罚过难可点“无法完成 +1”，给当前玩家累积免死金牌。",
  "下一次遇到惩罚可手动“使用免死金牌”跳过一次。",
  "点“下一张”会先遮挡 2 秒，再显示新词，避免偷看。",
];

const difficultyLabelMap: Record<HeartOpenDifficulty, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const fallbackWordBank: HeartOpenWordItem[] = [
  {
    wordId: "fallback_newyear_toast",
    word: "举杯",
    punishment: "即兴说 15 秒祝酒词，最后要押韵收尾。",
    category: "新年饭局",
    difficulty: "easy",
    enabled: true,
  },
  {
    wordId: "fallback_class_teacher",
    word: "老师好",
    punishment: "用播音腔介绍右手边玩家 20 秒。",
    category: "课堂演讲",
    difficulty: "easy",
    enabled: true,
  },
  {
    wordId: "fallback_ktv_song",
    word: "点歌",
    punishment: "清唱任意副歌两句，不能只哼旋律。",
    category: "KTV局",
    difficulty: "easy",
    enabled: true,
  },
  {
    wordId: "fallback_market_checkout",
    word: "结账",
    punishment: "模仿收银员报菜名 20 秒，越快越好。",
    category: "超市购物",
    difficulty: "easy",
    enabled: true,
  },
  {
    wordId: "fallback_stage_bow",
    word: "鞠躬",
    punishment: "给全场来一段 10 秒颁奖感言。",
    category: "晚会舞台",
    difficulty: "medium",
    enabled: true,
  },
  {
    wordId: "fallback_book_author",
    word: "作者名",
    punishment: "说出 3 本你读过的书名，限时 15 秒。",
    category: "书店闲聊",
    difficulty: "medium",
    enabled: true,
  },
  {
    wordId: "fallback_military_attention",
    word: "立正",
    punishment: "站军姿 10 秒并大声报数到 5。",
    category: "军训回忆",
    difficulty: "medium",
    enabled: true,
  },
  {
    wordId: "fallback_dance_swan",
    word: "天鹅湖",
    punishment: "模仿天鹅动作 8 秒，保持微笑。",
    category: "舞蹈课",
    difficulty: "hard",
    enabled: true,
  },
  {
    wordId: "fallback_supermarket_queue",
    word: "插队",
    punishment: "给全场演一段“礼貌制止插队”小剧场 20 秒。",
    category: "超市购物",
    difficulty: "hard",
    enabled: true,
  },
  {
    wordId: "fallback_ktv_duet",
    word: "情歌对唱",
    punishment: "随机点一位玩家，合唱“我爱你”三种语气版本。",
    category: "KTV局",
    difficulty: "hard",
    enabled: true,
  },
  {
    wordId: "fallback_class_answer",
    word: "回答问题",
    punishment: "被提问“今天最尴尬的事”，30 秒内必须答完。",
    category: "校园回忆",
    difficulty: "medium",
    enabled: true,
  },
];

const difficultyOptions = [
  { value: "", label: "全部难度" },
  { value: "easy", label: "简单" },
  { value: "medium", label: "中等" },
  { value: "hard", label: "困难" },
];

const { themeKey } = usePartyGameTheme();

const loadingWordBank = ref(false);
const wordBank = ref<HeartOpenWordItem[]>([]);
const sourceLabel = ref("词库来源：兜底");
const selectedCategory = ref("");
const selectedDifficulty = ref<"" | HeartOpenDifficulty>("");
const currentCardState = ref<CurrentCardState>({ phase: "front" });
const currentWordId = ref("");
const deckQueue = ref<string[]>([]);
const playerNameInput = ref("");
const playerJokers = ref<PlayerJokerState>({});
const roundSkipped = ref(false);
const keepScreenWarned = ref(false);

let maskTimer: ReturnType<typeof setTimeout> | null = null;

const normalizeDifficulty = (value: unknown): HeartOpenDifficulty => {
  const difficulty = String(value || "").trim().toLowerCase();
  if (difficulty === "easy" || difficulty === "hard" || difficulty === "medium") {
    return difficulty;
  }
  return "medium";
};

const normalizeWordItem = (item: Partial<HeartOpenWordItem>): HeartOpenWordItem | null => {
  const wordId = String(item.wordId || "").trim();
  const word = String(item.word || "").trim();
  const punishment = String(item.punishment || "").trim();
  if (!wordId || !word || !punishment) {
    return null;
  }
  return {
    wordId,
    word,
    punishment,
    category: String(item.category || "默认").trim() || "默认",
    difficulty: normalizeDifficulty(item.difficulty),
    enabled: item.enabled !== false,
  };
};

const filteredWords = computed(() => {
  const category = selectedCategory.value.trim().toLowerCase();
  const difficulty = selectedDifficulty.value;
  return wordBank.value
    .filter((item) => item.enabled)
    .filter((item) => (!category ? true : item.category.toLowerCase() === category))
    .filter((item) => (!difficulty ? true : item.difficulty === difficulty));
});

const categoryOptions = computed(() => {
  const set = new Set<string>();
  wordBank.value.forEach((item) => {
    if (item.enabled && item.category) {
      set.add(item.category);
    }
  });
  return ["全部分类", ...Array.from(set.values()).sort((left, right) => left.localeCompare(right, "zh-CN"))];
});

const selectedCategoryLabel = computed(() => {
  return selectedCategory.value || "全部分类";
});

const selectedDifficultyLabel = computed(() => {
  const selected = difficultyOptions.find((item) => item.value === selectedDifficulty.value);
  return selected?.label || "全部难度";
});

const currentWord = computed(() => {
  return filteredWords.value.find((item) => item.wordId === currentWordId.value) || null;
});

const normalizedPlayerName = computed(() => {
  return playerNameInput.value.trim();
});

const currentPlayerJokerCount = computed(() => {
  const name = normalizedPlayerName.value;
  if (!name) {
    return 0;
  }
  return Math.max(0, Number(playerJokers.value[name] || 0));
});

const canUseJoker = computed(() => {
  return Boolean(currentWord.value) && currentPlayerJokerCount.value > 0 && !roundSkipped.value;
});

const clearMaskTimer = () => {
  if (!maskTimer) {
    return;
  }
  clearTimeout(maskTimer);
  maskTimer = null;
};

const setKeepScreenOn = (keepScreenOn: boolean) => {
  uni.setKeepScreenOn({
    keepScreenOn,
    fail: () => {
      if (!keepScreenOn || keepScreenWarned.value) {
        return;
      }
      keepScreenWarned.value = true;
      uni.showToast({
        title: "常亮设置失败，请留意屏幕息屏",
        icon: "none",
      });
    },
  });
};

const shuffle = (items: string[]) => {
  const copied = [...items];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = copied[index];
    copied[index] = copied[randomIndex];
    copied[randomIndex] = temp;
  }
  return copied;
};

const rebuildDeckIfNeeded = () => {
  if (deckQueue.value.length > 0) {
    return;
  }
  deckQueue.value = shuffle(filteredWords.value.map((item) => item.wordId));
};

const drawNextWord = () => {
  const available = filteredWords.value;
  if (available.length === 0) {
    currentWordId.value = "";
    deckQueue.value = [];
    currentCardState.value = { phase: "front" };
    roundSkipped.value = false;
    return;
  }
  rebuildDeckIfNeeded();
  if (deckQueue.value.length === 0) {
    currentWordId.value = "";
    return;
  }
  const nextWordId = deckQueue.value.shift() || "";
  currentWordId.value = nextWordId;
  currentCardState.value = { phase: "front" };
  roundSkipped.value = false;
};

const applyWordBank = (items: HeartOpenWordItem[], source: "cache" | "server" | "fallback") => {
  wordBank.value = items;
  sourceLabel.value =
    source === "server" ? "词库来源：服务端" : source === "cache" ? "词库来源：本地缓存" : "词库来源：兜底";
  deckQueue.value = [];
  drawNextWord();
};

const readCachedWordBank = () => {
  const raw = uni.getStorageSync(STORAGE_HEART_OPEN_WORD_BANK_KEY);
  if (!raw) {
    return [] as HeartOpenWordItem[];
  }
  try {
    const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    const version = Number((payload as { version?: unknown })?.version || 0);
    if (version !== STORAGE_HEART_OPEN_WORD_BANK_VERSION) {
      return [];
    }
    const items = Array.isArray((payload as { items?: unknown[] })?.items) ? (payload as { items: unknown[] }).items : [];
    return items
      .map((item) => normalizeWordItem(item as Partial<HeartOpenWordItem>))
      .filter((item): item is HeartOpenWordItem => item !== null);
  } catch (error) {
    return [];
  }
};

const persistCachedWordBank = (items: HeartOpenWordItem[]) => {
  uni.setStorageSync(
    STORAGE_HEART_OPEN_WORD_BANK_KEY,
    JSON.stringify({
      version: STORAGE_HEART_OPEN_WORD_BANK_VERSION,
      items,
      updatedAt: Date.now(),
    }),
  );
};

const fetchWordBankFromServer = async () => {
  const session = readAuthSessionFromStorage();
  if (!session.token) {
    throw new Error("请先登录后再拉取服务端词库");
  }
  const baseUrl = resolveBackendBaseUrlFromStorage();
  const data = await requestBackendGet<HeartOpenWordBankResponse>(
    baseUrl,
    "/api/v1/party-games/heart-open/word-bank",
    {},
    session.token,
  );
  const normalized = (Array.isArray(data.items) ? data.items : [])
    .map((item) =>
      normalizeWordItem({
        wordId: item.wordId,
        word: item.word,
        punishment: item.punishment,
        category: item.category,
        difficulty: normalizeDifficulty(item.difficulty),
        enabled: item.enabled,
      }),
    )
    .filter((item): item is HeartOpenWordItem => item !== null)
    .filter((item) => item.enabled);
  return normalized;
};

const initWordBank = async () => {
  loadingWordBank.value = true;
  try {
    const cached = readCachedWordBank();
    if (cached.length > 0) {
      applyWordBank(cached, "cache");
      return;
    }
    try {
      const remote = await fetchWordBankFromServer();
      if (remote.length > 0) {
        persistCachedWordBank(remote);
        applyWordBank(remote, "server");
        return;
      }
    } catch (error) {
      // noop
    }
    applyWordBank(fallbackWordBank, "fallback");
  } finally {
    loadingWordBank.value = false;
  }
};

const refreshWordBankManually = async () => {
  if (loadingWordBank.value) {
    return;
  }
  loadingWordBank.value = true;
  try {
    const remote = await fetchWordBankFromServer();
    if (remote.length <= 0) {
      uni.showToast({ title: "服务端词库为空", icon: "none" });
      return;
    }
    persistCachedWordBank(remote);
    applyWordBank(remote, "server");
    uni.showToast({ title: "词库刷新成功", icon: "none" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "刷新失败";
    uni.showToast({ title: message, icon: "none" });
    if (wordBank.value.length === 0) {
      applyWordBank(fallbackWordBank, "fallback");
    }
  } finally {
    loadingWordBank.value = false;
  }
};

const onCategoryChange = (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? 0);
  const label = categoryOptions.value[index] || "全部分类";
  selectedCategory.value = label === "全部分类" ? "" : label;
};

const onDifficultyChange = (event: { detail?: { value?: number } }) => {
  const index = Number(event?.detail?.value ?? 0);
  const selected = difficultyOptions[index];
  selectedDifficulty.value = (selected?.value || "") as "" | HeartOpenDifficulty;
};

const showPunishment = () => {
  if (!currentWord.value || currentCardState.value.phase !== "front") {
    return;
  }
  currentCardState.value = { phase: "back" };
};

const ensurePlayerName = () => {
  const playerName = normalizedPlayerName.value;
  if (!playerName) {
    uni.showToast({ title: "请先输入当前玩家名", icon: "none" });
    return "";
  }
  return playerName;
};

const addJokerForCurrentPlayer = () => {
  if (!currentWord.value || currentCardState.value.phase !== "back") {
    return;
  }
  const playerName = ensurePlayerName();
  if (!playerName) {
    return;
  }
  playerJokers.value[playerName] = Math.max(0, Number(playerJokers.value[playerName] || 0)) + 1;
  uni.showToast({ title: `${playerName} 获得 1 张免死金牌`, icon: "none" });
};

const useJokerForCurrentPunishment = () => {
  if (!currentWord.value || currentCardState.value.phase !== "back") {
    return;
  }
  if (roundSkipped.value) {
    uni.showToast({ title: "本轮已使用免死金牌", icon: "none" });
    return;
  }
  const playerName = ensurePlayerName();
  if (!playerName) {
    return;
  }
  const currentCount = Math.max(0, Number(playerJokers.value[playerName] || 0));
  if (currentCount <= 0) {
    uni.showToast({ title: "当前玩家没有免死金牌", icon: "none" });
    return;
  }
  playerJokers.value[playerName] = currentCount - 1;
  roundSkipped.value = true;
  uni.showToast({ title: "已使用免死金牌，惩罚跳过", icon: "none" });
};

const goNextCard = () => {
  if (!currentWord.value || currentCardState.value.phase !== "back") {
    return;
  }
  currentCardState.value = { phase: "mask" };
  clearMaskTimer();
  maskTimer = setTimeout(() => {
    drawNextWord();
    maskTimer = null;
  }, MASK_DURATION_MS);
};

watch([selectedCategory, selectedDifficulty], () => {
  clearMaskTimer();
  deckQueue.value = [];
  drawNextWord();
});

onMounted(async () => {
  await initWordBank();
  setKeepScreenOn(true);
});

onShow(() => {
  setKeepScreenOn(true);
});

onHide(() => {
  setKeepScreenOn(false);
});

onUnload(() => {
  clearMaskTimer();
  setKeepScreenOn(false);
});

onUnmounted(() => {
  clearMaskTimer();
});
</script>

<style scoped>
.card {
  background: color-mix(in srgb, var(--card-bg) 92%, #ffffff 8%);
  border: 1rpx solid var(--line);
  border-radius: 16rpx;
  padding: 18rpx;
}

.stage-card {
  min-height: 680rpx;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 8% 12%, color-mix(in srgb, var(--accent) 22%, #ffffff 78%), transparent 26%),
    radial-gradient(circle at 92% 20%, color-mix(in srgb, var(--accent) 14%, #ffffff 86%), transparent 22%),
    linear-gradient(160deg, color-mix(in srgb, var(--card-bg) 90%, var(--accent) 10%), var(--card-bg));
}

.title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.meta {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--text-sub);
}

.filter-grid {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.label {
  font-size: 22rpx;
  color: var(--text-sub);
}

.picker {
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  padding: 12rpx 14rpx;
  font-size: 24rpx;
  color: var(--text-main);
  background: var(--card-bg);
}

.text-input {
  margin-top: 14rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  padding: 14rpx;
  font-size: 26rpx;
  color: var(--text-main);
}

.text-input-ph {
  color: color-mix(in srgb, var(--text-sub) 78%, #ffffff 22%);
}

.card-face {
  margin-top: 14rpx;
  border-radius: 24rpx;
  border: 1rpx solid color-mix(in srgb, var(--line) 68%, var(--accent) 32%);
  min-height: 520rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(170deg, color-mix(in srgb, var(--card-bg) 82%, #ffffff 18%), color-mix(in srgb, var(--card-bg) 90%, var(--accent) 10%));
  padding: 30rpx 30rpx;
  box-shadow: 0 18rpx 40rpx color-mix(in srgb, var(--accent) 20%, transparent);
}

.content-view {
  width: 100%;
  text-align: center;
}

.face-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  border: 1rpx solid color-mix(in srgb, var(--accent) 58%, var(--line) 42%);
  padding: 8rpx 18rpx;
  font-size: 24rpx;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--card-bg) 90%);
}

.content-main {
  margin-top: 18rpx;
  font-size: 62rpx;
  line-height: 1.3;
  color: var(--text-main);
  font-weight: 700;
  word-break: break-all;
}

.content-main.back {
  font-size: 48rpx;
}

.content-sub {
  margin-top: 18rpx;
  font-size: 24rpx;
  color: var(--text-sub);
}

.skip-tip {
  margin-top: 14rpx;
  font-size: 24rpx;
  color: var(--accent);
}

.mask-view,
.empty-view {
  width: 100%;
  text-align: center;
}

.mask-title {
  font-size: 48rpx;
  font-weight: 700;
  color: var(--text-main);
}

.mask-sub {
  margin-top: 14rpx;
  font-size: 28rpx;
  color: var(--text-sub);
}

.empty-view {
  font-size: 32rpx;
  color: var(--text-sub);
}

.action-row {
  margin-top: 16rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.stage-action-row {
  justify-content: center;
}

.btn {
  border-radius: 14rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  color: var(--text-main);
  font-size: 26rpx;
  font-weight: 600;
  padding: 14rpx 22rpx;
  min-width: 180rpx;
  text-align: center;
}

.btn.primary {
  color: #ffffff;
  border-color: transparent;
  background: var(--accent);
}

.btn.warn {
  color: #ffffff;
  border-color: transparent;
  background: color-mix(in srgb, #ff7a45 88%, #000000 12%);
}

.btn.ghost {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 60%, var(--line) 40%);
  background: color-mix(in srgb, var(--accent) 8%, var(--card-bg) 92%);
}

.btn.disabled {
  opacity: 0.5;
  pointer-events: none;
}
</style>
