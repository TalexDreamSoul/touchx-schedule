<template>
  <main class="nexus-root" :data-theme="theme">
    <aside class="nexus-sidebar" :class="{ 'is-open': sidebarOpen }">
      <NuxtLink to="/" class="nexus-brand" @click="closeSidebar">
        <span class="nexus-brand-mark">TX</span>
        <span>
          <strong>TouchX</strong>
          <small>Admin Console</small>
        </span>
      </NuxtLink>

      <div class="nexus-sidebar-scroll">
        <section v-for="group in navGroups" :key="group.label" class="nexus-nav-section">
          <p>{{ group.label }}</p>
          <nav class="nexus-nav">
            <NuxtLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="nexus-nav-link"
              :class="{ 'is-active': isActive(item) }"
              @click="closeSidebar"
            >
              <span>{{ item.label }}</span>
              <small>{{ item.hint }}</small>
            </NuxtLink>
          </nav>
        </section>
      </div>

      <div class="nexus-sidebar-footer">
        <p>API / 页面边界</p>
        <strong>/api/** JSON · / 页面</strong>
      </div>
    </aside>

    <div v-if="sidebarOpen" class="nexus-overlay" @click="closeSidebar" />

    <section class="nexus-workspace">
      <header class="nexus-topbar">
        <div class="nexus-title-row">
          <button class="nexus-icon-btn nexus-mobile-only" type="button" aria-label="打开导航" @click="sidebarOpen = true">☰</button>
          <div>
            <p class="nexus-kicker">{{ eyebrow }}</p>
            <h1>{{ title }}</h1>
            <p v-if="description" class="nexus-subtitle">{{ description }}</p>
          </div>
        </div>
        <div class="nexus-actions">
          <button class="nexus-btn nexus-btn-outline" type="button" @click="toggleTheme">
            {{ theme === "dark" ? "Light" : "Dark" }}
          </button>
          <button class="nexus-btn nexus-btn-outline" type="button" @click="refresh">刷新</button>
          <NuxtLink class="nexus-btn" to="/nexus/settings">设置</NuxtLink>
        </div>
      </header>

      <div class="nexus-content">
        <slot />
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { getPreferredNexusTheme, setNexusTheme, type NexusThemeMode } from "../../utils/nexus-theme";

interface NavItem {
  to: string;
  label: string;
  hint: string;
  aliases?: string[];
}

withDefaults(
  defineProps<{
    title?: string;
    eyebrow?: string;
    description?: string;
  }>(),
  {
    title: "Dashboard",
    eyebrow: "TouchX Admin",
    description: "",
  },
);

const emit = defineEmits<{
  refresh: [];
}>();

const route = useRoute();
const theme = ref<NexusThemeMode>("dark");
const sidebarOpen = ref(false);

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "运营台",
    items: [
      { to: "/", label: "总览", hint: "Dashboard", aliases: ["/nexus"] },
      { to: "/nexus/users", label: "用户", hint: "Users" },
      { to: "/nexus/classes", label: "班级", hint: "Classes" },
      { to: "/nexus/calendar-sources", label: "日程源", hint: "Sources" },
      { to: "/nexus/schedules", label: "课表", hint: "Schedules" },
      { to: "/nexus/personal-events", label: "个人事项", hint: "Todos" },
      { to: "/nexus/imports", label: "导入中心", hint: "Imports" },
      { to: "/nexus/schedule-import", label: "PDF 导入", hint: "Legacy import" },
      { to: "/nexus/foods", label: "食物", hint: "Foods" },
      { to: "/nexus/media", label: "媒体", hint: "Assets" },
      { to: "/nexus/bots", label: "机器人", hint: "Bots" },
      { to: "/nexus/campaigns", label: "投票活动", hint: "Campaigns" },
    ],
  },
  {
    label: "通知",
    items: [
      { to: "/nexus/reminder-rules", label: "提醒规则", hint: "Rules" },
      { to: "/nexus/reminder-candidates", label: "提醒候选", hint: "Candidates" },
      { to: "/nexus/notification-channels", label: "通知通道", hint: "Channels" },
      { to: "/nexus/notification-deliveries", label: "投递记录", hint: "Deliveries" },
    ],
  },
  {
    label: "系统",
    items: [
      { to: "/nexus/heart-open-word-bank", label: "心口难开", hint: "Word bank" },
      { to: "/nexus/preview", label: "联调预览", hint: "Preview" },
      { to: "/nexus/audit-logs", label: "审计日志", hint: "Audit" },
      { to: "/nexus/settings", label: "设置", hint: "Settings" },
    ],
  },
];

const isActive = (item: NavItem) => {
  const currentPath = route.path.replace(/\/$/, "") || "/";
  const targetPath = item.to.replace(/\/$/, "") || "/";
  const aliases = (item.aliases || []).map((alias) => alias.replace(/\/$/, "") || "/");
  return currentPath === targetPath || aliases.includes(currentPath);
};

const closeSidebar = () => {
  sidebarOpen.value = false;
};

const toggleTheme = () => {
  theme.value = theme.value === "dark" ? "light" : "dark";
  setNexusTheme(theme.value);
};

const refresh = () => emit("refresh");

onMounted(() => {
  theme.value = getPreferredNexusTheme();
});
</script>

<style scoped>
.nexus-root {
  min-height: 100vh;
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --ring: 240 5.9% 10%;
  --radius: 0.75rem;
  --shadow-soft: 0 1px 2px rgb(0 0 0 / 0.04);
}

.nexus-root[data-theme="dark"] {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --ring: 240 4.9% 83.9%;
}

.nexus-root,
.nexus-root * {
  box-sizing: border-box;
}

.nexus-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 40;
  width: 17.5rem;
  display: flex;
  flex-direction: column;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--background));
}

.nexus-brand {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  height: 4.5rem;
  padding: 0 1rem;
  color: hsl(var(--foreground));
  text-decoration: none;
  border-bottom: 1px solid hsl(var(--border));
}

.nexus-brand-mark {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: calc(var(--radius) - 0.2rem);
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-weight: 700;
  letter-spacing: -0.04em;
}

.nexus-brand strong,
.nexus-brand small {
  display: block;
}

.nexus-brand small,
.nexus-kicker,
.nexus-subtitle,
.nexus-nav-section p,
.nexus-nav-link small,
.nexus-sidebar-footer p,
:deep(.rx-muted),
:deep(.nexus-muted) {
  color: hsl(var(--muted-foreground));
}

.nexus-brand small {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  font-weight: 500;
}

.nexus-sidebar-scroll {
  flex: 1;
  overflow: auto;
  padding: 1rem 0.75rem;
}

.nexus-nav-section + .nexus-nav-section {
  margin-top: 1.25rem;
}

.nexus-nav-section p {
  margin: 0 0 0.5rem 0.75rem;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nexus-nav {
  display: grid;
  gap: 0.25rem;
}

.nexus-nav-link {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  min-height: 2.35rem;
  padding: 0.5rem 0.75rem;
  border-radius: calc(var(--radius) - 0.25rem);
  color: hsl(var(--muted-foreground));
  text-decoration: none;
  font-size: 0.875rem;
}

.nexus-nav-link:hover,
.nexus-nav-link.is-active {
  color: hsl(var(--foreground));
  background: hsl(var(--muted));
}

.nexus-nav-link small {
  font-size: 0.7rem;
}

.nexus-sidebar-footer {
  margin: 0.75rem;
  padding: 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.45);
}

.nexus-sidebar-footer p,
.nexus-sidebar-footer strong {
  margin: 0;
  font-size: 0.75rem;
}

.nexus-sidebar-footer strong {
  display: block;
  margin-top: 0.25rem;
  font-weight: 550;
}

.nexus-workspace {
  min-height: 100vh;
  margin-left: 17.5rem;
}

.nexus-topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  min-height: 4.5rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--background) / 0.92);
  backdrop-filter: blur(12px);
}

.nexus-title-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  min-width: 0;
}

.nexus-kicker,
.nexus-topbar h1,
.nexus-subtitle {
  margin: 0;
}

.nexus-kicker {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nexus-topbar h1 {
  margin-top: 0.125rem;
  font-size: 1.35rem;
  line-height: 1.15;
  letter-spacing: -0.035em;
}

.nexus-subtitle {
  margin-top: 0.2rem;
  max-width: 44rem;
  font-size: 0.84rem;
  line-height: 1.5;
}

.nexus-actions,
:deep(.rx-actions) {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.nexus-content {
  width: min(100%, 88rem);
  margin: 0 auto;
  padding: 1.5rem;
  display: grid;
  gap: 1rem;
}

.nexus-btn,
.nexus-icon-btn,
:deep(.rx-btn),
:deep(.nexus-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.25rem;
  border: 1px solid hsl(var(--primary));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.45rem 0.85rem;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.nexus-btn:hover,
:deep(.rx-btn:hover),
:deep(.nexus-btn:hover) {
  opacity: 0.88;
}

.nexus-btn:disabled,
:deep(.rx-btn:disabled),
:deep(.nexus-btn:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.nexus-btn-outline,
:deep(.rx-btn-ghost),
:deep(.nexus-btn-outline) {
  border-color: hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.nexus-icon-btn {
  width: 2.25rem;
  padding: 0;
  border-color: hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.nexus-mobile-only {
  display: none;
}

:deep(.rx-card),
:deep(.nexus-card) {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  box-shadow: var(--shadow-soft);
  padding: 1rem;
}

:deep(.rx-card-head),
:deep(.nexus-card-head) {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 1rem;
  margin-bottom: 1rem;
}

:deep(.rx-card h2),
:deep(.nexus-card h2) {
  margin: 0;
  font-size: 1rem;
  line-height: 1.25;
  letter-spacing: -0.02em;
}

:deep(.rx-card p),
:deep(.nexus-card p) {
  margin: 0.3rem 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
  line-height: 1.5;
}

:deep(.rx-grid),
:deep(.nexus-grid) {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}

:deep(.rx-pill),
:deep(.nexus-badge) {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border: 1px solid hsl(var(--border));
  border-radius: 999px;
  padding: 0.18rem 0.55rem;
  background: hsl(var(--muted) / 0.45);
  color: hsl(var(--foreground));
  font-size: 0.72rem;
  font-weight: 500;
  line-height: 1.2;
}

:deep(.nexus-badge-muted) {
  color: hsl(var(--muted-foreground));
  background: transparent;
}

:deep(.nexus-stat) {
  display: grid;
  gap: 0.5rem;
}

:deep(.nexus-stat strong) {
  display: block;
  margin-top: 0.25rem;
  font-size: 2rem;
  line-height: 1;
  letter-spacing: -0.055em;
}

:deep(.rx-table-wrap),
:deep(.nexus-table-wrap) {
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: calc(var(--radius) - 0.2rem);
}

:deep(.rx-table),
:deep(.nexus-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

:deep(.rx-table th),
:deep(.rx-table td),
:deep(.nexus-table th),
:deep(.nexus-table td) {
  text-align: left;
  padding: 0.75rem;
  border-bottom: 1px solid hsl(var(--border));
  vertical-align: top;
}

:deep(.rx-table th),
:deep(.nexus-table th) {
  color: hsl(var(--muted-foreground));
  font-weight: 500;
  background: hsl(var(--muted) / 0.45);
}

:deep(.rx-table tr:last-child td),
:deep(.nexus-table tr:last-child td) {
  border-bottom: 0;
}

:deep(.nexus-form),
:deep(.rule-form),
:deep(.candidate-form),
:deep(.personal-form) {
  display: grid;
  gap: 0.625rem;
}

:deep(.nexus-form input),
:deep(.nexus-form select),
:deep(.nexus-form textarea),
:deep(.rule-form input),
:deep(.rule-form select),
:deep(.candidate-form input),
:deep(.candidate-form select),
:deep(.personal-form input),
:deep(.personal-form select) {
  min-height: 2.5rem;
  width: 100%;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.55rem 0.75rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  outline: none;
}

:deep(.nexus-form input:focus),
:deep(.nexus-form select:focus),
:deep(.nexus-form textarea:focus),
:deep(.rule-form input:focus),
:deep(.rule-form select:focus),
:deep(.candidate-form input:focus),
:deep(.candidate-form select:focus),
:deep(.personal-form input:focus) {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.12);
}

:deep(.nexus-alert) {
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  background: hsl(var(--muted) / 0.45);
  color: hsl(var(--muted-foreground));
  font-size: 0.875rem;
}

:deep(.nexus-json),
:deep(.rx-json) {
  max-width: 38rem;
  max-height: 12rem;
  overflow: auto;
  margin: 0;
  color: inherit;
  font-size: 0.75rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

@media (max-width: 1100px) {
  :deep(.rx-grid),
  :deep(.nexus-grid) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .nexus-sidebar {
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }

  .nexus-sidebar.is-open {
    transform: translateX(0);
  }

  .nexus-overlay {
    position: fixed;
    inset: 0;
    z-index: 35;
    background: rgb(0 0 0 / 0.45);
  }

  .nexus-workspace {
    margin-left: 0;
  }

  .nexus-mobile-only {
    display: inline-flex;
  }

  .nexus-topbar {
    align-items: flex-start;
    padding: 0.75rem 1rem;
    flex-direction: column;
  }

  .nexus-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .nexus-content {
    padding: 1rem;
  }
}

@media (max-width: 640px) {
  :deep(.rx-grid),
  :deep(.nexus-grid) {
    grid-template-columns: 1fr;
  }

  :deep(.rx-card-head),
  :deep(.nexus-card-head) {
    flex-direction: column;
  }
}
</style>
