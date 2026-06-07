import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const transpileModuleToTemp = (sourcePath, fileName) => {
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-session-token-")), fileName);
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

test("session tokens do not use predictable password or static fallback secrets", async () => {
  const sessionToken = await loadSessionToken({
    sessionTokenSecret: "",
    adminLoginPassword: "123456",
  });
  const user = {
    userId: "user-1",
    studentNo: "2300000001",
  };
  const session = sessionToken.createSignedSession({}, user, "admin", 1);

  assert.equal(sessionToken.resolveSignedSession({}, session.token)?.session.userId, user.userId);
  assert.equal(sessionToken.resolveSignedSession({}, createWeakToken("fallback:123456")), null);
  assert.equal(sessionToken.resolveSignedSession({}, createWeakToken("touchx-session-fallback-secret")), null);
});
