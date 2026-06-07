#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOUCHX_SMOKE_BASE_URL:-https://schedule-backend.tagzxia.com}"
RESPONSE_FILE="/tmp/touchx-smoke-response.json"
NOTIFICATION_RESPONSE_FILE="/tmp/touchx-smoke-notification-response.json"
CLAWDBOT_WEBHOOK_RESPONSE_FILE="/tmp/touchx-smoke-clawdbot-webhook-response.json"
SMOKE_BOOTSTRAP_STUDENT_NO=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/production-url-guard.sh"

if is_non_production_smoke_url "${BASE_URL}"; then
  echo "TOUCHX_SMOKE_BASE_URL must point to a public HTTPS production API for smoke:production" >&2
  exit 1
fi

request() {
  local path="$1"
  curl --fail --silent --show-error --max-time 15 "${BASE_URL}${path}" >"${RESPONSE_FILE}"
  echo "ok ${path}"
}

request_protected() {
  local path="$1"
  if [[ -n "${TOUCHX_SMOKE_AUTH_TOKEN:-}" ]]; then
    curl --fail --silent --show-error --max-time 15 \
      -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}" \
      "${BASE_URL}${path}" >"${RESPONSE_FILE}"
    echo "ok ${path}"
    return
  fi
  local status_code
  status_code="$(curl --silent --show-error --output "${RESPONSE_FILE}" --write-out "%{http_code}" --max-time 15 "${BASE_URL}${path}")"
  if [[ "${status_code}" != "401" ]]; then
    echo "expected 401 for protected ${path}, got ${status_code}" >&2
    exit 1
  fi
  echo "ok ${path} protected"
}

request_admin_bootstrap_status() {
  local status_file="/tmp/touchx-smoke-admin-bootstrap.json"
  curl --fail --silent --show-error --max-time 15 "${BASE_URL}/api/v1/admin/bootstrap-status" >"${status_file}"
  local bootstrap_result
  bootstrap_result="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx-smoke-admin-bootstrap.json").read_text())
data = payload.get("data") or {}
print("1" if data.get("passwordInitialized") is True else "0")
print("1" if data.get("requirePassword") is True else "0")
print(str(data.get("bootstrapStudentNo") or ""))
PY
)"
  local password_initialized require_password bootstrap_student_no
  password_initialized="$(printf '%s\n' "${bootstrap_result}" | sed -n '1p')"
  require_password="$(printf '%s\n' "${bootstrap_result}" | sed -n '2p')"
  bootstrap_student_no="$(printf '%s\n' "${bootstrap_result}" | sed -n '3p')"
  SMOKE_BOOTSTRAP_STUDENT_NO="${bootstrap_student_no}"
  if [[ "${password_initialized}" != "1" || "${require_password}" != "1" ]]; then
    echo "expected initialized admin password in production bootstrap status" >&2
    cat "${status_file}" >&2 || true
    exit 1
  fi
  if [[ -n "${TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO:-}" && "${bootstrap_student_no}" != "${TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO}" ]]; then
    echo "expected bootstrap student/account ${TOUCHX_SMOKE_EXPECT_BOOTSTRAP_STUDENT_NO}, got ${bootstrap_student_no}" >&2
    cat "${status_file}" >&2 || true
    exit 1
  fi
  echo "ok /api/v1/admin/bootstrap-status initialized"
}

create_signed_smoke_token() {
  local secret="$1"
  local student_no="$2"
  python - "${secret}" "${student_no}" <<'PY'
import base64
import hashlib
import hmac
import json
import secrets
import sys
import time

secret = sys.argv[1]
student_no = sys.argv[2] or "admin@schedule.com"

def b64url(value):
  return base64.urlsafe_b64encode(value).decode("utf-8").rstrip("=")

payload = {
  "v": 1,
  "uid": "smoke-fallback-admin",
  "sno": student_no,
  "role": "admin",
  "iat": int(time.time() * 1000),
  "exp": int((time.time() + 600) * 1000),
  "nonce": secrets.token_hex(8),
}
payload_base64 = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
signature = b64url(hmac.new(secret.encode("utf-8"), payload_base64.encode("utf-8"), hashlib.sha256).digest())
print(f"txs1.{payload_base64}.{signature}")
PY
}

