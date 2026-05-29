<template>
  <NexusAdminShell
    title="Dashboard"
    eyebrow="TouchX Admin"
    description="统一后台入口：接口只走 /api/**，页面统一在 / 与 /nexus/**。"
    @refresh="loadData"
  >
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Users</span>
        <strong>{{ stats.users }}</strong>
        <p>账号与学生身份总数</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Sources</span>
        <strong>{{ stats.calendarSources }}</strong>
        <p>可订阅日程源</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Deliveries</span>
        <strong>{{ stats.pendingDeliveries }}</strong>
        <p>等待投递通知</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Imports</span>
        <strong>{{ stats.pendingImports }}</strong>
        <p>待审核候选导入</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="dashboard-grid">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>快捷操作</h2>
            <p>Backend 内置管理台是唯一后台入口，独立 CMS 已移除。</p>
          </div>
        </header>
        <div class="quick-grid">
          <NuxtLink v-for="item in quickLinks" :key="item.to" class="quick-link" :to="item.to">
            <span>{{ item.label }}</span>
            <small>{{ item.hint }}</small>
          </NuxtLink>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>系统边界</h2>
            <p>保持路由和架构简洁，后续 UI 统一按 shadcn 风格推进。</p>
          </div>
          <span class="rx-pill">shadcn</span>
        </header>
        <div class="boundary-list">
          <div><strong>/</strong><span>主后台 Dashboard</span></div>
          <div><strong>/nexus/**</strong><span>后台页面兼容路径</span></div>
          <div><strong>/api/**</strong><span>JSON / webhook / API only</span></div>
        </div>
      </article>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>最近审计</h2>
          <p>关键管理动作会在这里留下操作轨迹。</p>
        </div>
        <NuxtLink class="rx-btn rx-btn-ghost" to="/nexus/audit-logs">查看全部</NuxtLink>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>时间</th><th>操作</th><th>操作者</th></tr></thead>
          <tbody>
            <tr v-for="item in auditLogs" :key="item.id">
              <td>{{ toDisplayDate(item.createdAt) }}</td>
              <td><span class="rx-pill">{{ item.action }}</span></td>
              <td class="rx-muted">{{ item.actorUserId }}</td>
            </tr>
            <tr v-if="auditLogs.length <= 0"><td colspan="3" class="rx-muted">暂无审计日志</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "./NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface AuditLogRow {
  id: string;
  action: string;
  actorUserId: string;
  createdAt: string;
}

interface DashboardPayload {
  stats?: {
    users?: number;
    calendarSources?: number;
    pendingDeliveries?: number;
    pendingImports?: number;
  };
  recentAuditLogs?: AuditLogRow[];
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const stats = reactive({
  users: 0,
  calendarSources: 0,
  pendingDeliveries: 0,
  pendingImports: 0,
});
const auditLogs = ref<AuditLogRow[]>([]);

const quickLinks = [
  { to: "/nexus/users", label: "用户", hint: "账号与角色" },
  { to: "/nexus/classes", label: "班级", hint: "成员与加入码" },
  { to: "/nexus/calendar-sources", label: "日程源", hint: "发布与订阅" },
  { to: "/nexus/schedules", label: "课表", hint: "版本与订阅" },
  { to: "/nexus/imports", label: "导入中心", hint: "候选审核" },
  { to: "/nexus/notification-channels", label: "通知通道", hint: "ClawDBot / 飞书" },
];

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const loadData = async () => {
  if (loading.value) return;
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<DashboardPayload>("/api/v1/admin/dashboard");
    stats.users = Number(data.stats?.users || 0);
    stats.calendarSources = Number(data.stats?.calendarSources || 0);
    stats.pendingDeliveries = Number(data.stats?.pendingDeliveries || 0);
    stats.pendingImports = Number(data.stats?.pendingImports || 0);
    auditLogs.value = data.recentAuditLogs || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载 Dashboard 失败";
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
.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(20rem, 0.65fr);
  gap: 1rem;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.quick-link {
  display: grid;
  gap: 0.25rem;
  padding: 0.85rem;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.2rem);
  color: hsl(var(--foreground));
  text-decoration: none;
  background: hsl(var(--background));
}

.quick-link:hover {
  background: hsl(var(--muted) / 0.55);
}

.quick-link span {
  font-weight: 600;
}

.quick-link small,
.boundary-list span {
  color: hsl(var(--muted-foreground));
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

@media (max-width: 960px) {
  .dashboard-grid,
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
</style>
