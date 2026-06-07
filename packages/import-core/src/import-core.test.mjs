import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { bundleTsModule, repoRoot } from "../../test-utils/bundle-ts-module.mjs";

const core = await bundleTsModule(join(repoRoot, "packages/import-core/src/index.ts"), {
  outFileName: "import-core.mjs",
  tmpPrefix: "touchx-import-core-test",
});

const candidate = (status, confidence = 0.8) => ({
  id: `candidate-${status}`,
  jobId: "job-1",
  title: "高等数学",
  eventType: "course",
  location: "A101",
  confidence,
  warnings: [],
  rawPayload: {},
  status,
});

test("normalizes import job statuses with uploaded fallback", () => {
  assert.equal(core.normalizeImportJobStatus("reviewing"), "reviewing");
  assert.equal(core.normalizeImportJobStatus(" failed "), "failed");
  assert.equal(core.normalizeImportJobStatus("done"), "uploaded");
  assert.equal(core.normalizeImportJobStatus(null), "uploaded");
});

test("normalizes import candidate statuses with pending fallback", () => {
  assert.equal(core.normalizeImportCandidateStatus("accepted"), "accepted");
  assert.equal(core.normalizeImportCandidateStatus(" corrected "), "corrected");
  assert.equal(core.normalizeImportCandidateStatus("unknown"), "pending");
  assert.equal(core.normalizeImportCandidateStatus(undefined), "pending");
});

test("summarizes candidates and normalizes invalid persisted status", () => {
  const summary = core.summarizeImportCandidates([
    candidate("pending"),
    candidate("accepted"),
    candidate("rejected"),
    candidate("corrected"),
    candidate("legacy_unknown"),
  ]);

  assert.deepEqual(summary, {
    total: 5,
    pending: 2,
    accepted: 1,
    rejected: 1,
    corrected: 1,
  });
  assert.equal(summary.legacy_unknown, undefined);
});

test("detects actionable candidates", () => {
  assert.equal(core.isImportCandidateActionable(candidate("pending")), true);
  assert.equal(core.isImportCandidateActionable(candidate("corrected")), true);
  assert.equal(core.isImportCandidateActionable(candidate("accepted")), false);
  assert.equal(core.isImportCandidateActionable(candidate("rejected")), false);
});

test("labels import confidence by stable thresholds", () => {
  assert.equal(core.toImportConfidenceLabel(0.86), "high");
  assert.equal(core.toImportConfidenceLabel(0.85), "medium");
  assert.equal(core.toImportConfidenceLabel(0.62), "medium");
  assert.equal(core.toImportConfidenceLabel(0.61), "low");
});
