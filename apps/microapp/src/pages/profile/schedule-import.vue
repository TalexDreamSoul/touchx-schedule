<template>
  <PageContainer title="课表导入" :theme-key="themeKey">
    <view class="page">
      <view class="card">
        <view class="title">用户侧课表导入</view>
        <view class="sub">PDF 会进入识别任务；拍照/相册入口先返回清晰的 OCR 配置提示，不阻塞 PDF 导入。</view>
        <view class="form-field">
          <view class="label">学期</view>
          <input v-model.trim="term" class="input" placeholder="例如 2025-2026-2" />
        </view>
        <view class="form-field">
          <view class="label">学号（可选）</view>
          <input v-model.trim="studentNo" class="input" placeholder="留空则尝试从 PDF/文件名识别" />
        </view>
        <view class="form-field">
          <view class="label">课表文件</view>
          <view class="picker-row">
            <view class="picker-file">{{ selectedFileName || "未选择文件" }}</view>
            <view class="btn ghost" @click="choosePdf">选择 PDF</view>
            <view class="btn ghost" @click="chooseImage">拍照/相册</view>
          </view>
        </view>
        <view class="actions">
          <view class="btn" :class="{ disabled: submitPending || pollingPending }" @click="submitImport">
            {{ submitPending ? "上传中..." : pollingPending ? "轮询中..." : "开始导入" }}
          </view>
        </view>
        <view v-if="statusText" class="status">{{ statusText }}</view>
        <view v-if="pageError" class="error-text">{{ pageError }}</view>
      </view>

      <view v-if="jobDetail" class="card">
        <view class="title small">任务状态</view>
        <view class="summary-grid">
          <view class="summary-item">
            <view class="summary-label">任务 ID</view>
            <view class="summary-value mono">{{ jobDetail.jobId }}</view>
          </view>
          <view class="summary-item">
            <view class="summary-label">状态</view>
            <view class="summary-value">{{ formatJobStatus(jobDetail.status) }}</view>
          </view>
          <view class="summary-item">
            <view class="summary-label">成功/失败</view>
            <view class="summary-value">{{ jobDetail.successCount }}/{{ jobDetail.failCount }}</view>
          </view>
          <view class="summary-item">
            <view class="summary-label">进度</view>
            <view class="summary-value">{{ jobDetail.processedFiles }}/{{ jobDetail.totalFiles }}</view>
          </view>
        </view>
        <view v-for="item in jobDetail.results" :key="item.itemId" class="result-item">
          <view class="result-head">
            <view class="result-name">{{ item.fileName }}</view>
            <view class="result-tag" :class="`tag-${item.status}`">{{ formatItemStatus(item.status) }}</view>
          </view>
          <view class="result-meta">学号：{{ item.studentNo || "自动识别" }} · 录入 {{ item.entryCount }} 条课程</view>
          <view v-if="item.errorMessage || item.error" class="result-error">
            <view>错误：{{ item.errorMessage || item.error }}</view>
            <view v-if="item.errorCode">代码：{{ item.errorCode }}</view>
            <view v-if="formatErrorDetails(item.errorDetails)">详情：{{ formatErrorDetails(item.errorDetails) }}</view>
          </view>
        </view>
      </view>

      <view v-if="editablePreviewEntries.length > 0" class="card">
        <view class="title small">识别预览</view>
        <view class="sub">确认前可修正课程名、节次、周次、单双周、教室和教师；确认后才会写入正式课表。</view>
        <view class="preview-toolbar">
          <view class="preview-count">共 {{ editablePreviewEntries.length }} 条课程</view>
          <view class="link-btn" @click="restorePreviewEntries">恢复原始识别</view>
        </view>
        <view v-for="(entry, index) in editablePreviewEntries" :key="entry.previewEntryId" class="preview-item">
          <view class="preview-head">
            <view class="preview-index">#{{ index + 1 }}</view>
            <view class="link-btn danger" @click="removePreviewEntry(index)">删除</view>
          </view>
          <view class="form-field compact">
            <view class="label">课程名</view>
            <input v-model.trim="entry.courseName" class="input" placeholder="课程名" />
          </view>
          <view class="preview-grid">
            <view class="form-field compact">
              <view class="label">周几</view>
              <input v-model.number="entry.day" class="input" type="number" placeholder="1-7" />
            </view>
            <view class="form-field compact">
              <view class="label">开始节</view>
              <input v-model.number="entry.startSection" class="input" type="number" placeholder="1" />
            </view>
            <view class="form-field compact">
              <view class="label">结束节</view>
              <input v-model.number="entry.endSection" class="input" type="number" placeholder="2" />
            </view>
          </view>
          <view class="preview-grid two">
            <view class="form-field compact">
              <view class="label">周次</view>
              <input v-model.trim="entry.weekExpr" class="input" placeholder="1-16" />
            </view>
            <view class="form-field compact">
              <view class="label">单双周</view>
              <picker :range="parityOptions" range-key="label" :value="getParityIndex(entry.parity)" @change="updatePreviewParity(index, $event)">
                <view class="input picker-input">{{ formatParity(entry.parity) }}</view>
              </picker>
            </view>
          </view>
          <view class="preview-grid two">
            <view class="form-field compact">
              <view class="label">教室</view>
              <input v-model.trim="entry.classroom" class="input" placeholder="教室" />
            </view>
            <view class="form-field compact">
              <view class="label">教师</view>
              <input v-model.trim="entry.teacher" class="input" placeholder="教师" />
            </view>
          </view>
        </view>
        <view class="actions">
          <view class="btn" :class="{ disabled: confirmPending || editablePreviewEntries.length <= 0 }" @click="confirmImport">
            {{ confirmPending ? "确认中..." : "确认导入" }}
          </view>
        </view>
      </view>

      <view class="card">
        <view class="title small">识别修正回流</view>
        <view class="sub">把 AI/OCR 原始识别和你修正后的结果一起提交，后续用于本校模型优化。</view>
        <view class="form-field">
          <view class="label">任务 ID（可选）</view>
          <input v-model.trim="correctionJobId" class="input" placeholder="可填导入任务 ID" />
        </view>
        <view class="form-field">
          <view class="label">原始识别结果</view>
          <textarea v-model="originalPayloadText" class="textarea" maxlength="1200" placeholder="可粘贴 JSON 或纯文本" />
        </view>
        <view class="form-field">
          <view class="label">修正后结果</view>
          <textarea v-model="correctedPayloadText" class="textarea" maxlength="1200" placeholder="可粘贴 JSON 或纯文本" />
        </view>
        <view class="actions">
          <view class="btn" :class="{ disabled: correctionPending }" @click="submitCorrection">
            {{ correctionPending ? "提交中..." : "提交修正样本" }}
          </view>
        </view>
      </view>
    </view>
  </PageContainer>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { onShow } from "@dcloudio/uni-app";
