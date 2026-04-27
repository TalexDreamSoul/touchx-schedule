import { getRequestURL, readFormData, readMultipartFormData, type H3Event } from "h3";
import type { ScheduleSubscription } from "@touchx/shared";
import { getNexusStore, storeHelpers, type ClassMemberRecord, type ClassRecord, type ScheduleEntryRecord, type ScheduleRecord, type ScheduleVersionRecord, type UserRecord } from "./domain-store";
import { parseSchedulePdf, type ParsedScheduleCourse } from "./schedule-pdf-parser";
import {
  buildScheduleImportPreviewEntries,
  normalizeScheduleImportPreviewCourses,
  type ScheduleImportPreviewEntry,
} from "./schedule-import-preview";
import { withNexusStateScopeByDb } from "./nexus-state-manager";

export type ScheduleImportStatus = "queued" | "processing" | "preview_ready" | "confirmed" | "completed" | "completed_with_errors" | "failed";
export type ScheduleImportItemStatus = "queued" | "processing" | "retrying" | "preview_ready" | "confirmed" | "success" | "failed";

export interface ScheduleImportItemResult {
  itemId: string;
  fileName: string;
  studentNo: string;
  term: string;
  status: ScheduleImportItemStatus;
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
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface ScheduleImportJob {
  jobId: string;
  status: ScheduleImportStatus;
  totalFiles: number;
  processedFiles: number;
  successCount: number;
  failCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string;
}

export interface ScheduleImportJobStatusPayload extends ScheduleImportJob {
  results: ScheduleImportItemResult[];
}

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = unknown>() => Promise<T | null>;
  all?: <T = unknown>() => Promise<{ results?: T[] }>;
  run: () => Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare: (sql: string) => D1PreparedStatementLike;
  exec?: (sql: string) => Promise<unknown>;
}

interface R2ObjectLike {
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

interface R2BucketLike {
  put: (key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectLike | null>;
  delete?: (key: string) => Promise<unknown>;
}

interface QueueLike {
  send: (body: unknown) => Promise<unknown>;
}

interface ScheduleImportMappingInput {
  fileName?: string;
  studentNo?: string;
  term?: string;
}

interface ScheduleImportMappingRow {
  fileName: string;
  studentNo: string;
  term: string;
}

interface ScheduleImportPart {
  name?: string;
  filename?: string;
  type?: string;
  data?: unknown;
}

interface ScheduleImportQueuePayload {
  jobId: string;
  itemId: string;
}

interface CreateScheduleImportJobOptions {
  mode?: "direct" | "preview";
}

interface PreparedScheduleImportItem {
  fileName: string;
  studentNo: string;
  term: string;
  bytes: Uint8Array;
}

interface QueueMessageLike {
  body?: unknown;
  ack?: () => void;
  retry?: () => void;
}

interface QueueBatchLike {
  messages?: QueueMessageLike[];
}

interface ScheduleImportItemRow {
  id: string;
  job_id: string;
  file_name: string;
  student_no: string;
  term: string;
  r2_key: string;
  status: ScheduleImportItemStatus;
  attempt_count: number;
  entry_count: number;
  schedule_id: string;
  version_no: number;
  error_message: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  created_at: string;
  updated_at: string;
}

interface ScheduleImportJobRow {
  id: string;
  status: ScheduleImportStatus;
  total_files: number;
  processed_files: number;
  success_count: number;
  fail_count: number;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  finished_at: string;
  error_message: string;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_JOB = 30;
const MAX_RETRY_ATTEMPTS = 3;
const IMPORT_ITEM_PROCESSING_STALE_MS = 30 * 60 * 1000;
const DEFAULT_TERM = "2025-2026-2";

interface ScheduleImportStructuredError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const COURSE_NAME_REPLACE_MAP: Record<string, string> = {
  据科学与大数据技术毛泽东思想和中国特色社会主义理论体系概论: "毛泽东思想和中国特色社会主义理论体系概论",
  械设计制造及其自动化软件工程: "软件工程",
};

const asString = (value: unknown) => String(value || "").trim();

const createScheduleImportStructuredError = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => {
  const error = new Error(message) as Error & { scheduleImportError?: ScheduleImportStructuredError };
  error.scheduleImportError = {
    code,
    message,
    details: details || {},
  };
  return error;
};

const serializeScheduleImportError = (error: unknown) => {
  const structured =
    error instanceof Error && (error as Error & { scheduleImportError?: ScheduleImportStructuredError }).scheduleImportError
      ? (error as Error & { scheduleImportError?: ScheduleImportStructuredError }).scheduleImportError
      : null;
  if (structured) {
    return JSON.stringify({
      code: asString(structured.code) || "SCHEDULE_IMPORT_FAILED",
      message: asString(structured.message) || "导入失败",
      details: structured.details || {},
    });
  }
  const message = error instanceof Error ? error.message : "解析失败";
  return JSON.stringify({
    code: "SCHEDULE_IMPORT_FAILED",
    message,
    details: {},
  });
};

const parseScheduleImportError = (raw: unknown) => {
  const text = asString(raw);
  if (!text) {
    return {
      raw: "",
      code: "",
      message: "",
      details: null as Record<string, unknown> | null,
    };
  }
  try {
    const parsed = JSON.parse(text) as Partial<ScheduleImportStructuredError>;
    return {
      raw: text,
      code: asString(parsed.code),
      message: asString(parsed.message) || text,
      details:
        parsed.details && typeof parsed.details === "object" && !Array.isArray(parsed.details)
          ? (parsed.details as Record<string, unknown>)
          : null,
    };
  } catch (error) {
    return {
      raw: text,
      code: "",
      message: text,
      details: null as Record<string, unknown> | null,
    };
  }
};

export const toScheduleImportErrorPayload = (error: unknown) => {
  return parseScheduleImportError(serializeScheduleImportError(error));
};

const toUint8Array = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return null;
};

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
};

const normalizeParity = (value: unknown): "all" | "odd" | "even" => {
  const text = asString(value).toLowerCase();
  if (text === "odd" || text === "even" || text === "all") {
    return text;
  }
  return "all";
};

const sanitizeFileName = (value: string) => {
  const normalized = asString(value).replace(/[^\w.\-]+/g, "_");
  return normalized || `upload_${Date.now()}.pdf`;
};

const isPdfBytes = (bytes: Uint8Array) => {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
};

const normalizeCourseName = (value: string) => {
  const raw = asString(value);
  if (!raw) {
    return "";
  }
  if (COURSE_NAME_REPLACE_MAP[raw]) {
    return COURSE_NAME_REPLACE_MAP[raw];
  }
  if (raw.startsWith("据科学与大数据技术") && raw.includes("毛泽东思想和中国特色社会主义理论体系概论")) {
    return "毛泽东思想和中国特色社会主义理论体系概论";
  }
  if (raw.startsWith("械设计制造及其自动化") && raw.endsWith("软件工程")) {
    return "软件工程";
  }
  return raw;
};

const splitTeachingClasses = (value: unknown) => {
  return asString(value)
    .split(/[;；]/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "无");
};

const normalizeEntriesFromCourses = (courses: ParsedScheduleCourse[]) => {
  const dedup = new Map<string, ScheduleEntryRecord>();
  courses.forEach((course) => {
    const day = toInt(course.day, 0);
    const startSection = toInt(course.startSection, 0);
    const endSection = toInt(course.endSection, 0);
    const weekExpr = asString(course.weekExpr) || "1-20";
    const parity = normalizeParity(course.parity);
    const courseName = normalizeCourseName(course.name);
    const classroom = asString(course.classroom);
    const teacher = asString(course.teacher);
    if (!courseName || day < 1 || day > 7 || startSection <= 0 || endSection < startSection) {
      return;
    }
    const key = [day, startSection, endSection, weekExpr, parity, courseName, classroom, teacher].join("|");
    if (dedup.has(key)) {
      return;
    }
    dedup.set(key, {
      id: storeHelpers.createId("entry"),
      day,
      startSection,
      endSection,
      weekExpr,
      parity,
      courseName,
      classroom,
      teacher,
    });
  });
  return Array.from(dedup.values()).sort((left, right) => {
    if (left.day !== right.day) {
      return left.day - right.day;
    }
    if (left.startSection !== right.startSection) {
      return left.startSection - right.startSection;
    }
    return left.endSection - right.endSection;
  });
};

const resolveClassLabelFromCourses = (courses: ParsedScheduleCourse[], fallback = "") => {
  if (fallback) {
    return fallback;
  }
  const scoreMap = new Map<string, number>();
  courses.forEach((course) => {
    splitTeachingClasses(course.teachingClasses).forEach((item) => {
      const score = scoreMap.get(item) || 0;
      scoreMap.set(item, score + 1);
    });
  });
  const best = Array.from(scoreMap.entries())
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)[0]?.[0];
  return best || "未分班";
};

