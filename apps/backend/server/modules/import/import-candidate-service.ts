import type { CalendarEventType, ImportCandidateEvent, ImportJob } from "@touchx/shared";
import { normalizeImportCandidateStatus, summarizeImportCandidates } from "@touchx/import-core";
import type { NexusStore, ScheduleEntryRecord, ScheduleVersionRecord, UserScheduleEventRecord } from "../../services/domain-store";
import type { ScheduleImportPreviewEntry } from "../../services/schedule-import-preview";
import { storeHelpers } from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

const normalizeEventType = (value: unknown): CalendarEventType => {
  const text = asString(value) as CalendarEventType;
  if (text === "course" || text === "exam" || text === "todo" || text === "activity" || text === "holiday" || text === "deadline" || text === "custom") {
    return text;
  }
  return "course";
};

export const createManualImportJob = (
  store: NexusStore,
  input: {
    ownerUserId: string;
    type?: ImportJob["type"];
    rawText?: string;
    targetSourceId?: string;
  },
) => {
  const now = storeHelpers.nowIso();
  const job: ImportJob = {
    id: storeHelpers.createId("import_job"),
    type: input.type || "manual",
    status: "reviewing",
    ownerUserId: input.ownerUserId,
    targetSourceId: asString(input.targetSourceId) || undefined,
    rawText: asString(input.rawText),
    parserVersion: "manual-v1",
    createdAt: now,
    updatedAt: now,
  };
  store.importJobs.unshift(job);
  return job;
};

const normalizePreviewWeekday = (value: unknown) => {
  const day = Number(value);
  return Number.isFinite(day) ? Math.max(1, Math.min(7, Math.trunc(day))) : undefined;
};

const getPreviewValue = (entry: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = entry[key];
    if (asString(value)) return value;
  }
  return undefined;
};

export const createCandidatesFromScheduleImportPreview = (
  store: NexusStore,
  input: {
    ownerUserId: string;
    legacyJobId: string;
    previewEntries: ScheduleImportPreviewEntry[];
    targetSourceId?: string;
    rawText?: string;
  },
) => {
  const job = createManualImportJob(store, {
    ownerUserId: input.ownerUserId,
    type: "pdf",
    rawText: input.rawText || `legacy schedule import ${input.legacyJobId}`,
    targetSourceId: input.targetSourceId,
  });
  job.parserVersion = "schedule-import-preview-v1";
  job.rawPayload = { legacyJobId: input.legacyJobId, previewCount: input.previewEntries.length } as Record<string, unknown>;
  const candidates = input.previewEntries.map((entry) => {
    const record = entry as unknown as Record<string, unknown>;
    return createImportCandidateEvent(store, {
      jobId: job.id,
      title: asString(getPreviewValue(record, ["courseName", "title", "name"])) || "未命名课程",
      eventType: "course",
      location: asString(getPreviewValue(record, ["classroom", "location", "room"])),
      weekday: normalizePreviewWeekday(getPreviewValue(record, ["day", "weekday"])),
      weekExpr: asString(getPreviewValue(record, ["weekExpr", "weeks"])),
      startSection: Number(getPreviewValue(record, ["startSection", "start_section"])),
      endSection: Number(getPreviewValue(record, ["endSection", "end_section"])),
      confidence: 0.82,
      warnings: [],
      rawPayload: { ...record, legacyJobId: input.legacyJobId },
    });
  });
  return { job, candidates };
};

export const createImportCandidateEvent = (
  store: NexusStore,
  input: {
    jobId: string;
    title: string;
    eventType?: CalendarEventType;
    location?: string;
    weekday?: number;
    weekExpr?: string;
    startSection?: number;
    endSection?: number;
    date?: string;
    confidence?: number;
    warnings?: string[];
    rawPayload?: Record<string, unknown>;
  },
) => {
  const candidate: ImportCandidateEvent = {
    id: storeHelpers.createId("import_candidate"),
    jobId: input.jobId,
    title: asString(input.title) || "未命名候选事件",
    eventType: normalizeEventType(input.eventType),
    location: asString(input.location),
    weekday: Number.isFinite(Number(input.weekday)) ? Math.max(1, Math.min(7, Math.trunc(Number(input.weekday)))) : undefined,
    weekExpr: asString(input.weekExpr) || undefined,
    startSection: Number.isFinite(Number(input.startSection)) ? Math.max(1, Math.trunc(Number(input.startSection))) : undefined,
    endSection: Number.isFinite(Number(input.endSection)) ? Math.max(1, Math.trunc(Number(input.endSection))) : undefined,
    date: asString(input.date) || undefined,
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.75))),
    warnings: Array.isArray(input.warnings) ? input.warnings.map((item) => asString(item)).filter(Boolean) : [],
    rawPayload: input.rawPayload || {},
    status: "pending",
  };
  if (candidate.startSection && candidate.endSection) {
    candidate.endSection = Math.max(candidate.startSection, candidate.endSection);
  }
  store.importCandidateEvents.push(candidate);
  return candidate;
};