import PageContainer from "@/components/PageContainer.vue";
import { useSocialDashboard, type SocialDashboardResponse } from "@/composables/useSocialDashboard";
import {
  enforceBackendEndpointStorage,
  guardProfilePageAccess,
  readAuthSessionFromStorage,
  requestBackendGet,
  requestBackendPost,
  uploadBackendFile,
} from "@/utils/profile-service";

type ThemeKey = "black" | "purple" | "green" | "pink" | "blue" | "yellow" | "orange";
type JobStatus = "queued" | "processing" | "preview_ready" | "confirmed" | "completed" | "completed_with_errors" | "failed";
type ItemStatus = "queued" | "processing" | "retrying" | "preview_ready" | "confirmed" | "success" | "failed";
type ScheduleImportPreviewParity = "all" | "odd" | "even";

interface ScheduleImportPreviewEntry {
  previewEntryId: string;
  sourceIndex: number;
  courseName: string;
  day: number;
  startSection: number;
  endSection: number;
  weekExpr: string;
  parity: ScheduleImportPreviewParity;
  classroom: string;
  teacher: string;
  confidence: number;
}

interface ScheduleImportJobItem {
  itemId: string;
  fileName: string;
  studentNo: string;
  term: string;
  status: ItemStatus;
  attemptCount: number;
  entryCount: number;
  scheduleId: string;
  versionNo: number;
  error: string;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: Record<string, unknown> | null;
  previewEntries?: ScheduleImportPreviewEntry[];
  confirmed?: boolean;
}

