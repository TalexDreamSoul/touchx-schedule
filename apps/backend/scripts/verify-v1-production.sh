#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "${ROOT_DIR}"
source "${SCRIPT_DIR}/production-url-guard.sh"

missing=()

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    missing+=("${name}")
  fi
}

require_student_no() {
  local name="$1"
  local value="${!name:-}"
  if [[ -n "${value}" && ! "${value}" =~ ^[0-9]{6,32}$ ]]; then
    missing+=("${name} must be a 6-32 digit student number")
  fi
}

is_local_smoke_url() {
  local url="$1"
  [[ "${url}" == "http://127.0.0.1" || "${url}" == "http://127.0.0.1/"* || "${url}" == "http://127.0.0.1:"* ]] && return 0
  [[ "${url}" == "http://localhost" || "${url}" == "http://localhost/"* || "${url}" == "http://localhost:"* ]] && return 0
  return 1
}

require_env "TOUCHX_SMOKE_AUTH_TOKEN"
require_env "TOUCHX_SMOKE_STUDENT_NO"
require_env "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN"
require_env "SMOKE_REAL_PDF_PATH"
require_env "SMOKE_SCHEDULE_IMPORT_STUDENT_NO"

SMOKE_REAL_PDF_MIN_ENTRIES="${SMOKE_REAL_PDF_MIN_ENTRIES:-8}"
SMOKE_REAL_PDF_EXPECT_STUDENT_NO="${SMOKE_REAL_PDF_EXPECT_STUDENT_NO:-${TOUCHX_SMOKE_STUDENT_NO:-}}"
LOCAL_SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:9986}"
PRODUCTION_SMOKE_BASE_URL="${TOUCHX_SMOKE_BASE_URL:-https://schedule-backend.tagzxia.com}"

notification_channels="${TOUCHX_SMOKE_NOTIFICATION_CHANNELS:-${TOUCHX_SMOKE_NOTIFICATION_CHANNEL:-}}"
if [[ -z "${notification_channels}" ]]; then
  missing+=("TOUCHX_SMOKE_NOTIFICATION_CHANNELS=wechat_clawdbot,feishu")
fi

normalized_notification_channels=",${notification_channels// /},"
normalized_notification_channels="${normalized_notification_channels//,,/,}"
if [[ "${normalized_notification_channels}" != *",wechat_clawdbot,"* ]]; then
  missing+=("TOUCHX_SMOKE_NOTIFICATION_CHANNELS includes wechat_clawdbot")
fi
if [[ "${normalized_notification_channels}" != *",feishu,"* ]]; then
  missing+=("TOUCHX_SMOKE_NOTIFICATION_CHANNELS includes feishu")
fi
for channel in ${notification_channels//,/ }; do
  if [[ "${channel}" != "wechat_clawdbot" && "${channel}" != "feishu" ]]; then
    missing+=("TOUCHX_SMOKE_NOTIFICATION_CHANNELS only supports wechat_clawdbot,feishu")
    break
  fi
done

if [[ -n "${SMOKE_REAL_PDF_PATH:-}" && ! -f "${SMOKE_REAL_PDF_PATH}" ]]; then
  missing+=("SMOKE_REAL_PDF_PATH exists: ${SMOKE_REAL_PDF_PATH}")
fi
if [[ ! "${SMOKE_REAL_PDF_MIN_ENTRIES}" =~ ^[0-9]+$ || "${SMOKE_REAL_PDF_MIN_ENTRIES}" -lt 8 ]]; then
  missing+=("SMOKE_REAL_PDF_MIN_ENTRIES must be an integer >= 8")
fi
if [[ -z "${SMOKE_REAL_PDF_EXPECT_STUDENT_NO}" ]]; then
  missing+=("SMOKE_REAL_PDF_EXPECT_STUDENT_NO or TOUCHX_SMOKE_STUDENT_NO")
fi
require_student_no "TOUCHX_SMOKE_STUDENT_NO"
require_student_no "SMOKE_SCHEDULE_IMPORT_STUDENT_NO"
require_student_no "SMOKE_REAL_PDF_EXPECT_STUDENT_NO"
if ! is_local_smoke_url "${LOCAL_SMOKE_BASE_URL}"; then
  missing+=("SMOKE_BASE_URL must stay local for verify:v1-production smoke:local")
fi
if is_non_production_smoke_url "${PRODUCTION_SMOKE_BASE_URL}"; then
  missing+=("TOUCHX_SMOKE_BASE_URL must point to the production API for verify:v1-production")
fi

if (( ${#missing[@]} > 0 )); then
  printf 'V1 production verification is missing required inputs:\n' >&2
  printf '  - %s\n' "${missing[@]}" >&2
  cat >&2 <<'EOF'

Required inputs:
  TOUCHX_SMOKE_AUTH_TOKEN              Admin token for protected production checks.
  TOUCHX_SMOKE_STUDENT_NO              Real production student number for legacy login verification; must be 6-32 digits.
  TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN  Real ClawDBot webhook token for inbound production smoke.
  TOUCHX_SMOKE_NOTIFICATION_CHANNELS   Must include both wechat_clawdbot and feishu.
  SMOKE_REAL_PDF_PATH                  Real schedule PDF sample on this machine.
  SMOKE_SCHEDULE_IMPORT_STUDENT_NO     Student number used by local PDF import smoke; must be 6-32 digits.

Optional hardening:
  TOUCHX_SMOKE_AUTH_LOGOUT=1           Revokes the supplied admin token at the end.
  SMOKE_REAL_PDF_MIN_ENTRIES=8         Minimum parsed course count; production gate requires >= 8.
  SMOKE_REAL_PDF_EXPECT_STUDENT_NO=... Verifies parsed PDF owner student number; defaults to TOUCHX_SMOKE_STUDENT_NO and must be 6-32 digits.
  SMOKE_BASE_URL=http://127.0.0.1:9986 Local backend URL for the real PDF smoke; production URLs are refused.
  TOUCHX_SMOKE_BASE_URL=https://...    Public HTTPS production backend URL; non-HTTPS, local, and private URLs are refused.
EOF
  exit 1
fi

export SMOKE_REAL_PDF_MIN_ENTRIES
export SMOKE_REAL_PDF_EXPECT_STUDENT_NO
export TOUCHX_SMOKE_EXTERNAL_DELIVERY=1
export TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=1
export TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=1
export TOUCHX_SMOKE_NOTIFICATION_CHANNELS="${notification_channels}"

echo "==> local real PDF parser smoke"
if [[ -z "${SMOKE_BASE_URL:-}" ]]; then
  echo "SMOKE_BASE_URL is not set; using smoke-local default http://127.0.0.1:9986" >&2
fi
pnpm --filter "@touchx/backend" smoke:local

echo "==> Cloudflare live resources"
pnpm --filter "@touchx/backend" smoke:cloudflare-live

echo "==> production API, auth, queue, and external delivery"
pnpm --filter "@touchx/backend" smoke:production

echo "ok V1 production verification gate"
