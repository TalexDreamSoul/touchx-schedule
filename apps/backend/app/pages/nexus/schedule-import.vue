<template>
  <NexusAdminShell title="Schedule Import" description="旧 PDF 课表异步导入任务，后续可转入 Import Center 候选审核流。" @refresh="loadData">
    <section class="rx-grid">
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Jobs</span>
        <strong>{{ jobs.length }}</strong>
        <p>最近导入任务</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Files</span>
        <strong>{{ selectedFiles.length }}</strong>
        <p>待上传 PDF</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Current</span>
        <strong>{{ currentJob?.status || "--" }}</strong>
        <p>{{ currentJob?.jobId || "未选择任务" }}</p>
      </article>
      <article class="rx-card nexus-stat">
        <span class="rx-pill">Progress</span>
        <strong>{{ currentProgress }}</strong>
        <p>processed / total</p>
      </article>
    </section>

    <section v-if="errorText" class="nexus-alert">{{ errorText }}</section>

    <section class="import-layout">
      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>创建导入任务</h2>
            <p>支持多 PDF 上传；学号可留空，后端会尝试从文件名识别。</p>
          </div>
        </header>
        <div class="nexus-form import-form">
          <input v-model.trim="defaultTerm" placeholder="默认学期，例如 2025-2026-2" />
          <input :key="fileInputKey" type="file" accept=".pdf,application/pdf" multiple @change="onFilesChange" />
          <div class="rx-actions">
            <button class="rx-btn" type="button" :disabled="loading || mappings.length <= 0" @click="submitJob">提交导入任务</button>
            <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="resetFiles">清空文件</button>
          </div>
        </div>
      </article>

      <article class="rx-card">
        <header class="rx-card-head">
          <div>
            <h2>最近任务</h2>
            <p>选择任务查看解析状态和结果。</p>
          </div>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadData">刷新</button>
        </header>
        <div class="rx-table-wrap">
          <table class="rx-table">
            <thead><tr><th>任务</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in jobs" :key="item.jobId">
                <td><strong>{{ item.jobId }}</strong></td>
                <td><button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadJobStatus(item.jobId)">查看</button></td>
              </tr>
              <tr v-if="jobs.length <= 0"><td colspan="2" class="rx-muted">暂无导入任务</td></tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>

    <section class="rx-card" v-if="mappings.length > 0">
      <header class="rx-card-head">
        <div>
          <h2>文件映射</h2>
          <p>提交前可修正学号和学期。</p>
        </div>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>文件名</th><th>大小(MB)</th><th>学号</th><th>学期</th></tr></thead>
          <tbody>
            <tr v-for="(item, index) in mappings" :key="`${item.fileName}-${index}`">
              <td>{{ item.fileName }}</td>
              <td>{{ ((selectedFiles[index]?.size || 0) / 1024 / 1024).toFixed(2) }}</td>
              <td><input v-model.trim="item.studentNo" class="table-input" placeholder="可留空自动识别" /></td>
              <td><input v-model.trim="item.term" class="table-input" placeholder="2025-2026-2" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rx-card" v-if="currentJob">
      <header class="rx-card-head">
        <div>
          <h2>任务详情</h2>
          <p>{{ currentJob.jobId }}</p>
        </div>
        <div class="rx-actions">
          <span class="rx-pill">{{ currentJob.status }}</span>
          <button class="rx-btn rx-btn-ghost" type="button" :disabled="loading" @click="loadJobStatus(currentJobId)">刷新当前任务</button>
          <NuxtLink class="rx-btn rx-btn-ghost" to="/nexus/imports">打开候选导入中心</NuxtLink>
        </div>
      </header>
      <div class="rx-table-wrap">
        <table class="rx-table">
          <thead><tr><th>文件</th><th>学号</th><th>状态</th><th>条目数</th><th>课表ID</th><th>版本</th><th>耗时(ms)</th><th>错误</th></tr></thead>
          <tbody>
            <tr v-for="item in currentJob.results || []" :key="item.itemId">
              <td>{{ item.fileName }}</td>
              <td>{{ item.studentNo }}</td>
              <td><span class="rx-pill">{{ item.status }}</span></td>
              <td>{{ item.entryCount || 0 }}</td>
              <td>{{ item.scheduleId || "-" }}</td>
              <td>{{ item.versionNo || "-" }}</td>
              <td>{{ item.durationMs || 0 }}</td>
              <td class="rx-muted">{{ item.error || "-" }}</td>
            </tr>
            <tr v-if="!currentJob.results || currentJob.results.length <= 0"><td colspan="8" class="rx-muted">暂无结果</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </NexusAdminShell>
</template>