interface ScheduleImportJobDetail {
  jobId: string;
  status: JobStatus;
  totalFiles: number;
  processedFiles: number;
  successCount: number;
  failCount: number;
  results: ScheduleImportJobItem[];
}

interface ScheduleImportCreateResponse {
  jobId: string;
  status: JobStatus;
  totalFiles: number;
}

const themeKey = ref<ThemeKey>("black");
const backendBaseUrl = ref("");
const authToken = ref("");
const term = ref("2025-2026-2");
const studentNo = ref("");
const selectedFilePath = ref("");
const selectedFileName = ref("");
const selectedFileKind = ref<"pdf" | "image">("pdf");
const submitPending = ref(false);
const pollingPending = ref(false);
const statusText = ref("");
const pageError = ref("");
const jobDetail = ref<ScheduleImportJobDetail | null>(null);
const originalPreviewEntries = ref<ScheduleImportPreviewEntry[]>([]);
const editablePreviewEntries = ref<ScheduleImportPreviewEntry[]>([]);
const confirmPending = ref(false);
const correctionJobId = ref("");
const originalPayloadText = ref("");
const correctedPayloadText = ref("");
const correctionPending = ref(false);
const { refreshDashboard, hydrateDashboardFromStorage, clearDashboard } = useSocialDashboard();
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const parityOptions: Array<{ label: string; value: ScheduleImportPreviewParity }> = [
  { label: "全部", value: "all" },
  { label: "单周", value: "odd" },
  { label: "双周", value: "even" },
];

const clearPollTimer = () => {
  if (!pollTimer) {
    return;
  }
  clearTimeout(pollTimer);
  pollTimer = null;
};

const loadPageContext = async () => {
  const endpoint = enforceBackendEndpointStorage();
  backendBaseUrl.value = endpoint.baseUrl;
  const session = readAuthSessionFromStorage();
  authToken.value = session.token;
  const savedTheme = String(uni.getStorageSync("touchx_theme_key") || "").trim();
  if (
    savedTheme === "black" ||
    savedTheme === "purple" ||
    savedTheme === "green" ||
    savedTheme === "pink" ||
    savedTheme === "blue" ||
    savedTheme === "yellow" ||
    savedTheme === "orange"
  ) {
    themeKey.value = savedTheme;
  }
  if (!session.token) {
    clearDashboard(true);
    pageError.value = "请先登录后导入课表。";
    return;
  }
  try {
    await refreshDashboard(
      () => requestBackendGet<SocialDashboardResponse>(backendBaseUrl.value, "/api/v1/social/me", {}, session.token),
      backendBaseUrl.value,
    );
  } catch (error) {
    if (!hydrateDashboardFromStorage(backendBaseUrl.value)) {
      clearDashboard();
    }
  }
  pageError.value = "";
};

const choosePdf = () => {
  uni.chooseMessageFile({
    count: 1,
    type: "file",
    extension: ["pdf"],
    success: (result) => {
      const file = result.tempFiles?.[0];
      const filePath = String((file as { path?: string })?.path || "").trim();
      const fileName = String((file as { name?: string })?.name || "").trim();
      if (!filePath || !fileName) {
        uni.showToast({ title: "未读取到 PDF 文件", icon: "none", duration: 1800 });
        return;
      }
      selectedFilePath.value = filePath;
      selectedFileName.value = fileName;
      selectedFileKind.value = "pdf";
      pageError.value = "";
    },
    fail: (error) => {
      const message = String(error?.errMsg || "选择 PDF 失败");
      uni.showToast({ title: message, icon: "none", duration: 1800 });
    },
  });
};

const chooseImage = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ["album", "camera"],
    success: (result) => {
      const filePath = String(result.tempFilePaths?.[0] || "").trim();
      if (!filePath) {
        uni.showToast({ title: "未读取到图片", icon: "none", duration: 1800 });
        return;
      }
      selectedFilePath.value = filePath;
      selectedFileName.value = filePath.split("/").pop() || `schedule_${Date.now()}.jpg`;
      selectedFileKind.value = "image";
      pageError.value = "图片 OCR Provider 暂未配置，请先选择 PDF 导入；该图片可保留用于后续 OCR 接入验证。";
    },
    fail: (error) => {
      const message = String(error?.errMsg || "选择图片失败");
      uni.showToast({ title: message, icon: "none", duration: 1800 });
    },
  });
};

