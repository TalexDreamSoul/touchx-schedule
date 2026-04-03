import { getMethod, getRequestURL, type H3Event } from "h3";
import {
  createBootstrapStore,
  getNexusStore,
  getNexusStoreRevision,
  runWithNexusStoreScope,
  setGlobalNexusStore,
  type NexusStore,
} from "./domain-store";
import {
  hydrateLegacyCompatState,
  serializeLegacyCompatState,
  type LegacyCompatStateSnapshot,
} from "./social-v1-api";
import {
  hydrateAdminAuthState,
  serializeAdminAuthState,
  type AdminAuthStateSnapshot,
} from "./v1-api";

export interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => D1PreparedStatementLike;
  first: <T = unknown>() => Promise<T | null>;
  run: () => Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare: (sql: string) => D1PreparedStatementLike;
  exec?: (sql: string) => Promise<unknown>;
}

interface PersistedStatePayload {
  version: 1;
  store: NexusStore;
  legacyCompatState?: LegacyCompatStateSnapshot | null;
  adminAuthState?: AdminAuthStateSnapshot | null;
}

interface PersistedStateRow {
  revision?: number;
  payload?: string;
}

interface LoadedState {
  revision: number;
  payload: PersistedStatePayload;
}

const STATE_ROW_ID = 1;
const LOCK_ROW_ID = 1;
const LOCK_TTL_MS = 20_000;
const LOCK_WAIT_TIMEOUT_MS = 6_000;
const LOCK_RETRY_DELAY_MS = 60;
const WRITE_METHOD_SET = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const sleep = (ms: number) => {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const resolveNexusDb = (event: H3Event): D1DatabaseLike | null => {
  const candidate = (event.context as { cloudflare?: { env?: { NEXUS_DB?: unknown } } }).cloudflare?.env?.NEXUS_DB;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const db = candidate as D1DatabaseLike;
  if (typeof db.prepare !== "function") {
    return null;
  }
  return db;
};

const ensureTables = async (db: D1DatabaseLike) => {
  const ddl = [
    "CREATE TABLE IF NOT EXISTS nexus_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS nexus_write_lock (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL)",
  ];
  for (const statement of ddl) {
    await db.prepare(statement).run();
  }
};

const parsePersistedStatePayload = (raw: unknown): PersistedStatePayload | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const payload = raw as Partial<PersistedStatePayload>;
  if (payload.version !== 1 || !payload.store || typeof payload.store !== "object") {
    return null;
  }
  return {
    version: 1,
    store: payload.store as NexusStore,
    legacyCompatState: payload.legacyCompatState || null,
    adminAuthState: payload.adminAuthState || null,
  };
};

const loadPersistedState = async (db: D1DatabaseLike): Promise<LoadedState | null> => {
  const row = await db
    .prepare("SELECT revision, payload FROM nexus_state WHERE id = ?")
    .bind(STATE_ROW_ID)
    .first<PersistedStateRow>();
  if (!row || typeof row.payload !== "string" || !row.payload.trim()) {
    return null;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.payload);
  } catch (error) {
    return null;
  }
  const payload = parsePersistedStatePayload(parsed);
  if (!payload) {
    return null;
  }
  return {
    revision: Math.max(0, Number(row.revision || 0)),
    payload,
  };
};

const buildPersistedStatePayload = (store: NexusStore): PersistedStatePayload => {
  return {
    version: 1,
    store,
    legacyCompatState: serializeLegacyCompatState(store),
    adminAuthState: serializeAdminAuthState(store),
  };
};

const savePersistedState = async (db: D1DatabaseLike, revision: number, payload: PersistedStatePayload) => {
  await db
    .prepare(
      "INSERT INTO nexus_state (id, revision, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at",
    )
    .bind(STATE_ROW_ID, revision, JSON.stringify(payload), new Date().toISOString())
    .run();
};

const createLockOwner = (event: H3Event) => {
  const path = getRequestURL(event).pathname;
  return `lock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${path}`;
};

