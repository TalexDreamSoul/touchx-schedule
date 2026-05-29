<template>
  <div class="auth-root" :data-theme="theme">
    <form class="init-card" @submit.prevent="onSubmit">
      <header class="init-head">
        <div>
          <p class="auth-kicker">Bootstrap</p>
          <h1>首次初始化</h1>
          <p>管理员账号 {{ bootstrapStudentNo || "未识别" }}，请设置后台登录密码。</p>
        </div>
        <button class="auth-btn auth-btn-outline" type="button" @click="toggleTheme">
          {{ theme === "dark" ? "Light" : "Dark" }}
        </button>
      </header>

      <div class="init-body">
        <label class="auth-field">
          <span>新密码</span>
          <input v-model.trim="password" type="password" placeholder="至少 6 位" autocomplete="new-password" required />
        </label>
        <label class="auth-field">
          <span>确认密码</span>
          <input v-model.trim="confirmPassword" type="password" placeholder="再次输入密码" autocomplete="new-password" required />
        </label>

        <button type="submit" class="auth-submit" :disabled="pending">
          {{ pending ? "保存中..." : "完成初始化并进入后台" }}
        </button>

        <p v-if="errorText" class="auth-error">{{ errorText }}</p>
      </div>
    </form>
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
        accountName?: string;
      };
      needInit?: boolean;
      bootstrapStudentNo?: string;
      bootstrapAccountName?: string;
    }>;
    if (!response.ok || !payload.ok) {
      throw new Error(String(payload?.error?.message || `HTTP ${response.status}`).trim() || "会话无效");
    }
    const needInit = Boolean(payload?.data?.needInit);
    if (!needInit) {
      await navigateTo("/", { replace: true });
      return;
    }
    bootstrapStudentNo.value = String(payload?.data?.bootstrapAccountName || payload?.data?.bootstrapStudentNo || payload?.data?.user?.accountName || payload?.data?.user?.studentNo || "").trim();
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
    await navigateTo("/", { replace: true });
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
.auth-root {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --destructive: 0 84.2% 60.2%;
  --radius: 0.75rem;
}

.auth-root[data-theme="dark"] {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --destructive: 0 72% 51%;
}

.auth-root * {
  box-sizing: border-box;
}

.init-card {
  width: min(100%, 29rem);
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) + 0.35rem);
  background: hsl(var(--card));
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.12);
}

.init-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  padding: 1.25rem;
  border-bottom: 1px solid hsl(var(--border));
}

.auth-kicker,
.init-head h1,
.init-head p,
.auth-error {
  margin: 0;
}

.auth-kicker {
  margin-bottom: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.init-head h1 {
  font-size: 1.5rem;
  line-height: 1;
  letter-spacing: -0.04em;
}

.init-head p {
  margin-top: 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  line-height: 1.5;
}

.init-body {
  display: grid;
  gap: 0.85rem;
  padding: 1.25rem;
}

.auth-field {
  display: grid;
  gap: 0.4rem;
}

.auth-field span {
  font-size: 0.82rem;
  font-weight: 500;
}

.auth-field input {
  width: 100%;
  min-height: 2.6rem;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 0.2rem);
  padding: 0 0.75rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  outline: none;
}

.auth-field input:focus {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.12);
}

.auth-btn,
.auth-submit {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 2.5rem;
  border: 1px solid hsl(var(--primary));
  border-radius: calc(var(--radius) - 0.2rem);
  padding: 0 0.9rem;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-weight: 550;
  cursor: pointer;
}

.auth-btn-outline {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  border-color: hsl(var(--border));
}

.auth-submit {
  width: 100%;
}

.auth-submit:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.auth-error {
  color: hsl(var(--destructive));
  font-size: 0.875rem;
}
</style>
