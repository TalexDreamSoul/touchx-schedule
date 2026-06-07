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

test("TouchXApiClient joins URLs, attaches auth and returns envelope data", async () => {
  const calls = [];
  const client = apiClient.createTouchXApiClient({
    baseUrl: "https://api.example/api/v1/",
    token: async () => " token-123 ",
    fetcher: async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ ok: true, data: { saved: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const data = await client.post("calendar/me/settings", { nickname: "TouchX" });

  assert.deepEqual(data, { saved: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://api.example/api/v1/calendar/me/settings");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer token-123");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ nickname: "TouchX" }));
  assert.equal(calls[0].init.credentials, "omit");
});

test("TouchXApiClient exposes today brief for server-time calibration", async () => {
  const calls = [];
  const client = apiClient.createTouchXApiClient({
    baseUrl: "https://api.example/api/v1",
    fetcher: async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({
        ok: true,
        data: {
          serverNowIso: "2026-06-08T01:02:03.000Z",
          serverTimezone: "Asia/Shanghai",
          currentWeek: 15,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const data = await client.getTodayBrief();

  assert.equal(calls[0].input, "https://api.example/api/v1/today-brief");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(data.serverNowIso, "2026-06-08T01:02:03.000Z");
  assert.equal(data.currentWeek, 15);
});

test("TouchXApiClient preserves API envelope errors", async () => {
  const client = apiClient.createTouchXApiClient({
    baseUrl: "https://api.example/api/v1",
    fetcher: async () => new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "AUTH_REQUIRED",
          message: "请先登录",
          details: { route: "calendar/me/settings" },
        },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    ),
  });

  await assert.rejects(
    () => client.get("calendar/me/settings"),
    (error) => {
      assert.ok(error instanceof apiClient.TouchXApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(error.message, "请先登录");
      assert.deepEqual(error.details, { route: "calendar/me/settings" });
      return true;
    },
  );
});

test("TouchXApiClient wraps non-JSON API responses", async () => {
  const client = apiClient.createTouchXApiClient({
    baseUrl: "https://api.example/api/v1",
    fetcher: async () => new Response("bad gateway", { status: 502 }),
  });

  await assert.rejects(
    () => client.get("calendar/me/settings"),
    (error) => {
      assert.ok(error instanceof apiClient.TouchXApiError);
      assert.equal(error.status, 502);
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.match(error.message, /Invalid API response/);
      assert.equal(typeof error.details, "string");
      return true;
    },
  );
});
