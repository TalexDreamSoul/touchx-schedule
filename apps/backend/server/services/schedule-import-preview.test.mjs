import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadPreviewModule = async () => {
  const sourcePath = join(import.meta.dirname, "schedule-import-preview.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-schedule-preview-")), "schedule-import-preview.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("builds editable preview entries from parsed PDF courses", async () => {
  const preview = await loadPreviewModule();

  const entries = preview.buildScheduleImportPreviewEntries([
    {
      name: "人工智能导论",
      day: 1,
      startSection: 1,
      endSection: 2,
      weekExpr: "1-16",
      parity: "odd",
      classroom: "10-512",
      teacher: "张老师",
    },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].previewEntryId, "preview_1");
  assert.equal(entries[0].sourceIndex, 0);
  assert.equal(entries[0].courseName, "人工智能导论");
  assert.equal(entries[0].parity, "odd");
  assert.equal(entries[0].confidence, 0.88);
});

test("normalizes edited preview entries back to importable courses", async () => {
  const preview = await loadPreviewModule();

  const courses = preview.normalizeScheduleImportPreviewCourses([
    {
      previewEntryId: "preview_1",
      sourceIndex: 0,
      courseName: "人工智能导论 修正",
      day: 1,
      startSection: 1,
      endSection: 2,
      weekExpr: "1-16",
      parity: "all",
      classroom: "10-513",
      teacher: "张老师",
      confidence: 0.88,
    },
  ]);

  assert.equal(courses.length, 1);
  assert.equal(courses[0].name, "人工智能导论 修正");
  assert.equal(courses[0].classroom, "10-513");
  assert.equal(courses[0].parity, "all");
});

test("rejects empty or invalid preview entries before confirmation", async () => {
  const preview = await loadPreviewModule();

  assert.throws(() => {
    preview.normalizeScheduleImportPreviewCourses([
      {
        previewEntryId: "preview_1",
        sourceIndex: 0,
        courseName: "",
        day: 8,
        startSection: 1,
        endSection: 2,
        weekExpr: "1-16",
        parity: "all",
        classroom: "",
        teacher: "",
        confidence: 0.88,
      },
    ]);
  }, /SCHEDULE_IMPORT_PREVIEW_ENTRY_INVALID/);
});
