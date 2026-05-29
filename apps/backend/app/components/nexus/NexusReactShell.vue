<template>
  <main class="rx-root" :data-theme="theme">
    <header class="rx-topbar">
      <div>
        <p class="rx-kicker">TouchX CMS</p>
        <h1>{{ title }}</h1>
      </div>
      <div class="rx-actions">
        <button class="rx-btn rx-btn-ghost" type="button" @click="toggleTheme">
          {{ theme === "dark" ? "浅色" : "深色" }}
        </button>
        <button class="rx-btn rx-btn-ghost" type="button" @click="refresh">刷新</button>
        <button class="rx-btn" type="button" @click="goLegacy">Legacy CMS</button>
      </div>
    </header>

    <div class="rx-layout">
      <aside class="rx-sidebar">
        <div class="rx-brand-card">
          <span class="rx-dot" />
          <div>
            <strong>React 化迁移</strong>
            <p>shadcn/ui tokens · 黑白双色 · CMS 模块拆分</p>
          </div>
        </div>
        <nav class="rx-nav">
          <NuxtLink to="/nexus" class="rx-nav-link">总览</NuxtLink>
          <NuxtLink to="/nexus/calendar-sources" class="rx-nav-link">日程源</NuxtLink>
          <NuxtLink to="/nexus/personal-events" class="rx-nav-link">个人事项</NuxtLink>
          <NuxtLink to="/nexus/reminder-rules" class="rx-nav-link">提醒规则</NuxtLink>
          <NuxtLink to="/nexus/reminder-candidates" class="rx-nav-link">提醒候选</NuxtLink>
          <NuxtLink to="/nexus/notification-channels" class="rx-nav-link">通知通道</NuxtLink>
          <NuxtLink to="/nexus/notification-deliveries" class="rx-nav-link">投递记录</NuxtLink>
          <NuxtLink to="/nexus/imports" class="rx-nav-link">导入中心</NuxtLink>
          <NuxtLink to="/nexus/audit-logs" class="rx-nav-link">审计日志</NuxtLink>
          <NuxtLink to="/nexus/schedules" class="rx-nav-link">旧课表</NuxtLink>
        </nav>
      </aside>

      <section class="rx-main">
        <slot />
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { getPreferredNexusTheme, setNexusTheme, type NexusThemeMode } from "../../utils/nexus-theme";

withDefaults(
  defineProps<{
    title?: string;
  }>(),
  {
    title: "ScheduleNexus",
  },
);

const emit = defineEmits<{
  refresh: [];
}>();

const theme = ref<NexusThemeMode>("dark");

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
  setNexusTheme(theme.value);
};

const refresh = () => emit("refresh");
const goLegacy = async () => navigateTo("/nexus/schedules");

onMounted(() => {
  theme.value = getPreferredNexusTheme();
});
</script>

<style scoped>
.rx-root {
  min-height: 100vh;
  color: hsl(var(--foreground));
  background:
    radial-gradient(circle at top left, hsl(var(--muted) / 0.72), transparent 36rem),
    hsl(var(--background));
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --border: 240 5.9% 90%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --radius: 0.875rem;
}

.rx-root[data-theme="dark"] {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --border: 240 3.7% 15.9%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
}

.rx-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid hsl(var(--border));
  backdrop-filter: blur(18px) saturate(1.2);
  background: hsl(var(--background) / 0.78);
}

.rx-kicker,
.rx-topbar h1,
.rx-brand-card p {
  margin: 0;
}

.rx-kicker {
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.rx-topbar h1 {
  margin-top: 0.125rem;
  font-size: 1.125rem;
  font-weight: 650;
}

.rx-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.rx-layout {
  display: grid;
  grid-template-columns: 16rem minmax(0, 1fr);
  gap: 1rem;
  padding: 1rem;
  max-width: 118rem;
  margin: 0 auto;
}

.rx-sidebar {
  position: sticky;
  top: 5rem;
  align-self: start;
  display: grid;
  gap: 0.75rem;
}

.rx-brand-card,
:deep(.rx-card) {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card) / 0.82);
  box-shadow: 0 18px 50px rgb(0 0 0 / 0.08);
}

.rx-brand-card {
  display: flex;
  gap: 0.75rem;
  padding: 0.875rem;
}

.rx-brand-card p {
  margin-top: 0.25rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.8125rem;
  line-height: 1.45;
}

.rx-dot {
  width: 0.625rem;
  height: 0.625rem;
  margin-top: 0.3125rem;
  border-radius: 999px;
  background: hsl(var(--primary));
}

.rx-nav {
  display: grid;
  gap: 0.375rem;
}

.rx-nav-link {
  color: hsl(var(--muted-foreground));
  text-decoration: none;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.625rem 0.75rem;
  background: hsl(var(--card) / 0.62);
}

.rx-nav-link.router-link-active,
.rx-nav-link:hover {
  color: hsl(var(--foreground));
  border-color: hsl(var(--primary) / 0.4);
}

.rx-main {
  min-width: 0;
  display: grid;
  gap: 1rem;
}

.rx-btn,
:deep(.rx-btn) {
  border: 1px solid hsl(var(--primary));
  border-radius: calc(var(--radius) - 0.35rem);
  padding: 0.5rem 0.8rem;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 0.875rem;
  cursor: pointer;
}

.rx-btn-ghost,
:deep(.rx-btn-ghost) {
  border-color: hsl(var(--border));
  background: transparent;
  color: hsl(var(--foreground));
}

:deep(.rx-card) {
  padding: 1rem;
}

:deep(.rx-card-head) {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 1rem;
  margin-bottom: 1rem;
}

:deep(.rx-card h2) {
  margin: 0;
  font-size: 1rem;
}

:deep(.rx-card p) {
  color: hsl(var(--muted-foreground));
}

:deep(.rx-table-wrap) {
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.2rem);
}

:deep(.rx-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

:deep(.rx-table th),
:deep(.rx-table td) {
  text-align: left;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid hsl(var(--border));
  vertical-align: top;
}

:deep(.rx-table th) {
  color: hsl(var(--muted-foreground));
  font-weight: 500;
  background: hsl(var(--muted) / 0.42);
}

:deep(.rx-pill) {
  display: inline-flex;
  align-items: center;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  padding: 0.15rem 0.5rem;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

:deep(.rx-muted) {
  color: hsl(var(--muted-foreground));
}

:deep(.rx-grid) {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 900px) {
  .rx-layout {
    grid-template-columns: 1fr;
  }

  .rx-sidebar {
    position: static;
  }

  .rx-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  :deep(.rx-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
