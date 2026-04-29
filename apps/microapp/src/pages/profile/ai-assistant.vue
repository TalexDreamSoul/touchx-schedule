<template>
  <PageViewContainer title="AI 时间助手">
    <view class="chat-page">
      <scroll-view class="message-scroll" scroll-y :show-scrollbar="false">
        <view v-for="message in messages" :key="message.id" class="message-row" :class="message.role">
          <view v-if="message.role === 'assistant'" class="bot-avatar" :class="{ thinking: thinkingMessageId === message.id }">AI</view>
          <view class="message-bubble">
            <view class="message-text">{{ message.content }}</view>
            <view v-for="card in message.cards || []" :key="card.id" class="result-card">
              <view class="card-title">{{ card.title }}</view>
              <view class="card-meta">
                周{{ formatDay(card.candidate.day) }} · 第 {{ card.candidate.startSection }}-{{ card.candidate.endSection }} 节 · {{ card.candidate.weekExpr || "1-20" }} 周
              </view>
              <view class="card-meta">标签：{{ card.candidate.tags.join(" / ") }} · 优先级：{{ formatPriority(card.candidate.priorityLabel) }}</view>
              <view v-if="card.candidate.conflicts?.length" class="warning-line">
                {{ card.candidate.conflicts[0]?.message || "存在时间冲突" }}
              </view>
              <view v-if="card.candidate.alternatives?.length" class="alternative-row">
                <view
                  v-for="slot in card.candidate.alternatives"
                  :key="`${card.id}-${slot.week}-${slot.day}-${slot.startSection}`"
                  class="alt-chip"
                  @click="applyAlternative(card, slot)"
                >
                  周{{ formatDay(slot.day) }} {{ slot.startSection }}-{{ slot.endSection }} 节
                </view>
              </view>
              <view class="card-actions">
                <view class="card-btn" @click="commitCandidate(card)">确认创建</view>
                <view class="card-btn ghost" @click="openEditor(card)">修改</view>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>

      <view class="floating-input" @click="openComposer">
        <view class="floating-plus">+</view>
      </view>

      <view v-if="composerOpen" class="sheet-mask" @click="closeComposer">
        <view class="composer-sheet" @click.stop>
          <textarea v-model="inputText" class="composer-textarea" maxlength="800" placeholder="例如：下周三下午3点开会，或周一三五下午2-4点训练" />
          <view v-if="attachments.length" class="attachment-row">
            <view v-for="item in attachments" :key="item.id" class="attachment-chip">{{ item.name }}</view>
          </view>
          <view class="tool-row">
            <view class="tool-btn" @click="chooseCamera">拍照</view>
            <view class="tool-btn" @click="chooseAlbum">相册</view>
            <view class="tool-btn" @click="chooseFile">文件</view>
          </view>
          <view class="send-btn" :class="{ disabled: submitPending || attachmentUploadPending }" @click="sendToAi">
            {{ attachmentUploadPending ? "上传中..." : submitPending ? "识别中..." : "发送给AI" }}
          </view>
        </view>
      </view>

      <view v-if="editingCard" class="sheet-mask" @click="closeEditor">
        <view class="composer-sheet" @click.stop>
          <view class="edit-title">修改日程</view>
          <input v-model.trim="editingCard.candidate.title" class="input" placeholder="标题" />
          <input v-model.number="editingCard.candidate.day" class="input" type="number" placeholder="周几 1-7" />
          <view class="edit-grid">
            <input v-model.number="editingCard.candidate.startSection" class="input" type="number" placeholder="开始节" />
            <input v-model.number="editingCard.candidate.endSection" class="input" type="number" placeholder="结束节" />
          </view>
          <input v-model.trim="editingCard.candidate.weekExpr" class="input" placeholder="周次，例如 1-20" />
          <textarea v-model="editingCard.candidate.description" class="composer-textarea small" maxlength="500" placeholder="描述" />
          <view class="send-btn" @click="closeEditor">保存修改</view>
        </view>
      </view>
    </view>
  </PageViewContainer>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageViewContainer from "@/components/PageViewContainer.vue";