const formatJobStatus = (status: JobStatus) => {
  if (status === "preview_ready") {
    return "待确认";
  }
  if (status === "confirmed") {
    return "已确认";
  }
  if (status === "completed") {
    return "已完成";
  }
  if (status === "completed_with_errors") {
    return "完成但有错误";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "processing") {
    return "处理中";
  }
  return "排队中";
};

const formatItemStatus = (status: ItemStatus) => {
  if (status === "preview_ready") {
    return "待确认";
  }
  if (status === "confirmed") {
    return "已确认";
  }
  if (status === "success") {
    return "成功";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "retrying") {
    return "重试中";
  }
  if (status === "processing") {
    return "处理中";
  }
  return "排队中";
};

const formatParity = (parity: ScheduleImportPreviewParity) => {
  return parityOptions.find((item) => item.value === parity)?.label || "全部";
};

const getParityIndex = (parity: ScheduleImportPreviewParity) => {
  return Math.max(0, parityOptions.findIndex((item) => item.value === parity));
};

const updatePreviewParity = (index: number, event: unknown) => {
  const detail = (event || {}) as { detail?: { value?: number | string } };
  const optionIndex = Number(detail.detail?.value ?? 0);
  const next = parityOptions[Number.isFinite(optionIndex) ? optionIndex : 0] || parityOptions[0];
  const entry = editablePreviewEntries.value[index];
  if (entry) {
    entry.parity = next.value;
  }
};

const formatErrorDetails = (details?: Record<string, unknown> | null) => {
  if (!details || Object.keys(details).length <= 0) {
    return "";
  }
  return Object.entries(details)
    .map(([key, value]) => `${key}=${String(value ?? "")}`)
    .join("，");
};

const isTerminalJobStatus = (status: JobStatus) => {
  return status === "preview_ready" || status === "confirmed" || status === "completed" || status === "completed_with_errors" || status === "failed";
};

const clonePreviewEntries = (entries: ScheduleImportPreviewEntry[]) => {
  return entries.map((entry) => ({ ...entry }));
};

const syncPreviewEntriesFromJob = (detail: ScheduleImportJobDetail) => {
  const previewItem = detail.results.find((item) => !item.confirmed && Array.isArray(item.previewEntries) && item.previewEntries.length > 0);
  if (!previewItem?.previewEntries?.length) {
    if (detail.status === "confirmed" || detail.status === "completed" || detail.status === "failed") {
      originalPreviewEntries.value = [];
      editablePreviewEntries.value = [];
    }
    return;
  }
  originalPreviewEntries.value = clonePreviewEntries(previewItem.previewEntries);
  editablePreviewEntries.value = clonePreviewEntries(previewItem.previewEntries);
  correctionJobId.value = detail.jobId;
  originalPayloadText.value = JSON.stringify({ previewEntries: previewItem.previewEntries }, null, 2);
};

const removePreviewEntry = (index: number) => {
  editablePreviewEntries.value.splice(index, 1);
};

const restorePreviewEntries = () => {
  editablePreviewEntries.value = clonePreviewEntries(originalPreviewEntries.value);
};

const fetchJobDetail = async (jobId: string) => {
  const detail = await requestBackendGet<ScheduleImportJobDetail>(
    backendBaseUrl.value,
    `/api/v1/schedule-import/jobs/${encodeURIComponent(jobId)}`,
    {},
    authToken.value,
  );
  jobDetail.value = detail;
  syncPreviewEntriesFromJob(detail);
  statusText.value = `任务 ${formatJobStatus(detail.status)}：${detail.processedFiles}/${detail.totalFiles}`;
  return detail;
};

const schedulePoll = (jobId: string) => {
  clearPollTimer();
  pollTimer = setTimeout(async () => {
    try {
      const detail = await fetchJobDetail(jobId);
      if (isTerminalJobStatus(detail.status)) {
        pollingPending.value = false;
        if (detail.status === "preview_ready") {
          uni.showToast({ title: "识别完成，请确认导入", icon: "none", duration: 1600 });
        } else if (detail.status === "confirmed" || detail.status === "completed") {
          uni.showToast({ title: "导入完成", icon: "none", duration: 1200 });
        } else {
          uni.showToast({ title: "导入结束，请查看结果", icon: "none", duration: 1600 });
        }
        return;
      }
      schedulePoll(jobId);
    } catch (error) {
      pollingPending.value = false;
      pageError.value = error instanceof Error ? error.message : "轮询任务失败";
    }
  }, 2000);
};

