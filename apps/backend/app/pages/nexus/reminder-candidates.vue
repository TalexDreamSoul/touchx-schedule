<template>
  <NexusReactShell title="Reminder Candidates" @refresh="loadData">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>提醒候选</h2>
          <p>由 EffectiveCalendarEvent + ReminderRule 计算，可入队 NotificationDelivery。</p>
        </div>
        <div>
          <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="enqueue">入队</button>
          <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="loadData">刷新</button>
        </div>
      </header>
      <div class="candidate-form">
        <input v-model.number="week" type="number" min="1" placeholder="week" />
        <input v-model.trim="date" placeholder="date YYYY-MM-DD 可空" />
      </div>
      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>事件</th><th>计划时间</th><th>提前</th><th>模板</th><th>内容</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td><strong>{{ item.title }}</strong><div class="rx-muted">{{ item.eventId }}</div></td>
              <td>{{ toDisplayDate(item.scheduledAt) }}</td>
              <td>{{ item.offsetMinutes }} 分钟</td>
              <td>{{ item.templateKey }}</td>
              <td class="rx-muted">{{ item.body }}</td>
            </tr>
            <tr v-if="items.length <= 0"><td colspan="5" class="rx-muted">暂无提醒候选</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusReactShell>
</template>

<script setup lang="ts">
import NexusReactShell from "../../components/nexus/NexusReactShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface CandidateRow {
  id: string;
  eventId: string;
  scheduledAt: string;
  offsetMinutes: number;
  templateKey: string;
  title: string;
  body: string;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const items = ref<CandidateRow[]>([]);
const week = ref<number | undefined>(undefined);
const date = ref("");

const queryString = () => {
  const params = new URLSearchParams();
  if (week.value) params.set("week", String(week.value));
  if (date.value.trim()) params.set("date", date.value.trim());
  const text = params.toString();
  return text ? `?${text}` : "";
};

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: CandidateRow[] }>(`/api/v1/calendar/me/reminder-candidates${queryString()}`);
    items.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
};

const enqueue = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/calendar/me/reminder-candidates/enqueue", {
      method: "POST",
      body: { week: week.value, date: date.value, limit: 50 },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "入队失败";
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
.candidate-form { display: flex; gap: .5rem; margin-bottom: 1rem; }
.candidate-form input { border: 1px solid hsl(var(--border)); border-radius: .7rem; padding: .55rem .7rem; background: transparent; color: hsl(var(--foreground)); }
</style>