import {
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendPost,
  resolveBackendBaseUrlFromStorage,
  uploadBackendFile,
  type AuthSessionState,
} from "@/utils/profile-service";

type PriorityLabel = "low" | "normal" | "high";

interface ScheduleCandidate {
  title: string;
  description: string;
  tags: string[];
  priorityLabel: PriorityLabel;
  priorityScore: number;
  repeatWeekdays: number[];
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity: "all" | "odd" | "even";
  examLike: boolean;
  examDate?: string;
  confidence: number;
  conflicts?: Array<{ message: string }>;
  alternatives?: Array<{ week: number; day: number; startSection: number; endSection: number; reason: string }>;
}

interface AssistantCard {
  id: string;
  type: "schedule_candidate";
  title: string;
  candidate: ScheduleCandidate;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards?: AssistantCard[];
}

interface AttachmentItem {
  id: string;
  type: "camera" | "album" | "file";
  name: string;
  url: string;
}

interface AiChatResponse {
  message?: { content?: string };
  cards?: Array<{ type?: string; candidate?: ScheduleCandidate }>;
}

interface AiAttachmentUploadResponse {
  asset?: {
    assetId?: string;
    url?: string;
  };
}

const backendBaseUrl = ref("");
const authSession = ref<AuthSessionState>({ token: "", expiresAt: 0, mode: "none", user: null });
const messages = ref<ChatMessage[]>([
  {
    id: "welcome",
    role: "assistant",
    content: "把时间安排、活动通知或课表文件发给我，我会先生成候选卡片，确认后再写入日程。",
  },
]);
const inputText = ref("");
const attachments = ref<AttachmentItem[]>([]);
const composerOpen = ref(false);
const submitPending = ref(false);
const attachmentUploadPending = ref(false);
const thinkingMessageId = ref("");
const editingCard = ref<AssistantCard | null>(null);

const syncContext = () => {
  backendBaseUrl.value = resolveBackendBaseUrlFromStorage();
  authSession.value = readAuthSessionFromStorage();
};

const createId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const formatPriority = (label: PriorityLabel) => {
  if (label === "high") {
    return "高";
  }
  if (label === "low") {
    return "低";
  }
  return "普通";
};

const formatDay = (day: number) => {
  return ["一", "二", "三", "四", "五", "六", "日"][Math.max(1, Math.min(7, Number(day || 1))) - 1] || "一";
};

const openComposer = () => {
  composerOpen.value = true;
};

const closeComposer = () => {
  if (!submitPending.value) {
    composerOpen.value = false;
  }
};

const appendAttachment = (type: AttachmentItem["type"], filePath: string, remoteUrl = "") => {
  if (!filePath && !remoteUrl) {
    return;
  }
  const name = filePath.split("/").pop() || remoteUrl.split("/").pop() || `${type}_${Date.now()}`;
  attachments.value.push({ id: createId("att"), type, name, url: remoteUrl || filePath });
};

const uploadAiAttachment = async (type: AttachmentItem["type"], filePath: string) => {
  if (!filePath) {
    return;
  }
  syncContext();
  if (!authSession.value.token) {
    uni.showToast({ title: "请先登录后上传附件", icon: "none", duration: 1600 });
    return;
  }
  attachmentUploadPending.value = true;
  try {
    const payload = await uploadBackendFile<AiAttachmentUploadResponse>(backendBaseUrl.value, "/api/v1/ai/attachments", {
      filePath,
      name: "file",
      token: authSession.value.token,
    });
    appendAttachment(type, filePath, payload.asset?.url || "");
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "附件上传失败", icon: "none", duration: 1800 });
  } finally {
    attachmentUploadPending.value = false;
  }
};

const chooseCamera = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ["camera"],
    success: (result) => {
      void uploadAiAttachment("camera", String(result.tempFilePaths?.[0] || ""));
    },
  });
};

