<template>
  <view class="pg-card">
    <view class="row-head">
      <view class="title">联机房间</view>
      <view class="sync-chip" :class="{ offline: !connected && roomId }">
        {{ connected ? "已同步" : roomId ? "连接中" : "未联机" }}
      </view>
    </view>
    <view class="meta">{{ metaText }}</view>

    <view class="action-row">
      <view class="btn" @click="openDialog">房间操作</view>
      <view class="btn ghost" :class="{ disabled: !roomId }" @click="onRefresh">拉取最新</view>
      <view class="btn ghost" :class="{ disabled: !roomId }" @click="onLeave">离开房间</view>
    </view>

    <view v-if="roomId" class="room-info">
      <view class="room-line">房间ID：{{ roomId }}</view>
      <view class="room-line">房间码：{{ roomCode || "-" }} <text class="copy" @click="emit('copy')">复制</text></view>
      <view class="room-line">房间状态：{{ roomStatusLabel }}</view>
      <view class="member-list">
        <view v-for="member in members" :key="member.memberId" class="member-chip" :class="{ offline: !member.online }">
          <text>{{ member.nickname || member.studentNo || member.userId }}</text>
          <text>{{ member.isHost ? "房主" : member.online ? "在线" : "离线" }}</text>
        </view>
      </view>
    </view>

    <view v-if="dialogVisible" class="dialog-mask" @click="closeDialog">
      <view class="dialog-card" @click.stop>
        <view class="dialog-head">
          <view class="dialog-title">房间操作</view>
          <view class="dialog-close" @click="closeDialog">×</view>
        </view>

        <view class="dialog-block">
          <view class="label">创建房间标题</view>
          <input
            class="text-input"
            :value="roomTitleInput"
            maxlength="24"
            placeholder="房间标题（可选）"
            placeholder-class="text-input-ph"
            @input="onRoomTitleInput"
          />
          <view class="btn" @click="onCreate">创建房间</view>
        </view>

        <view class="dialog-block">
          <view class="label">加入房间码</view>
          <input
            class="text-input"
            :value="joinCodeInput"
            maxlength="8"
            placeholder="输入房间码"
            placeholder-class="text-input-ph"
            @input="onJoinCodeInput"
          />
          <view class="btn ghost" @click="onJoin">加入房间</view>
          <view v-if="recentRoomCodes.length > 0" class="recent-wrap">
            <view class="recent-label">最近房间码</view>
            <view class="recent-list">
              <view v-for="code in recentRoomCodes" :key="code" class="recent-chip" @click="emit('pickRecentCode', code)">
                {{ code }}
              </view>
            </view>
          </view>
        </view>

        <view v-if="lastRoom" class="dialog-block">
          <view class="label">上次房间</view>
          <view class="last-room">
            <view class="last-room-line">{{ lastRoom.title || "未命名房间" }}</view>
            <view class="last-room-line">ID：{{ lastRoom.roomId || "-" }}</view>
            <view class="last-room-line">Code：{{ lastRoom.roomCode || "-" }}</view>
          </view>
          <view class="btn ghost" @click="onReconnectLast">一键重连上次房间</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from "vue";

interface PartyGameRoomMember {
  memberId: string;
  userId: string;
  studentNo: string;
  nickname: string;
  online: boolean;
  isHost: boolean;
}

interface PartyGameLastRoom {
  roomId: string;
  roomCode: string;
  title: string;
  updatedAt: string;
}

withDefaults(
  defineProps<{
    connected: boolean;
    roomId: string;
    roomCode: string;
    roomStatusLabel: string;
    metaText: string;
    members: PartyGameRoomMember[];
    roomTitleInput: string;
    joinCodeInput: string;
    recentRoomCodes: string[];
    lastRoom: PartyGameLastRoom | null;
  }>(),
  {},
);

const emit = defineEmits<{
  (event: "update:roomTitleInput", value: string): void;
  (event: "update:joinCodeInput", value: string): void;
  (event: "create"): void;
  (event: "join"): void;
  (event: "refresh"): void;
  (event: "leave"): void;
  (event: "copy"): void;
  (event: "pickRecentCode", value: string): void;
  (event: "reconnectLast"): void;
}>();

const dialogVisible = ref(false);

const openDialog = () => {
  dialogVisible.value = true;
};

const closeDialog = () => {
  dialogVisible.value = false;
};

const onRoomTitleInput = (event: unknown) => {
  const payload = event as { detail?: { value?: string } };
  emit("update:roomTitleInput", String(payload?.detail?.value || ""));
};

const onJoinCodeInput = (event: unknown) => {
  const payload = event as { detail?: { value?: string } };
  emit("update:joinCodeInput", String(payload?.detail?.value || ""));
};

const onRefresh = () => {
  emit("refresh");
};

const onLeave = () => {
  emit("leave");
};

const onCreate = () => {
  emit("create");
  closeDialog();
};

const onJoin = () => {
  emit("join");
  closeDialog();
};

const onReconnectLast = () => {
  emit("reconnectLast");
  closeDialog();
};
</script>

<style scoped>
.pg-card {
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

.action-row {
  margin-top: 12rpx;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
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

.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 70;
  background: color-mix(in srgb, #000000 45%, transparent 55%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24rpx;
}

.dialog-card {
  width: 100%;
  max-width: 640rpx;
  border-radius: 18rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  padding: 18rpx;
}

.dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.dialog-close {
  width: 42rpx;
  height: 42rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  color: var(--text-sub);
  font-size: 28rpx;
  line-height: 40rpx;
  text-align: center;
}

.dialog-block {
  margin-top: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.label {
  font-size: 22rpx;
  color: var(--text-main);
}

.text-input {
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

.recent-wrap {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.recent-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

.recent-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.recent-chip {
  min-width: 96rpx;
  border-radius: 999rpx;
  border: 1rpx solid var(--line);
  background: color-mix(in srgb, var(--muted-bg) 82%, var(--card-bg) 18%);
  color: var(--text-main);
  font-size: 20rpx;
  text-align: center;
  padding: 8rpx 12rpx;
}

.last-room {
  border: 1rpx solid var(--line);
  border-radius: 12rpx;
  background: color-mix(in srgb, var(--muted-bg) 82%, var(--card-bg) 18%);
  padding: 10rpx 12rpx;
}

.last-room-line {
  font-size: 20rpx;
  color: var(--text-main);
}

.last-room-line + .last-room-line {
  margin-top: 4rpx;
}
</style>
