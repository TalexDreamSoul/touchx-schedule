import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = join(import.meta.dirname, "../../scripts/smoke-production.sh");
const script = readFileSync(scriptPath, "utf8");
const cloudflareConfigSmokePath = join(import.meta.dirname, "../../scripts/smoke-cloudflare-config.mjs");
const cloudflareConfigSmoke = readFileSync(cloudflareConfigSmokePath, "utf8");
const cloudflareConfigUtilsPath = join(import.meta.dirname, "../../scripts/cloudflare-config-utils.mjs");
const cloudflareConfigUtils = readFileSync(cloudflareConfigUtilsPath, "utf8");
const cloudflareLiveSmokePath = join(import.meta.dirname, "../../scripts/smoke-cloudflare-live.mjs");
const cloudflareLiveSmoke = readFileSync(cloudflareLiveSmokePath, "utf8");
const v1ProductionVerifyPath = join(import.meta.dirname, "../../scripts/verify-v1-production.sh");
const v1ProductionVerify = readFileSync(v1ProductionVerifyPath, "utf8");
const backendPackageJson = readFileSync(join(import.meta.dirname, "../../package.json"), "utf8");
const v1LocalVerifyPath = join(import.meta.dirname, "../../scripts/verify-v1-local.sh");
const v1LocalVerify = readFileSync(v1LocalVerifyPath, "utf8");
const productionUrlGuardPath = join(import.meta.dirname, "../../scripts/production-url-guard.sh");
const productionUrlGuard = readFileSync(productionUrlGuardPath, "utf8");
const smokeLocalPath = join(import.meta.dirname, "../../scripts/smoke-local.sh");
const smokeLocal = readFileSync(smokeLocalPath, "utf8");
const apiBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-api-boundaries.mjs");
const apiBoundarySmoke = readFileSync(apiBoundarySmokePath, "utf8");
const adminUiBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-admin-ui-boundaries.mjs");
const adminUiBoundarySmoke = readFileSync(adminUiBoundarySmokePath, "utf8");
const clientBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-client-boundaries.mjs");
const clientBoundarySmoke = readFileSync(clientBoundarySmokePath, "utf8");
const miniappParitySmokePath = join(import.meta.dirname, "../../scripts/smoke-miniapp-parity.mjs");
const miniappParitySmoke = readFileSync(miniappParitySmokePath, "utf8");
const dataBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-data-boundaries.mjs");
const dataBoundarySmoke = readFileSync(dataBoundarySmokePath, "utf8");
const rootReadme = readFileSync(join(import.meta.dirname, "../../../../README.md"), "utf8");
const backendReadme = readFileSync(join(import.meta.dirname, "../../README.md"), "utf8");
const todoDoc = readFileSync(join(import.meta.dirname, "../../../../TODO.md"), "utf8");
const v1CloseoutStatus = readFileSync(join(import.meta.dirname, "../../../../docs/v1-closeout-status.md"), "utf8");
const productionSmokeEnvExample = readFileSync(join(import.meta.dirname, "../../.env.production-smoke.example"), "utf8");
const rootGitignore = readFileSync(join(import.meta.dirname, "../../../../.gitignore"), "utf8");
const backendRoot = join(import.meta.dirname, "../../..");
const validProductionAuthToken = "production-admin-token-value";
const validClawdbotWebhookToken = "production-clawdbot-webhook-token-value";

const productionPrecheckEnv = (overrides = {}) => ({
  ...process.env,
  TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
  TOUCHX_SMOKE_STUDENT_NO: "2305100613",
  TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
  TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
  TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
  SMOKE_BASE_URL: "http://127.0.0.1:9986",
  SMOKE_REAL_PDF_MIN_ENTRIES: "8",
  SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
  ...overrides,
});

const runV1ProductionVerify = (args, env) =>
  spawnSync("bash", [v1ProductionVerifyPath, ...args], {
    cwd: backendRoot,
    encoding: "utf8",
    env,
  });

const runV1ProductionPrecheck = (envOverrides = {}) =>
  runV1ProductionVerify(["--check-env"], productionPrecheckEnv(envOverrides));

const withTempPdf = (prefix, callback) => {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const pdfPath = join(tempDir, "real-schedule.pdf");
  writeFileSync(pdfPath, "%PDF-1.4\n");
  try {
    return callback(pdfPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const classifyProductionUrl = (baseUrl) =>
  spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; if is_non_production_smoke_url "$2"; then printf "non-production"; else printf "production"; fi',
      "bash",
      productionUrlGuardPath,
      baseUrl,
    ],
    {
      encoding: "utf8",
    },
  );

test("production smoke rejects weak fallback session secrets by default", () => {
  assert.match(script, /reject_raw_token_env "TOUCHX_SMOKE_AUTH_TOKEN"/);
  assert.match(script, /reject_raw_token_env "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN"/);
  assert.match(script, /reject_optional_plain_env "TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO"/);
  assert.match(script, /reject_optional_text_env "TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD"/);
  assert.match(script, /reject_placeholder_env\(\)/);
  assert.match(script, /\*__REPLACE_WITH_\*/);
  assert.match(script, /reject_optional_plain_env\(\)/);
  assert.match(script, /reject_optional_text_env\(\)/);
  assert.match(script, /reject_student_no_env\(\)/);
  assert.match(script, /reject_known_nonproduction_env\(\)/);
  assert.match(script, /request_session_secret_security\(\)/);
  assert.match(script, /create_signed_smoke_token\(\)/);
  assert.match(script, /fallback:123456/);
  assert.match(script, /fallback_password="\$\{TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD:-123456\}"/);
  assert.match(script, /if \[\[ "\$\{fallback_password\}" != "123456" \]\]; then[\s\S]*weak_secrets\+=\("fallback:\$\{fallback_password\}"\)/);
  assert.match(script, /touchx-session-fallback-secret/);
  assert.match(script, /TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK/);
  assert.match(script, /expected 401 for weak fallback session token/);
  assert.match(script, /request_admin_bootstrap_status[\s\S]*request_session_secret_security[\s\S]*request_protected/);
});

test("production smoke rejects malformed opt-in flags before network checks", () => {
  [
    "TOUCHX_SMOKE_AUTH_LOGOUT",
    "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK",
    "TOUCHX_SMOKE_EXTERNAL_DELIVERY",
    "TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE",
    "TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK",
  ].forEach((name) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        [name]: "true",
      },
    });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, new RegExp(`${name} must be empty or 1`), name);
    assert.doesNotMatch(result.stdout, /ok \/health/, name);
  });
});

test("production smoke rejects enabled opt-ins with missing dependencies before network checks", () => {
  [
    {
      env: { TOUCHX_SMOKE_AUTH_LOGOUT: "1" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN is required for admin logout revocation smoke/,
    },
    {
      env: { TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE: "1" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN is required for notification queue mode smoke/,
    },
    {
      env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK: "1" },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN is required for ClawDBot webhook smoke/,
    },
    {
      env: {
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK: "1",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
      },
      pattern: /TOUCHX_SMOKE_STUDENT_NO is required for ClawDBot webhook smoke/,
    },
    {
      env: { TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN is required for external notification delivery smoke/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_CHANNELS must include wechat_clawdbot and\/or feishu/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot",
        TOUCHX_SMOKE_NOTIFICATION_CHANNEL: "feishu",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_CHANNEL must be empty when TOUCHX_SMOKE_NOTIFICATION_CHANNELS is set/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNEL: "wechat_clawdbot,feishu",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_CHANNEL must contain exactly one channel/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "email",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_CHANNELS entries must be wechat_clawdbot or feishu/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,,feishu",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_CHANNELS must not contain empty entries/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "feishu,feishu",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_CHANNELS must not contain duplicate entries/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_AUTH_TOKEN: "",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "",
        TOUCHX_SMOKE_STUDENT_NO: "",
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "",
        TOUCHX_SMOKE_NOTIFICATION_CHANNEL: "",
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /ok \/health/);
  });
});

test("production smoke rejects malformed supplied tokens before network checks", () => {
  [
    {
      env: { TOUCHX_SMOKE_AUTH_TOKEN: "Bearer production-token-value" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN must be the raw token without a Bearer prefix/,
    },
    {
      env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "dummy-webhook-secret" },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real production value/,
    },
    {
      env: { TOUCHX_SMOKE_AUTH_TOKEN: "Dummy-Admin-Token-2026" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real production value/,
    },
    {
      env: { TOUCHX_SMOKE_AUTH_TOKEN: "production-test-token-local" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real production value/,
    },
    {
      env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "EXAMPLE-webhook-secret-local" },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real production value/,
    },
    {
      env: { TOUCHX_SMOKE_AUTH_TOKEN: "test" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real production value/,
    },
    {
      env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "changeme" },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real production value/,
    },
    {
      env: { TOUCHX_SMOKE_AUTH_TOKEN: "__REPLACE_WITH_PRODUCTION_ADMIN_TOKEN__" },
      pattern: /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real value/,
    },
    {
      env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "__REPLACE_WITH_CLAWDBOT_WEBHOOK_TOKEN__" },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real value/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /ok \/health/);
  });
});