request_session_secret_security() {
  if [[ "${TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK:-}" == "1" ]]; then
    echo "skip fallback session secret smoke; TOUCHX_SMOKE_SKIP_SESSION_SECRET_CHECK=1"
    return
  fi
  local bootstrap_student_no="${SMOKE_BOOTSTRAP_STUDENT_NO:-admin@schedule.com}"
  local fallback_password="${TOUCHX_SMOKE_FALLBACK_ADMIN_PASSWORD:-123456}"
  local weak_secrets=("fallback:123456" "touchx-session-fallback-secret")
  if [[ "${fallback_password}" != "123456" ]]; then
    weak_secrets+=("fallback:${fallback_password}")
  fi
  local weak_secret
  for weak_secret in "${weak_secrets[@]}"; do
    local weak_token
    weak_token="$(create_signed_smoke_token "${weak_secret}" "${bootstrap_student_no}")"
    local weak_file="/tmp/touchx-smoke-weak-session.json"
    local status_code
    status_code="$(curl --silent --show-error --output "${weak_file}" --write-out "%{http_code}" --max-time 15 \
      -H "Authorization: Bearer ${weak_token}" \
      "${BASE_URL}/api/v1/admin/me")"
    if [[ "${status_code}" != "401" ]]; then
      echo "expected 401 for weak fallback session token, got ${status_code}" >&2
      echo "production NEXUS_SESSION_TOKEN_SECRET may be missing or weak; checked bootstrap=${bootstrap_student_no}" >&2
      cat "${weak_file}" >&2 || true
      exit 1
    fi
  done
  echo "ok weak fallback session tokens rejected"
}

request_admin_token_security() {
  if [[ -z "${TOUCHX_SMOKE_AUTH_TOKEN:-}" ]]; then
    echo "skip admin token smoke; set TOUCHX_SMOKE_AUTH_TOKEN to enable"
    return
  fi
  local admin_me_file="/tmp/touchx-smoke-admin-me.json"
  curl --fail --silent --show-error --max-time 15 \
    -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}" \
    "${BASE_URL}/api/v1/admin/me" >"${admin_me_file}"
  echo "ok /api/v1/admin/me"
}

request_admin_logout_revocation() {
  if [[ "${TOUCHX_SMOKE_AUTH_LOGOUT:-}" != "1" ]]; then
    echo "skip admin logout revocation smoke; set TOUCHX_SMOKE_AUTH_LOGOUT=1 to enable"
    return
  fi
  if [[ -z "${TOUCHX_SMOKE_AUTH_TOKEN:-}" ]]; then
    echo "TOUCHX_SMOKE_AUTH_TOKEN is required for admin logout revocation smoke" >&2
    exit 1
  fi
  local admin_me_file="/tmp/touchx-smoke-admin-me.json"
  local logout_file="/tmp/touchx-smoke-admin-logout.json"
  local logout_code
  logout_code="$(curl --silent --show-error --output "${logout_file}" --write-out "%{http_code}" --max-time 15 \
    -X POST "${BASE_URL}/api/v1/admin/logout" \
    -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}")"
  if [[ "${logout_code}" != "200" ]]; then
    echo "expected 200 for admin logout, got ${logout_code}" >&2
    cat "${logout_file}" >&2 || true
    exit 1
  fi
  local revoked_code
  revoked_code="$(curl --silent --show-error --output "${admin_me_file}" --write-out "%{http_code}" --max-time 15 \
    -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}" \
    "${BASE_URL}/api/v1/admin/me")"
  if [[ "${revoked_code}" != "401" ]]; then
    echo "expected 401 for revoked admin token, got ${revoked_code}" >&2
    cat "${admin_me_file}" >&2 || true
    exit 1
  fi
  echo "ok admin logout revoked token"
}

