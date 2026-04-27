export type ScheduleImportJobSummaryStatus = "queued" | "processing" | "preview_ready" | "confirmed" | "completed" | "completed_with_errors" | "failed";
export type ScheduleImportJobSummaryItemStatus = "queued" | "processing" | "retrying" | "preview_ready" | "confirmed" | "success" | "failed";

export interface ScheduleImportJobSummary {
  jobId: string;
  status: ScheduleImportJobSummaryStatus;
  totalFiles: number;
  processedFiles: number;
  successCount: number;
  failCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string;
  fileName: string;
  studentNo: string;
  term: string;
  itemStatus: ScheduleImportJobSummaryItemStatus;
  entryCount: number;
  scheduleId: string;
  versionNo: number;
  confirmed: boolean;
  canResumePreview: boolean;
}

export interface ScheduleImportJobSummaryRow {
  id?: unknown;
  status?: unknown;
  total_files?: unknown;
  processed_files?: unknown;
  success_count?: unknown;
  fail_count?: unknown;
  created_by_user_id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  finished_at?: unknown;
  file_name?: unknown;
  student_no?: unknown;
  term?: unknown;
  item_status?: unknown;
  entry_count?: unknown;
  schedule_id?: unknown;
  version_no?: unknown;
}

const asString = (value: unknown) => String(value || "").trim();

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const normalizeJobStatus = (value: unknown): ScheduleImportJobSummaryStatus => {
  const status = asString(value);
  if (
    status === "queued" ||
    status === "processing" ||
    status === "preview_ready" ||
    status === "confirmed" ||
    status === "completed" ||
    status === "completed_with_errors" ||
    status === "failed"
  ) {
    return status;
  }
  return "queued";
};

const normalizeItemStatus = (value: unknown): ScheduleImportJobSummaryItemStatus => {
  const status = asString(value);
  if (
    status === "queued" ||
    status === "processing" ||
    status === "retrying" ||
    status === "preview_ready" ||
    status === "confirmed" ||
    status === "success" ||
    status === "failed"
  ) {
    return status;
  }
  return "queued";
};

export const normalizeScheduleImportJobSummaryRows = (rows: ScheduleImportJobSummaryRow[]): ScheduleImportJobSummary[] => {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const jobId = asString(row.id);
      if (!jobId) {
        return null;
      }
      const status = normalizeJobStatus(row.status);
      const itemStatus = normalizeItemStatus(row.item_status);
      const scheduleId = asString(row.schedule_id);
      const versionNo = toInt(row.version_no, 0);
      const confirmed = Boolean(scheduleId && versionNo > 0) || status === "confirmed" || itemStatus === "confirmed";
      return {
        jobId,
        status,
        totalFiles: toInt(row.total_files, 0),
        processedFiles: toInt(row.processed_files, 0),
        successCount: toInt(row.success_count, 0),
        failCount: toInt(row.fail_count, 0),
        createdByUserId: asString(row.created_by_user_id),
        createdAt: asString(row.created_at),
        updatedAt: asString(row.updated_at),
        finishedAt: asString(row.finished_at),
        fileName: asString(row.file_name),
        studentNo: asString(row.student_no),
        term: asString(row.term) || "2025-2026-2",
        itemStatus,
        entryCount: toInt(row.entry_count, 0),
        scheduleId,
        versionNo,
        confirmed,
        canResumePreview: status === "preview_ready" && itemStatus === "preview_ready" && !confirmed,
      } satisfies ScheduleImportJobSummary;
    })
    .filter((item): item is ScheduleImportJobSummary => Boolean(item));
};
