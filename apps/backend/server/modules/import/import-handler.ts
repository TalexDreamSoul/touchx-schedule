import { readMultipartFormData, type H3Event } from "h3";
import type { AuthSessionRecord, NexusStore, UserRecord } from "../../services/domain-store";
import {
  buildScheduleImportPreviewEntries,
  type ScheduleImportPreviewEntry,
} from "../../services/schedule-import-preview";
import {
  confirmScheduleImportJob,
  createScheduleImportJob,
  getScheduleImportJobStatus,
  listRecentScheduleImportJobIds,
  listRecentScheduleImportJobs,
  toScheduleImportErrorPayload,
} from "../../services/schedule-import-service";
import { parseSchedulePdf } from "../../services/schedule-pdf-parser";
import {
  commitImportCandidateToCalendarSource,
  commitImportCandidateToPersonalEvent,
  createCandidatesFromScheduleImportPreview,
  createImportCandidateEvent,
  createManualImportJob,
  listImportCandidates,
  listImportJobsWithCandidates,
  updateImportCandidateStatus,
} from "./import-candidate-service";
import { isAdminRole } from "../auth/auth-service";

type ApiOk = <T>(data: T) => unknown;
type ApiError = (statusCode: number, code: string, message: string, details?: unknown) => never;
type RequireUser = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord };
type RequireAdmin = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord };
type ResolveSessionWithUser = (event: H3Event) => { session: AuthSessionRecord; user: UserRecord } | null;
type ReadJsonBody = <T>(event: H3Event) => Promise<T>;
type AppendAudit = (action: string, actorUserId: string, payload: Record<string, unknown>) => void;

export interface ImportHandlerContext {
  event: H3Event;
  method: string;
  path: string;
  query: Record<string, unknown>;
  store: NexusStore;
  ok: ApiOk;
  toApiError: ApiError;
  requireUser: RequireUser;
  requireAdmin: RequireAdmin;
  resolveSessionWithUser: ResolveSessionWithUser;
  readJsonBody: ReadJsonBody;
  appendAudit: AppendAudit;
}

const asString = (value: unknown) => String(value || "").trim();

