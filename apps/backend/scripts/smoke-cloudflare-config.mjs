import assert from "node:assert/strict";
import { getCloudflareConfig } from "./cloudflare-config-utils.mjs";

const requireRecordValue = (records, key, expectedValue, label) => {
  assert.ok(
    records.some((record) => record[key] === expectedValue),
    `${label} must include ${key}="${expectedValue}"`,
  );
};

const config = getCloudflareConfig();

assert.equal(config.workerName, "touchx-backend", "worker name should stay stable");
assert.ok(config.toml.includes('compatibility_flags = ["nodejs_compat"]'), "nodejs_compat flag is required");

requireRecordValue(config.r2Buckets, "binding", "MEDIA_BUCKET", "R2 buckets");
requireRecordValue(config.r2Buckets, "binding", "SCHEDULE_IMPORT_BUCKET", "R2 buckets");
requireRecordValue(config.d1Databases, "binding", "NEXUS_DB", "D1 databases");
requireRecordValue(config.queueProducers, "binding", "SCHEDULE_IMPORT_QUEUE", "queue producers");

const producerQueue = config.queueProducers.map((producer) => producer.queue).find(Boolean);
assert.equal(producerQueue, "touchx-schedule-import-queue", "schedule import producer queue name should stay stable");
requireRecordValue(config.queueConsumers, "queue", producerQueue, "queue consumers");

assert.ok(
  config.triggerBlocks.some((block) => block.includes('crons = ["*/15 0-15 * * *"]')),
  "15-minute Beijing daytime Cloudflare cron must be configured",
);

config.migrations.forEach((migration) => {
  assert.ok(migration.exists, `migration ${migration.fileName} must exist`);
});

console.log("ok Cloudflare config bindings, cron, and migrations");
