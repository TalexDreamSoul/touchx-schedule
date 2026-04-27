import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadHistoryModule = async () => {
  const sourcePath = join(import.meta.dirname, "schedule-import-history.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-schedule-history-")), "schedule-import-history.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("marks preview jobs as resumable confirmation tasks", async () => {
  const history = await loadHistoryModule();

  const [item] = history.normalizeScheduleImportJobSummaryRows([
    {
      id: "job_1",
      status: "preview_ready",
      total_files: 1,
      processed_files: 1,
      success_count: 1,
      fail_count: 0,
      created_by_user_id: "user_1",
      created_at: "2026-04-27T01:00:00.000Z",
      updated_at: "2026-04-27T01:01:00.000Z",
      finished_at: "2026-04-27T01:01:00.000Z",
      file_name: "唐子贤.pdf",
      student_no: "2305100613",
      term: "2025-2026-2",
      item_status: "preview_ready",
      entry_count: 15,
      schedule_id: "",
      version_no: 0,
    },
  ]);

  assert.equal(item.jobId, "job_1");
  assert.equal(item.canResumePreview, true);
  assert.equal(item.confirmed, false);
  assert.equal(item.entryCount, 15);
});

test("marks confirmed jobs as completed imports", async () => {
  const history = await loadHistoryModule();

  const [item] = history.normalizeScheduleImportJobSummaryRows([
    {
      id: "job_2",
      status: "confirmed",
      total_files: 1,
      processed_files: 1,
      success_count: 1,
      fail_count: 0,
      created_by_user_id: "user_1",
      created_at: "2026-04-27T02:00:00.000Z",
      updated_at: "2026-04-27T02:02:00.000Z",
      finished_at: "2026-04-27T02:02:00.000Z",
      file_name: "唐子贤.pdf",
      student_no: "2305100613",
      term: "2025-2026-2",
      item_status: "confirmed",
      entry_count: 15,
      schedule_id: "schedule_1",
      version_no: 3,
    },
  ]);

  assert.equal(item.canResumePreview, false);
  assert.equal(item.confirmed, true);
  assert.equal(item.scheduleId, "schedule_1");
  assert.equal(item.versionNo, 3);
});