export const listImportJobsWithCandidates = (store: NexusStore) => {
  const items = store.importJobs.map((job) => {
    const candidates = store.importCandidateEvents.filter((item) => item.jobId === job.id);
    return {
      ...job,
      candidateSummary: summarizeImportCandidates(candidates),
    };
  });
  return { items, total: items.length };
};

export const listImportCandidates = (store: NexusStore, jobId: string) => {
  const items = store.importCandidateEvents.filter((item) => item.jobId === jobId);
  return {
    items,
    total: items.length,
    summary: summarizeImportCandidates(items),
  };
};

const resolveScheduleIdFromSourceId = (sourceId: string) => asString(sourceId).replace(/^schedule:/, "");

const findLatestScheduleVersion = (store: NexusStore, scheduleId: string) => {
  return store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId)
    .sort((left, right) => right.versionNo - left.versionNo)[0] || null;
};

const findPublishedScheduleVersion = (store: NexusStore, scheduleId: string, versionNo = 0) => {
  if (versionNo > 0) {
    return store.scheduleVersions.find((item) => item.scheduleId === scheduleId && item.versionNo === versionNo && item.status === "published") || null;
  }
  return store.scheduleVersions
    .filter((item) => item.scheduleId === scheduleId && item.status === "published")
    .sort((left, right) => right.versionNo - left.versionNo)[0] || null;
};

const cloneEntry = (entry: ScheduleEntryRecord): ScheduleEntryRecord => ({
  id: entry.id,
  day: entry.day,
  startSection: entry.startSection,
  endSection: entry.endSection,
  weekExpr: entry.weekExpr,
  parity: entry.parity,
  courseName: entry.courseName,
  classroom: entry.classroom,
  teacher: entry.teacher,
});

const toScheduleEntryFromCandidate = (candidate: ImportCandidateEvent): ScheduleEntryRecord => ({
  id: storeHelpers.createId("entry"),
  day: Math.max(1, Math.min(7, Number(candidate.weekday || 1))),
  startSection: Math.max(1, Number(candidate.startSection || 1)),
  endSection: Math.max(Number(candidate.startSection || 1), Number(candidate.endSection || candidate.startSection || 1)),
  weekExpr: candidate.weekExpr || "1-25",
  parity: "all",
  courseName: candidate.title,
  classroom: candidate.location,
  teacher: asString(candidate.rawPayload?.teacher || candidate.rawPayload?.teacherOrOwner),
});

