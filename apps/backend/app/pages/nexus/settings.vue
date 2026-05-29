<template>
  <NexusAdminShell title="Settings" description="运行状态、API 元信息与本地 smoke 入口。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Health</span>
        <strong>{{ healthOk ? "OK" : "--" }}</strong>
        <p>服务健康检查</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">API</span>
        <strong>{{ apiOk ? "v1" : "--" }}</strong>
        <p>/api/v1 元信息</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Routes</span>
        <strong>3</strong>
        <p>/ · /nexus · /api</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Admin</span>
        <strong>shadcn</strong>
        <p>内置后台 UI 风格</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="settings-grid">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>Health</h2>
            <p>兼容 `/health` 与新 `/api/health`。</p>
          </div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </header>
        <pre class="rx-json">{{ toJson(health) }}</pre>
      </article>

      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>API Root</h2>
            <p>`/api/v1` 只返回 JSON，不承载页面。</p>
          </div>
        </header>
        <pre class="rx-json">{{ toJson(apiRoot) }}</pre>
      </article>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>后台入口约束</h2>
          <p>后续 UI 只在 backend Nuxt 内迭代，独立 CMS 架构已经移除。</p>
        </div>
      </header>
      <div class="boundary-list">
        <div><strong>/</strong><span>主 Dashboard</span></div>
        <div><strong>/nexus/**</strong><span>后台兼容路径</span></div>
        <div><strong>/api/**</strong><span>接口 / JSON / webhook only</span></div>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

const { ensureSessionToken, request, requestRaw, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const health = ref<Record<string, unknown>>({});
const apiRoot = ref<Record<string, unknown>>({});
const healthOk = computed(() => Boolean(Object.keys(health.value || {}).length));
const apiOk = computed(() => Boolean(Object.keys(apiRoot.value || {}).length));

const toJson = (value: unknown) => JSON.stringify(value || {}, null, 2);

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const [healthData, apiData] = await Promise.all([
      requestRaw<Record<string, unknown>>("/api/health"),
      request<Record<string, unknown>>("/api/v1"),
    ]);
    health.value = healthData;
    apiRoot.value = apiData;
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载设置失败";
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  if (!ensureSessionToken()) {
    await goToLogin();
    return;
  }
  await loadData();
});
</script>

<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.boundary-list {
  display: grid;
  gap: 0.65rem;
}

.boundary-list div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.2rem);
}

.boundary-list span {
  color: hsl(var(--muted-foreground));
}

@media (max-width: 900px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
