<template>
  <view class="pg-card">
    <view class="row-head">
      <view class="title">房间玩家（{{ players.length }}/{{ maxPlayers }}）</view>
      <view class="desc">建议 {{ minPlayers }}-{{ maxPlayers }} 人</view>
    </view>

    <view class="input-row">
      <input
        class="player-input"
        :value="newPlayerName"
        :maxlength="16"
        placeholder="输入玩家昵称"
        placeholder-class="player-input-ph"
        @input="onPlayerInput"
      />
      <view class="btn" @click="emit('add')">添加</view>
    </view>

    <view class="player-list">
      <view v-for="item in players" :key="item.id" class="player-chip" :class="{ dead: !item.alive }" @click="emit('toggleAlive', item.id)">
        <text class="player-name">{{ item.name }}</text>
        <text class="player-state">{{ item.alive ? "在场" : "出局" }}</text>
        <text v-if="!started" class="player-remove" @click.stop="emit('remove', item.id)">×</text>
      </view>
    </view>

    <view class="action-row">
      <view class="btn ghost" @click="emit('shuffle')">随机顺序</view>
      <view class="btn ghost" @click="emit('reset')">重置玩家</view>
      <view class="btn primary" :class="{ disabled: startDisabled }" @click="onStart">{{ startText }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { PartyGamePlayer } from "../composables/usePartyGamePlayers";

const props = withDefaults(
  defineProps<{
    players: PartyGamePlayer[];
    newPlayerName: string;
    minPlayers: number;
    maxPlayers: number;
    started: boolean;
    startDisabled?: boolean;
    startText?: string;
  }>(),
  {
    startDisabled: false,
    startText: "开始对局",
  },
);

const emit = defineEmits<{
  (event: "update:newPlayerName", value: string): void;
  (event: "add"): void;
  (event: "remove", playerId: string): void;
  (event: "toggleAlive", playerId: string): void;
  (event: "shuffle"): void;
  (event: "reset"): void;
  (event: "start"): void;
}>();

const onPlayerInput = (event: unknown) => {
  const payload = event as { detail?: { value?: string } };
  emit("update:newPlayerName", String(payload?.detail?.value || ""));
};

const onStart = () => {
  if (props.startDisabled) {
    return;
  }
  emit("start");
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
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
}

.title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-main);
}

.desc {
  font-size: 22rpx;
  color: var(--text-sub);
}

.input-row {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.player-input {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  background: var(--card-bg);
  color: var(--text-main);
  font-size: 24rpx;
  padding: 0 16rpx;
  box-sizing: border-box;
}

.player-input-ph {
  color: color-mix(in srgb, var(--text-sub) 72%, #ffffff 28%);
}

.player-list {
  margin-top: 12rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
}

.player-chip {
  position: relative;
  min-width: 132rpx;
  border-radius: 10rpx;
  padding: 10rpx 12rpx;
  border: 1rpx solid var(--line);
  background: color-mix(in srgb, var(--muted-bg) 86%, var(--card-bg) 14%);
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.player-chip.dead {
  opacity: 0.62;
  background: color-mix(in srgb, var(--danger-soft) 28%, var(--card-bg) 72%);
}

.player-name {
  font-size: 23rpx;
  color: var(--text-main);
}

.player-state {
  font-size: 20rpx;
  color: var(--text-sub);
}

.player-remove {
  margin-left: auto;
  width: 28rpx;
  height: 28rpx;
  border-radius: 999rpx;
  background: color-mix(in srgb, var(--danger) 16%, var(--card-bg) 84%);
  color: var(--danger);
  font-size: 20rpx;
  text-align: center;
  line-height: 28rpx;
}

.action-row {
  margin-top: 14rpx;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
}

.btn {
  height: 62rpx;
  border-radius: 12rpx;
  border: 1rpx solid color-mix(in srgb, var(--accent) 24%, var(--line) 76%);
  background: color-mix(in srgb, var(--card-bg) 88%, var(--accent) 12%);
  color: var(--accent);
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
  opacity: 0.45;
}
</style>
