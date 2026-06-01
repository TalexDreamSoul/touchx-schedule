import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");

const readSource = (relativePath) => {
  const absolutePath = resolve(repoRoot, relativePath);
  return {
    absolutePath,
    source: readFileSync(absolutePath, "utf8"),
  };
};

const assertContains = (file, needle) => {
  assert.ok(file.source.includes(needle), `${file.absolutePath} must include ${needle}`);
};

const assertNotContains = (file, needle) => {
  assert.ok(!file.source.includes(needle), `${file.absolutePath} must not include ${needle}`);
};

const rootPackage = readSource("package.json");
const backendPackage = readSource("apps/backend/package.json");
const migration = readSource("apps/backend/server/data/migrations/001_nexus_state.sql");
const stateManager = readSource("apps/backend/server/services/nexus-state-manager.ts");
const domainStore = readSource("apps/backend/server/services/domain-store.ts");
const verifyLocal = readSource("apps/backend/scripts/verify-v1-local.sh");

assertContains(migration, "CREATE TABLE IF NOT EXISTS nexus_state");
assertContains(migration, "id INTEGER PRIMARY KEY CHECK (id = 1)");
assertContains(migration, "revision INTEGER NOT NULL");
assertContains(migration, "payload TEXT NOT NULL");
assertContains(migration, "CREATE TABLE IF NOT EXISTS nexus_write_lock");
assertNotContains(migration, "postgres");

assertContains(stateManager, "NEXUS_STATE_PAYLOAD_EMPTY");
assertContains(stateManager, "NEXUS_STATE_PAYLOAD_INVALID_JSON");
assertContains(stateManager, "NEXUS_STATE_PAYLOAD_INVALID_SHAPE");
assertContains(stateManager, "refusing to bootstrap over persisted state");
assertContains(stateManager, "statusCode = 503");
assertContains(stateManager, "SELECT revision, payload FROM nexus_state WHERE id = ?");
assertContains(stateManager, "ON CONFLICT(id) DO UPDATE");

assertContains(domainStore, "createBootstrapStore");
assertContains(domainStore, "upgradeDefaultAdminAccount");
assertContains(domainStore, "upgradeNotificationCollections");
assertContains(domainStore, "upgradeSocialCollaborationCollections");
assertContains(domainStore, "notificationDeliveries = []");

[rootPackage, backendPackage].forEach((file) => {
  ["pg", "postgres", "postgresql", "redis", "ioredis", "bullmq"].forEach((dependencyName) => {
    assertNotContains(file, `"${dependencyName}"`);
  });
});

[
  "docker-compose.yml",
  "docker-compose.yaml",
  "apps/backend/docker-compose.yml",
  "apps/backend/docker-compose.yaml",
].forEach((relativePath) => {
  assert.ok(!existsSync(resolve(repoRoot, relativePath)), `${relativePath} must stay out of V1 scope`);
});

assertContains(verifyLocal, "smoke:data-boundaries");

console.log("ok D1 state payload and V1 infra boundaries");