const resolveNexusDb = (event: H3Event) => {
  const candidate = (event.context as { cloudflare?: { env?: { NEXUS_DB?: unknown } } }).cloudflare?.env?.NEXUS_DB;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const db = candidate as D1DatabaseLike;
  if (typeof db.prepare !== "function") {
    return null;
  }
  return db;
};

const resolveImportBucketFromEvent = (event: H3Event) => {
  const candidate = (event.context as { cloudflare?: { env?: { SCHEDULE_IMPORT_BUCKET?: unknown } } }).cloudflare?.env
    ?.SCHEDULE_IMPORT_BUCKET;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const bucket = candidate as R2BucketLike;
  if (typeof bucket.get !== "function" || typeof bucket.put !== "function") {
    return null;
  }
  return bucket;
};

const resolveImportQueue = (event: H3Event) => {
  const candidate = (event.context as { cloudflare?: { env?: { SCHEDULE_IMPORT_QUEUE?: unknown } } }).cloudflare?.env
    ?.SCHEDULE_IMPORT_QUEUE;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const queue = candidate as QueueLike;
  if (typeof queue.send !== "function") {
    return null;
  }
  return queue;
};

const enqueueOrProcessScheduleImportItem = async (
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  queue: QueueLike | null,
  payload: ScheduleImportQueuePayload,
) => {
  const shouldProcessInline = import.meta.dev || !queue;
  if (!shouldProcessInline && queue) {
    try {
      await queue.send(payload);
      return;
    } catch (error) {
      // Miniflare 的队列 emulation 在本地有时会直接把 consumer 异常冒泡到上传接口，这里降级为同步处理。
    }
  }
  let result = await processScheduleImportQueueMessage(db, bucket, payload);
  while (result.action === "retry") {
    result = await processScheduleImportQueueMessage(db, bucket, payload);
  }
};

const resolveImportBucketFromEnv = (env: unknown) => {
  const bucket = (env as { SCHEDULE_IMPORT_BUCKET?: unknown })?.SCHEDULE_IMPORT_BUCKET;
  if (!bucket || typeof bucket !== "object") {
    return null;
  }
  const typed = bucket as R2BucketLike;
  if (typeof typed.get !== "function" || typeof typed.put !== "function") {
    return null;
  }
  return typed;
};

const resolveNexusDbFromEnv = (env: unknown) => {
  const db = (env as { NEXUS_DB?: unknown })?.NEXUS_DB;
  if (!db || typeof db !== "object") {
    return null;
  }
  const typed = db as D1DatabaseLike;
  if (typeof typed.prepare !== "function") {
    return null;
  }
  return typed;
};

const ensureImportTables = async (db: D1DatabaseLike) => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS schedule_import_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      total_files INTEGER NOT NULL,
      processed_files INTEGER NOT NULL,
      success_count INTEGER NOT NULL,
      fail_count INTEGER NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS schedule_import_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      student_no TEXT NOT NULL,
      term TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      entry_count INTEGER NOT NULL DEFAULT 0,
      schedule_id TEXT NOT NULL DEFAULT '',
      version_no INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_schedule_import_job_items_job ON schedule_import_job_items(job_id)",
    "CREATE INDEX IF NOT EXISTS idx_schedule_import_job_items_status ON schedule_import_job_items(status)",
  ];
  for (const sql of ddl) {
    await db.prepare(sql).run();
  }
};

const readScheduleImportParts = async (event: H3Event): Promise<ScheduleImportPart[]> => {
  try {
    const formData = await readFormData(event);
    const parts: ScheduleImportPart[] = [];
    for (const [name, value] of formData.entries()) {
      if (typeof value === "string") {
        parts.push({
          name,
          data: new TextEncoder().encode(value),
        });
        continue;
      }
      parts.push({
        name,
        filename: typeof value.name === "string" ? value.name : "",
        type: typeof value.type === "string" ? value.type : "",
        data: new Uint8Array(await value.arrayBuffer()),
      });
    }
    if (parts.length > 0) {
      return parts;
    }
  } catch (error) {
    // Node/本地 emulation 行为不一致时回退到 h3 的 multipart 解析。
  }
  return (await readMultipartFormData(event)) || [];
};

const queryAll = async <T>(statement: D1PreparedStatementLike) => {
  if (typeof statement.all === "function") {
    const rows = await statement.all<T>();
    return Array.isArray(rows?.results) ? rows.results : [];
  }
  const fallbackRow = await statement.first<T>();
  return fallbackRow ? [fallbackRow] : [];
};

