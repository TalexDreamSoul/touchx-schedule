<template>
  <div class="nexus-init" :data-theme="theme">
    <div class="init-wrap">
      <form class="init-card" @submit.prevent="onSubmit">
        <header class="init-head">
          <div class="head-row">
            <p class="brand-mark">ScheduleNexus</p>
            <button class="theme-btn" type="button" @click="toggleTheme">
              {{ theme === "dark" ? "浅色" : "深色" }}
            </button>
          </div>
          <h1>首次初始化</h1>
          <p class="head-desc">管理员学号 {{ bootstrapStudentNo || "未识别" }}，请设置后台登录密码</p>
        </header>

        <div class="init-body">
          <label class="field">
            <span>新密码</span>
            <input
              v-model.trim="password"
              type="password"
              placeholder="至少 6 位"
              autocomplete="new-password"
              required
            />
          </label>
          <label class="field">
            <span>确认密码</span>
            <input
              v-model.trim="confirmPassword"
              type="password"
              placeholder="再次输入密码"
              autocomplete="new-password"
              required
            />
          </label>

          <button type="submit" class="submit-btn" :disabled="pending">
            {{ pending ? "保存中..." : "完成初始化并进入后台" }}
          </button>

          <p v-if="errorText" class="error-text">{{ errorText }}</p>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { buildNexusLoginPath, clearNexusSessionToken, getNexusSessionToken } from "../../utils/nexus-auth";
import { getPreferredNexusTheme, setNexusTheme, type NexusThemeMode } from "../../utils/nexus-theme";

interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    message?: string;
  };
}

const route = useRoute();
const theme = ref<NexusThemeMode>("dark");
const pending = ref(false);
const errorText = ref("");
const password = ref("");
const confirmPassword = ref("");
const bootstrapStudentNo = ref("");

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
  setNexusTheme(theme.value);
};

const getSessionTokenOrRedirect = async () => {
  const token = getNexusSessionToken();
  if (!token) {
    await navigateTo(buildNexusLoginPath(route.fullPath), { replace: true });
    return "";
  }
  return token;
};

const loadInitContext = async () => {
  const token = await getSessionTokenOrRedirect();
  if (!token) {
    return;
  }
  try {
    const response = await fetch("/api/v1/admin/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "omit",
    });
    const payload = (await response.json()) as ApiEnvelope<{
      user?: {
        studentNo?: string;
      };
      needInit?: boolean;
      bootstrapStudentNo?: string;
    }>;
    if (!response.ok || !payload.ok) {
      throw new Error(String(payload?.error?.message || `HTTP ${response.status}`).trim() || "会话无效");
    }
    const needInit = Boolean(payload?.data?.needInit);
    if (!needInit) {
      await navigateTo("/nexus", { replace: true });
      return;
    }
    bootstrapStudentNo.value = String(payload?.data?.bootstrapStudentNo || payload?.data?.user?.studentNo || "").trim();
  } catch {
    clearNexusSessionToken();
    await navigateTo(buildNexusLoginPath(route.fullPath), { replace: true });
  }
};

const onSubmit = async () => {
  if (!password.value.trim()) {
    errorText.value = "请输入新密码";
    return;
  }
  if (password.value.trim().length < 6) {
    errorText.value = "密码至少 6 位";
    return;
  }
  if (!confirmPassword.value.trim()) {
    errorText.value = "请再次输入密码";
    return;
  }
  if (password.value.trim() !== confirmPassword.value.trim()) {
    errorText.value = "两次输入密码不一致";
    return;
  }
  const token = await getSessionTokenOrRedirect();
  if (!token) {
    return;
  }
  pending.value = true;
  errorText.value = "";
  try {
    const response = await fetch("/api/v1/admin/init-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "omit",
      body: JSON.stringify({
        password: password.value,
        confirmPassword: confirmPassword.value,
      }),
    });
    const payload = (await response.json()) as ApiEnvelope;
    if (!response.ok || !payload.ok) {
      throw new Error(String(payload?.error?.message || `HTTP ${response.status}`).trim() || "初始化失败");
    }
    await navigateTo("/nexus", { replace: true });
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "初始化失败";
  } finally {
    pending.value = false;
  }
};

onMounted(async () => {
  theme.value = getPreferredNexusTheme();
  await loadInitContext();
});
</script>

<style scoped>
.nexus-init {
  min-height: 100vh;
  transition: background-color 0.2s ease, color 0.2s ease;
  background: var(--bg);
  color: var(--text);
}

.nexus-init[data-theme="dark"] {
  --bg: #070707;
  --text: #f5f5f5;
  --panel: #0f0f0f;
  --panel-soft: #141414;
  --border: rgba(255, 255, 255, 0.14);
  --muted: rgba(255, 255, 255, 0.64);
  --muted-strong: rgba(255, 255, 255, 0.84);
  --input-bg: #090909;
  --input-text: #f6f6f6;
  --input-border: rgba(255, 255, 255, 0.2);
  --button-text: #0d0d0d;
  --button-bg: #fafafa;
  --error: #ff8d8d;
}

.nexus-init[data-theme="light"] {
  --bg: #f4f4f4;
  --text: #111111;
  --panel: #fbfbfb;
  --panel-soft: #f5f5f5;
  --border: rgba(10, 10, 10, 0.16);
  --muted: rgba(17, 17, 17, 0.6);
  --muted-strong: rgba(17, 17, 17, 0.82);
  --input-bg: #ffffff;
  --input-text: #111111;
  --input-border: rgba(10, 10, 10, 0.2);
  --button-text: #ffffff;
  --button-bg: #111111;
  --error: #cb2a2a;
}

.init-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
}

.init-card {
  width: 100%;
  max-width: 27rem;
  border: 0.0625rem solid var(--border);
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-soft) 100%);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.15);
}

.init-head {
  display: grid;
  gap: 0.5rem;
  border-bottom: 0.0625rem solid var(--border);
  padding: 1rem;
}

.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand-mark {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.18rem;
  font-size: 0.625rem;
  color: var(--muted);
}

.theme-btn {
  border: 0.0625rem solid var(--border);
  background: transparent;
  color: var(--muted-strong);
  font-size: 0.6875rem;
  line-height: 1;
  padding: 0.375rem 0.625rem;
  cursor: pointer;
}

.init-head h1 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1;
}

.head-desc {
  margin: 0;
  font-size: 0.75rem;
  color: var(--muted);
}

.init-body {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}

.field {
  display: grid;
  gap: 0.375rem;
}

.field span {
  font-size: 0.75rem;
  color: var(--muted-strong);
}

.field input {
  width: 100%;
  border: 0.0625rem solid var(--input-border);
  background: var(--input-bg);
  color: var(--input-text);
  padding: 0.625rem 0.75rem;
  font-size: 0.8125rem;
}

.submit-btn {
  width: 100%;
  border: 0;
  background: var(--button-bg);
  color: var(--button-text);
  padding: 0.625rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-text {
  margin: 0;
  font-size: 0.75rem;
  color: var(--error);
}
</style>
