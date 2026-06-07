import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import ts from "typescript";

const tempDirs = [];
const user = {
  userId: "user-1",
  studentNo: "2300000001",
};

const transpileModuleToTemp = (sourcePath, fileName) => {
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpDir = mkdtempSync(join(tmpdir(), "touchx-session-token-"));
  tempDirs.push(tmpDir);
  const tmpFile = join(tmpDir, fileName);
  writeFileSync(tmpFile, transpiled, "utf8");
  return tmpFile;
};

const loadSessionToken = async (runtimeConfig) => {
  globalThis.useRuntimeConfig = () => runtimeConfig;
  const modulePath = transpileModuleToTemp(
    join(import.meta.dirname, "../utils/session-token.ts"),
    "session-token.mjs",
  );
  return import(pathToFileURL(modulePath).href);
};

const createWeakToken = (secret, overrides = {}) => {
  const payload = {
    v: 1,
    uid: "user-weak",
    sno: "2300000001",
    role: "admin",
    iat: Date.now(),
    exp: Date.now() + 60 * 60 * 1000,
    nonce: "weak",
    ...overrides,
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadBase64).digest("base64url");
  return `txs1.${payloadBase64}.${signature}`;
};

after(() => {
  tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

test("session tokens do not use predictable password or static fallback secrets", async () => {
  const sessionToken = await loadSessionToken({
    sessionTokenSecret: "",
    adminLoginPassword: "123456",
  });
  const session = sessionToken.createSignedSession({}, user, "admin", 1);

  assert.equal(sessionToken.resolveSignedSession({}, session.token)?.session.userId, user.userId);
  assert.equal(sessionToken.resolveSignedSession({}, createWeakToken("fallback:123456")), null);
  assert.equal(sessionToken.resolveSignedSession({}, createWeakToken("touchx-session-fallback-secret")), null);
});

test("configured session token secret remains stable across module instances", async () => {
  const runtimeConfig = {
    sessionTokenSecret: "strong-configured-session-secret",
    adminLoginPassword: "123456",
  };
  const firstSessionToken = await loadSessionToken(runtimeConfig);
  const secondSessionToken = await loadSessionToken(runtimeConfig);
  const session = firstSessionToken.createSignedSession({}, user, "admin", 1);

  assert.equal(secondSessionToken.resolveSignedSession({}, session.token)?.session.userId, user.userId);
});

test("runtime fallback session token secrets are module-local", async () => {
  const runtimeConfig = {
    sessionTokenSecret: "",
    adminLoginPassword: "123456",
  };
  const firstSessionToken = await loadSessionToken(runtimeConfig);
  const secondSessionToken = await loadSessionToken(runtimeConfig);
  const session = firstSessionToken.createSignedSession({}, user, "admin", 1);

  assert.equal(firstSessionToken.resolveSignedSession({}, session.token)?.session.userId, user.userId);
  assert.equal(secondSessionToken.resolveSignedSession({}, session.token), null);
});