const parseMappingsPart = (parts: Array<{ name?: string; data?: unknown }>) => {
  const mappingsPart = parts.find((part) => asString(part.name) === "mappings") || null;
  const mappingBytes = toUint8Array(mappingsPart?.data);
  if (!mappingBytes) {
    throw new Error("mappings 字段缺失");
  }
  const text = new TextDecoder("utf-8").decode(mappingBytes).trim();
  if (!text) {
    throw new Error("mappings 不能为空");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("mappings 不是合法 JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("mappings 必须是数组");
  }
  const mappings: ScheduleImportMappingRow[] = [];
  parsed.forEach((item, index) => {
    const row = (item || {}) as ScheduleImportMappingInput;
    const fileName = asString(row.fileName);
    const studentNo = asString(row.studentNo);
    const term = asString(row.term) || DEFAULT_TERM;
    if (!fileName) {
      throw new Error(`mappings[${index}].fileName 不能为空`);
    }
    if (studentNo && !/^\d{6,32}$/.test(studentNo)) {
      throw new Error(`mappings[${index}].studentNo 非法`);
    }
    mappings.push({ fileName, studentNo, term });
  });
  return mappings;
};

const inferStudentNoFromFileName = (fileName: string) => {
  const matched = fileName.match(/(\d{6,32})/g) || [];
  if (matched.length <= 0) {
    return "";
  }
  return matched.sort((left, right) => right.length - left.length)[0] || "";
};

const inferStudentNoFromStoreByName = (name: string) => {
  const targetName = asString(name);
  if (!targetName) {
    return "";
  }
  const store = getNexusStore();
  const matched = store.users.filter((item) => asString(item.name) === targetName || asString(item.nickname) === targetName);
  if (matched.length !== 1) {
    return "";
  }
  return asString(matched[0]?.studentNo);
};

const inferNameFromFileName = (fileName: string) => {
  const baseName = asString(fileName).replace(/\.[^.]+$/, "");
  if (!baseName) {
    return "";
  }
  const direct = baseName.match(/[_-]([\u4e00-\u9fff]{2,12})(?:\(|（|$)/);
  if (direct?.[1]) {
    return asString(direct[1]);
  }
  const bracketed = baseName.match(/([\u4e00-\u9fff]{2,12})(?:\(|（)/);
  if (bracketed?.[1]) {
    return asString(bracketed[1]);
  }
  const plain = baseName.match(/([\u4e00-\u9fff]{2,12})/);
  return asString(plain?.[1]);
};

const prepareScheduleImportItems = (
  fileParts: Array<
    ScheduleImportPart & {
      data: Uint8Array;
    }
  >,
  mappings: ScheduleImportMappingRow[],
) => {
  const mappingByFileName = new Map<string, { studentNo: string; term: string }>();
  mappings.forEach((item) => {
    if (mappingByFileName.has(item.fileName)) {
      throw new Error(`mappings 存在重复 fileName: ${item.fileName}`);
    }
    mappingByFileName.set(item.fileName, {
      studentNo: item.studentNo,
      term: item.term || DEFAULT_TERM,
    });
  });

  return fileParts.map((filePart) => {
    const bytes = filePart.data;
    if (bytes.length <= 0) {
      throw new Error("上传文件不能为空");
    }
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error(`文件过大，单文件限制 ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB`);
    }
    const fileName = asString(filePart.filename);
    if (!fileName) {
      throw new Error("文件名缺失，无法映射学号");
    }
    const mapping = mappingByFileName.get(fileName) || null;
    if (!mapping) {
      throw new Error(`缺少映射：${fileName}`);
    }
    let resolvedStudentNo = asString(mapping.studentNo);
    const resolvedTerm = asString(mapping.term) || DEFAULT_TERM;
    const mime = asString(filePart.type).toLowerCase();
    const extOk = fileName.toLowerCase().endsWith(".pdf");
    const mimeOk = mime.includes("pdf");
    const headerOk = isPdfBytes(bytes);
    if (!extOk && !mimeOk && !headerOk) {
      throw new Error(`非 PDF 文件：${fileName}`);
    }
    if (!resolvedStudentNo) {
      const parsed = parseSchedulePdf(bytes);
      resolvedStudentNo =
        asString(parsed.studentNo) || inferStudentNoFromFileName(fileName) || inferStudentNoFromStoreByName(parsed.name);
    }
    if (!/^\d{6,32}$/.test(resolvedStudentNo)) {
      throw new Error(`无法自动识别学号：${fileName}，请手动填写 studentNo`);
    }
    return {
      fileName,
      studentNo: resolvedStudentNo,
      term: resolvedTerm,
      bytes,
    } satisfies PreparedScheduleImportItem;
  });
};

const parseScheduleImportPdfForPreview = (bytes: Uint8Array, fileName: string) => {
  const parsed = parseSchedulePdf(bytes);
  if (!Array.isArray(parsed.courses) || parsed.courses.length <= 0) {
    const hasIdentityHint = Boolean(asString(parsed.name) || asString(parsed.studentNo));
    throw createScheduleImportStructuredError(
      hasIdentityHint ? "COURSE_BLOCK_PARSE_FAILED" : "TEMPLATE_MISMATCH",
      hasIdentityHint ? "课程块解析失败，请检查 PDF 模板或解析规则" : "PDF 模板不匹配，未识别到课表结构",
      {
        fileName,
        parsedName: asString(parsed.name),
        parsedStudentNo: asString(parsed.studentNo),
      },
    );
  }
  return {
    parsedName: asString(parsed.name) || inferNameFromFileName(fileName),
    parsedStudentNo: asString(parsed.studentNo),
    previewEntries: buildScheduleImportPreviewEntries(parsed.courses),
  };
};

const computeJobSummary = async (db: D1DatabaseLike, jobId: string) => {
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN status IN ('success', 'preview_ready', 'confirmed') THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS fail_count,
        SUM(CASE WHEN status IN ('success', 'preview_ready', 'confirmed', 'failed') THEN 1 ELSE 0 END) AS processed_count
      FROM schedule_import_job_items
      WHERE job_id = ?`,
    )
    .bind(jobId)
    .first<{
      total_count?: number;
      success_count?: number;
      fail_count?: number;
      processed_count?: number;
    }>();
  return {
    totalFiles: toInt(row?.total_count, 0),
    successCount: toInt(row?.success_count, 0),
    failCount: toInt(row?.fail_count, 0),
    processedFiles: toInt(row?.processed_count, 0),
  };
};

const updateJobBySummary = async (db: D1DatabaseLike, jobId: string, summary: { totalFiles: number; successCount: number; failCount: number; processedFiles: number }) => {
  const now = storeHelpers.nowIso();
  let status: ScheduleImportStatus = "processing";
  let finishedAt = "";
  if (summary.totalFiles <= 0) {
    status = "failed";
    finishedAt = now;
  } else if (summary.processedFiles >= summary.totalFiles) {
    status = summary.failCount > 0 ? "completed_with_errors" : "completed";
    finishedAt = now;
  } else if (summary.processedFiles === 0) {
    status = "queued";
  }
  await db
    .prepare(
      `UPDATE schedule_import_jobs
        SET status = ?, processed_files = ?, success_count = ?, fail_count = ?, updated_at = ?, finished_at = ?
        WHERE id = ?`,
    )
    .bind(status, summary.processedFiles, summary.successCount, summary.failCount, now, finishedAt, jobId)
    .run();
  return status;
};

const updatePreviewJobStatus = async (db: D1DatabaseLike, jobId: string, status: "preview_ready" | "confirmed" | "completed_with_errors" | "failed") => {
  const now = storeHelpers.nowIso();
  const summary = await computeJobSummary(db, jobId);
  await db
    .prepare(
      `UPDATE schedule_import_jobs
        SET status = ?, processed_files = ?, success_count = ?, fail_count = ?, updated_at = ?, finished_at = ?
        WHERE id = ?`,
    )
    .bind(status, summary.processedFiles, summary.successCount, summary.failCount, now, now, jobId)
    .run();
};

const stableHashBase36 = (value: string) => {
  let hash = 2166136261;
  for (const ch of value) {
    hash ^= ch.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const shouldStripTrailingClassTag = (tag: string) => {
  const normalized = asString(tag).replace(/\s+/g, "");
  if (!normalized) {
    return true;
  }
  if (/^\d+$/.test(normalized) || /^\d+班$/.test(normalized)) {
    return false;
  }
  if (/^[\u4e00-\u9fff]{2,8}$/.test(normalized)) {
    return true;
  }
  if (/^[A-Za-z]{2,16}$/.test(normalized)) {
    return true;
  }
  if (!/\d/.test(normalized) && normalized.length <= 16) {
    return true;
  }
  return false;
};

const normalizeClassLabel = (value: string) => {
  let normalized = asString(value).replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }
  normalized = normalized.replace(/[（(]([^()（）]{1,20})[)）]$/, (full, tag: string) => {
    return shouldStripTrailingClassTag(tag) ? "" : full;
  });
  normalized = normalized.replace(/（/g, "(").replace(/）/g, ")");
  if (/\(\d+\)$/.test(normalized)) {
    normalized = `${normalized}班`;
  }
  return normalized;
};

const resolveClassLabelByClassId = (store: ReturnType<typeof getNexusStore>, classId: string) => {
  const classItem = store.classes.find((item) => item.id === classId) || null;
  if (!classItem) {
    return "";
  }
  return normalizeClassLabel(classItem.name);
};

const ensureClassMembership = (
  store: ReturnType<typeof getNexusStore>,
  user: UserRecord,
  classId: string,
  classRole: ClassMemberRecord["classRole"],
  now: string,
) => {
  store.classMembers = store.classMembers.filter((item) => !(item.classId === classId && item.userId === user.userId));
  const member: ClassMemberRecord = {
    id: storeHelpers.createId("class_member"),
    classId,
    userId: user.userId,
    classRole,
    joinedAt: now,
  };
  store.classMembers.push(member);
};

const upsertClassScheduleInStore = (
  store: ReturnType<typeof getNexusStore>,
  input: {
    studentNo: string;
    term: string;
    parsedName: string;
    courses: ParsedScheduleCourse[];
  },
) => {
  const now = storeHelpers.nowIso();
  const inferredClassLabel = resolveClassLabelFromCourses(input.courses);
  const normalizedClassLabel = normalizeClassLabel(inferredClassLabel) || "未分班";

  let user = store.users.find((item) => item.studentNo === input.studentNo) || null;
  if (!user) {
    user = {
      userId: `user_touchx_${input.studentNo}`,
      studentNo: input.studentNo,
      studentId: input.studentNo,
      name: input.parsedName || "",
      classLabel: normalizedClassLabel,
      nickname: input.parsedName || "",
      avatarUrl: "",
      wallpaperUrl: "",
      classIds: [],
      adminRole: "none",
      reminderEnabled: true,
      reminderWindowMinutes: [30, 15],
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(user);
  } else {
    user.studentId = asString(user.studentId) || input.studentNo;
    if (input.parsedName) {
      user.name = input.parsedName;
      user.nickname = input.parsedName;
    }
    user.classLabel = normalizedClassLabel || normalizeClassLabel(asString(user.classLabel)) || "未分班";
    user.updatedAt = now;
  }

  const userExistingClass = user.classIds
    .map((classId) => store.classes.find((item) => item.id === classId) || null)
    .find((item) => item && !item.id.startsWith("class_touchx_") && normalizeClassLabel(item.name) === normalizedClassLabel) || null;
  const sharedTouchxClassId = `class_touchx_shared_${stableHashBase36(normalizedClassLabel)}`;
  const exactPublicClass =
    store.classes.find(
      (item) => !item.id.startsWith("class_touchx_") && normalizeClassLabel(item.name) === normalizedClassLabel,
    ) || null;
  let classItem =
    userExistingClass ||
    exactPublicClass ||
    store.classes.find((item) => item.id === sharedTouchxClassId) ||
    null;
  if (!classItem) {
    classItem = {
      id: sharedTouchxClassId,
      name: normalizedClassLabel,
      ownerUserId: user.userId,
      timezone: "Asia/Shanghai",
      status: "active",
      activeJoinCode: storeHelpers.generateJoinCode(),
      createdAt: now,
      updatedAt: now,
    } satisfies ClassRecord;
    store.classes.push(classItem);
  } else {
    classItem.timezone = "Asia/Shanghai";
    classItem.status = "active";
    classItem.updatedAt = now;
  }
  const classRole: ClassMemberRecord["classRole"] = classItem.ownerUserId === user.userId ? "class_owner" : "class_viewer";
  ensureClassMembership(store, user, classItem.id, classRole, now);
  const removableClassIds = new Set<string>();
  store.classMembers = store.classMembers.filter((member) => {
    if (member.userId !== user.userId || member.classId === classItem.id) {
      return true;
    }
    const memberClass = store.classes.find((candidate) => candidate.id === member.classId) || null;
    const memberClassLabel = normalizeClassLabel(asString(memberClass?.name));
    if (member.classId.startsWith("class_touchx_") || memberClassLabel === normalizedClassLabel) {
      removableClassIds.add(member.classId);
      return false;
    }
    return true;
  });
  user.classIds = [classItem.id];
  user.classLabel = normalizedClassLabel;
  user.updatedAt = now;

  const classSchedules = store.schedules.filter((item) => item.classId === classItem.id);
  let schedule =
    [...classSchedules].sort((left, right) => {
      const leftVersion = Number(left.publishedVersionNo || 0);
      const rightVersion = Number(right.publishedVersionNo || 0);
      if (leftVersion !== rightVersion) {
        return rightVersion - leftVersion;
      }
      return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
    })[0] || null;
  const scheduleId = schedule?.id || `schedule_touchx_shared_${stableHashBase36(`${classItem.id}_schedule`)}`;
  if (!schedule) {
    schedule = {
      id: scheduleId,
      classId: classItem.id,
      title: `${normalizedClassLabel}课表`,
      description: `${input.term} PDF 导入`,
      publishedVersionNo: 0,
      createdByUserId: user.userId,
      createdAt: now,
      updatedAt: now,
    } satisfies ScheduleRecord;
    store.schedules.push(schedule);
  } else {
    schedule.classId = classItem.id;
    schedule.title = `${normalizedClassLabel}课表`;
    schedule.description = `${input.term} PDF 导入`;
    schedule.updatedAt = now;
  }

  const entries = normalizeEntriesFromCourses(input.courses);
  if (entries.length <= 0) {
    throw createScheduleImportStructuredError("EMPTY_SCHEDULE", "解析结果为空课表", {
      studentNo: input.studentNo,
      term: input.term,
      parsedName: input.parsedName,
    });
  }
  const latestVersionNo = store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId)
    .reduce((max, item) => Math.max(max, Number(item.versionNo || 0)), 0);
  const nextVersionNo = latestVersionNo + 1;
  const version: ScheduleVersionRecord = {
    id: storeHelpers.createId("schedule_version"),
    scheduleId,
    versionNo: nextVersionNo,
    status: "published",
    entries,
    createdByUserId: user.userId,
    createdAt: now,
  };
  store.scheduleVersions.push(version);
  schedule.publishedVersionNo = nextVersionNo;
  schedule.updatedAt = now;

  store.scheduleSubscriptions.forEach((item) => {
    if (item.sourceScheduleId !== scheduleId) {
      return;
    }
    item.baseVersionNo = nextVersionNo;
    item.followMode = "following";
  });
  let ownSubscription = store.scheduleSubscriptions.find(
    (item) => item.subscriberUserId === user.userId && item.sourceScheduleId === scheduleId,
  ) || null;
  if (!ownSubscription) {
    ownSubscription = {
      id: storeHelpers.createId("schedule_subscription"),
      subscriberUserId: user.userId,
      sourceScheduleId: scheduleId,
      baseVersionNo: nextVersionNo,
      followMode: "following",
      createdAt: now,
    } satisfies ScheduleSubscription;
    store.scheduleSubscriptions.push(ownSubscription);
  } else {
    ownSubscription.baseVersionNo = nextVersionNo;
    ownSubscription.followMode = "following";
  }

  const removeSubscriptionIds = new Set<string>();
  store.scheduleSubscriptions.forEach((item) => {
    if (item.subscriberUserId !== user.userId || item.id === ownSubscription?.id) {
      return;
    }
    const sourceSchedule = store.schedules.find((scheduleItem) => scheduleItem.id === item.sourceScheduleId) || null;
    if (!sourceSchedule) {
      return;
    }
    if (sourceSchedule.classId !== classItem.id) {
      removeSubscriptionIds.add(item.id);
      return;
    }
    if (sourceSchedule.createdByUserId === user.userId) {
      removeSubscriptionIds.add(item.id);
      return;
    }
    if (removableClassIds.has(sourceSchedule.classId)) {
      removeSubscriptionIds.add(item.id);
      return;
    }
    if (sourceSchedule.classId.startsWith("class_touchx_") && sourceSchedule.classId !== classItem.id) {
      removeSubscriptionIds.add(item.id);
      return;
    }
    const sourceClassLabel = resolveClassLabelByClassId(store, sourceSchedule.classId);
    if (sourceClassLabel === normalizedClassLabel) {
      removeSubscriptionIds.add(item.id);
    }
  });
  if (removeSubscriptionIds.size > 0) {
    store.scheduleSubscriptions = store.scheduleSubscriptions.filter((item) => !removeSubscriptionIds.has(item.id));
    store.schedulePatches = store.schedulePatches.filter((item) => !removeSubscriptionIds.has(item.subscriptionId));
    store.scheduleConflicts = store.scheduleConflicts.filter((item) => !removeSubscriptionIds.has(item.subscriptionId));
  }

  const referencedScheduleIds = new Set(store.scheduleSubscriptions.map((item) => item.sourceScheduleId));
  const removableScheduleIds = new Set<string>();
  store.schedules = store.schedules.filter((scheduleItem) => {
    if (!scheduleItem.classId.startsWith("class_touchx_")) {
      return true;
    }
    if (referencedScheduleIds.has(scheduleItem.id)) {
      return true;
    }
    if (store.classMembers.some((member) => member.classId === scheduleItem.classId)) {
      return true;
    }
    if (store.users.some((storeUser) => storeUser.classIds.includes(scheduleItem.classId))) {
      return true;
    }
    removableScheduleIds.add(scheduleItem.id);
    return false;
  });
  if (removableScheduleIds.size > 0) {
    store.scheduleVersions = store.scheduleVersions.filter((versionItem) => !removableScheduleIds.has(versionItem.scheduleId));
  }
  const referencedClassIds = new Set(store.schedules.map((scheduleItem) => scheduleItem.classId));
  store.classes = store.classes.filter((classCandidate) => {
    if (!classCandidate.id.startsWith("class_touchx_")) {
      return true;
    }
    if (referencedClassIds.has(classCandidate.id)) {
      return true;
    }
    if (store.classMembers.some((member) => member.classId === classCandidate.id)) {
      return true;
    }
    if (store.users.some((storeUser) => storeUser.classIds.includes(classCandidate.id))) {
      return true;
    }
    return false;
  });

  return {
    userId: user.userId,
    scheduleId,
    versionNo: nextVersionNo,
    entryCount: entries.length,
  };
};

export const createScheduleImportJob = async (event: H3Event, actorUserId: string, options: CreateScheduleImportJobOptions = {}) => {
  const db = resolveNexusDb(event);
  if (!db) {
    throw new Error("NEXUS_DB 未配置");
  }
  const bucket = resolveImportBucketFromEvent(event);
  if (!bucket) {
    throw new Error("SCHEDULE_IMPORT_BUCKET 未配置");
  }
  const queue = resolveImportQueue(event);
  const mode = options.mode === "preview" ? "preview" : "direct";
  await ensureImportTables(db);
  const parts = await readScheduleImportParts(event);
  const fileParts = parts
    .map((part) => {
      const data = toUint8Array(part.data);
      if (!data) {
        return null;
      }
      return {
        ...part,
        data,
      };
    })
    .filter((part): part is NonNullable<typeof part> => part !== null)
    .filter((part) => {
      const name = asString(part.name);
      return name === "files" || name === "files[]";
    });
  if (fileParts.length <= 0) {
    throw new Error("请至少上传一个 PDF 文件");
  }
  if (fileParts.length > MAX_FILES_PER_JOB) {
    throw new Error(`单次最多上传 ${MAX_FILES_PER_JOB} 个文件`);
  }
  const mappings = parseMappingsPart(parts);
  const preparedItems = prepareScheduleImportItems(fileParts, mappings);
  const jobId = storeHelpers.createId("schedule_import_job");
  const createdAt = storeHelpers.nowIso();
  const queuePayloads: ScheduleImportQueuePayload[] = [];
  const uploadedKeys: string[] = [];
  const createdItemIds: string[] = [];
  let jobInserted = false;
  try {
    await db
      .prepare(
        `INSERT INTO schedule_import_jobs (
          id, status, total_files, processed_files, success_count, fail_count,
          created_by_user_id, created_at, updated_at, finished_at, error_message
        ) VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, '', '')`,
      )
      .bind(jobId, "queued", preparedItems.length, actorUserId, createdAt, createdAt)
      .run();
    jobInserted = true;

    for (const [index, preparedItem] of preparedItems.entries()) {
      const itemId = storeHelpers.createId("schedule_import_item");
      const key = `touchx/schedule-import/${jobId}/${String(index + 1).padStart(2, "0")}_${sanitizeFileName(preparedItem.fileName)}`;
      await bucket.put(key, preparedItem.bytes, {
        httpMetadata: {
          contentType: "application/pdf",
        },
      });
      uploadedKeys.push(key);
      await db
        .prepare(
          `INSERT INTO schedule_import_job_items (
            id, job_id, file_name, student_no, term, r2_key, status, attempt_count,
            entry_count, schedule_id, version_no, error_message, started_at, finished_at, duration_ms,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 0, '', 0, '', '', '', 0, ?, ?)`,
        )
        .bind(
          itemId,
          jobId,
          preparedItem.fileName,
          preparedItem.studentNo,
          preparedItem.term,
          key,
          createdAt,
          createdAt,
        )
        .run();
      createdItemIds.push(itemId);
      queuePayloads.push({
        jobId,
        itemId,
      });
    }
  } catch (error) {
    if (typeof bucket.delete === "function") {
      for (const key of uploadedKeys) {
        try {
          await bucket.delete(key);
        } catch {
          // ignore cleanup error
        }
      }
    }
    for (const itemId of createdItemIds) {
      try {
        await db
          .prepare("DELETE FROM schedule_import_job_items WHERE id = ? AND job_id = ?")
          .bind(itemId, jobId)
          .run();
      } catch {
        // ignore cleanup error
      }
    }
    if (jobInserted) {
      try {
        await db.prepare("DELETE FROM schedule_import_jobs WHERE id = ?").bind(jobId).run();
      } catch {
        // ignore cleanup error
      }
    }
    throw error;
  }

  if (mode === "preview") {
    let successCount = 0;
    for (const [index, preparedItem] of preparedItems.entries()) {
      const payload = queuePayloads[index];
      const itemId = payload?.itemId || "";
      const startedAt = storeHelpers.nowIso();
      const startedMs = Date.now();
      try {
        const preview = parseScheduleImportPdfForPreview(preparedItem.bytes, preparedItem.fileName);
        if (preview.previewEntries.length <= 0) {
          throw createScheduleImportStructuredError("EMPTY_SCHEDULE", "解析结果为空课表", {
            studentNo: preparedItem.studentNo,
            term: preparedItem.term,
            parsedName: preview.parsedName,
          });
        }
        await db
          .prepare(
            `UPDATE schedule_import_job_items
              SET status = 'preview_ready', entry_count = ?, error_message = '', started_at = ?, finished_at = ?, duration_ms = ?, updated_at = ?
              WHERE id = ? AND job_id = ?`,
          )
          .bind(
            preview.previewEntries.length,
            startedAt,
            storeHelpers.nowIso(),
            Math.max(0, Date.now() - startedMs),
            storeHelpers.nowIso(),
            itemId,
            jobId,
          )
          .run();
        successCount += 1;
      } catch (error) {
        await db
          .prepare(
            `UPDATE schedule_import_job_items
              SET status = 'failed', error_message = ?, started_at = ?, finished_at = ?, duration_ms = ?, updated_at = ?
              WHERE id = ? AND job_id = ?`,
          )
          .bind(
            serializeScheduleImportError(error),
            startedAt,
            storeHelpers.nowIso(),
            Math.max(0, Date.now() - startedMs),
            storeHelpers.nowIso(),
            itemId,
            jobId,
          )
          .run();
      }
    }
    await updatePreviewJobStatus(
      db,
      jobId,
      successCount === preparedItems.length ? "preview_ready" : successCount > 0 ? "completed_with_errors" : "failed",
    );
    return {
      jobId,
      status: successCount === preparedItems.length ? ("preview_ready" as const) : successCount > 0 ? ("completed_with_errors" as const) : ("failed" as const),
      totalFiles: preparedItems.length,
    };
  }

  for (const payload of queuePayloads) {
    await enqueueOrProcessScheduleImportItem(db, bucket, queue, payload);
  }

  await db
    .prepare("UPDATE schedule_import_jobs SET updated_at = ? WHERE id = ?")
    .bind(storeHelpers.nowIso(), jobId)
    .run();
  return {
    jobId,
    status: "queued" as const,
    totalFiles: preparedItems.length,
  };
};

export const getScheduleImportJobStatus = async (event: H3Event, jobId: string): Promise<ScheduleImportJobStatusPayload | null> => {
  const db = resolveNexusDb(event);
  if (!db) {
    throw new Error("NEXUS_DB 未配置");
  }
  const bucket = resolveImportBucketFromEvent(event);
  await ensureImportTables(db);
  const job = await db
    .prepare(
      `SELECT
        id, status, total_files, processed_files, success_count, fail_count,
        created_by_user_id, created_at, updated_at, finished_at, error_message
      FROM schedule_import_jobs
      WHERE id = ?`,
    )
    .bind(jobId)
    .first<ScheduleImportJobRow>();
  if (!job) {
    return null;
  }
  const itemsResult = await db
    .prepare(
      `SELECT
        id, job_id, file_name, student_no, term, r2_key, status, attempt_count,
        entry_count, schedule_id, version_no, error_message, started_at, finished_at,
        duration_ms, created_at, updated_at
      FROM schedule_import_job_items
      WHERE job_id = ?
      ORDER BY created_at ASC`,
    )
    .bind(jobId);
  const itemRows = await queryAll<ScheduleImportItemRow>(itemsResult);
  const items = await Promise.all(itemRows.map(async (item) => {
    const parsedError = parseScheduleImportError(item.error_message);
    let previewEntries: ScheduleImportPreviewEntry[] = [];
    const confirmed = Boolean(asString(item.schedule_id) && toInt(item.version_no, 0) > 0);
    if (!confirmed && bucket && (asString(item.status) === "preview_ready" || asString(item.status) === "success")) {
      try {
        const object = await bucket.get(asString(item.r2_key));
        if (object?.arrayBuffer) {
          const pdfBytes = new Uint8Array(await object.arrayBuffer());
          previewEntries = parseScheduleImportPdfForPreview(pdfBytes, asString(item.file_name)).previewEntries;
        }
      } catch {
        previewEntries = [];
      }
    }
    return {
      itemId: asString(item.id),
      fileName: asString(item.file_name),
      studentNo: asString(item.student_no),
      term: asString(item.term) || DEFAULT_TERM,
      status: (asString(item.status) || "queued") as ScheduleImportItemStatus,
      attemptCount: toInt(item.attempt_count, 0),
      entryCount: toInt(item.entry_count, 0),
      scheduleId: asString(item.schedule_id),
      versionNo: toInt(item.version_no, 0),
      error: parsedError.message || parsedError.raw,
      errorCode: parsedError.code || undefined,
      errorMessage: parsedError.message || undefined,
      errorDetails: parsedError.details,
      previewEntries,
      confirmed,
      startedAt: asString(item.started_at),
      finishedAt: asString(item.finished_at),
      durationMs: toInt(item.duration_ms, 0),
    };
  }));
  return {
    jobId: asString(job.id),
    status: (asString(job.status) || "queued") as ScheduleImportStatus,
    totalFiles: toInt(job.total_files, 0),
    processedFiles: toInt(job.processed_files, 0),
    successCount: toInt(job.success_count, 0),
    failCount: toInt(job.fail_count, 0),
    createdByUserId: asString(job.created_by_user_id),
    createdAt: asString(job.created_at),
    updatedAt: asString(job.updated_at),
    finishedAt: asString(job.finished_at),
    results: items,
  };
};

export const confirmScheduleImportJob = async (
  event: H3Event,
  jobId: string,
  actorUserId: string,
  correctedEntries: ScheduleImportPreviewEntry[],
) => {
  const db = resolveNexusDb(event);
  if (!db) {
    throw new Error("NEXUS_DB 未配置");
  }
  const bucket = resolveImportBucketFromEvent(event);
  if (!bucket) {
    throw new Error("SCHEDULE_IMPORT_BUCKET 未配置");
  }
  await ensureImportTables(db);
  const job = await db
    .prepare(
      `SELECT id, status, total_files, created_by_user_id
       FROM schedule_import_jobs
       WHERE id = ?`,
    )
    .bind(jobId)
    .first<{ id?: string; status?: string; total_files?: number; created_by_user_id?: string }>();
  if (!job || !asString(job.id)) {
    throw createScheduleImportStructuredError("SCHEDULE_IMPORT_JOB_NOT_FOUND", "导入任务不存在", { jobId });
  }
  const itemsResult = await db
    .prepare(
      `SELECT
        id, job_id, file_name, student_no, term, r2_key, status, attempt_count,
        entry_count, schedule_id, version_no, error_message, started_at, finished_at,
        duration_ms, created_at, updated_at
      FROM schedule_import_job_items
      WHERE job_id = ?
      ORDER BY created_at ASC`,
    )
    .bind(jobId);
  const itemRows = await queryAll<ScheduleImportItemRow>(itemsResult);
  if (itemRows.length !== 1) {
    throw createScheduleImportStructuredError("SCHEDULE_IMPORT_CONFIRM_SINGLE_ITEM_ONLY", "小程序端一次只能确认一个导入任务", {
      jobId,
      itemCount: itemRows.length,
    });
  }
  const item = itemRows[0];
  if (!item || asString(item.status) === "failed") {
    throw createScheduleImportStructuredError("SCHEDULE_IMPORT_ITEM_NOT_CONFIRMABLE", "导入任务不可确认", {
      jobId,
      itemId: asString(item?.id),
    });
  }
  if (asString(item.schedule_id) && toInt(item.version_no, 0) > 0) {
    return {
      scheduleId: asString(item.schedule_id),
      versionNo: toInt(item.version_no, 0),
      entryCount: toInt(item.entry_count, 0),
      alreadyConfirmed: true,
    };
  }

  const object = await bucket.get(asString(item.r2_key));
  if (!object?.arrayBuffer) {
    throw createScheduleImportStructuredError("PDF_OBJECT_MISSING", "未找到 PDF 文件对象", {
      jobId,
      itemId: asString(item.id),
    });
  }
  const pdfBytes = new Uint8Array(await object.arrayBuffer());
  const originalPreview = parseScheduleImportPdfForPreview(pdfBytes, asString(item.file_name));
  let normalizedCourses: ParsedScheduleCourse[];
  try {
    normalizedCourses = normalizeScheduleImportPreviewCourses(correctedEntries) as ParsedScheduleCourse[];
  } catch (error) {
    throw createScheduleImportStructuredError("SCHEDULE_IMPORT_PREVIEW_ENTRY_INVALID", "确认课程包含无效字段", {
      jobId,
      itemId: asString(item.id),
    });
  }
  if (normalizedCourses.length <= 0) {
    throw createScheduleImportStructuredError("EMPTY_SCHEDULE", "确认结果为空课表", {
      jobId,
      itemId: asString(item.id),
    });
  }
  const startedAt = storeHelpers.nowIso();
  const result = await withNexusStateScopeByDb(
    db,
    {
      writeRequest: true,
      lockOwner: `schedule_import_confirm_${jobId}_${asString(item.id)}`,
    },
    async () => {
      const store = getNexusStore();
      const writeResult = upsertClassScheduleInStore(store, {
        studentNo: asString(item.student_no),
        term: asString(item.term) || DEFAULT_TERM,
        parsedName: originalPreview.parsedName,
        courses: normalizedCourses,
      });
      store.scheduleCorrections.push({
        id: storeHelpers.createId("schedule_correction"),
        userId: actorUserId,
        jobId,
        originalPayload: {
          previewEntries: originalPreview.previewEntries,
          parsedName: originalPreview.parsedName,
          parsedStudentNo: originalPreview.parsedStudentNo,
        },
        correctedPayload: {
          previewEntries: correctedEntries,
          courses: normalizedCourses,
        },
        createdAt: storeHelpers.nowIso(),
      });
      return writeResult;
    },
  );

  await db
    .prepare(
      `UPDATE schedule_import_job_items
        SET status = 'confirmed', entry_count = ?, schedule_id = ?, version_no = ?,
          error_message = '', started_at = COALESCE(NULLIF(started_at, ''), ?), finished_at = ?, updated_at = ?
        WHERE id = ? AND job_id = ?`,
    )
    .bind(result.entryCount, result.scheduleId, result.versionNo, startedAt, storeHelpers.nowIso(), storeHelpers.nowIso(), asString(item.id), jobId)
    .run();
  await updatePreviewJobStatus(db, jobId, "confirmed");
  if (typeof bucket.delete === "function") {
    await bucket.delete(asString(item.r2_key));
  }
  return {
    scheduleId: result.scheduleId,
    versionNo: result.versionNo,
    entryCount: result.entryCount,
    alreadyConfirmed: false,
  };
};

const parseQueuePayload = (value: unknown): ScheduleImportQueuePayload | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    try {
      return parseQueuePayload(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value !== "object") {
    return null;
  }
  const payload = value as Partial<ScheduleImportQueuePayload>;
  const jobId = asString(payload.jobId);
  const itemId = asString(payload.itemId);
  if (!jobId || !itemId) {
    return null;
  }
  return { jobId, itemId };
};

const finalizeItemStatus = async (
  db: D1DatabaseLike,
  jobId: string,
  itemId: string,
  options: {
    status: ScheduleImportItemStatus;
    entryCount?: number;
    scheduleId?: string;
    versionNo?: number;
    error?: string;
    startedAt?: string;
  },
) => {
  const finishedAt = storeHelpers.nowIso();
  const startedAt = asString(options.startedAt);
  const durationMs = startedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : 0;
  await db
    .prepare(
      `UPDATE schedule_import_job_items
       SET status = ?, entry_count = ?, schedule_id = ?, version_no = ?, error_message = ?, finished_at = ?, duration_ms = ?, updated_at = ?
       WHERE id = ? AND job_id = ?`,
    )
    .bind(
      options.status,
      toInt(options.entryCount, 0),
      asString(options.scheduleId),
      toInt(options.versionNo, 0),
      asString(options.error),
      finishedAt,
      durationMs,
      finishedAt,
      itemId,
      jobId,
    )
    .run();
};

const processScheduleImportQueueMessage = async (
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  payload: ScheduleImportQueuePayload,
) => {
  const job = await db
    .prepare("SELECT id, status, total_files FROM schedule_import_jobs WHERE id = ?")
    .bind(payload.jobId)
    .first<{ id?: string; status?: string; total_files?: number }>();
  if (!job || !asString(job.id)) {
    return { action: "ack" as const };
  }
  const item = await db
    .prepare(
      `SELECT
        id, job_id, file_name, student_no, term, r2_key, status, attempt_count, updated_at
      FROM schedule_import_job_items
      WHERE id = ? AND job_id = ?`,
    )
    .bind(payload.itemId, payload.jobId)
    .first<{
      id?: string;
      job_id?: string;
      file_name?: string;
      student_no?: string;
      term?: string;
      r2_key?: string;
      status?: string;
      attempt_count?: number;
      updated_at?: string;
    }>();
  if (!item || !asString(item.id)) {
    return { action: "ack" as const };
  }
  const currentStatus = asString(item.status) as ScheduleImportItemStatus;
  if (currentStatus === "success" || currentStatus === "preview_ready" || currentStatus === "confirmed" || currentStatus === "failed") {
    return { action: "ack" as const };
  }
  const now = storeHelpers.nowIso();
  const staleIso = new Date(Date.now() - IMPORT_ITEM_PROCESSING_STALE_MS).toISOString();
  const nextAttempt = toInt(item.attempt_count, 0) + 1;
  const claim = await db
    .prepare(
      `UPDATE schedule_import_job_items
       SET status = 'processing', attempt_count = attempt_count + 1, started_at = ?, updated_at = ?, error_message = ''
       WHERE id = ? AND job_id = ?
         AND (
           status = 'queued'
           OR status = 'retrying'
           OR (status = 'processing' AND updated_at <= ?)
         )`,
    )
    .bind(now, now, payload.itemId, payload.jobId, staleIso)
    .run();
  if (Number(claim?.meta?.changes || 0) <= 0) {
    return { action: "ack" as const };
  }
  await db
    .prepare("UPDATE schedule_import_jobs SET status = 'processing', updated_at = ? WHERE id = ?")
    .bind(now, payload.jobId)
    .run();

  try {
    const object = await bucket.get(asString(item.r2_key));
    if (!object?.arrayBuffer) {
      throw createScheduleImportStructuredError("PDF_OBJECT_MISSING", "未找到 PDF 文件对象", {
        jobId: payload.jobId,
        itemId: payload.itemId,
      });
    }
    const pdfBytes = new Uint8Array(await object.arrayBuffer());
    if (pdfBytes.length <= 0) {
      throw createScheduleImportStructuredError("PDF_EMPTY", "PDF 内容为空", {
        fileName: asString(item.file_name),
      });
    }
    const parsed = parseSchedulePdf(pdfBytes);
    if (!Array.isArray(parsed.courses) || parsed.courses.length <= 0) {
      const hasIdentityHint = Boolean(asString(parsed.name) || asString(parsed.studentNo));
      throw createScheduleImportStructuredError(
        hasIdentityHint ? "COURSE_BLOCK_PARSE_FAILED" : "TEMPLATE_MISMATCH",
        hasIdentityHint ? "课程块解析失败，请检查 PDF 模板或解析规则" : "PDF 模板不匹配，未识别到课表结构",
        {
          fileName: asString(item.file_name),
          parsedName: asString(parsed.name),
          parsedStudentNo: asString(parsed.studentNo),
        },
      );
    }
    const parsedName = asString(parsed.name) || inferNameFromFileName(asString(item.file_name));
    const result = await withNexusStateScopeByDb(
      db,
      {
        writeRequest: true,
        lockOwner: `schedule_import_${payload.jobId}_${payload.itemId}`,
      },
      async () => {
        const store = getNexusStore();
        return upsertClassScheduleInStore(store, {
          studentNo: asString(item.student_no),
          term: asString(item.term) || DEFAULT_TERM,
          parsedName,
          courses: Array.isArray(parsed.courses) ? parsed.courses : [],
        });
      },
    );

    await finalizeItemStatus(db, payload.jobId, payload.itemId, {
      status: "success",
      entryCount: result.entryCount,
      scheduleId: result.scheduleId,
      versionNo: result.versionNo,
      startedAt: now,
    });
    if (typeof bucket.delete === "function") {
      await bucket.delete(asString(item.r2_key));
    }
    const summary = await computeJobSummary(db, payload.jobId);
    await updateJobBySummary(db, payload.jobId, summary);
    return { action: "ack" as const };
  } catch (error) {
    const message = serializeScheduleImportError(error);
    const shouldRetry = nextAttempt < MAX_RETRY_ATTEMPTS;
    await finalizeItemStatus(db, payload.jobId, payload.itemId, {
      status: shouldRetry ? "retrying" : "failed",
      error: message,
      startedAt: now,
    });
    const summary = await computeJobSummary(db, payload.jobId);
    await updateJobBySummary(db, payload.jobId, summary);
    if (!shouldRetry && typeof bucket.delete === "function") {
      await bucket.delete(asString(item.r2_key));
    }
    return { action: shouldRetry ? ("retry" as const) : ("ack" as const) };
  }
};

export const consumeScheduleImportQueueBatch = async (env: unknown, batch: QueueBatchLike) => {
  const db = resolveNexusDbFromEnv(env);
  const bucket = resolveImportBucketFromEnv(env);
  if (!db || !bucket) {
    return;
  }
  await ensureImportTables(db);
  const messages = Array.isArray(batch.messages) ? batch.messages : [];
  for (const message of messages) {
    const payload = parseQueuePayload(message.body);
    if (!payload) {
      message.ack?.();
      continue;
    }
    const result = await processScheduleImportQueueMessage(db, bucket, payload);
    if (result.action === "retry") {
      message.retry?.();
      continue;
    }
    message.ack?.();
  }
};

export const listRecentScheduleImportJobIds = async (event: H3Event, limit = 20) => {
  const db = resolveNexusDb(event);
  if (!db) {
    throw new Error("NEXUS_DB 未配置");
  }
  await ensureImportTables(db);
  const safeLimit = Math.max(1, Math.min(100, toInt(limit, 20)));
  const rows = await db
    .prepare(
      `SELECT id
       FROM schedule_import_jobs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(safeLimit);
  const listRows = await queryAll<{ id?: string }>(rows);
  return listRows.map((row) => asString(row.id)).filter((item) => item !== "");
};

export const resolveScheduleImportDebugContext = (event: H3Event) => {
  const url = getRequestURL(event);
  return {
    path: url.pathname,
    search: url.search,
  };
};
