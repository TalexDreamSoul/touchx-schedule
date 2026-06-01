<template>
  <NexusAdminShell title="Personal Events" @refresh="loadData">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>个人事项 / Todo</h2>
          <p>接入 `/api/v1/calendar/me/personal-events`，事项会进入有效日程合成。</p>
        </div>
        <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
      </header>
      <div class="rx-card" style="margin-bottom: 1rem">
        <div class="rx-card-head">
          <div>
            <h2>快速创建</h2>
            <p>创建到当前管理员账号，用于验证 Todo + Effective Calendar。</p>
          </div>
        </div>
        <div class="personal-form">
          <input v-model.trim="form.title" placeholder="标题，例如：完成英语作业" />
          <input v-model.trim="form.date" placeholder="日期 YYYY-MM-DD，可空" />
          <input v-model.number="form.weekday" type="number" min="1" max="7" placeholder="星期 1-7" />
          <input v-model.number="form.startSection" type="number" min="1" placeholder="开始节" />
          <button class="rx-btn" type="button" :disabled="loading || !form.title" @click="createEvent">创建</button>
        </div>
      </div>

      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>标题</th><th>来源</th><th>时间</th><th>优先级</th><th>标签</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td><strong>{{ item.title }}</strong><div class="rx-muted">{{ item.description }}</div></td>
              <td>{{ item.source }}</td>
              <td>{{ item.examDate || `周${item.day} 第${item.startSection}-${item.endSection}节` }}</td>
              <td>{{ item.priorityLabel }}</td>
              <td>{{ (item.tags || []).join(' / ') || '-' }}</td>
              <td>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="markDone(item.id)">完成</button>
                <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="archiveEvent(item.id)">归档</button>
              </td>
            </tr>
            <tr v-if="items.length <= 0"><td colspan="6" class="rx-muted">暂无个人事项</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface PersonalEventRow {
  id: string;
  title: string;
  description: string;
  source: string;
  day: number;
  startSection: number;
  endSection: number;
  priorityLabel: string;
  examDate: string;
  tags: string[];
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const items = ref<PersonalEventRow[]>([]);
const form = reactive({
  title: "",
  date: "",
  weekday: 1,
  startSection: 1,
});

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: PersonalEventRow[] }>("/api/v1/calendar/me/personal-events");
    items.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
};

const createEvent = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/calendar/me/personal-events", {
      method: "POST",
      body: {
        title: form.title,
        date: form.date,
        weekday: form.weekday,
        startSection: form.startSection,
        endSection: form.startSection,
        eventType: "todo",
        priority: "normal",
      },
    });
    form.title = "";
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建失败";
  } finally {
    loading.value = false;
  }
};

const markDone = async (id: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/calendar/me/personal-events/${encodeURIComponent(id)}/done`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "操作失败";
  } finally {
    loading.value = false;
  }
};

const archiveEvent = async (id: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/calendar/me/personal-events/${encodeURIComponent(id)}/delete`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "操作失败";
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
.personal-form {
  grid-template-columns: minmax(12rem, 1fr) 10rem 7rem 7rem auto;
}
@media (max-width: 900px) {
  .personal-form { grid-template-columns: 1fr; }
}
</style>