request_notification_queue_mode() {
  if [[ "${TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE:-}" != "1" ]]; then
    echo "skip notification queue mode smoke; set TOUCHX_SMOKE_NOTIFICATION_QUEUE_MODE=1 to enable"
    return
  fi
  if [[ -z "${TOUCHX_SMOKE_AUTH_TOKEN:-}" ]]; then
    echo "TOUCHX_SMOKE_AUTH_TOKEN is required for notification queue mode smoke" >&2
    exit 1
  fi
  local deliveries_file="/tmp/touchx-smoke-notification-queue.json"
  local status_code
  status_code="$(curl --silent --show-error --output "${deliveries_file}" --write-out "%{http_code}" --max-time 15 \
    -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}" \
    "${BASE_URL}/api/v1/admin/notification-deliveries?sourceQueue=notification&limit=1")"
  if [[ "${status_code}" != "200" ]]; then
    echo "expected 200 for notification queue mode smoke, got ${status_code}" >&2
    cat "${deliveries_file}" >&2 || true
    exit 1
  fi
  local total
  total="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx-smoke-notification-queue.json").read_text())
data = payload.get("data") or {}
print(int(data.get("total") or 0))
PY
)"
  if [[ "${total}" -lt 1 ]]; then
    echo "expected at least one sourceQueue=notification delivery in production" >&2
    cat "${deliveries_file}" >&2 || true
    exit 1
  fi
  echo "ok notification queue mode has ${total} notification-source deliveries"
}

request_student_legacy_login() {
  if [[ -z "${TOUCHX_SMOKE_STUDENT_NO:-}" ]]; then
    echo "skip student legacy login smoke; set TOUCHX_SMOKE_STUDENT_NO to enable"
    return
  fi
  if [[ ! "${TOUCHX_SMOKE_STUDENT_NO}" =~ ^[0-9]{6,32}$ ]]; then
    echo "TOUCHX_SMOKE_STUDENT_NO must be a 6-32 digit student number" >&2
    exit 1
  fi
  local student_login_file="/tmp/touchx-smoke-student-login.json"
  local student_me_file="/tmp/touchx-smoke-student-me.json"
  local login_payload
  login_payload="$(python - <<'PY'
import json
import os
print(json.dumps({
  "studentNo": os.environ["TOUCHX_SMOKE_STUDENT_NO"],
}, ensure_ascii=False))
PY
)"
  local login_code
  login_code="$(curl --silent --show-error --output "${student_login_file}" --write-out "%{http_code}" --max-time 15 \
    -X POST "${BASE_URL}/api/v1/auth/login" \
    -H "content-type: application/json" \
    -d "${login_payload}")"
  if [[ "${login_code}" != "200" ]]; then
    echo "expected 200 for student legacy login, got ${login_code}" >&2
    cat "${student_login_file}" >&2 || true
    exit 1
  fi
  local login_result
  login_result="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx-smoke-student-login.json").read_text())
data = payload.get("data") or {}
user = data.get("user") or {}
print(str(data.get("mode") or ""))
print(str(data.get("sessionToken") or ""))
print(str(user.get("studentNo") or ""))
PY
)"
  local login_mode student_token returned_student_no
  login_mode="$(printf '%s\n' "${login_result}" | sed -n '1p')"
  student_token="$(printf '%s\n' "${login_result}" | sed -n '2p')"
  returned_student_no="$(printf '%s\n' "${login_result}" | sed -n '3p')"
  if [[ "${login_mode}" != "legacy_student_no" || -z "${student_token}" || "${returned_student_no}" != "${TOUCHX_SMOKE_STUDENT_NO}" ]]; then
    echo "expected legacy_student_no login for ${TOUCHX_SMOKE_STUDENT_NO}" >&2
    cat "${student_login_file}" >&2 || true
    exit 1
  fi
  local me_code
  me_code="$(curl --silent --show-error --output "${student_me_file}" --write-out "%{http_code}" --max-time 15 \
    -H "Authorization: Bearer ${student_token}" \
    "${BASE_URL}/api/v1/auth/me")"
  if [[ "${me_code}" != "200" ]]; then
    echo "expected 200 for student auth/me, got ${me_code}" >&2
    cat "${student_me_file}" >&2 || true
    exit 1
  fi
  local me_mode
  me_mode="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx-smoke-student-me.json").read_text())
