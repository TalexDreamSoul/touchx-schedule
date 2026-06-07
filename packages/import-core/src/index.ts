import {
  IMPORT_CANDIDATE_STATUSES,
  IMPORT_JOB_STATUSES,
  type ImportCandidateEvent,
  type ImportJob,
} from "@touchx/shared";

const asString = (value: unknown) => String(value || "").trim();

const isOneOf = <T extends readonly string[]>(items: T, value: string): value is T[number] => {
  return (items as readonly string[]).includes(value);
};

export const normalizeImportJobStatus = (value: unknown): ImportJob["status"] => {
  const status = asString(value);
  if (isOneOf(IMPORT_JOB_STATUSES, status)) {
    return status;
  }
  return "uploaded";
};

export const normalizeImportCandidateStatus = (value: unknown): ImportCandidateEvent["status"] => {
  const status = asString(value);
  if (isOneOf(IMPORT_CANDIDATE_STATUSES, status)) {
    return status;
  }
  return "pending";
};

export const isImportCandidateActionable = (candidate: ImportCandidateEvent) => {
  return candidate.status === "pending" || candidate.status === "corrected";
};

export const summarizeImportCandidates = (items: ImportCandidateEvent[]) => {
  return items.reduce(
    (acc, item) => {
      const status = normalizeImportCandidateStatus(item.status);
      acc.total += 1;
      acc[status] += 1;
      return acc;
    },
    {
      total: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      corrected: 0,
    },
  );
};

export const toImportConfidenceLabel = (confidence: number) => {
  if (confidence >= 0.86) return "high";
  if (confidence >= 0.62) return "medium";
  return "low";
};