<script setup lang="ts">
import NexusAdminShell from "../../components/nexus/NexusAdminShell.vue";
import { useNexusApi } from "../../composables/nexus/useNexusApi";

interface ImportJobListItem { jobId: string }
interface ImportJobStatus {
  jobId: string;
  status: string;
  processedFiles?: number;
  totalFiles?: number;
  successCount?: number;
  failCount?: number;
  updatedAt?: string;
  results?: Array<{
    itemId: string;
    fileName: string;
    studentNo: string;
    status: string;
    entryCount?: number;
    scheduleId?: string;
    versionNo?: number;
    durationMs?: number;
    error?: string;
  }>;
}

const { ensureSessionToken, request, upload, goToLogin } = useNexusApi();
const loading = ref(false);
const errorText = ref("");
const jobs = ref<ImportJobListItem[]>([]);
const currentJob = ref<ImportJobStatus | null>(null);
const currentJobId = ref("");
const defaultTerm = ref("2025-2026-2");
const selectedFiles = ref<File[]>([]);
const mappings = ref<Array<{ fileName: string; studentNo: string; term: string }>>([]);
const fileInputKey = ref(0);
let pollingTimer: ReturnType<typeof setTimeout> | null = null;

const currentProgress = computed(() => `${currentJob.value?.processedFiles || 0}/${currentJob.value?.totalFiles || 0}`);

const clearPolling = () => {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
};

const inferStudentNo = (fileName: string) => {
  const matched = String(fileName || "").match(/(\d{6,32})/g) || [];
  return matched.sort((left, right) => right.length - left.length)[0] || "";
};

const isRunning = (job: ImportJobStatus | null) => job?.status === "queued" || job?.status === "processing";

const onFilesChange = (event: Event) => {
  const target = event.target as HTMLInputElement | null;
  const files = target?.files ? Array.from(target.files.values()) : [];
  selectedFiles.value = files;
  const existing = new Map(mappings.value.map((item) => [item.fileName, item]));
  mappings.value = files.map((file) => {
    const prev = existing.get(file.name);
    return {
      fileName: file.name,
      studentNo: prev?.studentNo || inferStudentNo(file.name),
      term: prev?.term || defaultTerm.value,
    };
  });
};

const resetFiles = () => {
  selectedFiles.value = [];
  mappings.value = [];
  fileInputKey.value += 1;
};

const loadJobList = async () => {
  const data = await request<{ items: ImportJobListItem[] }>("/api/v1/admin/schedule-import/jobs?limit=20");
  jobs.value = data.items || [];
};

const loadJobStatus = async (jobId: string) => {
  const normalized = String(jobId || "").trim();
  if (!normalized) return;
  loading.value = true;
  errorText.value = "";
  try {
    const data = await request<ImportJobStatus>(`/api/v1/admin/schedule-import/jobs/${encodeURIComponent(normalized)}`);
    currentJob.value = data;
    currentJobId.value = data.jobId || normalized;
    clearPolling();
    if (isRunning(data)) {
      pollingTimer = setTimeout(() => {
        void loadJobStatus(normalized).catch(() => clearPolling());
      }, 3000);
    } else {
      await loadJobList();
    }
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载任务失败";
  } finally {
    loading.value = false;
  }
};

const loadData = async () => {
  loading.value = true;
  errorText.value = "";
  try {
    await loadJobList();
    const first = currentJobId.value || jobs.value[0]?.jobId || "";
    if (first) {
      await loadJobStatus(first);
    }
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "加载导入任务失败";
  } finally {
    loading.value = false;
  }
};

const submitJob = async () => {
  if (selectedFiles.value.length <= 0) return;
  loading.value = true;
  errorText.value = "";
  try {
    const normalizedMappings = mappings.value.map((item) => ({
      fileName: item.fileName,
      studentNo: item.studentNo,
      term: item.term || defaultTerm.value,
    }));
    const formData = new FormData();
    selectedFiles.value.forEach((file) => formData.append("files[]", file, file.name));
    formData.append("mappings", JSON.stringify(normalizedMappings));
    const data = await upload<{ jobId: string }>("/api/v1/admin/schedule-import/jobs", formData);
    currentJobId.value = data.jobId || "";
    resetFiles();
    await loadJobList();
    await loadJobStatus(currentJobId.value);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "提交导入任务失败";
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

onBeforeUnmount(() => {
  clearPolling();
});
</script>

<style scoped>
.import-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1fr);
  gap: 1rem;
}

.import-form {
  gap: 0.75rem;
}

.table-input {
  min-height: 2.25rem;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 0.25rem);
  padding: 0.45rem 0.65rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

@media (max-width: 1000px) {
  .import-layout {
    grid-template-columns: 1fr;
  }
}
</style>
