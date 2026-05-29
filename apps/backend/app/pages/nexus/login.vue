<template>
  <div class="auth-root" :data-theme="theme">
    <section class="auth-panel">
      <div class="auth-aside">
        <NuxtLink class="auth-brand" to="/">
          <span>TX</span>
          <strong>TouchX Admin</strong>
        </NuxtLink>
        <div>
          <p class="auth-kicker">Admin Console</p>
          <h1>统一后台入口</h1>
          <p class="auth-copy">/api/** 只提供接口，后台页面统一收敛到 / 与 /nexus/**，UI 逐步统一为 shadcn 简约风格。</p>
        </div>
        <div class="auth-route-card">
          <span>/</span>
          <span>/nexus/**</span>
          <span>/api/**</span>
        </div>
      </div>

      <form class="auth-card" @submit.prevent="onSubmit">
        <header class="auth-head">
          <div>
            <p class="auth-kicker">Sign in</p>
            <h2>管理员登录</h2>
            <p>{{ passwordRequired ? "输入账号与密码进入后台" : "首次初始化：输入默认管理员账号即可进入初始化流程" }}</p>
          </div>
          <button class="auth-btn auth-btn-outline" type="button" @click="toggleTheme">
            {{ theme === "dark" ? "Light" : "Dark" }}
          </button>
        </header>

        <div class="auth-body">
          <label class="auth-field">
            <span>账号</span>
            <input v-model.trim="studentNo" placeholder="admin@schedule.com" autocomplete="username" required />
          </label>

          <label class="auth-field">
            <span>密码</span>
            <div class="auth-password">
              <input
                v-model.trim="password"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="passwordRequired ? '请输入管理登录密码' : '首次初始化可留空'"
                autocomplete="current-password"
                :required="passwordRequired"
              />
              <button type="button" @click="showPassword = !showPassword">{{ showPassword ? "隐藏" : "显示" }}</button>
            </div>
          </label>

          <button type="submit" class="auth-submit" :disabled="pending">
            {{ pending ? "登录中..." : "进入后台" }}
          </button>

          <p v-if="errorText" class="auth-error">{{ errorText }}</p>
          <p class="auth-hint">默认本地账号：{{ bootstrapStudentNo }} / 123456</p>
        </div>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { clearNexusSessionToken, getNexusSessionToken, resolveNexusRedirectPath, setNexusSessionToken } from "../../utils/nexus-auth";
import { getPreferredNexusTheme, setNexusTheme, type NexusThemeMode } from "../../utils/nexus-theme";

interface LoginEnvelope {
  ok: boolean;
  data?: {
    sessionToken?: string;
    needInit?: boolean;
    bootstrapStudentNo?: string;
    bootstrapAccountName?: string;
    user?: {
      studentNo?: string;
      accountName?: string;
    };
  };
  error?: {
    message?: string;
  };
}

interface BootstrapStatusEnvelope {
  ok: boolean;
  data?: {
    bootstrapStudentNo?: string;
    bootstrapAccountName?: string;
    passwordInitialized?: boolean;
    requirePassword?: boolean;
  };
  error?: {
    message?: string;
  };
}

const route = useRoute();
const studentNo = ref("");
const password = ref("");
const showPassword = ref(false);
const pending = ref(false);
const errorText = ref("");
const theme = ref<NexusThemeMode>("dark");
const redirectPath = computed(() => resolveNexusRedirectPath(route.query.redirect, "/"));
const bootstrapStudentNo = ref("admin@schedule.com");
const passwordRequired = ref(true);

const clearSession = () => {
  clearNexusSessionToken();
};

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
  setNexusTheme(theme.value);
};

const onSubmit = async () => {
  if (!studentNo.value.trim()) {
    errorText.value = "请输入管理员账号";
    return;
  }
  if (passwordRequired.value && !password.value.trim()) {
    errorText.value = "请输入登录密码";
    return;
  }
  pending.value = true;
  errorText.value = "";
  try {
    const response = await fetch("/api/v1/admin/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        studentNo: studentNo.value,
        password: password.value,
      }),
    });
    const payload = (await response.json()) as LoginEnvelope;
    if (!response.ok || !payload.ok) {
      throw new Error(String(payload?.error?.message || `HTTP ${response.status}`).trim() || "登录失败");
    }
    const sessionToken = String(payload?.data?.sessionToken || "").trim();
    if (!sessionToken) {
      throw new Error("会话 token 缺失");
    }
    setNexusSessionToken(sessionToken);
    const needInit = Boolean(payload?.data?.needInit);
    if (needInit) {
      await navigateTo("/nexus/init", { replace: true });
      return;
    }
    await navigateTo(redirectPath.value, { replace: true });
  } catch (error) {
    clearSession();
    errorText.value = error instanceof Error ? error.message : "登录失败";
  } finally {
    pending.value = false;
  }
};

const loadBootstrapStatus = async () => {
  try {
    const response = await fetch("/api/v1/admin/bootstrap-status", {
      method: "GET",
      credentials: "omit",
    });
    const payload = (await response.json()) as BootstrapStatusEnvelope;
    if (!response.ok || !payload.ok) {
      return;
    }
    const nextBootstrapStudentNo = String(payload?.data?.bootstrapAccountName || payload?.data?.bootstrapStudentNo || "").trim();
    const nextPasswordRequired = Boolean(payload?.data?.requirePassword ?? payload?.data?.passwordInitialized ?? true);
    if (nextBootstrapStudentNo) {
      bootstrapStudentNo.value = nextBootstrapStudentNo;
    }
    passwordRequired.value = nextPasswordRequired;
    if (!passwordRequired.value && !studentNo.value.trim()) {
      studentNo.value = bootstrapStudentNo.value;
    }
  } catch {
    passwordRequired.value = true;
  }
};

const tryAutoRedirectWithSession = async () => {
  const existed = getNexusSessionToken();
  if (!existed) {
    return;
  }
  pending.value = true;
  errorText.value = "";
  try {
    const response = await fetch("/api/v1/admin/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${existed}`,
      },
      credentials: "omit",
    });
    const payload = (await response.json()) as LoginEnvelope;
    if (!response.ok || !payload.ok) {
      throw new Error(String(payload?.error?.message || `HTTP ${response.status}`).trim() || "登录态无效");
    }
    if (Boolean(payload?.data?.needInit)) {
      await navigateTo("/nexus/init", { replace: true });
      return;
    }
    await navigateTo(redirectPath.value, { replace: true });
  } catch {
    clearSession();
  } finally {
    pending.value = false;
  }
};

onMounted(async () => {
  theme.value = getPreferredNexusTheme();
  await loadBootstrapStatus();
  await tryAutoRedirectWithSession();
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

.auth-panel {
  width: min(100%, 62rem);
  min-height: 36rem;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(23rem, 0.8fr);
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) + 0.35rem);
  overflow: hidden;
  background: hsl(var(--card));
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.12);
}

.auth-aside {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2rem;
  padding: 2rem;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.42);
}

.auth-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  color: hsl(var(--foreground));
  text-decoration: none;
}

.auth-brand span {
  display: grid;
  place-items: center;
  width: 2.3rem;
  height: 2.3rem;
  border-radius: calc(var(--radius) - 0.2rem);
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-weight: 700;
}

.auth-kicker {
  margin: 0 0 0.5rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.auth-aside h1,
.auth-head h2,
.auth-head p,
.auth-copy,
.auth-hint,
.auth-error {
  margin: 0;
}

.auth-aside h1 {
  max-width: 20rem;
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 0.95;
  letter-spacing: -0.07em;
}

.auth-copy {
  max-width: 28rem;
  margin-top: 1rem;
  color: hsl(var(--muted-foreground));
  line-height: 1.7;
}

.auth-route-card {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.auth-route-card span {
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  padding: 0.3rem 0.65rem;
  background: hsl(var(--background));
  font-size: 0.75rem;
}

.auth-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.25rem;
  padding: 2rem;
}

.auth-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.auth-head h2 {
  font-size: 1.5rem;
  letter-spacing: -0.04em;
}

.auth-head p,
.auth-hint {
  margin-top: 0.4rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  line-height: 1.5;
}

.auth-body {
  display: grid;
  gap: 0.85rem;
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

.auth-password {
  position: relative;
}

.auth-password input {
  padding-right: 4rem;
}

.auth-password button {
  position: absolute;
  right: 0.35rem;
  top: 0.35rem;
  height: calc(100% - 0.7rem);
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.3rem);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  cursor: pointer;
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

@media (max-width: 820px) {
  .auth-panel {
    grid-template-columns: 1fr;
  }

  .auth-aside {
    display: none;
  }
}
</style>