test("production smoke rejects unreplaced optional message placeholders before network checks", () => {
  [
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot",
        TOUCHX_SMOKE_NOTIFICATION_TITLE: "smoke __REPLACE_WITH_SMOKE_TITLE__",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_TITLE must be replaced with a real value/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "feishu",
        TOUCHX_SMOKE_NOTIFICATION_BODY: "__REPLACE_WITH_SMOKE_BODY__",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_BODY must be replaced with a real value/,
    },
    {
      env: {
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK: "1",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
        TOUCHX_SMOKE_STUDENT_NO: "2305100613",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT: "__REPLACE_WITH_CLAWDBOT_TEXT__",
      },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT must be replaced with a real value/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /ok \/health/);
  });
});

test("production smoke rejects blank optional message values before network checks", () => {
  [
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot",
        TOUCHX_SMOKE_NOTIFICATION_TITLE: "   ",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_TITLE must not be blank/,
    },
    {
      env: {
        TOUCHX_SMOKE_EXTERNAL_DELIVERY: "1",
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "feishu",
        TOUCHX_SMOKE_NOTIFICATION_BODY: "\t",
      },
      pattern: /TOUCHX_SMOKE_NOTIFICATION_BODY must not be blank/,
    },
    {
      env: {
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK: "1",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
        TOUCHX_SMOKE_STUDENT_NO: "2305100613",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT: "   ",
      },
      pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT must not be blank/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /ok \/health/);
  });
});

test("production smoke rejects malformed fallback admin password candidate before network checks", () => {
  [
    {
      env: { TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD: "fallback-__REPLACE_WITH_FALLBACK_ADMIN_PASSWORD__" },
      pattern: /TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD must be replaced with a real value/,
    },
    {
      env: { TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD: "   " },
      pattern: /TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD must not be blank/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /ok \/health/);
  });
});

test("production smoke rejects malformed bootstrap expectation before network checks", () => {
  [
    {
      env: { TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO: "__REPLACE_WITH_BOOTSTRAP_STUDENT_NO__" },
      pattern: /TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO must be replaced with a real value/,
    },
    {
      env: { TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO: "admin@schedule.com " },
      pattern: /TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO must not contain whitespace/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /ok \/health/);
  });
});

test("production smoke rejects malformed student numbers before network checks", () => {
  [
    {
      studentNo: "student-2305100613",
      pattern: /TOUCHX_SMOKE_STUDENT_NO must be a 6-32 digit student number/,
    },
    {
      studentNo: "__REPLACE_WITH_6_TO_32_DIGIT_STUDENT_NO__",
      pattern: /TOUCHX_SMOKE_STUDENT_NO must be replaced with a real value/,
    },
  ].forEach(({ studentNo, pattern }) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        TOUCHX_SMOKE_STUDENT_NO: studentNo,
      },
    });
    assert.notEqual(result.status, 0, studentNo);
    assert.match(result.stderr, pattern, studentNo);
    assert.doesNotMatch(result.stdout, /ok \/health/, studentNo);
  });
});

test("production smoke leaves token revocation until other opt-in checks finish", () => {
  assert.match(script, /request_admin_logout_revocation\(\)/);
  assert.match(script, /TOUCHX_SMOKE_AUTH_LOGOUT/);
  assert.match(
    script,
    /request_admin_token_security[\s\S]*request_notification_queue_mode[\s\S]*request_student_legacy_login[\s\S]*request_external_notification[\s\S]*request_admin_logout_revocation/,
  );
});

test("production smoke can opt into student legacy login verification", () => {
  assert.match(script, /request_student_legacy_login\(\)/);
  assert.match(script, /TOUCHX_SMOKE_STUDENT_NO/);
  assert.match(script, /\/api\/v1\/auth\/login/);
  assert.match(script, /\/api\/v1\/auth\/me/);
  assert.match(script, /legacy_student_no/);
  assert.match(script, /request_admin_token_security[\s\S]*request_student_legacy_login[\s\S]*request_external_notification/);
});

test("production smoke can opt into notification queue mode verification", () => {
  assert.match(script, /request_notification_queue_mode\(\)/);
  assert.match(script, /TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE/);
  assert.match(script, /admin\/notification-deliveries\?sourceQueue=notification&limit=1/);
  assert.match(script, /expected at least one sourceQueue=notification delivery in production/);
});

test("production smoke refuses non-production base URLs before network checks", () => {
  assert.match(script, /if is_non_production_smoke_url "\$\{BASE_URL\}"; then/);
  assert.match(script, /source "\$\{SCRIPT_DIR\}\/production-url-guard\.sh"/);
  assert.match(script, /public HTTPS production API for smoke:production/);

  [
    "http://schedule-backend.tagzxia.com",
    "http://127.0.0.1:9986",
    "https://192.168.2.1",
    "https://203.0.113.1",
      "https://224.0.0.1",
      "https://prod",
      "https://api_tagzxia.com",
      "https://api..tagzxia.com",
      "https://-api.tagzxia.com",
      "https://api-.tagzxia.com",
      "https://api.example.com",
      "https://touchx.test",
      "https://touchx.local",
      "https://[::ffff:192.168.2.1]",
      "https://[2001:db8::1]",
      "https://[FD00::1]",
    ].forEach((baseUrl) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: baseUrl,
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(
      result.stderr,
      /TOUCHX_SMOKE_BASE_URL must point to a public HTTPS production API for smoke:production/,
      baseUrl,
    );
  });
});

test("production URL guard stays shared and parser-based", () => {
  assert.match(script, /source "\$\{SCRIPT_DIR\}\/production-url-guard\.sh"/);
  assert.match(v1ProductionVerify, /source "\$\{SCRIPT_DIR\}\/production-url-guard\.sh"/);
  assert.doesNotMatch(script, /from urllib\.parse import urlsplit/);
  assert.match(v1LocalVerify, /check_shell_syntax\(\)/);
  assert.match(v1LocalVerify, /for script in "apps\/backend\/scripts"\/\*\.sh; do/);
  assert.match(v1LocalVerify, /bash -n "\$\{script\}"/);
  assert.doesNotMatch(v1LocalVerify, /run_step "smoke script syntax" bash -n/);
  assert.match(productionUrlGuard, /urlsplit/);
  assert.match(productionUrlGuard, /char\.isspace\(\)/);
  assert.match(productionUrlGuard, /parsed\.hostname/);
  assert.match(productionUrlGuard, /parsed\.scheme != "https"/);
  assert.match(productionUrlGuard, /is_ambiguous_smoke_base_url\(\)/);
  assert.match(productionUrlGuard, /parsed\.path not in \("", "\/"\)/);
  assert.match(productionUrlGuard, /parsed\.username/);
  assert.match(productionUrlGuard, /parsed\.query/);
  assert.match(productionUrlGuard, /parsed\.fragment/);
  assert.match(productionUrlGuard, /parsed\.port/);
  assert.match(productionUrlGuard, /reserved_exact_hosts/);
  assert.match(productionUrlGuard, /reserved_suffixes/);
  assert.match(productionUrlGuard, /\.example\.com/);
  assert.match(productionUrlGuard, /\.test/);
  assert.match(productionUrlGuard, /"\." not in host/);
  assert.match(productionUrlGuard, /len\(host\) > 253/);
  assert.match(productionUrlGuard, /label_pattern = re\.compile/);
  assert.match(productionUrlGuard, /getattr\(ip, "ipv4_mapped", None\) or ip/);
  assert.match(productionUrlGuard, /ip\.is_global/);
  assert.match(productionUrlGuard, /not ip\.is_multicast/);
});

