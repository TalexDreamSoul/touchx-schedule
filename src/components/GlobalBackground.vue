<template>
  <view class="global-bg-layer">
    <image class="global-bg-image" :src="resolvedImageSrc" mode="aspectFill" :style="imageStyle" />
    <view class="global-bg-mask" :style="maskStyle" />
  </view>
</template>

<script setup lang="ts">
import { computed } from "vue";

const DEFAULT_BACKGROUND_SRC = "/static/background.png";
const DEFAULT_BACKGROUND_MASK_COLOR = "var(--bg)";
const DEFAULT_BACKGROUND_MASK_OPACITY = "0.25";

const props = withDefaults(
  defineProps<{
    imageSrc?: string;
    blurEnabled?: boolean;
    blurRadius?: number;
    maskColor?: string;
  }>(),
  {
    imageSrc: DEFAULT_BACKGROUND_SRC,
    blurEnabled: true,
    blurRadius: 24,
    maskColor: DEFAULT_BACKGROUND_MASK_COLOR,
  },
);

const resolvedImageSrc = computed(() => {
  const src = String(props.imageSrc || "").trim();
  return src || DEFAULT_BACKGROUND_SRC;
});

const isDefaultBackgroundImage = computed(() => resolvedImageSrc.value === DEFAULT_BACKGROUND_SRC);

const imageStyle = computed(() => {
  if (!props.blurEnabled) {
    return {
      transform: "scale(1)",
      filter: "none",
      opacity: isDefaultBackgroundImage.value ? "0.3" : "1",
    };
  }
  const blurRadius = Math.max(0, Number(props.blurRadius || 0));
  const scale = blurRadius > 0 ? 1.12 : 1;
  return {
    transform: `scale(${scale})`,
    filter: `blur(${blurRadius}px)`,
    opacity: isDefaultBackgroundImage.value ? "0.3" : "1",
  };
});

const maskStyle = computed(() => {
  const color = String(props.maskColor || "").trim() || DEFAULT_BACKGROUND_MASK_COLOR;
  const useDefaultBgOpacity = /^var\(\s*--bg\s*\)$/i.test(color);
  return {
    background: color,
    opacity: useDefaultBgOpacity ? DEFAULT_BACKGROUND_MASK_OPACITY : "1",
  };
});
</script>

<style scoped>
.global-bg-layer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.global-bg-image {
  width: 100%;
  height: 100%;
  transition:
    filter 220ms cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 180ms linear;
}

.global-bg-mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  transition: background 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 180ms linear;
}
</style>
