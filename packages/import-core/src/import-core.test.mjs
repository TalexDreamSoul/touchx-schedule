import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "../../..");
const esbuildBin = [
  "node_modules/.pnpm/esbuild@0.27.3/node_modules/esbuild/bin/esbuild",
  "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild",
  "node_modules/.pnpm/esbuild@0.20.2/node_modules/esbuild/bin/esbuild",
  "node_modules/.pnpm/esbuild@0.18.20/node_modules/esbuild/bin/esbuild",
].map((item) => join(repoRoot, item)).find((item) => existsSync(item));

if (!esbuildBin) {
  throw new Error("esbuild binary is required to run import-core tests");
}

const outDir = "/tmp/touchx-import-core-test";
const outFile = join(outDir, "import-core.mjs");
await mkdir(outDir, { recursive: true });
execFileSync(esbuildBin, [
  join(repoRoot, "packages/import-core/src/index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${outFile}`,
], { stdio: "pipe" });

const core = await import(outFile);

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
