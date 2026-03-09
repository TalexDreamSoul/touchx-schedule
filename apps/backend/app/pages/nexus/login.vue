<template>
  <div class="nexus-login" :data-theme="theme">
    <div class="login-wrap">
      <form class="login-card" @submit.prevent="onSubmit">
        <header class="login-head">
          <div class="head-row">
            <p class="brand-mark">ScheduleNexus</p>
            <button class="theme-btn" type="button" @click="toggleTheme">
              {{ theme === "dark" ? "浅色" : "深色" }}
            </button>
          </div>
          <h1>管理员登录</h1>
          <p class="head-desc">{{ passwordRequired ? "输入学号与密码进入后台" : "首次初始化：输入默认管理员学号即可进入初始化流程" }}</p>
        </header>

        <div class="login-body">
          <label class="field">
            <span>学号</span>
            <input
              v-model.trim="studentNo"
              placeholder="例如 90000001"
              autocomplete="username"
              required
            />
          </label>

          <label class="field">
            <span>密码</span>
            <div class="password-box">
              <input
                v-model.trim="password"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="passwordRequired ? '请输入管理登录密码' : '首次初始化可留空'"
                autocomplete="current-password"
                :required="passwordRequired"
              />
              <button class="switch-btn" type="button" @click="showPassword = !showPassword">
                {{ showPassword ? "隐藏" : "显示" }}
              </button>
            </div>
          </label>

          <button
            type="submit"
            class="submit-btn"
            :disabled="pending"
          >
            {{ pending ? "登录中..." : "进入 ScheduleNexus" }}
          </button>

          <p v-if="errorText" class="error-text">{{ errorText }}</p>
        </div>
      </form>
    </div>
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
    user?: {
      studentNo?: string;
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
const redirectPath = computed(() => resolveNexusRedirectPath(route.query.redirect, "/nexus"));
const bootstrapStudentNo = ref("2305100613");
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
    errorText.value = "请输入管理员学号";
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
    const nextBootstrapStudentNo = String(payload?.data?.bootstrapStudentNo || "").trim();
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
.nexus-login {
  min-height: 100vh;
  transition: background-color 0.2s ease, color 0.2s ease;
  background: var(--bg);
  color: var(--text);
}

.nexus-login[data-theme="dark"] {
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

.nexus-login[data-theme="light"] {
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

.login-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 27rem;
  border: 0.0625rem solid var(--border);
  background: linear-gradient(180deg, var(--panel) 0%, var(--panel-soft) 100%);
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.15);
}

.login-head {
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

.login-head h1 {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1;
}

.head-desc {
  margin: 0;
  font-size: 0.75rem;
  color: var(--muted);
}

.login-body {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
}

.field {
  display: grid;
  gap: 0.25rem;
}

.field span {
  font-size: 0.6875rem;
  color: var(--muted-strong);
}

.field input {
  width: 100%;
  height: 2.5rem;
  border: 0.0625rem solid var(--input-border);
  background: var(--input-bg);
  color: var(--input-text);
  font-size: 0.8125rem;
  line-height: 1;
  padding: 0 0.75rem;
  outline: none;
}

.field input:focus {
  border-color: var(--muted-strong);
}

.password-box {
  position: relative;
}

.password-box .switch-btn {
  position: absolute;
  right: 0.375rem;
  top: 0.375rem;
  border: 0.0625rem solid var(--input-border);
  background: transparent;
  color: var(--muted-strong);
  height: 1.75rem;
  min-width: 2.75rem;
  font-size: 0.6875rem;
  cursor: pointer;
}

.submit-btn {
  height: 2.5rem;
  border: 0.0625rem solid var(--button-bg);
  background: var(--button-bg);
  color: var(--button-text);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-text {
  margin: 0;
  color: var(--error);
  font-size: 0.75rem;
  line-height: 1.3;
}

@media (prefers-reduced-motion: reduce) {
  .nexus-login {
    transition: none;
  }
}
</style>
