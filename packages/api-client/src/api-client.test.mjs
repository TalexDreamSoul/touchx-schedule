import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const transpileApiClient = () => {
  const sourcePath = join(import.meta.dirname, "index.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  }).outputText;
  const tmpFile = join(mkdtempSync(join(tmpdir(), "touchx-api-client-")), "api-client.mjs");
  writeFileSync(tmpFile, transpiled, "utf8");
  return import(pathToFileURL(tmpFile).href);
};

const apiClient = await transpileApiClient();

test("resolveTouchXApiBaseUrl prefers runtime global override", () => {
  const baseUrl = apiClient.resolveTouchXApiBaseUrl({
    runtime: {
      __TOUCHX_API_BASE_URL__: " https://runtime.example/api/v1 ",
      process: {
        env: {
          TOUCHX_API_BASE_URL: "https://env.example/api/v1",
          TARO_APP_TOUCHX_API_BASE_URL: "https://taro.example/api/v1",
        },
      },
    },
    envKeys: ["TARO_APP_TOUCHX_API_BASE_URL"],
  });
  assert.equal(baseUrl, "https://runtime.example/api/v1");
});

test("resolveTouchXApiBaseUrl checks shared env before platform env", () => {
  const baseUrl = apiClient.resolveTouchXApiBaseUrl({
    runtime: {
      process: {
        env: {
          TOUCHX_API_BASE_URL: "https://shared.example/api/v1",
          TARO_APP_TOUCHX_API_BASE_URL: "https://taro.example/api/v1",
        },
      },
    },
    envKeys: ["TARO_APP_TOUCHX_API_BASE_URL"],
  });
  assert.equal(baseUrl, "https://shared.example/api/v1");
});

test("resolveTouchXApiBaseUrl supports platform env and custom default fallback", () => {
  assert.equal(
    apiClient.resolveTouchXApiBaseUrl({
      runtime: {
        process: {
          env: {
            REACT_NATIVE_TOUCHX_API_BASE_URL: " https://rn.example/api/v1 ",
          },
        },
      },
      envKeys: ["REACT_NATIVE_TOUCHX_API_BASE_URL"],
    }),
    "https://rn.example/api/v1",
  );

  assert.equal(
    apiClient.resolveTouchXApiBaseUrl({
      runtime: { process: { env: {} } },
      defaultBaseUrl: "https://fallback.example/api/v1",
    }),
    "https://fallback.example/api/v1",
  );
});
