<template>
  <NexusAdminShell title="Bots" description="机器人模板、次日播报任务和 ClawDBot 联调入口。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Templates</span>
        <strong>{{ templates.length }}</strong>
        <p>机器人模板</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Enabled</span>
        <strong>{{ enabledTemplateCount }}</strong>
        <p>启用模板</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Jobs</span>
        <strong>{{ jobs.length }}</strong>
        <p>任务历史</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Selected</span>
        <strong>{{ form.id ? 1 : 0 }}</strong>
        <p>{{ form.key || "未选择" }}</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="bots-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>模板列表</h2>
            <p>编辑模板 key/title/body/enabled。</p>
          </div>
          <div class="rx-actions">
            <button class="rx-btn rx-btn-ghost" type="button" @click="newTemplate">新模板</button>
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
          </div>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>Key</th><th>标题</th><th>启用</th><th>更新时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in templates" :key="item.id">
                <td><strong>{{ item.key }}</strong><div class="rx-muted">{{ item.id }}</div></td>
                <td>{{ item.title }}</td>
                <td><span class="rx-pill">{{ item.enabled ? "enabled" : "disabled" }}</span></td>
                <td>{{ toDisplayDate(item.updatedAt) }}</td>
                <td><button class="rx-btn rx-btn-ghost" type="button" @click="selectTemplate(item)">编辑</button></td>
              </tr>
              <tr v-if="templates.length <= 0"><td colspan="5" class="rx-muted">暂无模板</td></tr>
            </tbody>
          </table>
        </div>
      </article>

      <aside class="side-stack">
        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>编辑模板</h2><p>{{ form.id || "新建模板" }}</p></div></header>
          <div class="nexus-form">
            <input v-model.trim="form.key" placeholder="key" />
            <input v-model.trim="form.title" placeholder="标题" />
            <textarea v-model.trim="form.body" rows="8" placeholder="模板 body" />
            <label class="check-row"><input v-model="form.enabled" type="checkbox" /><span>启用模板</span></label>
            <button class="rx-btn" type="button" :disabled="loading || !form.key || !form.title || !form.body" @click="saveTemplate">保存模板</button>
          </div>
        </article>

        <article class="rx-card">
          <header class="rx-card-head compact-head"><div><h2>触发次日任务</h2><p>生成 next-day broadcast job。</p></div></header>
          <div class="nexus-form">
            <label class="check-row"><input v-model="triggerForm.rainy" type="checkbox" /><span>rainy</span></label>
            <input v-model.trim="triggerForm.date" placeholder="date ISO，可空默认明天" />
            <button class="rx-btn" type="button" :disabled="loading" @click="triggerNextDayJob">触发任务</button>
          </div>
        </article>
      </aside>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>任务历史</h2>
          <p>最近 bot job 记录。</p>
        </div>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>任务</th><th>类型</th><th>状态</th><th>摘要</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="item in jobs" :key="item.id">
              <td><strong>{{ item.id }}</strong></td>
              <td>{{ item.type }}</td>
              <td><span class="rx-pill">{{ item.status }}</span></td>
              <td>{{ item.summary }}</td>
              <td>{{ toDisplayDate(item.createdAt) }}</td>
            </tr>
            <tr v-if="jobs.length <= 0"><td colspan="5" class="rx-muted">暂无任务历史</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface BotTemplateRow {
  id: string;
  key: string;
  title: string;
  body: string;
  enabled: boolean;
  updatedAt: string;
}

interface BotJobRow {
  id: string;
  type: string;
  status: string;
  summary: string;
  createdAt: string;
}

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const templates = ref<BotTemplateRow[]>([]);
const jobs = ref<BotJobRow[]>([]);
const form = reactive({ id: "", key: "", title: "", body: "", enabled: true });
const triggerForm = reactive({ rainy: false, date: "" });
const enabledTemplateCount = computed(() => templates.value.filter((item) => item.enabled).length);

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const applyForm = (item: BotTemplateRow) => {
  form.id = item.id || "";
  form.key = item.key || "";
  form.title = item.title || "";
  form.body = item.body || "";
  form.enabled = Boolean(item.enabled);
};

const selectTemplate = (item: BotTemplateRow) => applyForm(item);

const newTemplate = () => {
  form.id = "";
  form.key = "";
  form.title = "";
  form.body = "";
  form.enabled = true;
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const [templateData, jobData] = await Promise.all([
      request<{ items: BotTemplateRow[] }>("/api/v1/bot/templates"),
      request<{ items: BotJobRow[] }>("/api/v1/bot/jobs/history?limit=200"),
    ]);
    templates.value = templateData.items || [];
    jobs.value = jobData.items || [];
    if (!form.id && templates.value[0]) applyForm(templates.value[0]);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载机器人数据失败";
  } finally {
    loading.value = false;
  }
};

const saveTemplate = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/bot/templates", { method: "POST", body: { ...form, id: form.id || undefined } });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "保存模板失败";
  } finally {
    loading.value = false;
  }
};

const triggerNextDayJob = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await request("/api/v1/bot/jobs/trigger-next-day", {
      method: "POST",
      body: { rainy: triggerForm.rainy, date: triggerForm.date || undefined },
    });
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "触发任务失败";
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
.bots-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.35fr);
  gap: 1rem;
}

@media (max-width: 1080px) {
  .bots-layout {
    grid-template-columns: 1fr;
  }
}
</style>
