<template>
  <NexusReactShell title="Audit Logs" @refresh="loadData">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>审计日志</h2>
          <p>追踪管理员和系统关键操作，用于 V1 管理后台审计。</p>
        </div>
        <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">
          {{ loading ? "加载中..." : "刷新" }}
        </button>
      </header>
      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>操作者</th>
              <th>载荷</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in logs" :key="item.id">
              <td>{{ toDisplayDate(item.createdAt) }}</td>
              <td><span class="rx-pill">{{ item.action }}</span></td>
              <td>{{ item.actorUserId }}</td>
              <td><pre class="rx-json">{{ stringifyPayload(item.payload) }}</pre></td>
            </tr>
            <tr v-if="logs.length <= 0"><td colspan="4" class="rx-muted">暂无审计日志</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusReactShell>
</template>

<script setup lang="ts">
import NexusReactShell from "../../components/nexus/NexusReactShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface AuditLogRow {
  id: string;
  action: string;
  actorUserId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const logs = ref<AuditLogRow[]>([]);

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const stringifyPayload = (payload: Record<string, unknown>) => JSON.stringify(payload || {}, null, 2);

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: AuditLogRow[] }>("/api/v1/admin/audit?limit=120");
    logs.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
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
.rx-json {
  max-width: 38rem;
  max-height: 12rem;
  overflow: auto;
  margin: 0;
  color: inherit;
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
}
</style>