test("production URL guard allows public HTTPS hosts and blocks unsafe parsed hosts", () => {
  [
    "https://schedule-backend.tagzxia.com",
    "https://api.tagzxia.com:443/base",
    "https://api.tagzxia.com.",
    "https://8.8.8.8",
    "https://[2606:4700:4700::1111]",
  ].forEach(
    (baseUrl) => {
      const result = classifyProductionUrl(baseUrl);
      assert.equal(result.status, 0, baseUrl);
      assert.equal(result.stdout, "production", baseUrl);
    },
  );

  [
    "http://schedule-backend.tagzxia.com",
    "https://localhost",
    "https://127.0.0.1:9986",
    "https://0.1.2.3",
    "https://192.0.2.1",
    "https://198.51.100.1",
    "https://203.0.113.1",
    "https://224.0.0.1",
    "https://255.255.255.255",
    "https://prod",
    "https://api_tagzxia.com",
    "https://api..tagzxia.com",
    "https://-api.tagzxia.com",
    "https://api-.tagzxia.com",
    `https://${"a".repeat(64)}.tagzxia.com`,
    "https://example.com",
    "https://api.example.com",
    "https://example.org",
    "https://example.net",
    "https://touchx.example",
    "https://touchx.test",
    "https://touchx.invalid",
    "https://touchx.local",
    "https://touchx.localhost",
    "https://schedule-backend.tagzxia.com@192.168.2.1",
    "https://[::ffff:192.168.2.1]",
    "https://[::]",
    "https://[2001:db8::1]",
    "https://prod.example@[FD00::1]",
    "https://[bad",
  ].forEach((baseUrl) => {
    const result = classifyProductionUrl(baseUrl);
    assert.equal(result.status, 0, baseUrl);
    assert.equal(result.stdout, "non-production", baseUrl);
  });
});

