import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../..");

const compareVersionDesc = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left.version[index] !== right.version[index]) {
      return right.version[index] - left.version[index];
    }
  }
  return 0;
};

const resolveEsbuildBin = () => {
  const directBin = join(repoRoot, "node_modules/.bin/esbuild");
  if (existsSync(directBin)) {
    return directBin;
  }

  const pnpmStore = join(repoRoot, "node_modules/.pnpm");
  if (!existsSync(pnpmStore)) {
    throw new Error("esbuild binary is required to run package tests");
  }

  const candidates = readdirSync(pnpmStore)
    .map((entry) => {
      const match = /^esbuild@(\d+)\.(\d+)\.(\d+)/.exec(entry);
      if (!match) {
        return undefined;
      }
      const binPath = join(pnpmStore, entry, "node_modules/esbuild/bin/esbuild");
      if (!existsSync(binPath)) {
        return undefined;
      }
      return {
        binPath,
        version: match.slice(1).map((item) => Number(item)),
      };
    })
    .filter(Boolean)
    .sort(compareVersionDesc);

  if (!candidates[0]) {
    throw new Error("esbuild binary is required to run package tests");
  }
  return candidates[0].binPath;
};

export const bundleTsModule = async (sourcePath, options = {}) => {
  const outDir = await mkdtemp(join(tmpdir(), `${options.tmpPrefix || "touchx-package-test"}-`));
  const outFile = join(outDir, options.outFileName || `${basename(sourcePath, ".ts")}.mjs`);
  await mkdir(outDir, { recursive: true });

  execFileSync(resolveEsbuildBin(), [
    sourcePath,
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${outFile}`,
  ], { stdio: "pipe" });

  return import(outFile);
};
