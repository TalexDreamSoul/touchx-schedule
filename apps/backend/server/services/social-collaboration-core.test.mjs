import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const loadCoreModule = async () => {
  const sourcePath = join(import.meta.dirname, "social-collaboration-core.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-social-core-")), "social-collaboration-core.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

test("normalizes collaboration visibility to the supported scopes", async () => {
  const core = await loadCoreModule();

  assert.equal(core.normalizeVisibilityScope("detail"), "detail");
  assert.equal(core.normalizeVisibilityScope("blocked"), "blocked");
  assert.equal(core.normalizeVisibilityScope("unknown", "hidden"), "hidden");
  assert.equal(core.normalizeVisibilityScope("", "busy_free"), "busy_free");
});

test("keeps social activity status transitions inside the activity state machine", async () => {
  const core = await loadCoreModule();

  assert.equal(core.resolveNextActivityStatus("draft", "send"), "inviting");
  assert.equal(core.resolveNextActivityStatus("inviting", "confirm"), "confirmed");
  assert.equal(core.resolveNextActivityStatus("inviting", "cancel"), "cancelled");
  assert.equal(core.resolveNextActivityStatus("confirmed", "expire"), "confirmed");
});

test("extracts first-pass schedule intelligence without requiring an LLM", async () => {
  const core = await loadCoreModule();

  const parsed = core.buildScheduleIntelligence("下周三下午3点考试复习，周一三五下午2-4点训练 DDL");

  assert.equal(parsed.tags.includes("学习"), true);
  assert.equal(parsed.tags.includes("运动"), true);
  assert.equal(parsed.priorityLabel, "high");
  assert.equal(parsed.examLike, true);
  assert.equal(parsed.repeatWeekdays.join(","), "1,3,5");
  assert.equal(parsed.suggestedDay, 1);
  assert.equal(parsed.suggestedStartSection, 6);
  assert.equal(parsed.suggestedEndSection, 6);

  const batchParsed = core.buildScheduleIntelligence("周一三五下午2-4点训练");
  assert.equal(batchParsed.repeatWeekdays.join(","), "1,3,5");
  assert.equal(batchParsed.suggestedStartSection, 5);
  assert.equal(batchParsed.suggestedEndSection, 7);
});