const submitImport = async () => {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录", icon: "none", duration: 1600 });
    return;
  }
  if (!selectedFilePath.value || !selectedFileName.value) {
    uni.showToast({ title: "请先选择 PDF", icon: "none", duration: 1600 });
    return;
  }
  if (selectedFileKind.value === "image") {
    pageError.value = "图片 OCR Provider 暂未配置，请先选择 PDF 导入。";
    uni.showToast({ title: "图片 OCR 暂未配置", icon: "none", duration: 1600 });
    return;
  }
  if (submitPending.value || pollingPending.value) {
    return;
  }
  submitPending.value = true;
  pageError.value = "";
  statusText.value = "正在提交导入任务...";
  originalPreviewEntries.value = [];
  editablePreviewEntries.value = [];
  try {
    const payload = await uploadBackendFile<ScheduleImportCreateResponse>(backendBaseUrl.value, "/api/v1/schedule-import/jobs", {
      filePath: selectedFilePath.value,
      name: "files[]",
      token: authToken.value,
      formData: {
        mappings: JSON.stringify([
          {
            fileName: selectedFileName.value,
            studentNo: studentNo.value.trim(),
            term: term.value.trim() || "2025-2026-2",
          },
        ]),
      },
    });
    pollingPending.value = true;
    await fetchJobDetail(payload.jobId);
    schedulePoll(payload.jobId);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "导入失败";
    statusText.value = "";
  } finally {
    submitPending.value = false;
  }
};

const validatePreviewEntries = () => {
  if (editablePreviewEntries.value.length <= 0) {
    return "预览课程为空，无法确认导入";
  }
  const invalid = editablePreviewEntries.value.find((entry) => {
    const day = Number(entry.day);
    const startSection = Number(entry.startSection);
    const endSection = Number(entry.endSection);
    return (
      !String(entry.courseName || "").trim() ||
      !Number.isFinite(day) ||
      day < 1 ||
      day > 7 ||
      !Number.isFinite(startSection) ||
      startSection <= 0 ||
      !Number.isFinite(endSection) ||
      endSection < startSection
    );
  });
  return invalid ? "请检查课程名、周几和节次范围" : "";
};

const confirmImport = async () => {
  if (!authToken.value || !jobDetail.value) {
    uni.showToast({ title: "请先完成上传识别", icon: "none", duration: 1600 });
    return;
  }
  if (confirmPending.value) {
    return;
  }
  const validationError = validatePreviewEntries();
  if (validationError) {
    uni.showToast({ title: validationError, icon: "none", duration: 1800 });
    return;
  }
  confirmPending.value = true;
  pageError.value = "";
  try {
    const correctedPreviewEntries = clonePreviewEntries(editablePreviewEntries.value);
    const result = await requestBackendPost<{ scheduleId: string; versionNo: number; entryCount: number }>(
      backendBaseUrl.value,
      `/api/v1/schedule-import/jobs/${encodeURIComponent(jobDetail.value.jobId)}/confirm`,
      {
        previewEntries: correctedPreviewEntries,
      },
      authToken.value,
    );
    correctedPayloadText.value = JSON.stringify({ previewEntries: correctedPreviewEntries, result }, null, 2);
    await fetchJobDetail(jobDetail.value.jobId);
    uni.showToast({ title: `已写入 ${result.entryCount} 条课程`, icon: "none", duration: 1600 });
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : "确认导入失败";
  } finally {
    confirmPending.value = false;
  }
};

const parseCorrectionPayload = (text: string) => {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    // 纯文本样本也需要保留，便于后续人工/模型复盘。
  }
  return { rawText: trimmed };
};

