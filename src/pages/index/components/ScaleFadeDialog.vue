<template>
  <view
    v-if="mounted"
    class="scale-fade-dialog-mask"
    :class="{ 'is-open': opened }"
    :style="maskInlineStyle"
    @click="onMaskClick"
  >
    <slot :is-open="opened" />
  </view>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties } from "vue";

const props = withDefaults(
  defineProps<{
    show: boolean;
    durationMs?: number;
    zIndex?: number;
    closeOnMask?: boolean;
  }>(),
  {
    durationMs: 200,
    zIndex: 100,
    closeOnMask: true,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
}>();

const mounted = ref(props.show);
const opened = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const clearHideTimer = () => {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

const requestFrame = (cb: () => void) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(cb);
    return;
  }
  setTimeout(cb, 16);
};

const normalizeDurationMs = computed(() => {
  const value = Number(props.durationMs || 0);
  if (!Number.isFinite(value) || value < 0) {
    return 200;
  }
  return value;
});

const maskInlineStyle = computed<CSSProperties>(() => {
  return {
    "--scale-fade-dialog-duration": `${normalizeDurationMs.value}ms`,
    zIndex: String(props.zIndex),
  } as CSSProperties;
});

const onMaskClick = () => {
  if (props.closeOnMask) {
    emit("close");
  }
};

watch(
  () => props.show,
  async (nextValue) => {
    clearHideTimer();
    if (nextValue) {
      mounted.value = true;
      opened.value = false;
      await nextTick();
      requestFrame(() => {
        opened.value = true;
      });
      return;
    }

    opened.value = false;
    if (!mounted.value) {
      return;
    }
    hideTimer = setTimeout(() => {
      mounted.value = false;
      hideTimer = null;
    }, normalizeDurationMs.value);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearHideTimer();
});
</script>

<style scoped>
.scale-fade-dialog-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: var(--mask-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20rpx;
  opacity: 0;
  transition: opacity var(--scale-fade-dialog-duration, 200ms) ease;
}

.scale-fade-dialog-mask.is-open {
  opacity: 1;
}
</style>
