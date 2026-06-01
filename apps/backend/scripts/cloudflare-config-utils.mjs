import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const backendRoot = resolve(import.meta.dirname, "..");
export const wranglerPath = join(backendRoot, "wrangler.toml");

export const requiredMigrationFiles = [
  "001_nexus_state.sql",
  "002_schedule_import_jobs.sql",
  "003_schedule_reminder_deliveries.sql",
];

export const readWranglerToml = () => readFileSync(wranglerPath, "utf8");

export const extractBlocks = (toml, header) => {
  const blocks = [];
  let current = null;
  for (const line of toml.split(/\r?\n/)) {
    if (line.trim() === header) {
      if (current) {
        blocks.push(current.join("\n"));
      }
      current = [];
      continue;
    }
    if (/^\s*\[/.test(line)) {
      if (current) {
        blocks.push(current.join("\n"));
        current = null;
      }
      continue;
    }
    if (current) {
      current.push(line);
    }
  }
  if (current) {
    blocks.push(current.join("\n"));
  }
  return blocks;
};

export const extractValue = (block, key) => {
  const match = block.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"));
  return match?.[1] || "";
};

export const getCloudflareConfig = (toml = readWranglerToml()) => {
  const r2Blocks = extractBlocks(toml, "[[r2_buckets]]");
  const d1Blocks = extractBlocks(toml, "[[d1_databases]]");
  const queueProducerBlocks = extractBlocks(toml, "[[queues.producers]]");
  const queueConsumerBlocks = extractBlocks(toml, "[[queues.consumers]]");
  const triggerBlocks = extractBlocks(toml, "[triggers]");

  return {
    toml,
    workerName: extractValue(toml, "name"),
    r2Buckets: r2Blocks.map((block) => ({
      binding: extractValue(block, "binding"),
      bucketName: extractValue(block, "bucket_name"),
    })),
    d1Databases: d1Blocks.map((block) => ({
      binding: extractValue(block, "binding"),
      databaseName: extractValue(block, "database_name"),
      databaseId: extractValue(block, "database_id"),
    })),
    queueProducers: queueProducerBlocks.map((block) => ({
      binding: extractValue(block, "binding"),
      queue: extractValue(block, "queue"),
    })),
    queueConsumers: queueConsumerBlocks.map((block) => ({
      queue: extractValue(block, "queue"),
    })),
    triggerBlocks,
    migrations: requiredMigrationFiles.map((fileName) => ({
      fileName,
      path: join(backendRoot, "server/data/migrations", fileName),
      exists: existsSync(join(backendRoot, "server/data/migrations", fileName)),
    })),
  };
};