export const commitImportCandidateToCalendarSource = (
  store: NexusStore,
  input: {
    candidateId: string;
    sourceId?: string;
    actorUserId: string;
    publish?: boolean;
  },
) => {
  const candidate = store.importCandidateEvents.find((item) => item.id === input.candidateId) || null;
  if (!candidate) {
    return null;
  }
  const job = store.importJobs.find((item) => item.id === candidate.jobId) || null;
  const targetSourceId = asString(input.sourceId) || asString(job?.targetSourceId) || (store.schedules[0] ? `schedule:${store.schedules[0].id}` : "");
  const scheduleId = resolveScheduleIdFromSourceId(targetSourceId);
  const schedule = store.schedules.find((item) => item.id === scheduleId) || null;
  if (!schedule) {
    return "source_not_found" as const;
  }
  const baseVersion = findPublishedScheduleVersion(store, schedule.id, schedule.publishedVersionNo) || findLatestScheduleVersion(store, schedule.id);
  const nextVersionNo = (baseVersion?.versionNo || 0) + 1;
  const entries = (baseVersion?.entries || []).map((entry) => cloneEntry(entry));
  const entry = toScheduleEntryFromCandidate(candidate);
  entries.push(entry);
  const now = storeHelpers.nowIso();
  const shouldPublish = input.publish !== false;
  const version: ScheduleVersionRecord = {
    id: storeHelpers.createId("schedule_version"),
    scheduleId: schedule.id,
    versionNo: nextVersionNo,
    status: shouldPublish ? "published" : "draft",
    entries,
    createdByUserId: input.actorUserId,
    createdAt: now,
  };
  store.scheduleVersions.push(version);
  if (shouldPublish) {
    schedule.publishedVersionNo = nextVersionNo;
  }
  schedule.updatedAt = now;
  candidate.status = "accepted";
  candidate.rawPayload = {
    ...candidate.rawPayload,
    committedTo: "calendar_source",
    publish: shouldPublish,
    sourceId: targetSourceId,
    scheduleId: schedule.id,
    scheduleVersionId: version.id,
    versionNo: nextVersionNo,
    entryId: entry.id,
    committedAt: now,
  };
  if (job) {
    job.status = "committed";
    job.targetSourceId = targetSourceId;
    job.updatedAt = now;
  }
  return { schedule, version, entry, candidate };
};

export const commitImportCandidateToPersonalEvent = (
  store: NexusStore,
  input: {
    candidateId: string;
    userId: string;
  },
) => {
  const candidate = store.importCandidateEvents.find((item) => item.id === input.candidateId) || null;
  if (!candidate) {
    return null;
  }
  const now = storeHelpers.nowIso();
  const event: UserScheduleEventRecord = {
    id: storeHelpers.createId("user_event"),
    userId: input.userId,
    title: candidate.title,
    description: candidate.warnings.length > 0 ? candidate.warnings.join("；") : "由导入候选事件提交",
    source: candidate.eventType === "exam" ? "exam" : candidate.eventType === "activity" ? "activity" : "manual",
    day: Math.max(1, Math.min(7, Number(candidate.weekday || 1))),
    startSection: Math.max(1, Number(candidate.startSection || 1)),
    endSection: Math.max(Number(candidate.startSection || 1), Number(candidate.endSection || candidate.startSection || 1)),
    weekExpr: candidate.weekExpr || "1-25",
    parity: "all",
    tags: ["import", candidate.eventType],
    priorityScore: candidate.eventType === "exam" || candidate.eventType === "deadline" ? 80 : 50,
    priorityLabel: candidate.eventType === "exam" || candidate.eventType === "deadline" ? "high" : "normal",
    examDate: candidate.date || "",
    createdAt: now,
    updatedAt: now,
  };
  store.userScheduleEvents.push(event);
  candidate.status = "accepted";
  candidate.rawPayload = {
    ...candidate.rawPayload,
    committedTo: "personal_event",
    personalEventId: event.id,
    committedAt: now,
  };
  const job = store.importJobs.find((item) => item.id === candidate.jobId) || null;
  if (job) {
    job.status = "committed";
    job.updatedAt = now;
  }
  return { event, candidate };
};

export const updateImportCandidateStatus = (
  store: NexusStore,
  candidateId: string,
  status: unknown,
  patch: Partial<ImportCandidateEvent> = {},
) => {
  const candidate = store.importCandidateEvents.find((item) => item.id === candidateId) || null;
  if (!candidate) {
    return null;
  }
  if (patch.title !== undefined) candidate.title = asString(patch.title) || candidate.title;
  if (patch.location !== undefined) candidate.location = asString(patch.location);
  if (patch.weekday !== undefined) candidate.weekday = Math.max(1, Math.min(7, Math.trunc(Number(patch.weekday))));
  if (patch.weekExpr !== undefined) candidate.weekExpr = asString(patch.weekExpr);
  if (patch.startSection !== undefined) candidate.startSection = Math.max(1, Math.trunc(Number(patch.startSection)));
  if (patch.endSection !== undefined) candidate.endSection = Math.max(Number(candidate.startSection || 1), Math.trunc(Number(patch.endSection)));
  if (patch.date !== undefined) candidate.date = asString(patch.date);
  candidate.status = normalizeImportCandidateStatus(status);
  return candidate;
};