data = payload.get("data") or {}
print(str(data.get("mode") or ""))
PY
)"
  if [[ "${me_mode}" != "legacy_student_no" ]]; then
    echo "expected auth/me mode legacy_student_no, got ${me_mode:-empty}" >&2
    cat "${student_me_file}" >&2 || true
    exit 1
  fi
  echo "ok student legacy login ${TOUCHX_SMOKE_STUDENT_NO}"
}

request_external_notification_channel() {
  local channel_type="$1"
  if [[ "${channel_type}" != "wechat_clawdbot" && "${channel_type}" != "feishu" ]]; then
    echo "TOUCHX_SMOKE_NOTIFICATION_CHANNELS entries must be wechat_clawdbot or feishu" >&2
    exit 1
  fi

  local payload
  payload="$(python - <<'PY'
import json
import os
default_title = "TouchX 生产 smoke"
default_body = "这是一条 TouchX 生产外部通知链路 smoke。"
print(json.dumps({
  "title": os.environ.get("TOUCHX_SMOKE_NOTIFICATION_TITLE") or default_title,
  "body": os.environ.get("TOUCHX_SMOKE_NOTIFICATION_BODY") or default_body,
}, ensure_ascii=False))
PY
)"
  local status_code
  status_code="$(curl --silent --show-error --output "${NOTIFICATION_RESPONSE_FILE}" --write-out "%{http_code}" --max-time 30 \
    -X POST "${BASE_URL}/api/v1/admin/notification-channels/${channel_type}/test" \
    -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}" \
    -H "content-type: application/json" \
    -d "${payload}")"
  if [[ "${status_code}" != "200" ]]; then
    echo "expected 200 for external notification smoke (${channel_type}), got ${status_code}" >&2
    cat "${NOTIFICATION_RESPONSE_FILE}" >&2 || true
    exit 1
  fi
  local delivery_status
  delivery_status="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx-smoke-notification-response.json").read_text())
delivery = (payload.get("data") or {}).get("delivery") or {}
print(str(delivery.get("status") or ""))
PY
)"
  if [[ "${delivery_status}" != "sent" ]]; then
    echo "expected external notification delivery status sent for ${channel_type}, got ${delivery_status:-empty}" >&2
    cat "${NOTIFICATION_RESPONSE_FILE}" >&2 || true
    exit 1
  fi
  echo "ok external notification ${channel_type} -> sent"
}

request_external_notification() {
  if [[ "${TOUCHX_SMOKE_EXTERNAL_DELIVERY:-}" != "1" ]]; then
    echo "skip external notification delivery smoke; set TOUCHX_SMOKE_EXTERNAL_DELIVERY=1 to enable"
    return
  fi
  if [[ -z "${TOUCHX_SMOKE_AUTH_TOKEN:-}" ]]; then
    echo "TOUCHX_SMOKE_AUTH_TOKEN is required for external notification delivery smoke" >&2
    exit 1
  fi

  local channels="${TOUCHX_SMOKE_NOTIFICATION_CHANNELS:-${TOUCHX_SMOKE_NOTIFICATION_CHANNEL:-}}"
  channels="${channels//,/ }"
  local channel_count=0
  local channel_type
  for channel_type in ${channels}; do
    channel_count=$((channel_count + 1))
    request_external_notification_channel "${channel_type}"
  done
  if (( channel_count <= 0 )); then
    echo "TOUCHX_SMOKE_NOTIFICATION_CHANNELS must include wechat_clawdbot and/or feishu" >&2
    exit 1
  fi
}