const chooseAlbum = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ["album"],
    success: (result) => {
      void uploadAiAttachment("album", String(result.tempFilePaths?.[0] || ""));
    },
  });
};

const chooseFile = () => {
  const uniAny = uni as unknown as {
    chooseMessageFile?: (options: {
      count: number;
      type: string;
      success: (result: { tempFiles?: Array<{ path?: string; name?: string }> }) => void;
    }) => void;
  };
  if (typeof uniAny.chooseMessageFile !== "function") {
    uni.showToast({ title: "当前端不支持文件选择", icon: "none", duration: 1600 });
    return;
  }
  uniAny.chooseMessageFile({
    count: 1,
    type: "file",
    success: (result) => {
      const file = result.tempFiles?.[0];
      appendAttachment("file", String(file?.path || file?.name || ""));
    },
  });
};

const normalizeCandidate = (candidate: ScheduleCandidate): ScheduleCandidate => ({
  ...candidate,
  day: Number(candidate.day || candidate.repeatWeekdays?.[0] || 1),
  startSection: Number(candidate.startSection || 1),
  endSection: Number(candidate.endSection || candidate.startSection || 1),
  weekExpr: candidate.weekExpr || "1-20",
  parity: candidate.parity || "all",
  tags: Array.isArray(candidate.tags) ? candidate.tags : [],
});

const sendToAi = async () => {
  syncContext();
  if (!authSession.value.token) {
    uni.showToast({ title: "请先登录后使用 AI 时间助手", icon: "none", duration: 1600 });
    return;
  }
  if (attachmentUploadPending.value) {
    uni.showToast({ title: "附件上传中，请稍后发送", icon: "none", duration: 1600 });
    return;
  }
  const text = inputText.value.trim();
  if (!text && attachments.value.length <= 0) {
    uni.showToast({ title: "请输入文本或选择文件", icon: "none", duration: 1600 });
    return;
  }
  const userMessage: ChatMessage = {
    id: createId("msg"),
    role: "user",
    content: [text, ...attachments.value.map((item) => `已选择：${item.name}`)].filter((item) => item).join("\n"),
  };
  const assistantMessage: ChatMessage = {
    id: createId("ai"),
    role: "assistant",
    content: "正在识别...",
  };
  messages.value.push(userMessage, assistantMessage);
  thinkingMessageId.value = assistantMessage.id;
  submitPending.value = true;
  try {
    const payload = await requestBackendPost<AiChatResponse>(
      backendBaseUrl.value,
      "/api/v1/ai/chat",
      {
        text,
        attachments: attachments.value.map((item) => ({ type: item.type, name: item.name, url: item.url })),
      },
      authSession.value.token,
    );
    assistantMessage.content = payload.message?.content || "已完成识别，请确认候选内容。";
    assistantMessage.cards = (payload.cards || [])
      .filter((item) => item.type === "schedule_candidate" && item.candidate)
      .map((item) => {
        const candidate = normalizeCandidate(item.candidate as ScheduleCandidate);
        return {
          id: createId("card"),
          type: "schedule_candidate",
          title: candidate.title || "新的日程",
          candidate,
        };
      });
    inputText.value = "";
    attachments.value = [];
    composerOpen.value = false;
  } catch (error) {
    assistantMessage.content = error instanceof Error ? error.message : "AI 识别失败";
  } finally {
    thinkingMessageId.value = "";
    submitPending.value = false;
  }
};

const applyAlternative = (
  card: AssistantCard,
  slot: { day: number; startSection: number; endSection: number },
) => {
  card.candidate.day = slot.day;
  card.candidate.startSection = slot.startSection;
  card.candidate.endSection = slot.endSection;
  card.candidate.conflicts = [];
};

const commitCandidate = async (card: AssistantCard) => {
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      "/api/v1/ai/schedule/commit",
      {
        title: card.candidate.title,
        description: card.candidate.description,
        day: card.candidate.day,
        startSection: card.candidate.startSection,
        endSection: card.candidate.endSection,
        weekExpr: card.candidate.weekExpr,
        parity: card.candidate.parity,
        tags: card.candidate.tags,
        examDate: card.candidate.examDate || "",
      },
      authSession.value.token,
    );
    uni.showToast({ title: "已写入日程", icon: "none", duration: 1200 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "写入失败", icon: "none", duration: 1800 });
  }
};

