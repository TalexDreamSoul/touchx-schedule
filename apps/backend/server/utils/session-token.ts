import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import type { AuthSessionRecord, UserRecord } from "../services/domain-store";

const SESSION_TOKEN_PREFIX = "txs1";
const SESSION_TOKEN_VERSION = 1;
const SESSION_SECRET_FALLBACK = "touchx-session-fallback-secret";

interface SessionTokenPayload {
  v: number;
  uid: string;
  sno: string;
  role: AuthSessionRecord["role"];
  iat: number;
  exp: number;
  nonce: string;
}

export interface SignedSessionResult {
  session: AuthSessionRecord;
  studentNo: string;
}

const asString = (value: unknown) => String(value || "").trim();

const encodeBase64Url = (value: string) => {
  return Buffer.from(value, "utf8").toString("base64url");
};

const decodeBase64Url = (value: string) => {
  return Buffer.from(value, "base64url").toString("utf8");
};

const isRole = (value: unknown): value is AuthSessionRecord["role"] => {
  return value === "admin" || value === "user";
};

const resolveSessionSecret = (event: H3Event) => {
  const config = useRuntimeConfig(event);
  const configured = asString((config as Record<string, unknown>).sessionTokenSecret);
  if (configured) {
    return configured;
  }
  const passwordFallback = asString((config as Record<string, unknown>).adminLoginPassword);
  if (passwordFallback) {
    return `fallback:${passwordFallback}`;
  }
  return SESSION_SECRET_FALLBACK;
};

const signPayload = (secret: string, payloadBase64: string) => {
  return createHmac("sha256", secret).update(payloadBase64).digest("base64url");
};

const isSafeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const createSignedSession = (
  event: H3Event,
  user: Pick<UserRecord, "userId" | "studentNo">,
  role: AuthSessionRecord["role"],
  ttlHours = 24 * 7,
): AuthSessionRecord => {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + Math.max(1, ttlHours) * 60 * 60 * 1000;
  const studentNo = asString(user.studentNo);
  if (!studentNo) {
    throw new Error("SESSION_STUDENT_NO_REQUIRED");
  }
  const payload: SessionTokenPayload = {
    v: SESSION_TOKEN_VERSION,
    uid: user.userId,
    sno: studentNo,
    role,
    iat: issuedAt,
    exp: expiresAt,
    nonce: randomBytes(8).toString("hex"),
  };
  const payloadBase64 = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(resolveSessionSecret(event), payloadBase64);
  return {
    token: `${SESSION_TOKEN_PREFIX}.${payloadBase64}.${signature}`,
    userId: user.userId,
    role,
    expiresAt,
    createdAt: new Date(issuedAt).toISOString(),
  };
};

export const resolveSignedSession = (event: H3Event, token: string): SignedSessionResult | null => {
  const normalizedToken = asString(token);
  if (!normalizedToken) {
    return null;
  }
  const parts = normalizedToken.split(".");
  if (parts.length !== 3 || parts[0] !== SESSION_TOKEN_PREFIX) {
    return null;
  }
  const payloadBase64 = parts[1];
  const signature = parts[2];
  const expectedSignature = signPayload(resolveSessionSecret(event), payloadBase64);
  if (!isSafeEqual(signature, expectedSignature)) {
    return null;
  }
  try {
    const decoded = JSON.parse(decodeBase64Url(payloadBase64)) as Partial<SessionTokenPayload>;
    if (decoded.v !== SESSION_TOKEN_VERSION) {
      return null;
    }
    if (!isRole(decoded.role)) {
      return null;
    }
    const userId = asString(decoded.uid);
    const studentNo = asString(decoded.sno);
    const issuedAt = Number(decoded.iat);
    const expiresAt = Number(decoded.exp);
    if (!studentNo || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
      return null;
    }
    if (expiresAt <= Date.now()) {
      return null;
    }
    return {
      session: {
        token: normalizedToken,
        userId,
        role: decoded.role,
        expiresAt,
        createdAt: new Date(issuedAt).toISOString(),
      },
      studentNo,
    };
  } catch {
    return null;
  }
};
