<template>
  <view class="auth-dialog-mask" :class="{ 'is-open': show }" @click="emit('close')">
    <view class="auth-dialog-card" :class="{ 'is-open': show }" :style="cardInlineStyle" @click.stop>
      <view class="auth-dialog-grabber" />
      <view class="auth-dialog-icon-wrap">
        <view class="auth-dialog-icon">🛡</view>
      </view>
      <view class="auth-dialog-title">{{ title }}</view>
      <view class="auth-dialog-sub">{{ subtitle }}</view>
      <view v-if="showStudentNoInput" class="auth-dialog-input-wrap">
        <input
          class="auth-dialog-input"
          type="text"
          :maxlength="32"
          :placeholder="studentNoPlaceholder"
          :value="studentNoValue"
          confirm-type="done"
          :cursor-spacing="20"
          @input="onStudentNoInput"
        />
      </view>
      <view v-if="requireAgreement" class="auth-dialog-agreement" @click="toggleAgreement">
        <view class="auth-dialog-agreement-check" :class="{ checked: agreementChecked }">
          <text v-if="agreementChecked" class="auth-dialog-agreement-check-mark">✓</text>
        </view>
        <view class="auth-dialog-agreement-text">
          已阅读并同意《用户协议》与《隐私政策》
        </view>
      </view>
      <view v-if="hintText" class="auth-dialog-hint">{{ hintText }}</view>
      <button class="auth-dialog-primary" :disabled="confirmDisabled" @click="emit('confirm')">
        {{ pending ? pendingText : confirmText }}
      </button>
      <view class="auth-dialog-cancel" @click="emit('close')">{{ cancelText }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    show: boolean;
    pending?: boolean;
    hintText?: string;
    title?: string;
    subtitle?: string;
    confirmText?: string;
    pendingText?: string;
    cancelText?: string;
    showStudentNoInput?: boolean;
    studentNoValue?: string;
    studentNoPlaceholder?: string;
    requireStudentNo?: boolean;
    heightPercent?: number;
    requireAgreement?: boolean;
    agreementChecked?: boolean;
  }>(),
  {
    pending: false,
    hintText: "",
    title: "需要授权后继续",
    subtitle: "登录后即可继续使用当前功能。",
    confirmText: "去授权",
    pendingText: "处理中...",
    cancelText: "取消",
    showStudentNoInput: false,
    studentNoValue: "",
    studentNoPlaceholder: "请输入学号",
    requireStudentNo: false,
    heightPercent: 50,
    requireAgreement: false,
    agreementChecked: false,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "confirm"): void;
  (event: "update:studentNoValue", value: string): void;
  (event: "update:agreementChecked", value: boolean): void;
}>();

const isIosDevice = ref(false);
const keyboardHeightPx = ref(0);

type KeyboardHeightChangeResult = {
  height?: number;
};

type UniKeyboardApi = {
  onKeyboardHeightChange?: (callback: (result: KeyboardHeightChangeResult) => void) => void;
  offKeyboardHeightChange?: (callback: (result: KeyboardHeightChangeResult) => void) => void;
};

const handleKeyboardHeightChange = (result: KeyboardHeightChangeResult) => {
  if (!isIosDevice.value) {
    return;
  }
  const height = Number(result?.height || 0);
  keyboardHeightPx.value = height > 0 ? Math.floor(height) : 0;
};

const onStudentNoInput = (event: Event) => {
  const detail = (event as unknown as { detail?: { value?: string } }).detail;
  emit("update:studentNoValue", String(detail?.value || ""));
};

const toggleAgreement = () => {
  emit("update:agreementChecked", !props.agreementChecked);
};

const cardInlineStyle = computed(() => {
  const value = Number(props.heightPercent || 50);
  const safe = Math.min(100, Math.max(40, value));
  const keyboardOffset = keyboardHeightPx.value > 0 ? `${keyboardHeightPx.value}px` : "0px";
  return {
    height: `${safe}vh`,
    marginBottom: keyboardOffset,
  };
});

const confirmDisabled = computed(() => {
  const studentNoFilled = String(props.studentNoValue || "").trim() !== "";
  return Boolean(
    props.pending ||
      (props.requireAgreement && !props.agreementChecked) ||
      (props.showStudentNoInput && props.requireStudentNo && !studentNoFilled),
  );
});

watch(
  () => props.show,
  (show) => {
    if (!show) {
      keyboardHeightPx.value = 0;
    }
  },
);

