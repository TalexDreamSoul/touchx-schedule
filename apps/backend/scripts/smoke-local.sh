#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:9986}"

is_local_base_url() {
  [[ "${BASE_URL}" == "http://127.0.0.1"* || "${BASE_URL}" == "http://localhost"* ]]
}

check_exact() {
  local path="$1"
  local expected="$2"
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}${path}")"
  if [[ "${code}" != "${expected}" ]]; then
    echo "❌ ${path} expected ${expected}, got ${code}" >&2
    return 1
  fi
  echo "✅ ${path} -> ${code}"
}

check_one_of() {
  local path="$1"
  shift
  local accepted=("$@")
  local code
  code="$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}${path}")"
  for item in "${accepted[@]}"; do
    if [[ "${code}" == "${item}" ]]; then
      echo "✅ ${path} -> ${code}"
      return 0
    fi
  done
  echo "❌ ${path} expected one of [${accepted[*]}], got ${code}" >&2
  return 1
}

echo "Running smoke checks against ${BASE_URL}"
check_exact "/health" "200"
check_exact "/api/v1" "200"
check_exact "/nexus/login" "200"
check_one_of "/nexus/preview" "200" "302" "307"

if [[ -n "${SMOKE_HEARTBEAT_TOKEN:-}" ]]; then
  heartbeat_code="$(curl -sS -o /tmp/touchx_heartbeat_smoke.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/bot/jobs/heartbeat" \
    -H "content-type: application/json" \
    -H "x-heartbeat-token: ${SMOKE_HEARTBEAT_TOKEN}" \
    -d '{"force":true,"dryRun":true}')"
  if [[ "${heartbeat_code}" != "200" ]]; then
    echo "❌ /api/v1/bot/jobs/heartbeat expected 200, got ${heartbeat_code}" >&2
    cat /tmp/touchx_heartbeat_smoke.json >&2 || true
    exit 1
  fi
  echo "✅ /api/v1/bot/jobs/heartbeat -> ${heartbeat_code}"
fi

if [[ -n "${SMOKE_BOT_DELIVERY_TOKEN:-}" ]]; then
  deliveries_code="$(curl -sS -o /tmp/touchx_deliveries_smoke.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/bot/deliveries/pending?limit=1" \
    -H "x-bot-delivery-token: ${SMOKE_BOT_DELIVERY_TOKEN}")"
  if [[ "${deliveries_code}" != "200" ]]; then
    echo "❌ /api/v1/bot/deliveries/pending expected 200, got ${deliveries_code}" >&2
    cat /tmp/touchx_deliveries_smoke.json >&2 || true
    exit 1
  fi
  echo "✅ /api/v1/bot/deliveries/pending -> ${deliveries_code}"
fi

if [[ -n "${SMOKE_HEARTBEAT_TOKEN:-}" && -n "${SMOKE_BOT_DELIVERY_TOKEN:-}" ]] && is_local_base_url; then
  enqueue_code="$(curl -sS -o /tmp/touchx_delivery_enqueue.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/bot/jobs/heartbeat" \
    -H "content-type: application/json" \
    -H "x-heartbeat-token: ${SMOKE_HEARTBEAT_TOKEN}" \
    -d '{"force":true,"runNextDay":true}')"
  if [[ "${enqueue_code}" != "200" ]]; then
    echo "❌ delivery enqueue heartbeat expected 200, got ${enqueue_code}" >&2
    cat /tmp/touchx_delivery_enqueue.json >&2 || true
    exit 1
  fi
  echo "✅ delivery enqueue heartbeat -> ${enqueue_code}"

  duplicate_code="$(curl -sS -o /tmp/touchx_delivery_duplicate.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/bot/jobs/heartbeat" \
    -H "content-type: application/json" \
    -H "x-heartbeat-token: ${SMOKE_HEARTBEAT_TOKEN}" \
    -d '{"force":true,"runNextDay":true}')"
  if [[ "${duplicate_code}" != "200" ]]; then
    echo "❌ duplicate heartbeat expected 200, got ${duplicate_code}" >&2
    cat /tmp/touchx_delivery_duplicate.json >&2 || true
    exit 1
  fi
  duplicate_count="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_delivery_duplicate.json").read_text())
data = payload.get("data") or {}
queued = data.get("queuedCounts") or {}
print(int(queued.get("duplicate") or 0))
PY
)"
  if [[ "${duplicate_count}" -lt 1 ]]; then
    echo "❌ duplicate heartbeat did not produce duplicate queue entries" >&2
    cat /tmp/touchx_delivery_duplicate.json >&2 || true
    exit 1
  fi
  echo "✅ duplicate heartbeat -> duplicate=${duplicate_count}"

  deliveries_after_enqueue_code="$(curl -sS -o /tmp/touchx_deliveries_after_enqueue.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/bot/deliveries/pending?limit=1" \
    -H "x-bot-delivery-token: ${SMOKE_BOT_DELIVERY_TOKEN}")"
  if [[ "${deliveries_after_enqueue_code}" != "200" ]]; then
    echo "❌ pending deliveries after enqueue expected 200, got ${deliveries_after_enqueue_code}" >&2
    cat /tmp/touchx_deliveries_after_enqueue.json >&2 || true
    exit 1
  fi

  pending_delivery_id="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_deliveries_after_enqueue.json").read_text())
