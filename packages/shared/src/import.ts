import type { CalendarEventType } from "./calendar";

export const IMPORT_JOB_TYPES = ["pdf", "image", "academic_system", "text", "manual"] as const;
export const IMPORT_JOB_STATUSES = ["uploaded", "parsing", "parsed", "reviewing", "committed", "failed"] as const;
export const IMPORT_CANDIDATE_STATUSES = ["pending", "accepted", "rejected", "corrected"] as const;

export type ImportJobType = (typeof IMPORT_JOB_TYPES)[number];
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];
export type ImportCandidateEventStatus = (typeof IMPORT_CANDIDATE_STATUSES)[number];

export interface ImportJob {
  id: string;
  type: ImportJobType;
  status: ImportJobStatus;
  ownerUserId: string;
  targetSourceId?: string;
  fileObjectKey?: string;
  rawText?: string;
  rawPayload?: Record<string, unknown>;
  parserVersion: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportCandidateEvent {
  id: string;
  jobId: string;
  title: string;
  eventType: CalendarEventType;
  location: string;
  weekday?: number;
  weekExpr?: string;
  startSection?: number;
  endSection?: number;
  date?: string;
  confidence: number;
  warnings: string[];
  rawPayload: Record<string, unknown>;
  status: ImportCandidateEventStatus;
}

export interface ImportCommitResult {
  jobId: string;
  acceptedCount: number;
  rejectedCount: number;
  targetSourceId?: string;
  createdPersonalEventIds?: string[];
  createdSourceEventIds?: string[];
}