onMounted(() => {
  try {
    const systemInfo = uni.getSystemInfoSync() as { uniPlatform?: string; platform?: string; system?: string };
    const platform = String(systemInfo.uniPlatform || systemInfo.platform || systemInfo.system || "").toLowerCase();
    isIosDevice.value = platform.includes("ios") || platform.includes("iphone");
  } catch (error) {
    isIosDevice.value = false;
  }
  const keyboardApi = uni as unknown as UniKeyboardApi;
  if (typeof keyboardApi.onKeyboardHeightChange === "function") {
    keyboardApi.onKeyboardHeightChange(handleKeyboardHeightChange);
  }
});

onUnmounted(() => {
  keyboardHeightPx.value = 0;
  const keyboardApi = uni as unknown as UniKeyboardApi;
  if (typeof keyboardApi.offKeyboardHeightChange === "function") {
    keyboardApi.offKeyboardHeightChange(handleKeyboardHeightChange);
  }
});
</script>

<style scoped>
.auth-dialog-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 300;
  background: var(--mask-bg, rgba(0, 0, 0, 0.45));
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.22s ease;
}

.auth-dialog-mask.is-open {
  opacity: 1;
  pointer-events: auto;
}

.auth-dialog-card {
  width: 100%;
  max-width: none;
  height: 50vh;
  border-radius: 32rpx 32rpx 0 0;
  background: var(--card-bg, #f8f9fc);
  padding: 24rpx 40rpx calc(36rpx + env(safe-area-inset-bottom));
  padding: 24rpx 40rpx calc(36rpx + constant(safe-area-inset-bottom));
  transform: translateY(115%);
  transition: transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
  box-sizing: border-box;
  overflow-y: auto;
}

.auth-dialog-card.is-open {
  transform: translateY(0);
}

.auth-dialog-grabber {
  width: 98rpx;
  height: 10rpx;
  border-radius: 999rpx;
  margin: 6rpx auto 39rpx;
  background: var(--line, #cfd6e5);
}

.auth-dialog-icon-wrap {
  width: 110rpx;
  height: 110rpx;
  border-radius: 999rpx;
  margin: 0 auto;
  background: var(--muted-bg, #d9e7fb);
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-dialog-icon {
  font-size: 52rpx;
  line-height: 1;
}

.auth-dialog-title {
  margin-top: 20rpx;
  text-align: center;
  font-size: 42rpx;
  font-weight: 700;
  color: var(--text-main, #17213a);
}

.auth-dialog-sub {
  margin-top: 12rpx;
  text-align: center;
  font-size: 28rpx;
  line-height: 1.5;
  color: var(--text-sub, #61708c);
}

.auth-dialog-input-wrap {
  margin-top: 18rpx;
}

.auth-dialog-input {
  width: 100%;
  box-sizing: border-box;
  border: 1rpx solid var(--line, #cfd6e5);
  border-radius: 18rpx;
  background: var(--card-bg, #ffffff);
  height: 84rpx;
  line-height: 84rpx;
  padding: 0 20rpx;
  font-size: 28rpx;
  color: var(--text-main, #17213a);
}

.auth-dialog-agreement {
  margin-top: 14rpx;
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}

.auth-dialog-agreement-check {
  width: 28rpx;
  height: 28rpx;
  border-radius: 8rpx;
  border: 1rpx solid var(--line, #bfc9da);
  background: var(--card-bg, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 3rpx;
}

.auth-dialog-agreement-check.checked {
  background: var(--accent, #2480e7);
  border-color: var(--accent, #2480e7);
}

.auth-dialog-agreement-check-mark {
  font-size: 20rpx;
  line-height: 1;
  color: #ffffff;
}

.auth-dialog-agreement-text {
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--text-sub, #61708c);
}

.auth-dialog-hint {
  margin-top: 12rpx;
  text-align: center;
  font-size: 24rpx;
  line-height: 1.5;
  color: var(--danger, #f56c6c);
}

.auth-dialog-primary {
  margin-top: 24rpx;
  border: 0;
  border-radius: 26rpx;
  height: 90rpx;
  line-height: 90rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: #ffffff;
  background: var(--accent, #2480e7);
}

.auth-dialog-primary[disabled] {
  opacity: 0.64;
}

.auth-dialog-cancel {
  margin-top: 16rpx;
  border-radius: 26rpx;
  height: 90rpx;
  line-height: 90rpx;
  text-align: center;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--text-main, #445066);
  background: var(--muted-bg, #dfe5ef);
}
</style>