const openEditor = (card: AssistantCard) => {
  editingCard.value = card;
};

const closeEditor = () => {
  editingCard.value = null;
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  syncContext();
});
</script>

<style scoped>
.chat-page {
  min-height: calc(100vh - 120rpx);
  position: relative;
  padding-bottom: 132rpx;
}

.message-scroll {
  max-height: calc(100vh - 180rpx);
}

.message-row {
  margin-bottom: 18rpx;
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}

.message-row.user {
  justify-content: flex-end;
}

.bot-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.12);
  color: var(--accent);
  font-size: 19rpx;
  font-weight: 700;
}

.bot-avatar.thinking {
  animation: pulse 1.2s ease-in-out infinite;
}

.message-bubble {
  max-width: 78%;
  border-radius: 18rpx;
  padding: 14rpx;
  background: rgba(148, 163, 184, 0.14);
  color: var(--text-main);
}

.message-row.user .message-bubble {
  background: var(--accent);
  color: #ffffff;
}

.message-text {
  white-space: pre-wrap;
  font-size: 23rpx;
  line-height: 1.45;
}

.result-card {
  margin-top: 12rpx;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 12rpx;
  background: var(--card-bg);
  color: var(--text-main);
}

.card-title,
.edit-title {
  font-size: 24rpx;
  font-weight: 700;
}

.card-meta {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.warning-line {
  margin-top: 10rpx;
  padding: 10rpx;
  border-radius: 8rpx;
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
  font-size: 20rpx;
}

.alternative-row,
.card-actions,
.tool-row,
.attachment-row,
.edit-grid {
  margin-top: 12rpx;
  display: flex;
  gap: 10rpx;
  flex-wrap: wrap;
}

.alt-chip,
.attachment-chip {
  border: 1rpx solid var(--line);
  border-radius: 999rpx;
  padding: 8rpx 12rpx;
  font-size: 20rpx;
  color: var(--text-main);
}

.card-btn,
.send-btn {
  flex: 1;
  border-radius: 10rpx;
  padding: 14rpx 12rpx;
  text-align: center;
  color: #ffffff;
  background: var(--accent);
  font-size: 22rpx;
  font-weight: 600;
}

.card-btn.ghost {
  color: var(--text-main);
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
}

.floating-input {
  position: fixed;
  right: 34rpx;
  bottom: 42rpx;
  width: 108rpx;
  height: 108rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #ffffff;
  box-shadow: 0 16rpx 36rpx rgba(15, 23, 42, 0.18);
}

.floating-plus {
  font-size: 54rpx;
  line-height: 1;
}

.sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(15, 23, 42, 0.3);
  display: flex;
  align-items: flex-end;
}

.composer-sheet {
  width: 100%;
  min-height: 48vh;
  box-sizing: border-box;
  border-radius: 28rpx 28rpx 0 0;
  padding: 22rpx;
  background: var(--card-bg);
}

.composer-textarea,
.input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  padding: 14rpx;
  color: var(--text-main);
  background: var(--muted-bg);
  font-size: 23rpx;
}

.composer-textarea {
  min-height: 180rpx;
}

.composer-textarea.small {
  min-height: 120rpx;
}

.input {
  min-height: 68rpx;
  margin-top: 12rpx;
}

.tool-btn {
  width: 112rpx;
  height: 112rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--muted-bg);
  border: 1rpx solid var(--line);
  color: var(--text-main);
  font-size: 22rpx;
}

.send-btn {
  margin-top: 18rpx;
}

.send-btn.disabled {
  opacity: 0.65;
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.35);
  }
  50% {
    box-shadow: 0 0 0 14rpx rgba(59, 130, 246, 0);
  }
}
</style>
