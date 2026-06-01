import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const dataModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

const transpileModuleToTemp = (sourcePath, fileName, replacements = []) => {
  let source = readFileSync(sourcePath, "utf8");
  for (const [needle, replacement] of replacements) {
    source = source.split(needle).join(replacement);
  }
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-nexus-state-manager-")), fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadNexusStateManager = async () => {
  const h3Stub = dataModule(`
    export const getMethod = (event) => event.method || "GET";
    export const getRequestURL = (event) => new URL(event.url || "https://touchx.example/api/v1");
  `);
  const domainStoreStub = dataModule(`
    let scopedStore = null;
    let globalStore = { users: [{ userId: "global-user" }] };
    let globalRevision = 0;
    export const createBootstrapStore = () => ({ users: [{ userId: "bootstrap-user" }] });
    export const getNexusStore = () => scopedStore || globalStore;
    export const getNexusStoreRevision = () => globalRevision;
    export const runWithNexusStoreScope = async (scope, executor) => {
      const previous = scopedStore;
      scopedStore = scope.store;
      try {
        return await executor();
      } finally {
        scopedStore = previous;
      }
    };
    export const setGlobalNexusStore = (store, revision = 0) => {
      globalStore = store;
      globalRevision = Number(revision || 0);
    };
  `);
  const legacyStateStub = dataModule(`
    export const hydrateLegacyCompatState = () => {};
    export const serializeLegacyCompatState = () => null;
  `);
  const authStateStub = dataModule(`
    export const hydrateAdminAuthState = () => {};
    export const serializeAdminAuthState = () => null;
  `);
  const modulePath = transpileModuleToTemp(
    join(import.meta.dirname, "nexus-state-manager.ts"),
    "nexus-state-manager.mjs",
    [
      ["from \"h3\";", `from ${JSON.stringify(h3Stub)};`],
      ["from \"./domain-store\"", `from ${JSON.stringify(domainStoreStub)}`],
      ["from \"../modules/legacy/legacy-state\"", `from ${JSON.stringify(legacyStateStub)}`],
      ["from \"../modules/auth/auth-service\"", `from ${JSON.stringify(authStateStub)}`],
    ],
  );
  return import(pathToFileURL(modulePath).href);
};

const createMemoryD1 = (payload) => {
  const state = {
    payload,
    revision: payload === undefined ? 0 : 11,
    lockOwner: "",
    savedPayloads: [],
  };
  return {
    state,
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (sql.includes("SELECT revision, payload FROM nexus_state")) {
            if (state.payload === undefined) return null;
            return { revision: state.revision, payload: state.payload };
          }
          return null;
        },
        async run() {
          if (sql.startsWith("CREATE TABLE")) {
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes("INSERT INTO nexus_write_lock")) {
            if (state.lockOwner) {
              throw new Error("lock exists");
            }
            state.lockOwner = String(this.values[1] || "");
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE nexus_write_lock")) {
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes("DELETE FROM nexus_write_lock")) {
            if (state.lockOwner === this.values[1]) {
              state.lockOwner = "";
              return { success: true, meta: { changes: 1 } };
            }
            return { success: true, meta: { changes: 0 } };
          }
          if (sql.includes("INSERT INTO nexus_state")) {
            state.revision = Number(this.values[1] || 0);
            state.payload = String(this.values[2] || "");
            state.savedPayloads.push(state.payload);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
};

test("bootstraps only when nexus_state row is missing", async () => {
  const manager = await loadNexusStateManager();
  const db = createMemoryD1(undefined);

  const result = await manager.withNexusStateScopeByDb(db, { writeRequest: false }, () => {
    return manager;
  });

  assert.equal(result, manager);
  assert.equal(db.state.payload, undefined);
  assert.equal(db.state.savedPayloads.length, 0);
});

test("rejects invalid persisted JSON instead of falling back to bootstrap", async () => {
  const manager = await loadNexusStateManager();
  const db = createMemoryD1("{not-json");

  await assert.rejects(
    () => manager.withNexusStateScopeByDb(db, { writeRequest: false }, () => "ok"),
    (error) =>
      error?.code === "NEXUS_STATE_PAYLOAD_INVALID_JSON" &&
      error?.statusCode === 503 &&
      error?.data?.error?.code === "NEXUS_STATE_PAYLOAD_INVALID_JSON",
  );
  assert.equal(db.state.payload, "{not-json");
  assert.equal(db.state.savedPayloads.length, 0);
});

test("write requests do not overwrite malformed persisted payloads", async () => {
  const manager = await loadNexusStateManager();
  const db = createMemoryD1(JSON.stringify({ version: 1, store: null }));

  await assert.rejects(
    () => manager.withNexusStateScopeByDb(db, { writeRequest: true, lockOwner: "unit-test" }, () => {
      throw new Error("executor should not run");
    }),
    (error) =>
      error?.code === "NEXUS_STATE_PAYLOAD_INVALID_SHAPE" &&
      error?.statusCode === 503 &&
      error?.data?.error?.code === "NEXUS_STATE_PAYLOAD_INVALID_SHAPE",
  );
  assert.equal(db.state.payload, JSON.stringify({ version: 1, store: null }));
  assert.equal(db.state.savedPayloads.length, 0);
  assert.equal(db.state.lockOwner, "");
});