test("smoke base URLs reject missing scheme or host, whitespace, paths, userinfo, query, and fragments before network checks", () => {
  [
    "https://",
    "https://schedule-backend.tagzxia.com ",
    "https://schedule-backend.tagzxia.com/api",
    "https://schedule-backend.tagzxia.com?debug=1",
    "https://schedule-backend.tagzxia.com#smoke",
    "https://user@schedule-backend.tagzxia.com",
    "https://schedule-backend.tagzxia.com:abc",
  ].forEach((baseUrl) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: baseUrl,
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(
      result.stderr,
      /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port for smoke:production/,
      baseUrl,
    );
    assert.doesNotMatch(result.stdout, /ok \/health/, baseUrl);
  });

  [
    "http://",
    "//127.0.0.1:9986",
    "http://127.0.0.1:9986 ",
    "http://127.0.0.1:9986/api",
    "http://127.0.0.1:9986?debug=1",
    "http://127.0.0.1:9986#smoke",
    "http://user@127.0.0.1:9986",
    "http://127.0.0.1:abc",
  ].forEach((baseUrl) => {
    const result = spawnSync("bash", [smokeLocalPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        SMOKE_BASE_URL: baseUrl,
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(
      result.stderr,
      /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port for smoke:local/,
      baseUrl,
    );
    assert.doesNotMatch(result.stdout, /Running smoke checks/, baseUrl);
  });
});

test("Cloudflare config smoke covers required bindings and migrations", () => {
  assert.match(cloudflareConfigSmoke, /MEDIA_BUCKET/);
  assert.match(cloudflareConfigSmoke, /SCHEDULE_IMPORT_BUCKET/);
  assert.match(cloudflareConfigSmoke, /NEXUS_DB/);
  assert.match(cloudflareConfigSmoke, /SCHEDULE_IMPORT_QUEUE/);
  assert.match(cloudflareConfigSmoke, /touchx-schedule-import-queue/);
  assert.match(cloudflareConfigSmoke, /getCloudflareConfig/);
  assert.match(cloudflareConfigUtils, /001_nexus_state\.sql/);
  assert.match(cloudflareConfigUtils, /002_schedule_import_jobs\.sql/);
  assert.match(cloudflareConfigUtils, /003_schedule_reminder_deliveries\.sql/);
});

test("Cloudflare live smoke is read-only and checks real resources", () => {
  assert.match(cloudflareLiveSmoke, /wranglerBaseArgs/);
  assert.match(cloudflareLiveSmoke, /whoami/);
  assert.match(cloudflareLiveSmoke, /outputHasName/);
  assert.match(cloudflareLiveSmoke, /wranglerSucceeds/);
  assert.match(cloudflareLiveSmoke, /d1", "list", "--json/);
  assert.match(cloudflareLiveSmoke, /\["result", "databases"\]/);
  assert.match(cloudflareLiveSmoke, /r2", "bucket", "list/);
  assert.match(cloudflareLiveSmoke, /outputHasName\(r2List, bucket\.bucketName\)/);
  assert.match(cloudflareLiveSmoke, /wranglerSucceeds\(\["r2", "bucket", "info", bucket\.bucketName\]/);
  assert.match(cloudflareLiveSmoke, /queues", "list/);
  assert.match(cloudflareLiveSmoke, /outputHasName\(queuesList, producer\.queue\)/);
  assert.match(cloudflareLiveSmoke, /wranglerSucceeds\(\["queues", "info", producer\.queue\]/);
  assert.match(cloudflareLiveSmoke, /deployments", "list"/);
  assert.match(cloudflareLiveSmoke, /\["deployments", "items"\]/);
  assert.match(cloudflareLiveSmoke, /\["result", "deployments"\]/);
  assert.match(cloudflareLiveSmoke, /secret", "list"/);
  assert.match(cloudflareLiveSmoke, /--format", "json"/);
  assert.match(cloudflareLiveSmoke, /extractSecretNames/);
  assert.match(cloudflareLiveSmoke, /\["result", "secrets", "items"\]/);
  assert.match(cloudflareLiveSmoke, /NEXUS_ADMIN_BOOTSTRAP_STUDENT_NO/);
  assert.match(cloudflareLiveSmoke, /NEXUS_ADMIN_LOGIN_PASSWORD/);
  assert.match(cloudflareLiveSmoke, /NEXUS_SESSION_TOKEN_SECRET/);
  assert.match(cloudflareLiveSmoke, /NEXUS_HEARTBEAT_TOKEN/);
  assert.match(cloudflareLiveSmoke, /NEXUS_HEARTBEAT_TIMEZONE/);
  assert.match(cloudflareLiveSmoke, /NEXUS_BOT_DELIVERY_TOKEN/);
  assert.match(cloudflareLiveSmoke, /NEXUS_REMINDER_DELIVERY_QUEUE/);
  assert.match(cloudflareLiveSmoke, /d1", "migrations", "list/);
  assert.match(cloudflareLiveSmoke, /outputHasName\(migrations, fileName\)/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")create(?:\s|")/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")delete(?:\s|")/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")deploy(?:\s|")/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")put(?:\s|")/);
});

test("V1 production verification gate requires real external inputs", () => {
  assert.match(backendPackageJson, /"check:v1-production-env": "bash \.\/scripts\/verify-v1-production\.sh --check-env"/);
  assert.match(v1ProductionVerify, /--check-env/);
  assert.match(v1ProductionVerify, /CHECK_ENV_ONLY/);
  assert.match(v1ProductionVerify, /reject_placeholder_env\(\)/);
  assert.match(v1ProductionVerify, /\*__REPLACE_WITH_\*/);
  assert.match(v1ProductionVerify, /reject_known_nonproduction_env\(\)/);
  assert.match(v1ProductionVerify, /reject_bearer_prefix\(\)/);
  assert.match(v1ProductionVerify, /reject_whitespace_env\(\)/);
  assert.match(v1ProductionVerify, /require_empty_or_one_flag\(\)/);
  assert.match(v1ProductionVerify, /require_empty_env\(\)/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_AUTH_TOKEN/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_STUDENT_NO/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS/);
  assert.match(v1ProductionVerify, /notification_channels="\$\{TOUCHX_SMOKE_NOTIFICATION_CHANNELS:-\}"/);
  assert.match(v1ProductionVerify, /has_wechat_clawdbot=0/);
  assert.match(v1ProductionVerify, /has_feishu=0/);
  assert.doesNotMatch(v1ProductionVerify, /notification_channels="\$\{TOUCHX_SMOKE_NOTIFICATION_CHANNELS:-\$\{TOUCHX_SMOKE_NOTIFICATION_CHANNEL:-\}\}"/);
  assert.match(v1ProductionVerify, /includes wechat_clawdbot/);
  assert.match(v1ProductionVerify, /includes feishu/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_PATH/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_MIN_ENTRIES="\$\{SMOKE_REAL_PDF_MIN_ENTRIES:-8\}"/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO="\$\{SMOKE_REAL_PDF_EXPECT_STUDENT_NO:-\$\{TOUCHX_SMOKE_STUDENT_NO:-\}\}"/);
  assert.match(v1ProductionVerify, /LOCAL_SMOKE_BASE_URL="\$\{SMOKE_BASE_URL:-http:\/\/127\.0\.0\.1:9986\}"/);
  assert.match(v1ProductionVerify, /PRODUCTION_SMOKE_BASE_URL="\$\{TOUCHX_SMOKE_BASE_URL:-https:\/\/schedule-backend\.tagzxia\.com\}"/);
  assert.match(v1ProductionVerify, /is_local_smoke_url\(\)/);
  assert.match(v1ProductionVerify, /if is_non_production_smoke_url "\$\{PRODUCTION_SMOKE_BASE_URL\}"; then/);
  assert.match(v1ProductionVerify, /source "\$\{SCRIPT_DIR\}\/production-url-guard\.sh"/);
  assert.match(v1ProductionVerify, /urlsplit/);
  assert.match(v1ProductionVerify, /parsed\.hostname/);
  assert.match(v1ProductionVerify, /require_student_no\(\)/);
  assert.match(v1ProductionVerify, /must be a 6-32 digit student number/);
  assert.match(v1ProductionVerify, /has_pdf_magic\(\)/);
  assert.match(v1ProductionVerify, /require_student_no "TOUCHX_SMOKE_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /require_student_no "SMOKE_SCHEDULE_IMPORT_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /require_student_no "SMOKE_REAL_PDF_EXPECT_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "TOUCHX_SMOKE_AUTH_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_known_nonproduction_env "TOUCHX_SMOKE_AUTH_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_known_nonproduction_env "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_bearer_prefix "TOUCHX_SMOKE_AUTH_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_whitespace_env "TOUCHX_SMOKE_AUTH_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_whitespace_env "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /reject_whitespace_env "TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD"/);
  assert.match(v1ProductionVerify, /reject_blank_env "TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD"/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD=.*Optional extra weak fallback password candidate/);
  assert.match(v1ProductionVerify, /reject_blank_env\(\)/);
  assert.match(v1ProductionVerify, /reject_blank_env "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT"/);
  assert.match(v1ProductionVerify, /reject_blank_env "TOUCHX_SMOKE_NOTIFICATION_TITLE"/);
  assert.match(v1ProductionVerify, /reject_blank_env "TOUCHX_SMOKE_NOTIFICATION_BODY"/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT=.*Optional webhook smoke text/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_TITLE=.*Optional notification smoke title/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_BODY=.*Optional notification smoke body/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO=.*Optional bootstrap admin account\/student assertion/);
  assert.match(v1ProductionVerify, /no auth prefix, whitespace, or dummy\/example\/test token value/);
  assert.match(v1ProductionVerify, /ClawDBot webhook token[\s\S]*no whitespace or dummy\/example\/test secret value/);
  assert.match(v1ProductionVerify, /require_empty_or_one_flag "TOUCHX_SMOKE_AUTH_LOGOUT"/);
  assert.match(v1ProductionVerify, /require_empty_or_one_flag "TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE"/);
  assert.match(v1ProductionVerify, /require_empty_or_one_flag "TOUCHX_SMOKE_EXTERNAL_DELIVERY"/);
  assert.match(v1ProductionVerify, /require_empty_or_one_flag "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK"/);
  assert.match(v1ProductionVerify, /require_empty_env "TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK"/);
  assert.match(v1ProductionVerify, /require_empty_env "TOUCHX_SMOKE_NOTIFICATION_CHANNEL"/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK must stay unset/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_CHANNEL[\s\S]*Must stay unset/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_EXTERNAL_DELIVERY, TOUCHX_SMOKE_CLAWDBOT_WEBHOOK, TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE must be empty or 1/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN"/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "SMOKE_REAL_PDF_PATH"/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "SMOKE_REAL_PDF_MIN_ENTRIES"/);
  assert.match(v1ProductionVerify, /reject_placeholder_env "SMOKE_REAL_PDF_EXPECT_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_PATH must be an absolute path/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_PATH must point to a PDF file/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_MIN_ENTRIES must be an integer >= 8/);
  assert.match(v1ProductionVerify, /10#\$\{SMOKE_REAL_PDF_MIN_ENTRIES\}/);
  assert.match(v1ProductionVerify, /SMOKE_BASE_URL must stay local for verify:v1-production smoke:local/);
  assert.match(
    v1ProductionVerify,
    /is_ambiguous_smoke_base_url "\$\{LOCAL_SMOKE_BASE_URL\}"[\s\S]*elif ! is_local_smoke_url "\$\{LOCAL_SMOKE_BASE_URL\}"/,
  );
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_BASE_URL must point to a public HTTPS production API for verify:v1-production/);
  assert.match(v1ProductionVerify, /non-global IP literals, single-label\/invalid DNS\/reserved hostnames/);
  assert.match(v1ProductionVerify, /scheme and host/);
  assert.match(v1ProductionVerify, /whitespace, path, userinfo, query, fragment, or invalid port/);
  assert.match(
    v1ProductionVerify,
    /is_ambiguous_smoke_base_url "\$\{PRODUCTION_SMOKE_BASE_URL\}"[\s\S]*elif is_non_production_smoke_url "\$\{PRODUCTION_SMOKE_BASE_URL\}"/,
  );
  assert.match(v1ProductionVerify, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_EXTERNAL_DELIVERY=1/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=1/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=1/);
  assert.match(v1ProductionVerify, /smoke:cloudflare-live/);
  assert.match(v1ProductionVerify, /smoke:production/);
  assert.match(v1ProductionVerify, /smoke:local/);
  assert.match(v1ProductionVerify, /smoke:local[\s\S]*smoke:cloudflare-live[\s\S]*smoke:production/);
});

test("V1 production verification rejects invalid logout opt-in flag values", () => {
  withTempPdf("touchx-v1-production-logout-flag-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_AUTH_LOGOUT: "true",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_AUTH_LOGOUT must be empty or 1/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects invalid direct smoke opt-in flag values", () => {
  withTempPdf("touchx-v1-production-direct-smoke-flags-", (pdfPath) => {
    [
      "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK",
      "TOUCHX_SMOKE_EXTERNAL_DELIVERY",
      "TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE",
    ].forEach((name) => {
      const result = runV1ProductionPrecheck({
        [name]: "true",
        SMOKE_REAL_PDF_PATH: pdfPath,
      });
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, new RegExp(`${name} must be empty or 1`), name);
      assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/, name);
    });
  });
});

test("V1 production verification refuses to skip session secret checks", () => {
  withTempPdf("touchx-v1-production-session-secret-skip-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK: "1",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK must be empty for verify:v1-production/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification accepts comma or space separated notification channels", () => {
  withTempPdf("touchx-v1-production-space-channels-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot feishu",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects unsupported notification channels", () => {
  withTempPdf("touchx-v1-production-unsupported-channel-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu,email",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS only supports wechat_clawdbot,feishu/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects empty notification channel entries", () => {
  withTempPdf("touchx-v1-production-empty-channel-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,,feishu",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS must not contain empty entries/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects duplicate notification channel entries", () => {
  withTempPdf("touchx-v1-production-duplicate-channel-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,wechat_clawdbot,feishu",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS must not contain duplicate entries/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects auth token with Bearer prefix", () => {
  withTempPdf("touchx-v1-production-auth-token-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_AUTH_TOKEN: "Bearer dummy-admin-token",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_AUTH_TOKEN must be the raw token without a Bearer prefix/);
    assert.doesNotMatch(result.stdout, /local real PDF parser smoke/);
  });
});

test("V1 production verification rejects token values containing whitespace", () => {
  withTempPdf("touchx-v1-production-token-whitespace-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy-admin-token ",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: " ",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_AUTH_TOKEN must not contain whitespace/);
    assert.match(result.stderr, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must not contain whitespace/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects malformed bootstrap expectation", () => {
  withTempPdf("touchx-v1-production-bootstrap-expectation-", (pdfPath) => {
    const placeholderResult = runV1ProductionPrecheck({
      TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO: "__REPLACE_WITH_BOOTSTRAP_STUDENT_NO__",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(placeholderResult.status, 0);
    assert.match(
      placeholderResult.stderr,
      /TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO must be replaced with a real value/,
    );
    assert.doesNotMatch(placeholderResult.stdout, /ok V1 production verification inputs/);

    const whitespaceResult = runV1ProductionPrecheck({
      TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO: "admin@schedule.com ",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(whitespaceResult.status, 0);
    assert.match(whitespaceResult.stderr, /TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO must not contain whitespace/);
    assert.doesNotMatch(whitespaceResult.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification requires plural notification channels for full gate", () => {
  withTempPdf("touchx-v1-production-channels-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "",
      TOUCHX_SMOKE_NOTIFICATION_CHANNEL: "wechat_clawdbot,feishu",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS=wechat_clawdbot,feishu/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects legacy single notification channel env", () => {
  withTempPdf("touchx-v1-production-legacy-channel-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_NOTIFICATION_CHANNEL: "wechat_clawdbot",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_CHANNEL must be empty for verify:v1-production/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects unreplaced env template placeholders", () => {
  const result = runV1ProductionPrecheck({
    TOUCHX_SMOKE_AUTH_TOKEN: "__REPLACE_WITH_PRODUCTION_ADMIN_TOKEN__",
    TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "__REPLACE_WITH_CLAWDBOT_WEBHOOK_TOKEN__",
    TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT: "__REPLACE_WITH_CLAWDBOT_TEXT__",
    TOUCHX_SMOKE_NOTIFICATION_TITLE: "smoke __REPLACE_WITH_SMOKE_TITLE__",
    TOUCHX_SMOKE_NOTIFICATION_BODY: "__REPLACE_WITH_SMOKE_BODY__",
    SMOKE_REAL_PDF_PATH: "/absolute/path/real-schedule.pdf",
    SMOKE_REAL_PDF_MIN_ENTRIES: "__REPLACE_WITH_MIN_REAL_PDF_ENTRIES__",
    SMOKE_REAL_PDF_EXPECT_STUDENT_NO: "__REPLACE_WITH_REAL_PDF_STUDENT_NO__",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real value/);
  assert.match(result.stderr, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real value/);
  assert.match(result.stderr, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT must be replaced with a real value/);
  assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_TITLE must be replaced with a real value/);
  assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_BODY must be replaced with a real value/);
  assert.match(result.stderr, /SMOKE_REAL_PDF_PATH must be replaced with a real value/);
  assert.match(result.stderr, /SMOKE_REAL_PDF_MIN_ENTRIES must be replaced with a real value/);
  assert.match(result.stderr, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO must be replaced with a real value/);
  assert.doesNotMatch(result.stdout, /local real PDF parser smoke/);
});

test("V1 production verification rejects blank optional message values", () => {
  withTempPdf("touchx-v1-production-blank-message-", (pdfPath) => {
    [
      {
        env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT: "   " },
        pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT must not be blank/,
      },
      {
        env: { TOUCHX_SMOKE_NOTIFICATION_TITLE: "\t" },
        pattern: /TOUCHX_SMOKE_NOTIFICATION_TITLE must not be blank/,
      },
      {
        env: { TOUCHX_SMOKE_NOTIFICATION_BODY: "   " },
        pattern: /TOUCHX_SMOKE_NOTIFICATION_BODY must not be blank/,
      },
    ].forEach(({ env, pattern }) => {
      const result = runV1ProductionPrecheck({
        SMOKE_REAL_PDF_PATH: pdfPath,
        ...env,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
    });
  });
});

test("V1 production verification rejects malformed fallback admin password candidate", () => {
  withTempPdf("touchx-v1-production-fallback-password-", (pdfPath) => {
    [
      {
        env: { TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD: "fallback-__REPLACE_WITH_FALLBACK_ADMIN_PASSWORD__" },
        pattern: /TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD must be replaced with a real value/,
      },
      {
        env: { TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD: "   " },
        pattern: /TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD must not be blank/,
      },
    ].forEach(({ env, pattern }) => {
      const result = runV1ProductionPrecheck({
        SMOKE_REAL_PDF_PATH: pdfPath,
        ...env,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
    });
  });
});

test("V1 production verification rejects known non-production token values", () => {
  withTempPdf("touchx-v1-production-dummy-token-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy-admin-token-2026",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "EXAMPLE-webhook-secret-local",
      SMOKE_REAL_PDF_PATH: pdfPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real production value/);
    assert.match(result.stderr, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real production value/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification rejects bare placeholder token values", () => {
  withTempPdf("touchx-v1-production-placeholder-token-", (pdfPath) => {
    [
      {
        env: { TOUCHX_SMOKE_AUTH_TOKEN: "test" },
        pattern: /TOUCHX_SMOKE_AUTH_TOKEN must be replaced with a real production value/,
      },
      {
        env: { TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "changeme" },
        pattern: /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN must be replaced with a real production value/,
      },
    ].forEach(({ env, pattern }) => {
      const result = runV1ProductionPrecheck({
        SMOKE_REAL_PDF_PATH: pdfPath,
        ...env,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
    });
  });
});

test("V1 production verification requires an absolute real PDF path", () => {
  const result = runV1ProductionPrecheck({
    SMOKE_REAL_PDF_PATH: "fixtures/real-schedule.pdf",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMOKE_REAL_PDF_PATH must be an absolute path/);
  assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
});

test("V1 production verification rejects non-PDF real sample files", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "touchx-v1-production-non-pdf-"));
  const textPath = join(tempDir, "real-schedule.txt");
  writeFileSync(textPath, "not a pdf\n");
  try {
    const result = runV1ProductionPrecheck({
      SMOKE_REAL_PDF_PATH: textPath,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SMOKE_REAL_PDF_PATH must point to a PDF file/);
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V1 production verification rejects unexpected CLI arguments", () => {
  const result = runV1ProductionVerify(["--check-env", "extra"], process.env);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: .*verify-v1-production\.sh \[--check-env\]/);
  assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
});

test("V1 production verification can precheck env without network smoke", () => {
  withTempPdf("touchx-v1-production-env-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      SMOKE_REAL_PDF_PATH: pdfPath,
      SMOKE_REAL_PDF_MIN_ENTRIES: "08",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ok V1 production verification inputs/);
    assert.doesNotMatch(result.stdout, /local real PDF parser smoke/);
    assert.doesNotMatch(result.stdout, /Cloudflare live resources/);
    assert.doesNotMatch(result.stdout, /production API, auth, queue, and external delivery/);
  });
});

test("V1 production verification rejects weak real PDF thresholds", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_REAL_PDF_MIN_ENTRIES: "1",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMOKE_REAL_PDF_MIN_ENTRIES must be an integer >= 8/);
});

test("V1 production verification rejects malformed student numbers before network checks", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
      TOUCHX_SMOKE_STUDENT_NO: "student-2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "import-student",
      SMOKE_REAL_PDF_EXPECT_STUDENT_NO: "expected-student",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TOUCHX_SMOKE_STUDENT_NO must be a 6-32 digit student number/);
  assert.match(result.stderr, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO must be a 6-32 digit student number/);
  assert.match(result.stderr, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO must be a 6-32 digit student number/);
});

test("V1 production verification keeps real PDF owner aligned with import student", () => {
  withTempPdf("touchx-v1-production-pdf-owner-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      SMOKE_REAL_PDF_PATH: pdfPath,
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100614",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /SMOKE_REAL_PDF_EXPECT_STUDENT_NO must match SMOKE_SCHEDULE_IMPORT_STUDENT_NO for real PDF smoke/,
    );
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification keeps import student aligned with production student", () => {
  withTempPdf("touchx-v1-production-import-owner-", (pdfPath) => {
    const result = runV1ProductionPrecheck({
      SMOKE_REAL_PDF_PATH: pdfPath,
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100614",
      SMOKE_REAL_PDF_EXPECT_STUDENT_NO: "2305100614",
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /SMOKE_SCHEDULE_IMPORT_STUDENT_NO must match TOUCHX_SMOKE_STUDENT_NO for verify:v1-production real PDF smoke/,
    );
    assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
  });
});

test("V1 production verification docs mention required student number format", () => {
  [rootReadme, backendReadme, todoDoc, v1CloseoutStatus].forEach((doc) => {
    assert.match(doc, /6-32 位数字/);
  });
  [rootReadme, backendReadme, todoDoc, v1CloseoutStatus].forEach((doc) => {
    assert.match(doc, /HTTPS|公网 HTTPS/);
  });
  assert.match(backendReadme, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO/);
  assert.match(backendReadme, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO/);
  assert.match(backendReadme, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO[^。]*TOUCHX_SMOKE_STUDENT_NO/);
  assert.match(backendReadme, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO[^。]*SMOKE_SCHEDULE_IMPORT_STUDENT_NO/);
  assert.match(backendReadme, /SMOKE_REAL_PDF_MIN_ENTRIES[^。]*不能使用未替换占位符/);
  assert.match(backendReadme, /绝对 PDF 文件路径|真实 PDF 路径必须是绝对 PDF 文件路径/);
  assert.match(backendReadme, /不能包含空白字符/);
  assert.match(backendReadme, /纯空白值/);
  assert.match(backendReadme, /完整生产聚合 gate 会拒绝该变量/);
  assert.match(todoDoc, /完整生产 gate 会拒绝 `TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK`/);
  assert.match(todoDoc, /纯空白值/);
  assert.match(v1CloseoutStatus, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO/);
  assert.match(v1CloseoutStatus, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO[^；。]*TOUCHX_SMOKE_STUDENT_NO/);
  assert.match(v1CloseoutStatus, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO[^；。]*SMOKE_SCHEDULE_IMPORT_STUDENT_NO/);
  assert.match(v1CloseoutStatus, /SMOKE_REAL_PDF_MIN_ENTRIES[^。]*不能使用未替换占位符/);
  assert.match(v1CloseoutStatus, /绝对 PDF 文件路径|真实 PDF 路径必须是绝对 PDF 文件路径/);
  assert.match(v1CloseoutStatus, /不能包含空白字符/);
  assert.match(v1CloseoutStatus, /纯空白值/);
  assert.match(v1CloseoutStatus, /TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD/);
  assert.match(v1CloseoutStatus, /TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK` 必须为空/);
  assert.match(backendReadme, /非 global IP literal/);
  assert.match(todoDoc, /非 global IP literal/);
  assert.match(v1CloseoutStatus, /非 global IP literal/);
  assert.match(backendReadme, /scheme(?: 和 |\/)host/);
  assert.match(todoDoc, /scheme\/host/);
  assert.match(v1CloseoutStatus, /scheme\/host/);
  assert.match(backendReadme, /legacy 变量只能包含一个通道/);
  assert.match(todoDoc, /legacy `TOUCHX_SMOKE_NOTIFICATION_CHANNEL` 只允许一个通道/);
  assert.match(v1CloseoutStatus, /legacy 变量只能包含一个通道/);
  assert.match(backendReadme, /保留域名/);
  assert.match(todoDoc, /保留域名/);
  assert.match(v1CloseoutStatus, /保留域名/);
    assert.match(backendReadme, /单标签/);
    assert.match(todoDoc, /单标签/);
    assert.match(v1CloseoutStatus, /单标签/);
    assert.match(backendReadme, /非法 DNS hostname/);
    assert.match(todoDoc, /非法 DNS hostname/);
    assert.match(v1CloseoutStatus, /非法 DNS hostname/);
    assert.match(backendReadme, /非法端口/);
  assert.match(todoDoc, /非法端口/);
  assert.match(v1CloseoutStatus, /非法端口/);
  assert.match(backendReadme, /始终检查默认 `fallback:123456`/);
  assert.match(todoDoc, /始终检查默认 `fallback:123456` 候选/);
});

test("V1 production verification env template avoids committing real smoke secrets", () => {
  [
    "TOUCHX_SMOKE_BASE_URL",
    "TOUCHX_SMOKE_AUTH_TOKEN",
    "TOUCHX_SMOKE_STUDENT_NO",
    "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN",
    "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT",
    "TOUCHX_SMOKE_NOTIFICATION_CHANNELS",
    "TOUCHX_SMOKE_NOTIFICATION_CHANNEL",
    "TOUCHX_SMOKE_NOTIFICATION_TITLE",
    "TOUCHX_SMOKE_NOTIFICATION_BODY",
    "SMOKE_BASE_URL",
    "SMOKE_SCHEDULE_IMPORT_STUDENT_NO",
    "SMOKE_REAL_PDF_PATH",
    "SMOKE_REAL_PDF_MIN_ENTRIES",
    "SMOKE_REAL_PDF_EXPECT_STUDENT_NO",
    "TOUCHX_SMOKE_AUTH_LOGOUT",
    "TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD",
    "TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK",
    "TOUCHX_SMOKE_EXTERNAL_DELIVERY",
    "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK",
    "TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE",
  ].forEach((name) => {
    assert.match(productionSmokeEnvExample, new RegExp(`^${name}=`, "m"));
  });

    assert.match(productionSmokeEnvExample, /\.env\.production-smoke\.local/);
    assert.match(productionSmokeEnvExample, /invalid DNS/);
    assert.match(productionSmokeEnvExample, /set -a; source apps\/backend\/\.env\.production-smoke\.local; set \+a/);
  assert.match(productionSmokeEnvExample, /check:v1-production-env/);
  assert.match(productionSmokeEnvExample, /__REPLACE_WITH_PRODUCTION_ADMIN_TOKEN__/);
  assert.match(productionSmokeEnvExample, /wechat_clawdbot,feishu/);
  assert.match(productionSmokeEnvExample, /bootstrap admin account\/student[\s\S]*Do not include whitespace or a placeholder value/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO=$/m);
  assert.match(productionSmokeEnvExample, /Legacy single-channel direct smoke variable; keep empty for verify:v1-production/);
  assert.match(productionSmokeEnvExample, /use TOUCHX_SMOKE_NOTIFICATION_CHANNELS for multiple channels/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_NOTIFICATION_CHANNEL=$/m);
  assert.match(productionSmokeEnvExample, /do not include the auth scheme prefix, whitespace, or dummy\/example\/test token value/);
  assert.match(productionSmokeEnvExample, /webhook token[\s\S]*do not include whitespace or dummy\/example\/test secret value/);
  assert.match(productionSmokeEnvExample, /webhook smoke text[\s\S]*do not use a placeholder or blank value/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT=$/m);
  assert.match(productionSmokeEnvExample, /external notification smoke message[\s\S]*do not use placeholder or blank values/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_NOTIFICATION_TITLE=$/m);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_NOTIFICATION_BODY=$/m);
  assert.match(productionSmokeEnvExample, /extra weak fallback admin password candidate[\s\S]*do not use a placeholder or blank value/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD=$/m);
  assert.match(productionSmokeEnvExample, /Session-secret bypass must stay empty for verify:v1-production/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK=$/m);
  assert.match(productionSmokeEnvExample, /Direct smoke opt-in flags are set by verify:v1-production/);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_EXTERNAL_DELIVERY=$/m);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=$/m);
  assert.match(productionSmokeEnvExample, /^TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=$/m);
  assert.doesNotMatch(productionSmokeEnvExample, /txs1\./);
  assert.doesNotMatch(productionSmokeEnvExample, /Bearer\s+/);
  assert.match(rootGitignore, /apps\/backend\/\.env\.\*/);
  assert.match(rootGitignore, /!apps\/backend\/\.env\.production-smoke\.example/);
  [rootReadme, backendReadme, v1CloseoutStatus].forEach((doc) => {
    assert.match(doc, /apps\/backend\/\.env\.production-smoke\.example/);
    assert.match(doc, /apps\/backend\/\.env\.production-smoke\.local/);
    assert.match(doc, /set -a; source apps\/backend\/\.env\.production-smoke\.local; set \+a/);
    assert.match(doc, /check:v1-production-env/);
  });
});

test("V1 production verification keeps local PDF smoke off production URLs", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
      SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMOKE_BASE_URL must stay local for verify:v1-production smoke:local/);
});

test("V1 production verification rejects ambiguous smoke base URLs before network checks", () => {
  withTempPdf("touchx-v1-production-ambiguous-base-url-", (pdfPath) => {
    [
      {
        env: { SMOKE_BASE_URL: "http://" },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { SMOKE_BASE_URL: "//127.0.0.1:9986" },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { SMOKE_BASE_URL: "http://127.0.0.1:9986?debug=1" },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { SMOKE_BASE_URL: "http://127.0.0.1:9986 " },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { SMOKE_BASE_URL: "http://127.0.0.1:abc" },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { SMOKE_BASE_URL: "http://127.0.0.1:9986@evil.test" },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { SMOKE_BASE_URL: "http://localhost:9986@evil.test" },
        pattern: /SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "//schedule-backend.tagzxia.com" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com/api" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com#smoke" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: " https://schedule-backend.tagzxia.com" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://user@schedule-backend.tagzxia.com" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com@192.168.2.1" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://prod.example@[FD00::1]" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
      {
        env: { TOUCHX_SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com:abc" },
        pattern: /TOUCHX_SMOKE_BASE_URL must include a scheme and host and must not include whitespace, path, userinfo, query, fragment, or invalid port/,
      },
    ].forEach(({ env, pattern }) => {
      const result = runV1ProductionPrecheck({
        SMOKE_REAL_PDF_PATH: pdfPath,
        ...env,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stdout, /ok V1 production verification inputs/);
    });
  });
});

test("local smoke URL checks require localhost host boundaries", () => {
  [v1ProductionVerify, smokeLocal].forEach((source) => {
    assert.match(source, /urlsplit/);
    assert.match(source, /parsed\.hostname/);
    assert.doesNotMatch(source, /http:\/\/127\.0\.0\.1:"\*/);
    assert.doesNotMatch(source, /http:\/\/localhost:"\*/);
  });
    [
      "http://localhost.evil.test:9986",
      "http://127.0.0.1.evil.test:9986",
    ].forEach((baseUrl) => {
    const result = spawnSync("bash", [v1ProductionVerifyPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_STUDENT_NO: "2305100613",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
        SMOKE_BASE_URL: baseUrl,
        SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
        SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(result.stderr, /SMOKE_BASE_URL must stay local for verify:v1-production smoke:local/, baseUrl);
  });
});

test("smoke-local refuses local-only write flows on non-local base URLs before network checks", () => {
  [
    {
      env: { SMOKE_STUDENT_NO_LOGIN: "2305100613" },
      pattern: /SMOKE_STUDENT_NO_LOGIN requires local SMOKE_BASE_URL for smoke:local/,
    },
    {
      env: { SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613" },
      pattern: /SMOKE_SCHEDULE_IMPORT_STUDENT_NO requires local SMOKE_BASE_URL for smoke:local/,
    },
    {
      env: { SMOKE_SOCIAL_P0: "1" },
      pattern: /SMOKE_SOCIAL_P0 requires local SMOKE_BASE_URL for smoke:local/,
    },
    {
      env: { SMOKE_HEARTBEAT_TOKEN: "local-heartbeat-token" },
      pattern: /SMOKE_HEARTBEAT_TOKEN requires local SMOKE_BASE_URL for smoke:local/,
    },
    {
      env: { SMOKE_BOT_DELIVERY_TOKEN: "local-bot-token" },
      pattern: /SMOKE_BOT_DELIVERY_TOKEN requires local SMOKE_BASE_URL for smoke:local/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [smokeLocalPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /Running smoke checks/);
  });
});

test("smoke-local rejects malformed local-only flags before network checks", () => {
  const result = spawnSync("bash", [smokeLocalPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      SMOKE_SOCIAL_P0: "true",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMOKE_SOCIAL_P0 must be empty or 1/);
  assert.doesNotMatch(result.stdout, /Running smoke checks/);
});

test("smoke-local rejects malformed direct smoke inputs before network checks", () => {
  assert.match(smokeLocal, /10#\$\{SMOKE_REAL_PDF_MIN_ENTRIES:-1\}/);
  assert.match(smokeLocal, /10#\$\{SMOKE_SCHEDULE_IMPORT_POLL_ATTEMPTS:-20\}/);
  [
    {
      env: { SMOKE_HEARTBEAT_TOKEN: "Bearer local-heartbeat-token" },
      pattern: /SMOKE_HEARTBEAT_TOKEN must be the raw token without a Bearer prefix/,
    },
    {
      env: { SMOKE_BOT_DELIVERY_TOKEN: "local bot token" },
      pattern: /SMOKE_BOT_DELIVERY_TOKEN must not contain whitespace/,
    },
    {
      env: { SMOKE_HEARTBEAT_TOKEN: "local-__REPLACE_WITH_LOCAL_HEARTBEAT_TOKEN__" },
      pattern: /SMOKE_HEARTBEAT_TOKEN must be replaced with a real value/,
    },
    {
      env: { SMOKE_STUDENT_NO_LOGIN: "student-2305100613" },
      pattern: /SMOKE_STUDENT_NO_LOGIN must be a 6-32 digit student number/,
    },
    {
      env: { SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "import-student" },
      pattern: /SMOKE_SCHEDULE_IMPORT_STUDENT_NO must be a 6-32 digit student number/,
    },
    {
      env: { SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "__REPLACE_WITH_6_TO_32_DIGIT_STUDENT_NO__" },
      pattern: /SMOKE_SCHEDULE_IMPORT_STUDENT_NO must be replaced with a real value/,
    },
    {
      env: { SMOKE_REAL_PDF_EXPECT_STUDENT_NO: "expected-student" },
      pattern: /SMOKE_REAL_PDF_EXPECT_STUDENT_NO must be a 6-32 digit student number/,
    },
    {
      env: { SMOKE_REAL_PDF_MIN_ENTRIES: "0" },
      pattern: /SMOKE_REAL_PDF_MIN_ENTRIES must be an integer >= 1/,
    },
    {
      env: { SMOKE_REAL_PDF_MIN_ENTRIES: "__REPLACE_WITH_MIN_REAL_PDF_ENTRIES__" },
      pattern: /SMOKE_REAL_PDF_MIN_ENTRIES must be replaced with a real value/,
    },
    {
      env: { SMOKE_SCHEDULE_IMPORT_POLL_ATTEMPTS: "never" },
      pattern: /SMOKE_SCHEDULE_IMPORT_POLL_ATTEMPTS must be an integer >= 1/,
    },
  ].forEach(({ env, pattern }) => {
    const result = spawnSync("bash", [smokeLocalPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.doesNotMatch(result.stdout, /Running smoke checks/);
  });
});

test("smoke-local rejects unusable real PDF inputs before network checks", () => {
  withTempPdf("touchx-local-real-pdf-inputs-", (pdfPath) => {
    [
      {
        env: { SMOKE_REAL_PDF_PATH: pdfPath },
        pattern: /SMOKE_REAL_PDF_PATH requires SMOKE_SCHEDULE_IMPORT_STUDENT_NO for smoke:local/,
      },
      {
        env: { SMOKE_REAL_PDF_MIN_ENTRIES: "8" },
        pattern: /SMOKE_REAL_PDF_MIN_ENTRIES requires SMOKE_REAL_PDF_PATH for smoke:local/,
      },
      {
        env: { SMOKE_REAL_PDF_EXPECT_STUDENT_NO: "2305100613" },
        pattern: /SMOKE_REAL_PDF_EXPECT_STUDENT_NO requires SMOKE_REAL_PDF_PATH for smoke:local/,
      },
      {
        env: {
          SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
          SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
        },
        pattern: /SMOKE_REAL_PDF_PATH must exist: \/tmp\/touchx-missing-real-schedule\.pdf/,
      },
      {
        env: {
          SMOKE_REAL_PDF_PATH: "/absolute/path/real-schedule.pdf",
          SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
        },
        pattern: /SMOKE_REAL_PDF_PATH must be replaced with a real value/,
      },
      {
        env: {
          SMOKE_REAL_PDF_PATH: "/tmp/__REPLACE_WITH_REAL_PDF_PATH__.pdf",
          SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
        },
        pattern: /SMOKE_REAL_PDF_PATH must be replaced with a real value/,
      },
      {
        env: {
          SMOKE_REAL_PDF_PATH: pdfPath,
          SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
          SMOKE_REAL_PDF_EXPECT_STUDENT_NO: "2305100614",
        },
        pattern: /SMOKE_REAL_PDF_EXPECT_STUDENT_NO must match SMOKE_SCHEDULE_IMPORT_STUDENT_NO for real PDF smoke/,
      },
    ].forEach(({ env, pattern }) => {
      const result = spawnSync("bash", [smokeLocalPath], {
        cwd: join(import.meta.dirname, "../../.."),
        encoding: "utf8",
        env: {
          ...process.env,
          ...env,
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, pattern);
      assert.doesNotMatch(result.stdout, /Running smoke checks/);
    });
  });

  const relativeTempDir = mkdtempSync(join(tmpdir(), "touchx-local-real-pdf-relative-"));
  const relativePdfPath = join(relativeTempDir, "real-schedule.pdf");
  writeFileSync(relativePdfPath, "%PDF-1.4\n");
  try {
    const result = spawnSync("bash", [smokeLocalPath], {
      cwd: relativeTempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        SMOKE_REAL_PDF_PATH: "real-schedule.pdf",
        SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SMOKE_REAL_PDF_PATH must be an absolute path/);
    assert.doesNotMatch(result.stdout, /Running smoke checks/);
  } finally {
    rmSync(relativeTempDir, { recursive: true, force: true });
  }

  const tempDir = mkdtempSync(join(tmpdir(), "touchx-local-real-pdf-nonpdf-"));
  const textPath = join(tempDir, "real-schedule.txt");
  writeFileSync(textPath, "not a pdf");
  try {
    const result = spawnSync("bash", [smokeLocalPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        SMOKE_REAL_PDF_PATH: textPath,
        SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SMOKE_REAL_PDF_PATH must point to a PDF file/);
    assert.doesNotMatch(result.stdout, /Running smoke checks/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V1 production verification keeps production smoke off local URLs", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
      TOUCHX_SMOKE_BASE_URL: "http://127.0.0.1:9986",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TOUCHX_SMOKE_BASE_URL must point to a public HTTPS production API for verify:v1-production/);
});

test("V1 production verification keeps production smoke off private network URLs", () => {
  [
    "http://schedule-backend.tagzxia.com",
    "http://10.0.0.8:9986",
    "https://172.16.2.1",
    "https://192.168.2.1",
    "https://169.254.1.1",
    "https://100.64.0.1",
    "https://100.127.255.1",
    "https://0.1.2.3",
    "https://192.0.2.1",
    "https://198.51.100.1",
    "https://203.0.113.1",
    "https://224.0.0.1",
    "https://255.255.255.255",
    "https://prod",
    "https://api_tagzxia.com",
    "https://api..tagzxia.com",
    "https://-api.tagzxia.com",
    "https://api-.tagzxia.com",
    "https://api.example.com",
    "https://touchx.example",
    "https://touchx.test",
    "https://touchx.invalid",
    "https://touchx.local",
    "https://touchx.localhost",
    "https://[::ffff:192.168.2.1]",
    "https://[::]",
    "http://[::1]:9986",
    "https://[2001:db8::1]",
    "https://[fd00::1]",
    "https://[FD00::1]",
    "https://[fe80::1]",
    "https://[FEBF::1]",
  ].forEach((baseUrl) => {
    const result = spawnSync("bash", [v1ProductionVerifyPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
        TOUCHX_SMOKE_STUDENT_NO: "2305100613",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
        TOUCHX_SMOKE_BASE_URL: baseUrl,
        SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
        SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(
      result.stderr,
      /TOUCHX_SMOKE_BASE_URL must point to a public HTTPS production API for verify:v1-production/,
      baseUrl,
    );
  });
});

test("production smoke can opt into ClawDBot webhook inbound verification", () => {
  assert.match(script, /request_clawdbot_webhook\(\)/);
  assert.match(script, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK/);
  assert.match(script, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN/);
  assert.match(script, /default_text = "周三下午3点复习数据结构"/);
  assert.match(script, /os\.environ\.get\("TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT"\) or default_text/);
  assert.match(script, /\/api\/v1\/bot\/clawdbot\/webhook/);
  assert.match(script, /x-clawdbot-webhook-token/);
  assert.match(script, /"commit": False/);
  assert.match(script, /payload\.get\("webhook"\) is True/);
  assert.match(script, /payload\.get\("committed"\) is False/);
  assert.match(script, /ok ClawDBot webhook inbound smoke/);
  assert.match(script, /request_external_notification[\s\S]*request_clawdbot_webhook[\s\S]*request_admin_logout_revocation/);
});

test("production smoke can verify multiple external notification channels", () => {
  assert.match(script, /request_external_notification_channel\(\)/);
  assert.match(script, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS/);
  assert.match(script, /TOUCHX_SMOKE_NOTIFICATION_CHANNEL:-/);
  assert.match(script, /reject_legacy_notification_channel_list\(\)/);
  assert.match(script, /TOUCHX_SMOKE_NOTIFICATION_CHANNEL must be empty when TOUCHX_SMOKE_NOTIFICATION_CHANNELS is set/);
  assert.match(script, /TOUCHX_SMOKE_NOTIFICATION_CHANNEL must contain exactly one channel/);
  assert.match(script, /default_title = "TouchX 生产 smoke"/);
  assert.match(script, /default_body = "这是一条 TouchX 生产外部通知链路 smoke。"/);
  assert.match(script, /os\.environ\.get\("TOUCHX_SMOKE_NOTIFICATION_TITLE"\) or default_title/);
  assert.match(script, /os\.environ\.get\("TOUCHX_SMOKE_NOTIFICATION_BODY"\) or default_body/);
  assert.match(script, /for channel_type in \$\{channels\}/);
  assert.match(script, /notification-channels\/\$\{channel_type\}\/test/);
  assert.match(script, /ok external notification \$\{channel_type\} -> sent/);
});

test("V1 production verification rejects single-channel external delivery", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: validProductionAuthToken,
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: validClawdbotWebhookToken,
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS includes feishu/);
});

test("API boundary smoke guards V1 dispatcher size and module delegation", () => {
  assert.match(apiBoundarySmoke, /server\/services\/v1-api\.ts/);
  assert.match(apiBoundarySmoke, /server\/services\/social-v1-api\.ts/);
  assert.match(apiBoundarySmoke, /assertLineBudget\(v1Api, 700\)/);
  assert.match(apiBoundarySmoke, /assertLineBudget\(socialV1Api, 450\)/);
  assert.match(apiBoundarySmoke, /\.\.\/modules\/auth\/auth-handler/);
  assert.match(apiBoundarySmoke, /\.\.\/modules\/notification\/notification-admin-handler/);
  assert.match(apiBoundarySmoke, /\.\.\/modules\/legacy\/legacy-account-handler/);
  assert.match(apiBoundarySmoke, /readMultipartFormData/);
});

test("admin UI boundary smoke guards shared Nexus shell reuse", () => {
  assert.match(adminUiBoundarySmoke, /NexusAdminShell\.vue/);
  assert.match(adminUiBoundarySmoke, /NexusDashboard\.vue/);
  assert.match(adminUiBoundarySmoke, /nexusPagesRoot/);
  assert.match(adminUiBoundarySmoke, /init\.vue/);
  assert.match(adminUiBoundarySmoke, /login\.vue/);
  assert.match(adminUiBoundarySmoke, /NexusConsole\.vue/);
  assert.match(adminUiBoundarySmoke, /AdminShell\|Dashboard/);
  assert.match(adminUiBoundarySmoke, /rx-btn-ghost/);
  assert.match(adminUiBoundarySmoke, /smoke:admin-ui-boundaries/);
});

test("client boundary smoke guards shared API client reuse", () => {
  assert.match(clientBoundarySmoke, /apps\/miniapp\/src\/lib\/api\.ts/);
  assert.match(clientBoundarySmoke, /apps\/mobile\/src\/api\.ts/);
  assert.match(clientBoundarySmoke, /apps\/mobile\/src\/App\.tsx/);
  assert.match(clientBoundarySmoke, /packages\/api-client\/src\/index\.ts/);
  assert.match(clientBoundarySmoke, /from \\"@touchx\/api-client\\"/);
  assert.match(clientBoundarySmoke, /createTouchXApiClient/);
  assert.match(clientBoundarySmoke, /resolveTouchXApiBaseUrl/);
  assert.match(clientBoundarySmoke, /mobileNativeTheme/);
  assert.match(clientBoundarySmoke, /calendarEventTones/);
  assert.match(clientBoundarySmoke, /must not define a local mobile color palette/);
  assert.match(clientBoundarySmoke, /assertMobileServerTimeParity/);
  assert.match(clientBoundarySmoke, /syncServerOffsetFromIso/);
  assert.match(clientBoundarySmoke, /alignWithServerWeek/);
  assert.match(clientBoundarySmoke, /Taro\.uploadFile/);
  assert.match(clientBoundarySmoke, /fetcher: fetch/);
  assert.match(clientBoundarySmoke, /must not include/);
});

test("miniapp parity smoke guards server-time calibration", () => {
  assert.match(miniappParitySmoke, /serverOffsetMs/);
  assert.match(miniappParitySmoke, /getTodayBrief/);
  assert.match(miniappParitySmoke, /syncServerOffsetFromIso/);
  assert.match(miniappParitySmoke, /getServerNow/);
  assert.match(miniappParitySmoke, /useMemo\(\(\) => getTodayInfo\(\), \[\]\)/);
  assert.match(miniappParitySmoke, /server-time/);
  assert.match(miniappParitySmoke, /release-candidate gate/);
  assert.match(miniappParitySmoke, /2026-06-08/);
});

test("data boundary smoke guards D1 payload state and V1 infra scope", () => {
  assert.match(dataBoundarySmoke, /001_nexus_state\.sql/);
  assert.match(dataBoundarySmoke, /payload TEXT NOT NULL/);
  assert.match(dataBoundarySmoke, /NEXUS_STATE_PAYLOAD_EMPTY/);
  assert.match(dataBoundarySmoke, /NEXUS_STATE_PAYLOAD_INVALID_JSON/);
  assert.match(dataBoundarySmoke, /NEXUS_STATE_PAYLOAD_INVALID_SHAPE/);
  assert.match(dataBoundarySmoke, /refusing to bootstrap over persisted state/);
  assert.match(dataBoundarySmoke, /smoke:data-boundaries/);
  assert.match(dataBoundarySmoke, /docker-compose\.yml/);
  assert.match(dataBoundarySmoke, /postgres/);
  assert.match(dataBoundarySmoke, /redis/);
});