data = payload.get("data") or {}
items = data.get("items") or []
print(str(items[0].get("id") or "") if items else "")
PY
)"
  if [[ -n "${pending_delivery_id}" ]]; then
    ack_code="$(curl -sS -o /tmp/touchx_delivery_ack.json -w "%{http_code}" \
      -X POST "${BASE_URL}/api/v1/bot/deliveries/${pending_delivery_id}/ack" \
      -H "content-type: application/json" \
      -H "x-bot-delivery-token: ${SMOKE_BOT_DELIVERY_TOKEN}" \
      -d '{"success":true,"externalMessageId":"smoke-ack"}')"
    if [[ "${ack_code}" != "200" ]]; then
      echo "❌ /api/v1/bot/deliveries/${pending_delivery_id}/ack expected 200, got ${ack_code}" >&2
      cat /tmp/touchx_delivery_ack.json >&2 || true
      exit 1
    fi
    echo "✅ /api/v1/bot/deliveries/${pending_delivery_id}/ack -> ${ack_code}"
  fi
fi

if [[ -n "${SMOKE_SCHEDULE_IMPORT_STUDENT_NO:-}" ]]; then
  cat >/tmp/touchx_schedule_import_smoke.pdf <<'EOF'
%PDF-1.4
1 0 obj<<>>endobj
trailer<<>>
%%EOF
EOF

  login_code="$(curl -sS -o /tmp/touchx_schedule_import_login.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/auth/wechat-login" \
    -H "content-type: application/json" \
    -d "{\"code\":\"smoke-import\",\"studentNo\":\"${SMOKE_SCHEDULE_IMPORT_STUDENT_NO}\",\"studentId\":\"smoke-import-admin\",\"mode\":\"mock\"}")"
  if [[ "${login_code}" != "200" ]]; then
    echo "❌ /api/v1/auth/wechat-login expected 200, got ${login_code}" >&2
    cat /tmp/touchx_schedule_import_login.json >&2 || true
    exit 1
  fi
  import_token="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_schedule_import_login.json").read_text())
print(str(payload.get("token") or ""))
PY
)"
  if [[ -z "${import_token}" ]]; then
    echo "❌ schedule import smoke login token missing" >&2
    cat /tmp/touchx_schedule_import_login.json >&2 || true
    exit 1
  fi

  import_code="$(curl -sS -o /tmp/touchx_schedule_import_create.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/admin/schedule-import/jobs" \
    -H "authorization: Bearer ${import_token}" \
    -F "files[]=@/tmp/touchx_schedule_import_smoke.pdf;type=application/pdf" \
    -F "mappings=[{\"fileName\":\"touchx_schedule_import_smoke.pdf\",\"studentNo\":\"${SMOKE_SCHEDULE_IMPORT_STUDENT_NO}\",\"term\":\"2025-2026-2\"}]")"
  if [[ "${import_code}" != "200" ]]; then
    echo "❌ /api/v1/admin/schedule-import/jobs expected 200, got ${import_code}" >&2
    cat /tmp/touchx_schedule_import_create.json >&2 || true
    exit 1
  fi
  job_id="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_schedule_import_create.json").read_text())
data = payload.get("data") or {}
print(str(data.get("jobId") or ""))
PY
)"
  if [[ -z "${job_id}" ]]; then
    echo "❌ schedule import smoke jobId missing" >&2
    cat /tmp/touchx_schedule_import_create.json >&2 || true
    exit 1
  fi

  terminal_status=""
  for _ in 1 2 3 4 5; do
    detail_code="$(curl -sS -o /tmp/touchx_schedule_import_detail.json -w "%{http_code}" \
      "${BASE_URL}/api/v1/admin/schedule-import/jobs/${job_id}" \
      -H "authorization: Bearer ${import_token}")"
    if [[ "${detail_code}" != "200" ]]; then
      echo "❌ /api/v1/admin/schedule-import/jobs/${job_id} expected 200, got ${detail_code}" >&2
      cat /tmp/touchx_schedule_import_detail.json >&2 || true
      exit 1
    fi
    terminal_status="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_schedule_import_detail.json").read_text())
data = payload.get("data") or {}
print(str(data.get("status") or ""))
PY
)"
    if [[ "${terminal_status}" == "completed" || "${terminal_status}" == "completed_with_errors" || "${terminal_status}" == "failed" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${terminal_status}" != "completed" && "${terminal_status}" != "completed_with_errors" && "${terminal_status}" != "failed" ]]; then
    echo "❌ schedule import job did not reach terminal status" >&2
    cat /tmp/touchx_schedule_import_detail.json >&2 || true
    exit 1
  fi
  import_error_code="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_schedule_import_detail.json").read_text())
data = payload.get("data") or {}
results = data.get("results") or []
first = results[0] if results else {}
print(str(first.get("errorCode") or ""))
PY
)"
  if [[ "${terminal_status}" == "completed_with_errors" || "${terminal_status}" == "failed" ]] && [[ -z "${import_error_code}" ]]; then
    echo "❌ schedule import terminal error missing structured errorCode" >&2
    cat /tmp/touchx_schedule_import_detail.json >&2 || true
    exit 1
  fi
  echo "✅ /api/v1/admin/schedule-import/jobs -> ${import_code} (${terminal_status})"
fi

echo "Smoke checks passed."
