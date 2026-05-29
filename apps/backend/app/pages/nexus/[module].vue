<template>
  <NexusAdminShell title="Legacy Redirect" description="旧 Nexus 模块路径兼容层；已迁移模块会自动跳转到新页面。" @refresh="redirectToTarget">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>正在跳转</h2>
          <p>{{ targetPath ? `/${moduleKey} 已迁移到 ${targetPath}` : `未知模块：${moduleKey}` }}</p>
        </div>
        <NuxtLink class="rx-btn" :to="targetPath || '/'">{{ targetPath ? "打开新页面" : "返回总览" }}</NuxtLink>
      </header>
      <p class="rx-muted">/nexus/[module] 现在只保留兼容重定向，不再加载旧控制台。</p>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";

const route = useRoute();
const moduleKey = computed(() => String(route.params.module || "overview").trim().toLowerCase());

const migratedRoutes: Record<string, string> = {
  overview: "/",
  users: "/nexus/users",
  classes: "/nexus/classes",
  "calendar-sources": "/nexus/calendar-sources",
  schedules: "/nexus/schedules",
  "schedule-import": "/nexus/schedule-import",
  foods: "/nexus/foods",
  media: "/nexus/media",
  bots: "/nexus/bots",
  campaigns: "/nexus/campaigns",
  "heart-open-word-bank": "/nexus/heart-open-word-bank",
  "personal-events": "/nexus/personal-events",
  "reminder-rules": "/nexus/reminder-rules",
  "reminder-candidates": "/nexus/reminder-candidates",
  imports: "/nexus/imports",
  "notification-channels": "/nexus/notification-channels",
  "notification-deliveries": "/nexus/notification-deliveries",
  preview: "/nexus/preview",
  audit: "/nexus/audit-logs",
  "audit-logs": "/nexus/audit-logs",
  settings: "/nexus/settings",
  "react-roadmap": "/nexus/react-roadmap",
};

const targetPath = computed(() => migratedRoutes[moduleKey.value] || "");

const redirectToTarget = async () => {
  const target = targetPath.value || "/";
  if (target !== route.path) {
    await navigateTo(target, { replace: true });
  }
};

onMounted(redirectToTarget);
</script>