request_clawdbot_webhook() {
  if [[ "${TOUCHX_SMOKE_CLAWDBOT_WEBHOOK:-}" != "1" ]]; then
    echo "skip ClawDBot webhook smoke; set TOUCHX_SMOKE_CLAWDBOT_WEBHOOK=1 to enable"
    return
  fi
  if [[ -z "${TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN:-}" ]]; then
    echo "TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN is required for ClawDBot webhook smoke" >&2
    exit 1
  fi
  if [[ -z "${TOUCHX_SMOKE_STUDENT_NO:-}" ]]; then
    echo "TOUCHX_SMOKE_STUDENT_NO is required for ClawDBot webhook smoke" >&2
    exit 1
  fi

  local payload
  payload="$(python - <<'PY'
import json
import os
default_text = "周三下午3点复习数据结构"
print(json.dumps({
  "studentNo": os.environ["TOUCHX_SMOKE_STUDENT_NO"],
  "text": os.environ.get("TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TEXT") or default_text,
  "nickname": "TouchX production smoke",
  "commit": False,
}, ensure_ascii=False))
PY
)"
  local status_code
  status_code="$(curl --silent --show-error --output "${CLAWDBOT_WEBHOOK_RESPONSE_FILE}" --write-out "%{http_code}" --max-time 30 \
    -X POST "${BASE_URL}/api/v1/bot/clawdbot/webhook" \
    -H "x-clawdbot-webhook-token: ${TOUCHX_SMOKE_CLAWDBOT_WEBHOOK_TOKEN}" \
    -H "content-type: application/json" \
    -d "${payload}")"
  if [[ "${status_code}" != "200" ]]; then
    echo "expected 200 for ClawDBot webhook smoke, got ${status_code}" >&2
    cat "${CLAWDBOT_WEBHOOK_RESPONSE_FILE}" >&2 || true
    exit 1
  fi
  local webhook_result
  webhook_result="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx-smoke-clawdbot-webhook-response.json").read_text())
print("1" if payload.get("ok") is True else "0")
print("1" if payload.get("webhook") is True else "0")
print("1" if payload.get("channel") == "wechat_clawdbot" else "0")
print("1" if payload.get("committed") is False else "0")
print(len(payload.get("candidates") or []))
PY
)"
  local ok webhook channel committed candidate_count
  ok="$(printf '%s\n' "${webhook_result}" | sed -n '1p')"
  webhook="$(printf '%s\n' "${webhook_result}" | sed -n '2p')"
  channel="$(printf '%s\n' "${webhook_result}" | sed -n '3p')"
  committed="$(printf '%s\n' "${webhook_result}" | sed -n '4p')"
  candidate_count="$(printf '%s\n' "${webhook_result}" | sed -n '5p')"
  if [[ "${ok}" != "1" || "${webhook}" != "1" || "${channel}" != "1" || "${committed}" != "1" || "${candidate_count}" -lt 1 ]]; then
    echo "expected ClawDBot webhook reply with at least one non-committed candidate" >&2
    cat "${CLAWDBOT_WEBHOOK_RESPONSE_FILE}" >&2 || true
    exit 1
  fi
  echo "ok ClawDBot webhook inbound smoke candidates=${candidate_count}"
}

request "/health"
request "/api/v1/theme-images"
request_admin_bootstrap_status
request_session_secret_security
request_protected "/api/v1/schedules/student?studentId=tangzixian"
request_admin_token_security
request_notification_queue_mode
request_student_legacy_login
request_external_notification
request_clawdbot_webhook
request_admin_logout_revocation
