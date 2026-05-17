<template>
  <NexusReactShell title="Import Center" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card">
        <span class="rx-pill">Legacy Jobs</span>
        <h2>{{ jobs.length }}</h2>
        <p>兼容读取旧 PDF schedule_import_jobs。</p>
      </article>
      <article class="rx-card">
        <span class="rx-pill">Candidate Jobs</span>
        <h2>{{ candidateJobs.length }}</h2>
        <p>新 ImportJob + ImportCandidateEvent 审核流。</p>
      </article>
      <article class="rx-card">
        <span class="rx-pill">Pending</span>
        <h2>{{ pendingCandidateCount }}</h2>
        <p>等待接受 / 拒绝 / 修正的候选事件。</p>
      </article>
      <article class="rx-card">
        <span class="rx-pill">Storage</span>
        <h2>{{ storage }}</h2>
        <p>{{ warning || "导入任务存储已配置" }}</p>
      </article>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>新建候选导入任务</h2>
          <p>用于验证 ImportCandidateEvent 审核流，后续接 PDF / OCR 解析结果。</p>
        </div>
      </header>
      <div class="candidate-form">
        <input v-model.trim="form.title" placeholder="事件标题" />
        <input v-model.trim="form.location" placeholder="地点" />
        <input v-model.number="form.weekday" type="number" min="1" max="7" placeholder="星期" />
        <input v-model.number="form.startSection" type="number" min="1" placeholder="开始节" />
        <input v-model.number="form.endSection" type="number" min="1" placeholder="结束节" />
        <select v-model="form.targetSourceId">
          <option value="">默认日程源</option>
          <option v-for="source in calendarSources" :key="source.id" :value="source.id">{{ source.title }}</option>
        </select>
        <select v-model="form.publishMode">
          <option value="publish">提交并发布</option>
          <option value="draft">提交为草稿</option>
        </select>
        <button class="rx-btn" type="button" :disabled="loading || !form.title" @click="createCandidateJob">创建</button>
      </div>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>候选导入任务</h2>
          <p>点击任务加载候选事件。</p>
        </div>
        <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
      </header>
      <p v-if="errorText" class="rx-muted">{{ errorText }}</p>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>任务</th><th>类型</th><th>状态</th><th>候选统计</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in candidateJobs" :key="item.id">
              <td><strong>{{ item.id }}</strong><div class="rx-muted">{{ item.rawText || '-' }}</div></td>
              <td>{{ item.type }}</td>
              <td><span class="rx-pill">{{ item.status }}</span></td>
              <td>{{ formatCandidateSummary(item.candidateSummary) }}</td>
              <td>{{ toDisplayDate(item.updatedAt) }}</td>
              <td><button class="rx-btn rx-btn-ghost" type="button" @click="loadCandidates(item.id)">候选</button></td>
            </tr>
            <tr v-if="candidateJobs.length <= 0"><td colspan="6" class="rx-muted">暂无候选导入任务</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>候选事件 {{ selectedJobId || '' }}</h2>
          <p>接受 / 拒绝 / 修正后，后续可提交到 CalendarSource 或 PersonalEvent。</p>
        </div>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>标题</th><th>时间</th><th>地点</th><th>置信度</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in candidates" :key="item.id">
              <td><strong>{{ item.title }}</strong><div class="rx-muted">{{ item.eventType }}</div></td>
              <td>{{ item.date || `周${item.weekday || '-'} 第${item.startSection || '-'}-${item.endSection || '-'}节` }}</td>
              <td>{{ item.location || '-' }}</td>
              <td>{{ Math.round((item.confidence || 0) * 100) }}%</td>
              <td><span class="rx-pill">{{ item.status }}</span></td>
              <td>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="updateCandidate(item.id, 'accept')">接受</button>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="updateCandidate(item.id, 'reject')">拒绝</button>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="updateCandidate(item.id, 'correct')">修正</button>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="commitPersonal(item.id)">提交个人事项</button>
                <button class="rx-btn rx-btn-ghost" :disabled="loading" @click="commitCalendar(item.id)">提交日程源</button>
              </td>
            </tr>
            <tr v-if="candidates.length <= 0"><td colspan="6" class="rx-muted">请选择任务查看候选事件</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rx-card">
      <header class="rx-card-head">
        <div>
          <h2>旧导入任务</h2>
          <p>PDF / 图片 / 文本 / 教务系统统一进入 ImportJob + Candidate 审核流。</p>
        </div>
        <NuxtLink class="rx-btn rx-btn-ghost" to="/nexus/schedule-import">打开旧 PDF 导入</NuxtLink>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>任务</th><th>状态</th><th>文件</th><th>成功</th><th>失败</th><th>创建人</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in jobs" :key="item.id || item.jobId">
              <td><strong>{{ item.id || item.jobId }}</strong><div class="rx-muted">{{ item.fileName || item.file_name || '-' }}</div></td>
              <td><span class="rx-pill">{{ item.status }}</span></td>
              <td>{{ item.totalFiles || item.total_files || 0 }}</td>
              <td>{{ item.successCount || item.success_count || 0 }}</td>
              <td>{{ item.failCount || item.fail_count || 0 }}</td>
              <td>{{ item.createdByUserId || item.created_by_user_id || '-' }}</td>
              <td>{{ toDisplayDate(item.updatedAt || item.updated_at) }}</td>
              <td><button class="rx-btn rx-btn-ghost" :disabled="loading" @click="convertLegacyJob(item.id || item.jobId)">转候选</button></td>
            </tr>
            <tr v-if="jobs.length <= 0"><td colspan="8" class="rx-muted">暂无旧导入任务</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusReactShell>