const submitCorrection = async () => {
  if (!authToken.value) {
    uni.showToast({ title: "请先登录", icon: "none", duration: 1600 });
    return;
  }
  if (!originalPayloadText.value.trim() && !correctedPayloadText.value.trim()) {
    uni.showToast({ title: "请填写修正内容", icon: "none", duration: 1600 });
    return;
  }
  if (correctionPending.value) {
    return;
  }
  correctionPending.value = true;
  try {
    await requestBackendPost(
      backendBaseUrl.value,
      "/api/v1/schedule-import/corrections",
      {
        jobId: correctionJobId.value.trim(),
        originalPayload: parseCorrectionPayload(originalPayloadText.value),
        correctedPayload: parseCorrectionPayload(correctedPayloadText.value),
      },
      authToken.value,
    );
    originalPayloadText.value = "";
    correctedPayloadText.value = "";
    uni.showToast({ title: "修正样本已提交", icon: "none", duration: 1200 });
  } catch (error) {
    uni.showToast({ title: error instanceof Error ? error.message : "提交失败", icon: "none", duration: 1800 });
  } finally {
    correctionPending.value = false;
  }
};

onShow(() => {
  if (!guardProfilePageAccess()) {
    return;
  }
  void loadPageContext();
});

onUnmounted(() => {
  clearPollTimer();
});
</script>

<style scoped>
.page {
  padding: 20rpx;
  box-sizing: border-box;
}

.card {
  background: var(--card-bg);
  border: 1rpx solid var(--line);
  border-radius: 14rpx;
  padding: 16rpx;
  margin-bottom: 12rpx;
}

.title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-main);
}

.title.small {
  font-size: 24rpx;
}

.sub {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.form-field {
  margin-top: 16rpx;
}

.form-field.compact {
  margin-top: 10rpx;
}

.label {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--text-main);
}

.input {
  margin-top: 8rpx;
  min-height: 72rpx;
  padding: 0 20rpx;
  border-radius: 10rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 24rpx;
}

.picker-input {
  display: flex;
  align-items: center;
  box-sizing: border-box;
}

.textarea {
  margin-top: 8rpx;
  width: 100%;
  min-height: 150rpx;
  padding: 16rpx;
  box-sizing: border-box;
  border-radius: 10rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-main);
  font-size: 24rpx;
}

.picker-row {
  margin-top: 8rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.picker-file {
  flex: 1;
  min-height: 72rpx;
  padding: 0 20rpx;
  border-radius: 10rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
  color: var(--text-sub);
  font-size: 22rpx;
  display: flex;
  align-items: center;
}

.actions {
  margin-top: 18rpx;
}

.btn {
  text-align: center;
  border-radius: 10rpx;
  padding: 18rpx 12rpx;
  background: var(--accent);
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 600;
}

.btn.ghost {
  min-width: 180rpx;
  padding: 18rpx 16rpx;
  background: var(--card-bg);
  color: var(--text-main);
  border: 1rpx solid var(--line);
}

.btn.disabled {
  opacity: 0.6;
}

.status {
  margin-top: 14rpx;
  font-size: 22rpx;
  color: var(--text-sub);
}

.error-text {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: var(--danger);
}

.summary-grid {
  margin-top: 12rpx;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}

.summary-item {
  padding: 12rpx;
  border-radius: 10rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
}

.summary-label {
  font-size: 20rpx;
  color: var(--text-sub);
}

.summary-value {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--text-main);
  word-break: break-all;
}

.summary-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.result-item {
  margin-top: 14rpx;
  padding: 14rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.result-name {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--text-main);
  word-break: break-all;
}

.result-tag {
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  font-size: 18rpx;
}

.tag-success {
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}

.tag-preview_ready,
.tag-confirmed {
  background: rgba(99, 102, 241, 0.12);
  color: #4338ca;
}

.tag-failed {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}

.tag-processing,
.tag-retrying,
.tag-queued {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
}

.result-meta {
  margin-top: 8rpx;
  font-size: 20rpx;
  color: var(--text-sub);
}

.result-error {
  margin-top: 8rpx;
  font-size: 20rpx;
  color: var(--danger);
  line-height: 1.5;
}

.preview-toolbar {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.preview-count {
  font-size: 22rpx;
  color: var(--text-sub);
}

.link-btn {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--accent);
}

.link-btn.danger {
  color: var(--danger);
}

.preview-item {
  margin-top: 14rpx;
  padding: 14rpx;
  border-radius: 12rpx;
  border: 1rpx solid var(--line);
  background: var(--muted-bg);
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preview-index {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--text-main);
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10rpx;
}

.preview-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>
