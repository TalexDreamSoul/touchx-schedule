import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_BOOTSTRAP_ADMIN_ACCOUNT_NAME,
  DEFAULT_BOOTSTRAP_ADMIN_PASSWORD,
  DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO,
  storeHelpers,
  type NexusStore,
  type UserRecord,
} from "../../services/domain-store";

const asString = (value: unknown) => String(value || "").trim();

const ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9_@.\-]{3,48}$/;
const USERNAME_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AdminAuthState {
  bootstrapStudentNo: string;
  password: string;
  initialized: boolean;
  updatedAt: string;
}

export interface AdminAuthStateSnapshot {
  bootstrapStudentNo: string;
  password: string;
  initialized: boolean;
  updatedAt: string;
}

export interface RuntimeConfigLike {
  adminBootstrapStudentNo?: unknown;
  adminLoginPassword?: unknown;
}

const adminAuthStateMap = new WeakMap<NexusStore, AdminAuthState>();

export const normalizeAccountName = (value: unknown) => asString(value).toLowerCase();

export const isValidAccountName = (value: unknown) => {
  const accountName = normalizeAccountName(value);
  return ACCOUNT_NAME_PATTERN.test(accountName) || USERNAME_EMAIL_PATTERN.test(accountName);
};

export const isAdminRole = (user: UserRecord) => {
  return user.adminRole === "super_admin" || user.adminRole === "operator";
};

export const createPasswordSalt = () => randomBytes(16).toString("hex");

export const hashPassword = (password: string, salt: string) => createHash("sha256").update(`${salt}:${password}`).digest("hex");

export const verifyPassword = (password: string, salt: string, expectedHash: string) => {
  const hash = hashPassword(password, salt);
  const left = Buffer.from(hash);
  const right = Buffer.from(asString(expectedHash));
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

export const createVirtualStudentNo = (accountName: string) => {
  const digest = createHash("sha1").update(accountName).digest("hex").slice(0, 16);
  return `acct_${digest}`;
};

export const ensureAccountNameAvailable = (store: NexusStore, accountName: string, ignoreUserId = "") => {
  return !store.users.some((item) => normalizeAccountName(item.accountName || item.studentNo) === accountName && item.userId !== ignoreUserId);
};

const resolveBootstrapStudentNo = (store: NexusStore, config: RuntimeConfigLike) => {
  const configured = asString(config.adminBootstrapStudentNo || DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO);
  const admins = store.users.filter((item) => isAdminRole(item));
  if (configured && admins.some((item) => item.studentNo === configured || normalizeAccountName(item.accountName) === normalizeAccountName(configured))) {
    return configured;
  }
  const defaultAdmin = admins.find((item) => normalizeAccountName(item.accountName || item.studentNo) === normalizeAccountName(DEFAULT_BOOTSTRAP_ADMIN_ACCOUNT_NAME)) || null;
  return defaultAdmin?.accountName || defaultAdmin?.studentNo || admins[0]?.accountName || admins[0]?.studentNo || configured || DEFAULT_BOOTSTRAP_ADMIN_STUDENT_NO;
};

export const getAdminAuthState = (store: NexusStore, config: RuntimeConfigLike) => {
  const existing = adminAuthStateMap.get(store);
  const bootstrapStudentNo = resolveBootstrapStudentNo(store, config);
  const configuredPassword = asString(config.adminLoginPassword || DEFAULT_BOOTSTRAP_ADMIN_PASSWORD);
  if (existing) {
    if (configuredPassword && (existing.password !== configuredPassword || !existing.initialized)) {
      existing.password = configuredPassword;
      existing.initialized = true;
      existing.updatedAt = storeHelpers.nowIso();
    }
    if (existing.bootstrapStudentNo !== bootstrapStudentNo) {
      existing.bootstrapStudentNo = bootstrapStudentNo;
      existing.updatedAt = storeHelpers.nowIso();
    }
    return existing;
  }
  const created: AdminAuthState = {
    bootstrapStudentNo,
    password: configuredPassword,
    initialized: Boolean(configuredPassword),
    updatedAt: storeHelpers.nowIso(),
  };
  adminAuthStateMap.set(store, created);
  return created;
};

export const serializeAdminAuthState = (store: NexusStore): AdminAuthStateSnapshot | null => {
  const state = adminAuthStateMap.get(store);
  if (!state) {
    return null;
  }
  return {
    bootstrapStudentNo: asString(state.bootstrapStudentNo),
    password: asString(state.password),
    initialized: Boolean(state.initialized),
    updatedAt: asString(state.updatedAt),
  };
};

export const hydrateAdminAuthState = (
  store: NexusStore,
  snapshot: AdminAuthStateSnapshot | null | undefined,
) => {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  adminAuthStateMap.set(store, {
    bootstrapStudentNo: asString(snapshot.bootstrapStudentNo),
    password: asString(snapshot.password),
    initialized: Boolean(snapshot.initialized),
    updatedAt: asString(snapshot.updatedAt) || storeHelpers.nowIso(),
  });
};
