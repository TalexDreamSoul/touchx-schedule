import type { ImportCandidateEvent, ImportJob } from "@touchx/shared";

const asString = (value: unknown) => String(value || "").trim();

export const normalizeImportJobStatus = (value: unknown): ImportJob["status"] => {
  const status = asString(value);
  if (status === "uploaded" || status === "parsing" || status === "parsed" || status === "reviewing" || status === "committed" || status === "failed") {
    return status;
  }
  return "uploaded";
};

export const normalizeImportCandidateStatus = (value: unknown): ImportCandidateEvent["status"] => {
  const status = asString(value);
  if (status === "accepted" || status === "rejected" || status === "corrected") {
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
      acc.total += 1;
      acc[item.status] += 1;
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
