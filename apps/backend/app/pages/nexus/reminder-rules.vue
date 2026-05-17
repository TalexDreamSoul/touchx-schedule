<template>
  <NexusReactShell title="Reminder Rules" @refresh="loadData">
    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>提醒规则</h2>
          <p>ReminderRule 管理：目标、提前时间、模板和通道策略。</p>
        </div>
        <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="loadData">刷新</button>
      </header>

      <div class="rule-form">
        <select v-model="form.targetType">
          <option value="global">global</option>
          <option value="subscription">subscription</option>
          <option value="source_event">source_event</option>
          <option value="personal_event">personal_event</option>
        </select>
        <input v-model.trim="form.targetId" placeholder="targetId，global 可空" />
        <input v-model.number="form.offsetMinutes" type="number" min="0" placeholder="提前分钟" />
        <input v-model.trim="form.templateKey" placeholder="templateKey" />
        <select v-model="form.channelStrategy">
          <option value="primary_then_fallback">primary_then_fallback</option>
          <option value="primary_only">primary_only</option>
          <option value="both">both</option>
        </select>
        <button class="rx-btn" :disabled="loading" @click="saveRule">保存</button>
      </div>

      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>目标</th><th>提前</th><th>模板</th><th>策略</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in rules" :key="item.id">
              <td><strong>{{ item.targetType }}</strong><div class="rx-muted">{{ item.targetId }}</div></td>
              <td>{{ item.offsetMinutes }} 分钟</td>
              <td>{{ item.templateKey }}</td>
              <td>{{ item.channelStrategy }}</td>
              <td>{{ item.enabled ? '启用' : '停用' }}</td>
              <td>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="toggleRule(item)">{{ item.enabled ? '停用' : '启用' }}</button>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="removeRule(item.id)">删除</button>
              </td>
            </tr>
            <tr v-if="rules.length <= 0"><td colspan="6" class="rx-muted">暂无规则</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusReactShell>
</template>

<script setup lang="ts">
import NexusReactShell from "../../components/nexus/NexusReactShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

type TargetType = "subscription" | "source_event" | "personal_event" | "global";
type Strategy = "both" | "primary_then_fallback" | "primary_only";

interface RuleRow {
  id: string;
  targetType: TargetType;
  targetId: string;
  enabled: boolean;
  offsetMinutes: number;
  templateKey: string;
  channelStrategy: Strategy;
  quietHoursRespect: boolean;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const rules = ref<RuleRow[]>([]);
const form = reactive({
  targetType: "global" as TargetType,
  targetId: "",
  offsetMinutes: 15,
  templateKey: "calendar.event.reminder",
  channelStrategy: "primary_then_fallback" as Strategy,
});

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ items: RuleRow[] }>("/api/v1/admin/reminder-rules");
    rules.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
};

const saveRule = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/reminder-rules", { method: "POST", body: form });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存失败";
  } finally {
    loading.value = false;
  }
};

const toggleRule = async (item: RuleRow) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/admin/reminder-rules", { method: "POST", body: { ...item, enabled: !item.enabled } });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存失败";
  } finally {
    loading.value = false;
  }
};

const removeRule = async (id: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/reminder-rules/${encodeURIComponent(id)}/delete`, { method: "POST" });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "删除失败";
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
.rule-form {
  display: grid;
  grid-template-columns: 10rem minmax(12rem, 1fr) 8rem minmax(12rem, 1fr) 13rem auto;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.rule-form input,
.rule-form select {
  border: 1px solid hsl(var(--border));
  border-radius: 0.7rem;
  padding: 0.55rem 0.7rem;
  background: transparent;
  color: hsl(var(--foreground));
}
@media (max-width: 1000px) {
  .rule-form { grid-template-columns: 1fr; }
}
</style>