</template>

<script setup lang="ts">
import NexusReactShell from "../../components/nexus/NexusReactShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

const { ensureSessionToken, request, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const jobs = ref<any[]>([]);
const candidateJobs = ref<any[]>([]);
const calendarSources = ref<any[]>([]);
const candidates = ref<any[]>([]);
const selectedJobId = ref("");
const storage = ref("unknown");
const warning = ref("");
const form = reactive({ title: "", location: "", weekday: 1, startSection: 1, endSection: 1, targetSourceId: "", publishMode: "publish" });

const pendingCandidateCount = computed(() => candidateJobs.value.reduce((sum, item) => sum + Number(item?.candidateSummary?.pending || 0), 0));

const toDisplayDate = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : String(value || "");
};

const formatCandidateSummary = (summary: any) => {
  if (!summary) return "-";
  return `总 ${summary.total || 0} / 待 ${summary.pending || 0} / 收 ${summary.accepted || 0} / 拒 ${summary.rejected || 0} / 修 ${summary.corrected || 0}`;
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const [legacyData, candidateData, sourceData] = await Promise.all([
      request<{ items: any[]; storage?: string; warning?: string }>("/api/v1/admin/import-jobs?limit=30"),
      request<{ items: any[] }>("/api/v1/admin/import-candidate-jobs"),
      request<{ items: any[] }>("/api/v1/calendar/sources"),
    ]);
    jobs.value = legacyData.items || [];
    storage.value = legacyData.storage || "unknown";
    warning.value = legacyData.warning || "";
    candidateJobs.value = candidateData.items || [];
    calendarSources.value = sourceData.items || [];
    if (selectedJobId.value) {
      await loadCandidates(selectedJobId.value, true);
    }
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载失败";
  } finally {
    loading.value = false;
  }
};

const convertLegacyJob = async (legacyJobId: string) => {
  if (!legacyJobId) return;
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ item: { id: string } }>(`/api/v1/admin/import-candidate-jobs/from-schedule-import/${encodeURIComponent(legacyJobId)}`, {
      method: "POST",
      body: { targetSourceId: form.targetSourceId },
    });
    selectedJobId.value = data.item.id;
    await loadData();
    await loadCandidates(data.item.id, true);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "转换失败";
  } finally {
    loading.value = false;
  }
};

const createCandidateJob = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<{ item: { id: string } }>("/api/v1/admin/import-candidate-jobs", { method: "POST", body: form });
    selectedJobId.value = data.item.id;
    form.title = "";
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "创建失败";
  } finally {
    loading.value = false;
  }
};

const loadCandidates = async (jobId: string, silent = false) => {
  if (!silent) loading.value = true;
  errorText.value = "";
  try {
    selectedJobId.value = jobId;
    const data = await request<{ items: any[] }>(`/api/v1/admin/import-candidate-jobs/${encodeURIComponent(jobId)}/candidates`);
    candidates.value = data.items || [];
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载候选失败";
  } finally {
    if (!silent) loading.value = false;
  }
};

const commitCalendar = async (candidateId: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/import-candidates/${encodeURIComponent(candidateId)}/commit-calendar`, { method: "POST", body: { sourceId: form.targetSourceId, publish: form.publishMode !== "draft" } });
    if (selectedJobId.value) await loadCandidates(selectedJobId.value, true);
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "提交失败";
  } finally {
    loading.value = false;
  }
};

const commitPersonal = async (candidateId: string) => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/import-candidates/${encodeURIComponent(candidateId)}/commit-personal`, { method: "POST", body: {} });
    if (selectedJobId.value) await loadCandidates(selectedJobId.value, true);
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "提交失败";
  } finally {
    loading.value = false;
  }
};

const updateCandidate = async (candidateId: string, action: "accept" | "reject" | "correct") => {
  loading.value = true;
  errorText.value = "";
  try {
    await request(`/api/v1/admin/import-candidates/${encodeURIComponent(candidateId)}/${action}`, { method: "POST", body: {} });
    if (selectedJobId.value) await loadCandidates(selectedJobId.value, true);
    await loadData();
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "更新候选失败";
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
.candidate-form { display: grid; grid-template-columns: minmax(12rem, 1fr) 10rem 6rem 6rem 6rem minmax(12rem, 1fr) 9rem auto; gap: .5rem; }
.candidate-form input,
.candidate-form select { border: 1px solid hsl(var(--border)); border-radius: .7rem; padding: .55rem .7rem; background: transparent; color: hsl(var(--foreground)); }
@media (max-width: 1000px) { .candidate-form { grid-template-columns: 1fr; } }
</style>
