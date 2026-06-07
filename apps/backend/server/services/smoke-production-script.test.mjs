import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const smokeLocalPath = join(import.meta.dirname, "../../scripts/smoke-local.sh");
const smokeLocal = readFileSync(smokeLocalPath, "utf8");
const apiBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-api-boundaries.mjs");
const apiBoundarySmoke = readFileSync(apiBoundarySmokePath, "utf8");
const adminUiBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-admin-ui-boundaries.mjs");
const adminUiBoundarySmoke = readFileSync(adminUiBoundarySmokePath, "utf8");
const clientBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-client-boundaries.mjs");
const clientBoundarySmoke = readFileSync(clientBoundarySmokePath, "utf8");
const dataBoundarySmokePath = join(import.meta.dirname, "../../scripts/smoke-data-boundaries.mjs");
const dataBoundarySmoke = readFileSync(dataBoundarySmokePath, "utf8");
const rootReadme = readFileSync(join(import.meta.dirname, "../../../../README.md"), "utf8");
const backendReadme = readFileSync(join(import.meta.dirname, "../../README.md"), "utf8");
const todoDoc = readFileSync(join(import.meta.dirname, "../../../../TODO.md"), "utf8");
const v1CloseoutStatus = readFileSync(join(import.meta.dirname, "../../../../docs/v1-closeout-status.md"), "utf8");

test("production smoke rejects weak fallback session secrets by default", () => {
  assert.match(script, /is_non_production_smoke_url\(\)/);
  assert.match(script, /public HTTPS production API for smoke:production/);
  assert.match(script, /request_session_secret_security\(\)/);
  assert.match(script, /create_signed_smoke_token\(\)/);
  assert.match(script, /fallback:\$\{fallback_password\}/);
  assert.match(script, /touchx-session-fallback-secret/);
  assert.match(script, /TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK/);
  assert.match(script, /expected 401 for weak fallback session token/);
  assert.match(script, /request_admin_bootstrap_status[\s\S]*request_session_secret_security[\s\S]*request_protected/);
});

