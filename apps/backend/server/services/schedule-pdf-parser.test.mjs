import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import test from "node:test";
import ts from "typescript";

const loadParserModule = async () => {
  const sourcePath = join(import.meta.dirname, "schedule-pdf-parser.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-schedule-pdf-parser-")), "schedule-pdf-parser.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

const encodePdfLiteral = (value) => {
  const bytes = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint > 0xffff) {
      throw new Error("test fixture only supports BMP characters");
    }
    bytes.push((codePoint >> 8) & 0xff, codePoint & 0xff);
  }
  return bytes.map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");
};

const buildSchedulePdfBytes = (tokens) => {
  const stream = tokens
    .map((token) => `1 0 0 1 ${token.x} ${token.y} Tm (${encodePdfLiteral(token.text)}) Tj`)
    .join("\n");
  return Buffer.concat([Buffer.from("stream\n", "latin1"), deflateSync(Buffer.from(stream, "latin1")), Buffer.from("\nendstream", "latin1")]);
};

test("preserves compound week ranges from schedule PDFs", async () => {
  const parser = await loadParserModule();
  const parsed = parser.parseSchedulePdf(
    buildSchedulePdfBytes([
      { x: 20, y: 700, text: "唐子贤课表" },
      { x: 104.08, y: 505.5, text: "并行与分布式计算" },
      { x: 104.08, y: 493.5, text: "(1-2节)1-5周,7-17周/场地:10-511/教师:王站东/教学班组成:计算机科学与技术23(3)/周学时:2" },
      { x: 104.08, y: 406, text: "人工智能导论" },
      { x: 104.08, y: 394, text: "(3-4节)1-17周/场地:10-511/教师:付春龍/教学班组成:计算机科学与技术23(3)/周学时:2" },
      { x: 104.08, y: 199, text: "信息安全工程" },
      { x: 104.08, y: 187, text: "(5-6节)9-11周(单),12-16周/场地:10-305/教师:张毅/教学班组成:计算机科学与技术23(3)/周学时:1" },
      { x: 104.08, y: 89.5, text: "web 应用开发-II" },
      { x: 104.08, y: 77.5, text: "(5-7节)1-3周,5-8周/场地:IT实训工作坊(I)/教师:刘国芳/教学班组成:计算机科学与技术23(3)/周学时:1.5" },
      { x: 104.08, y: 529.5, text: "web 应用开发-II" },
      { x: 104.08, y: 517.5, text: "(5-7节)4周/场地:10-304/教师:刘国芳/教学班组成:计算机科学与技术23(3)/周学时:1.5" },
      { x: 104.08, y: 427, text: "信息安全工程" },
      { x: 104.08, y: 415, text: "(9-10节)1-9周,11-16周/场地:5-509/教师:张毅/教学班组成:计算机科学与技术23(3)/周学时:2" },
    ]),
  );

  assert.equal(parsed.name, "唐子贤");
  assert.equal(parsed.courses.length, 10);

  const monday = parsed.courses.filter((course) => course.day === 1);
  assert.deepEqual(
    monday.map((course) => ({
      name: course.name,
      section: `${course.startSection}-${course.endSection}`,
      weekExpr: course.weekExpr,
      parity: course.parity || "all",
      classroom: course.classroom,
    })),
    [
      { name: "并行与分布式计算", section: "1-2", weekExpr: "1-5", parity: "all", classroom: "10-511" },
      { name: "并行与分布式计算", section: "1-2", weekExpr: "7-17", parity: "all", classroom: "10-511" },
      { name: "人工智能导论", section: "3-4", weekExpr: "1-17", parity: "all", classroom: "10-511" },
      { name: "信息安全工程", section: "5-6", weekExpr: "9-11", parity: "odd", classroom: "10-305" },
      { name: "信息安全工程", section: "5-6", weekExpr: "12-16", parity: "all", classroom: "10-305" },
      { name: "web 应用开发-II", section: "5-7", weekExpr: "1-3", parity: "all", classroom: "IT实训工作坊(I)" },
      { name: "web 应用开发-II", section: "5-7", weekExpr: "5-8", parity: "all", classroom: "IT实训工作坊(I)" },
      { name: "web 应用开发-II", section: "5-7", weekExpr: "4", parity: "all", classroom: "10-304" },
      { name: "信息安全工程", section: "9-10", weekExpr: "1-9", parity: "all", classroom: "5-509" },
      { name: "信息安全工程", section: "9-10", weekExpr: "11-16", parity: "all", classroom: "5-509" },
    ],
  );
});
