import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getCloudflareConfig } from "./cloudflare-config-utils.mjs";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const config = getCloudflareConfig();
const wranglerBaseArgs = ["--cwd", backendRoot];
const requiredWorkerSecrets = [
  "NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO",
  "NEXUS_ADMIN_LOGIN_PASSWORD",
  "NEXUS_SESSION_TOKEN_SECRET",
  "NEXUS_HEARTBEAT_TOKEN",
  "NEXUS_BOT_DELIVERY_TOKEN",
  "NEXUS_REMINDER_DELIVERY_QUEUE",
];

const runWrangler = (args, options = {}) => {
  const result = spawnSync("wrangler", [...wranglerBaseArgs, ...args], {
    cwd: backendRoot,
    encoding: "utf8",
    env: process.env,
  });
  const stdout = result.stdout?.trim() || "";
  const stderr = result.stderr?.trim() || "";

  if (result.status !== 0) {
    const detail = [stdout, stderr].filter(Boolean).join("\n");
    throw new Error(`${options.label || `wrangler ${args.join(" ")}`} failed\n${detail}`);
  }

  return stdout;
};

const parseJson = (raw, label) => {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${error.message}\n${raw}`);
  }
};

const asArray = (value, candidateKeys = []) => {
  if (Array.isArray(value)) {
    return value;
  }
  for (const key of candidateKeys) {
    if (Array.isArray(value?.[key])) {
      return value[key];
    }
  }
  return [];
};

const requireConfiguredRecords = (records, label, requiredFields) => {
  assert.ok(records.length > 0, `${label} must be configured in wrangler.toml`);
  records.forEach((record) => {
    requiredFields.forEach((field) => {
      assert.ok(record[field], `${label} record must include ${field}`);
    });
  });
};

const extractSecretNames = (payload) =>
  ([
    payload,
    payload?.result,
    payload?.secrets,
    payload?.items,
    payload?.result?.secrets,
    payload?.result?.items,
    payload?.secrets?.items,
    payload?.result?.secrets?.items,
  ]
    .find((candidate) => Array.isArray(candidate)) || [])
    .map((item) => (typeof item === "string" ? item : item?.name || item?.key || ""))
    .filter(Boolean);

requireConfiguredRecords(config.d1Databases, "D1 database", ["binding", "databaseName", "databaseId"]);
requireConfiguredRecords(config.r2Buckets, "R2 bucket", ["binding", "bucketName"]);
requireConfiguredRecords(config.queueProducers, "Queue producer", ["binding", "queue"]);

runWrangler(["whoami"], { label: "wrangler whoami" });

const d1List = asArray(
  parseJson(runWrangler(["d1", "list", "--json"], { label: "wrangler d1 list" }), "wrangler d1 list"),
  ["result", "databases", "items"],
);
config.d1Databases.forEach((database) => {
  assert.ok(
    d1List.some(
      (entry) =>
        entry.uuid === database.databaseId ||
        entry.id === database.databaseId ||
        entry.name === database.databaseName ||
        entry.database_name === database.databaseName,
    ),
    `D1 database ${database.databaseName} (${database.binding}) must exist in the Cloudflare account`,
  );
});

const r2List = runWrangler(["r2", "bucket", "list"], { label: "wrangler r2 bucket list" });
config.r2Buckets.forEach((bucket) => {
  assert.ok(
    r2List.includes(bucket.bucketName) || runWrangler(["r2", "bucket", "info", bucket.bucketName], { label: `wrangler r2 bucket info ${bucket.bucketName}` }),
    `R2 bucket ${bucket.bucketName} (${bucket.binding}) must exist in the Cloudflare account`,
  );
});

const queuesList = runWrangler(["queues", "list"], { label: "wrangler queues list" });
config.queueProducers.forEach((producer) => {
  assert.ok(
    queuesList.includes(producer.queue) || runWrangler(["queues", "info", producer.queue], { label: `wrangler queues info ${producer.queue}` }),
    `Queue ${producer.queue} (${producer.binding}) must exist in the Cloudflare account`,
  );
});

const deployments = parseJson(
  runWrangler(["deployments", "list", "--name", config.workerName, "--json"], {
    label: "wrangler deployments list",
  }),
  "wrangler deployments list",
);
const deploymentItems = asArray(deployments, ["deployments", "items", "result"]);
assert.ok(
  deploymentItems.length > 0,
  `Worker ${config.workerName} must have at least one Cloudflare deployment`,
);

const secretNames = extractSecretNames(
  parseJson(
    runWrangler(["secret", "list", "--name", config.workerName, "--format", "json"], {
      label: "wrangler secret list",
    }),
    "wrangler secret list",
  ),
);
requiredWorkerSecrets.forEach((secretName) => {
  assert.ok(
    secretNames.includes(secretName),
    `Worker ${config.workerName} must have Cloudflare secret ${secretName}`,
  );
});

config.d1Databases.forEach((database) => {
  const migrations = runWrangler(["d1", "migrations", "list", database.databaseName, "--remote"], {
    label: `wrangler d1 migrations list ${database.databaseName}`,
  });
  const unappliedRequiredMigrations = config.migrations
    .map((migration) => migration.fileName)
    .filter((fileName) => migrations.includes(fileName));
  assert.ok(
    unappliedRequiredMigrations.length === 0,
    `D1 migrations for ${database.databaseName} are still unapplied: ${unappliedRequiredMigrations.join(", ")}`,
  );
});

console.log("ok Cloudflare live resources, worker deployment, and worker secrets are visible");