test("production smoke refuses non-production base URLs before network checks", () => {
  ["http://127.0.0.1:9986", "http://schedule-backend.tagzxia.com", "https://192.168.2.1"].forEach((baseUrl) => {
    const result = spawnSync("bash", [scriptPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_BASE_URL: baseUrl,
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(result.stderr, /public HTTPS production API for smoke:production/, baseUrl);
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
  assert.match(cloudflareLiveSmoke, /d1", "list", "--json/);
  assert.match(cloudflareLiveSmoke, /r2", "bucket", "list/);
  assert.match(cloudflareLiveSmoke, /queues", "list/);
  assert.match(cloudflareLiveSmoke, /deployments", "list"/);
  assert.match(cloudflareLiveSmoke, /d1", "migrations", "list/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")create(?:\s|")/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")delete(?:\s|")/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")deploy(?:\s|")/);
  assert.doesNotMatch(cloudflareLiveSmoke, /(?:^|")put(?:\s|")/);
});

test("V1 production verification gate requires real external inputs", () => {
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_AUTH_TOKEN/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_STUDENT_NO/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_CHANNELS/);
  assert.match(v1ProductionVerify, /includes wechat_clawdbot/);
  assert.match(v1ProductionVerify, /includes feishu/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_PATH/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_MIN_ENTRIES="\$\{SMOKE_REAL_PDF_MIN_ENTRIES:-8\}"/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO="\$\{SMOKE_REAL_PDF_EXPECT_STUDENT_NO:-\$\{TOUCHX_SMOKE_STUDENT_NO:-\}\}"/);
  assert.match(v1ProductionVerify, /LOCAL_SMOKE_BASE_URL="\$\{SMOKE_BASE_URL:-http:\/\/127\.0\.0\.1:9986\}"/);
  assert.match(v1ProductionVerify, /PRODUCTION_SMOKE_BASE_URL="\$\{TOUCHX_SMOKE_BASE_URL:-https:\/\/schedule-backend\.tagzxia\.com\}"/);
  assert.match(v1ProductionVerify, /is_local_smoke_url\(\)/);
  assert.match(v1ProductionVerify, /is_non_production_smoke_url\(\)/);
  assert.match(v1ProductionVerify, /http:\/\/127\.0\.0\.1:"\*/);
  assert.match(v1ProductionVerify, /http:\/\/localhost:"\*/);
  assert.match(v1ProductionVerify, /\[\[ "\$\{url\}" != "https:\/\/"\* \]\] && return 0/);
  assert.match(v1ProductionVerify, /169\.254/);
  assert.match(v1ProductionVerify, /100\\\./);
  assert.match(v1ProductionVerify, /\[fF\]\[cCdD\]\|\[fF\]\[eE\]\[89aAbB\]/);
  assert.match(v1ProductionVerify, /require_student_no\(\)/);
  assert.match(v1ProductionVerify, /must be a 6-32 digit student number/);
  assert.match(v1ProductionVerify, /require_student_no "TOUCHX_SMOKE_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /require_student_no "SMOKE_SCHEDULE_IMPORT_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /require_student_no "SMOKE_REAL_PDF_EXPECT_STUDENT_NO"/);
  assert.match(v1ProductionVerify, /SMOKE_REAL_PDF_MIN_ENTRIES must be an integer >= 8/);
  assert.match(v1ProductionVerify, /SMOKE_BASE_URL must stay local for verify:v1-production smoke:local/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_BASE_URL must point to the production API for verify:v1-production/);
  assert.match(v1ProductionVerify, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_EXTERNAL_DELIVERY=1/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=1/);
  assert.match(v1ProductionVerify, /TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=1/);
  assert.match(v1ProductionVerify, /smoke:cloudflare-live/);
  assert.match(v1ProductionVerify, /smoke:production/);
  assert.match(v1ProductionVerify, /smoke:local/);
  assert.match(v1ProductionVerify, /smoke:local[\s\S]*smoke:cloudflare-live[\s\S]*smoke:production/);
});

test("V1 production verification rejects weak real PDF thresholds", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
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
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
      TOUCHX_SMOKE_STUDENT_NO: "student-2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
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

test("V1 production verification docs mention required student number format", () => {
  [rootReadme, backendReadme, todoDoc, v1CloseoutStatus].forEach((doc) => {
    assert.match(doc, /6-32 位数字/);
  });
  [rootReadme, backendReadme, todoDoc, v1CloseoutStatus].forEach((doc) => {
    assert.match(doc, /HTTPS|公网 HTTPS/);
  });
  assert.match(backendReadme, /SMOKE_SCHEDULE_IMPORT_STUDENT_NO/);
  assert.match(backendReadme, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO/);
  assert.match(v1CloseoutStatus, /SMOKE_REAL_PDF_EXPECT_STUDENT_NO/);
});

test("V1 production verification keeps local PDF smoke off production URLs", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
      SMOKE_BASE_URL: "https://schedule-backend.tagzxia.com",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMOKE_BASE_URL must stay local for verify:v1-production smoke:local/);
});

test("local smoke URL checks require localhost host boundaries", () => {
  assert.match(smokeLocal, /http:\/\/127\.0\.0\.1:"\*/);
  assert.match(smokeLocal, /http:\/\/localhost:"\*/);
  ["http://localhost.evil.test:9986", "http://127.0.0.1.evil.test:9986"].forEach((baseUrl) => {
    const result = spawnSync("bash", [v1ProductionVerifyPath], {
      cwd: join(import.meta.dirname, "../../.."),
      encoding: "utf8",
      env: {
        ...process.env,
        TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
        TOUCHX_SMOKE_STUDENT_NO: "2305100613",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
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

test("V1 production verification keeps production smoke off local URLs", () => {
  const result = spawnSync("bash", [v1ProductionVerifyPath], {
    cwd: join(import.meta.dirname, "../../.."),
    encoding: "utf8",
    env: {
      ...process.env,
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
      TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
      TOUCHX_SMOKE_BASE_URL: "http://127.0.0.1:9986",
      SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
      SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TOUCHX_SMOKE_BASE_URL must point to the production API for verify:v1-production/);
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
    "http://[::1]:9986",
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
        TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
        TOUCHX_SMOKE_STUDENT_NO: "2305100613",
        TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
        TOUCHX_SMOKE_NOTIFICATION_CHANNELS: "wechat_clawdbot,feishu",
        TOUCHX_SMOKE_BASE_URL: baseUrl,
        SMOKE_REAL_PDF_PATH: "/tmp/touchx-missing-real-schedule.pdf",
        SMOKE_SCHEDULE_IMPORT_STUDENT_NO: "2305100613",
      },
    });
    assert.notEqual(result.status, 0, baseUrl);
    assert.match(
      result.stderr,
      /TOUCHX_SMOKE_BASE_URL must point to the production API for verify:v1-production/,
      baseUrl,
    );
  });
});

test("production smoke can opt into ClawDBot webhook inbound verification", () => {
  assert.match(script, /request_clawdbot_webhook\(\)/);
  assert.match(script, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK/);
  assert.match(script, /TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN/);
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
      TOUCHX_SMOKE_AUTH_TOKEN: "dummy",
      TOUCHX_SMOKE_STUDENT_NO: "2305100613",
      TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN: "webhook-secret",
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
  assert.match(clientBoundarySmoke, /packages\/api-client\/src\/index\.ts/);
  assert.match(clientBoundarySmoke, /from \\"@touchx\/api-client\\"/);
  assert.match(clientBoundarySmoke, /createTouchXApiClient/);
  assert.match(clientBoundarySmoke, /resolveTouchXApiBaseUrl/);
  assert.match(clientBoundarySmoke, /Taro\.uploadFile/);
  assert.match(clientBoundarySmoke, /fetcher: fetch/);
  assert.match(clientBoundarySmoke, /must not include/);
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