const acquireWriteLock = async (db: D1DatabaseLike, owner: string) => {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const now = Date.now();
    const expiresAt = now + LOCK_TTL_MS;
    const updatedAt = new Date(now).toISOString();
    try {
      await db
        .prepare("INSERT INTO nexus_write_lock (id, owner, expires_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(LOCK_ROW_ID, owner, expiresAt, updatedAt)
        .run();
      return;
    } catch (error) {
      const takeover = await db
        .prepare("UPDATE nexus_write_lock SET owner = ?, expires_at = ?, updated_at = ? WHERE id = ? AND expires_at < ?")
        .bind(owner, expiresAt, updatedAt, LOCK_ROW_ID, now)
        .run();
      if (Number(takeover?.meta?.changes || 0) > 0) {
        return;
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }
  throw new Error("STATE_LOCK_TIMEOUT");
};

const releaseWriteLock = async (db: D1DatabaseLike, owner: string) => {
  try {
    await db.prepare("DELETE FROM nexus_write_lock WHERE id = ? AND owner = ?").bind(LOCK_ROW_ID, owner).run();
  } catch (error) {
    // ignore lock release error
  }
};

const createFallbackState = (): LoadedState => {
  const store = createBootstrapStore();
  return {
    revision: Math.max(0, Number(getNexusStoreRevision() || 0)),
    payload: buildPersistedStatePayload(store),
  };
};

const isWriteRequest = (event: H3Event) => {
  const method = getMethod(event).toUpperCase();
  return WRITE_METHOD_SET.has(method);
};

const runWithHydratedScope = async <T>(
  state: LoadedState,
  executor: () => Promise<T> | T,
  revisionOverride?: number,
) => {
  const store = state.payload.store;
  hydrateLegacyCompatState(store, state.payload.legacyCompatState || null);
  hydrateAdminAuthState(store, state.payload.adminAuthState || null);
  return await runWithNexusStoreScope(
    {
      store,
      revision: Number(revisionOverride ?? state.revision),
    },
    executor,
  );
};

interface WithDbOptions {
  writeRequest?: boolean;
  lockOwner?: string;
}

export const withNexusStateScopeByDb = async <T>(
  db: D1DatabaseLike,
  options: WithDbOptions,
  executor: () => Promise<T> | T,
) => {
  const writeRequest = Boolean(options.writeRequest);
  await ensureTables(db);
  const lockOwner = writeRequest
    ? (options.lockOwner && String(options.lockOwner).trim()) ||
      `lock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_external`
    : "";
  if (writeRequest) {
    await acquireWriteLock(db, lockOwner);
  }
  try {
    const persistedState = (await loadPersistedState(db)) || createFallbackState();
    if (!writeRequest) {
      return await runWithHydratedScope(persistedState, executor);
    }
    const nextRevision = persistedState.revision + 1;
    return await runWithHydratedScope(
      persistedState,
      async () => {
        const result = await executor();
        const scopedStore = getNexusStore();
        const nextPayload = buildPersistedStatePayload(scopedStore);
        await savePersistedState(db, nextRevision, nextPayload);
        setGlobalNexusStore(scopedStore, nextRevision);
        return result;
      },
      nextRevision,
    );
  } finally {
    if (writeRequest) {
      await releaseWriteLock(db, lockOwner);
    }
  }
};

export const withNexusStateScope = async <T>(event: H3Event, executor: () => Promise<T> | T) => {
  const db = resolveNexusDb(event);
  const writeRequest = isWriteRequest(event);
  if (!db) {
    const store = getNexusStore();
    const baseRevision = getNexusStoreRevision();
    const nextRevision = writeRequest ? baseRevision + 1 : baseRevision;
    return await runWithNexusStoreScope(
      {
        store,
        revision: nextRevision,
      },
      async () => {
        const result = await executor();
        if (writeRequest) {
          setGlobalNexusStore(store, nextRevision);
        }
        return result;
      },
    );
  }
  return await withNexusStateScopeByDb(
    db,
    {
      writeRequest,
      lockOwner: writeRequest ? createLockOwner(event) : "",
    },
    executor,
  );
};
