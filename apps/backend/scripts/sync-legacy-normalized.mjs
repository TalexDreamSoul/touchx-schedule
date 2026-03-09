import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const usersCsvPath = path.join(repoRoot, "apps/microapp/src/data/normalized/users.normalized.csv");
const coursesCsvPath = path.join(repoRoot, "apps/microapp/src/data/normalized/courses.normalized.csv");
const outputDir = path.join(repoRoot, "apps/backend/server/data/legacy");

const parseCsv = (source) => {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length <= 1) {
    return [];
  }
  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
};

const readRequiredFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
};

const usersCsv = readRequiredFile(usersCsvPath);
const coursesCsv = readRequiredFile(coursesCsvPath);
const users = parseCsv(usersCsv);
const courses = parseCsv(coursesCsv);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "users.normalized.json"), `${JSON.stringify(users, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputDir, "courses.normalized.json"), `${JSON.stringify(courses, null, 2)}\n`, "utf8");

console.log(`✅ legacy 数据已同步`);
console.log(`- users: ${users.length}`);
console.log(`- courses: ${courses.length}`);
console.log(`- output: ${outputDir}`);