const readSinglePdfUpload = async (event: H3Event, toApiError: ApiError, maxBytes = 12 * 1024 * 1024) => {
  const parts = await readMultipartFormData(event);
  const filePart = (parts || []).find((part) => part?.name === "file" && part.data instanceof Uint8Array) || null;
  if (!filePart || !(filePart.data instanceof Uint8Array)) {
    return toApiError(400, "PDF_FILE_REQUIRED", "请上传 PDF 文件");
  }
  const bytes = filePart.data;
  if (bytes.length <= 0) {
    return toApiError(400, "PDF_FILE_EMPTY", "上传文件为空");
  }
  if (bytes.length > maxBytes) {
    return toApiError(400, "PDF_FILE_TOO_LARGE", `文件过大，限制 ${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }
  const fileName = asString(filePart.filename) || `schedule_${Date.now()}.pdf`;
  const mime = asString(filePart.type).toLowerCase();
  if (!fileName.toLowerCase().endsWith(".pdf") && !mime.includes("pdf") && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return toApiError(400, "PDF_FILE_INVALID", "仅支持 PDF 文件");
  }
  return { bytes, fileName };
};

const parseLimit = (value: unknown, fallback: number, max: number) => {
  const parsedLimit = Number(value);
  return Number.isFinite(parsedLimit) ? Math.max(1, Math.min(max, Math.trunc(parsedLimit))) : fallback;
};

const requireScheduleImportAccess = (context: ImportHandlerContext) => {
  try {
    return context.requireAdmin(context.event);
  } catch (error) {
    const resolved = context.resolveSessionWithUser(context.event);
    if (resolved && isAdminRole(resolved.user)) {
      return resolved;
    }
    throw error;
  }
};

export const isImportPath = (path: string) => {
  return (
    path === "calendar/me/pdf-import/preview" ||
    path.startsWith("admin/import-candidate-jobs") ||
    path.startsWith("admin/import-candidates") ||
    path === "admin/import-jobs" ||
    path.startsWith("admin/import-jobs/") ||
    path === "admin/schedule-import/jobs" ||
    path.startsWith("admin/schedule-import/jobs/") ||
    path === "schedule-import/jobs" ||
    path.startsWith("schedule-import/jobs/")
  );
};

export const handleImportApi = async (context: ImportHandlerContext) => {
  const { event, method, path, query, store, ok, toApiError, requireUser, requireAdmin, readJsonBody, appendAudit } = context;

  if (method === "POST" && path === "calendar/me/pdf-import/preview") {
    const { user } = requireUser(event);
    const upload = await readSinglePdfUpload(event, toApiError);
    const parsed = parseSchedulePdf(upload.bytes);
    const previewEntries = buildScheduleImportPreviewEntries(parsed.courses || []);
    if (previewEntries.length <= 0) {
      return toApiError(422, "PDF_SCHEDULE_EMPTY", "未能从 PDF 中解析出日程，请确认文件格式或使用图片/OCR 导入");
    }
    const result = createCandidatesFromScheduleImportPreview(store, {
      ownerUserId: user.userId,
      legacyJobId: `pdf_${Date.now().toString(36)}`,
      previewEntries,
      rawText: `PDF 解析：${upload.fileName}`,
    });
    result.job.rawPayload = {
      fileName: upload.fileName,
      parsedName: parsed.name,
      parsedStudentNo: parsed.studentNo,
    };
    const candidates = result.candidates;
    appendAudit("calendar_pdf_import_preview", user.userId, { jobId: result.job.id, fileName: upload.fileName, candidateCount: candidates.length });
    return ok({
      jobId: result.job.id,
      fileName: upload.fileName,
      parsedName: asString(parsed.name),
      parsedStudentNo: asString(parsed.studentNo),
      previewEntries,
      candidates,
      total: previewEntries.length,
    });
  }

  if (method === "GET" && path === "admin/import-candidate-jobs") {
    requireAdmin(event);
    return ok(listImportJobsWithCandidates(store));
  }

  if (method === "POST" && path === "admin/import-candidate-jobs") {
    const { user } = requireAdmin(event);
    const body = await readJsonBody<{ rawText?: string; title?: string; location?: string; weekday?: number; startSection?: number; endSection?: number; targetSourceId?: string }>(event);
    const job = createManualImportJob(store, { ownerUserId: user.userId, type: "manual", rawText: body.rawText, targetSourceId: body.targetSourceId });
    if (asString(body.title)) {
      createImportCandidateEvent(store, {
        jobId: job.id,
        title: asString(body.title),
        location: asString(body.location),
        weekday: body.weekday,
        startSection: body.startSection,
        endSection: body.endSection,
        rawPayload: body as Record<string, unknown>,
      });
    }
    appendAudit("import_candidate_job_create", user.userId, { jobId: job.id });
    return ok({ item: job });
  }

  const importCandidateFromLegacyMatch = path.match(/^admin\/import-candidate-jobs\/from-schedule-import\/([^/]+)$/);
  if (method === "POST" && importCandidateFromLegacyMatch) {
    const { user } = requireAdmin(event);
    const legacyJobId = decodeURIComponent(importCandidateFromLegacyMatch[1]);
    const body = await readJsonBody<{ targetSourceId?: string; itemId?: string }>(event);
    let status: Awaited<ReturnType<typeof getScheduleImportJobStatus>> | null = null;
    try {
      status = await getScheduleImportJobStatus(event, legacyJobId);
    } catch (error) {
      return toApiError(400, "LEGACY_IMPORT_JOB_UNAVAILABLE", error instanceof Error ? error.message : "旧导入任务不可用");
    }
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "旧导入任务不存在");
    }
    const previewEntries = status.results
      .filter((item) => !body.itemId || item.itemId === body.itemId)
      .flatMap((item) => item.previewEntries || []);
    if (previewEntries.length <= 0) {
      return toApiError(400, "SCHEDULE_IMPORT_PREVIEW_EMPTY", "旧导入任务没有可转换的 previewEntries");
    }
    const result = createCandidatesFromScheduleImportPreview(store, {
      ownerUserId: user.userId,
      legacyJobId,
      previewEntries,
      targetSourceId: body.targetSourceId,
      rawText: `旧 PDF 导入任务 ${legacyJobId}`,
    });
    appendAudit("import_candidate_from_schedule_import", user.userId, { legacyJobId, jobId: result.job.id, candidateCount: result.candidates.length });
    return ok({ item: result.job, candidates: result.candidates, candidateCount: result.candidates.length });
  }

  const importCandidateListMatch = path.match(/^admin\/import-candidate-jobs\/([^/]+)\/candidates$/);
  if (method === "GET" && importCandidateListMatch) {
    requireAdmin(event);
    const jobId = decodeURIComponent(importCandidateListMatch[1]);
    return ok(listImportCandidates(store, jobId));
  }

  const importCandidateCommitCalendarMatch = path.match(/^admin\/import-candidates\/([^/]+)\/commit-calendar$/);
  if (method === "POST" && importCandidateCommitCalendarMatch) {
    const { user } = requireAdmin(event);
    const candidateId = decodeURIComponent(importCandidateCommitCalendarMatch[1]);
    const body = await readJsonBody<{ sourceId?: string; publish?: boolean }>(event);
    const result = commitImportCandidateToCalendarSource(store, { candidateId, sourceId: body.sourceId, actorUserId: user.userId, publish: body.publish });
    if (!result) {
      return toApiError(404, "IMPORT_CANDIDATE_NOT_FOUND", "导入候选不存在");
    }
    if (result === "source_not_found") {
      return toApiError(404, "IMPORT_TARGET_SOURCE_NOT_FOUND", "目标日程源不存在");
    }
    appendAudit("import_candidate_commit_calendar", user.userId, { candidateId, scheduleId: result.schedule.id, versionNo: result.version.versionNo });
    return ok(result);
  }

  const importCandidateCommitPersonalMatch = path.match(/^admin\/import-candidates\/([^/]+)\/commit-personal$/);
  if (method === "POST" && importCandidateCommitPersonalMatch) {
    const { user } = requireAdmin(event);
    const candidateId = decodeURIComponent(importCandidateCommitPersonalMatch[1]);
    const result = commitImportCandidateToPersonalEvent(store, { candidateId, userId: user.userId });
    if (!result) {
      return toApiError(404, "IMPORT_CANDIDATE_NOT_FOUND", "导入候选不存在");
    }
    appendAudit("import_candidate_commit_personal", user.userId, { candidateId, personalEventId: result.event.id });
    return ok(result);
  }

  const importCandidateStatusMatch = path.match(/^admin\/import-candidates\/([^/]+)\/(accept|reject|correct)$/);
  if (method === "POST" && importCandidateStatusMatch) {
    const { user } = requireAdmin(event);
    const candidateId = decodeURIComponent(importCandidateStatusMatch[1]);
    const action = importCandidateStatusMatch[2];
    const body = await readJsonBody<Partial<import("@touchx/shared").ImportCandidateEvent>>(event);
    const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "corrected";
    const item = updateImportCandidateStatus(store, candidateId, status, body);
    if (!item) {
      return toApiError(404, "IMPORT_CANDIDATE_NOT_FOUND", "导入候选不存在");
    }
    appendAudit("import_candidate_update", user.userId, { candidateId, status });
    return ok({ item });
  }

  if (method === "GET" && path === "admin/import-jobs") {
    const { user } = requireScheduleImportAccess(context);
    const limit = parseLimit(query.limit, 20, 100);
    try {
      const items = await listRecentScheduleImportJobs(event, {
        actorUserId: user.userId,
        includeAll: true,
        limit,
      });
      return ok({ items, total: items.length, limit, storage: "schedule_import_jobs" });
    } catch (error) {
      if (String(error instanceof Error ? error.message : error).includes("NEXUS_DB")) {
        return ok({ items: [], total: 0, limit, storage: "not_configured", warning: "NEXUS_DB 未配置，暂无导入任务存储" });
      }
      throw error;
    }
  }

  const adminImportJobMatch = path.match(/^admin\/import-jobs\/([^/]+)$/);
  if (method === "GET" && adminImportJobMatch) {
    requireScheduleImportAccess(context);
    const jobId = decodeURIComponent(adminImportJobMatch[1]);
    try {
      const item = await getScheduleImportJobStatus(event, jobId);
      if (!item) {
        return toApiError(404, "IMPORT_JOB_NOT_FOUND", "导入任务不存在");
      }
      return ok({ item });
    } catch (error) {
      if (String(error instanceof Error ? error.message : error).includes("NEXUS_DB")) {
        return toApiError(503, "IMPORT_STORAGE_NOT_CONFIGURED", "NEXUS_DB 未配置，无法读取导入任务");
      }
      throw error;
    }
  }

  if (method === "POST" && path === "admin/schedule-import/jobs") {
    const { user } = requireScheduleImportAccess(context);
    const result = await createScheduleImportJob(event, user.userId);
    appendAudit("admin_schedule_import_job_create", user.userId, {
      jobId: result.jobId,
      totalFiles: result.totalFiles,
    });
    return ok(result);
  }

  if (method === "GET" && path === "admin/schedule-import/jobs") {
    requireScheduleImportAccess(context);
    const limit = parseLimit(query.limit, 20, 100);
    const ids = await listRecentScheduleImportJobIds(event, limit);
    return ok({
      items: ids.map((id) => ({ jobId: id })),
      total: ids.length,
      limit,
    });
  }

  const adminScheduleImportJobMatch = path.match(/^admin\/schedule-import\/jobs\/([^/]+)$/);
  if (method === "GET" && adminScheduleImportJobMatch) {
    requireScheduleImportAccess(context);
    const jobId = decodeURIComponent(adminScheduleImportJobMatch[1]);
    const status = await getScheduleImportJobStatus(event, jobId);
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在");
    }
    return ok(status);
  }

  if (method === "POST" && path === "schedule-import/jobs") {
    const { user } = requireUser(event);
    const result = await createScheduleImportJob(event, user.userId, { mode: "preview" });
    appendAudit("schedule_import_job_create", user.userId, {
      jobId: result.jobId,
      totalFiles: result.totalFiles,
    });
    return ok(result);
  }

  if (method === "GET" && path === "schedule-import/jobs") {
    const { user } = requireUser(event);
    const limit = parseLimit(query.limit, 10, 50);
    const items = await listRecentScheduleImportJobs(event, {
      actorUserId: user.userId,
      includeAll: isAdminRole(user) && query.scope === "all",
      limit,
    });
    return ok({
      items,
      total: items.length,
      limit,
    });
  }

  const scheduleImportJobConfirmMatch = path.match(/^schedule-import\/jobs\/([^/]+)\/confirm$/);
  if (method === "POST" && scheduleImportJobConfirmMatch) {
    const { user } = requireUser(event);
    const jobId = decodeURIComponent(scheduleImportJobConfirmMatch[1]);
    const status = await getScheduleImportJobStatus(event, jobId);
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在");
    }
    if (status.createdByUserId !== user.userId && !isAdminRole(user)) {
      return toApiError(403, "SCHEDULE_IMPORT_JOB_FORBIDDEN", "无权确认该导入任务");
    }
    const body = await readJsonBody<{ previewEntries?: unknown[]; entries?: unknown[] }>(event);
    const previewEntries = Array.isArray(body.previewEntries)
      ? body.previewEntries
      : Array.isArray(body.entries)
        ? body.entries
        : [];
    try {
      const result = await confirmScheduleImportJob(event, jobId, user.userId, previewEntries as ScheduleImportPreviewEntry[]);
      appendAudit("schedule_import_job_confirm", user.userId, {
        jobId,
        scheduleId: result.scheduleId,
        versionNo: result.versionNo,
        entryCount: result.entryCount,
      });
      return ok(result);
    } catch (error) {
      const payload = toScheduleImportErrorPayload(error);
      const code = payload.code || "SCHEDULE_IMPORT_CONFIRM_FAILED";
      const statusCode = code === "SCHEDULE_IMPORT_JOB_NOT_FOUND" ? 404 : 400;
      return toApiError(statusCode, code, payload.message || "确认导入失败", payload.details || undefined);
    }
  }

  const scheduleImportJobMatch = path.match(/^schedule-import\/jobs\/([^/]+)$/);
  if (method === "GET" && scheduleImportJobMatch) {
    const { user } = requireUser(event);
    const jobId = decodeURIComponent(scheduleImportJobMatch[1]);
    const status = await getScheduleImportJobStatus(event, jobId);
    if (!status) {
      return toApiError(404, "SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在");
    }
    if (status.createdByUserId !== user.userId && !isAdminRole(user)) {
      return toApiError(403, "SCHEDULE_IMPORT_JOB_FORBIDDEN", "无权查看该导入任务");
    }
    return ok(status);
  }

  return null;
};
