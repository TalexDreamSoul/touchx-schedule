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

if [[ -n "${SMOKE_STUDENT_NO_LOGIN:-}" ]]; then
  student_login_code="$(curl -sS -o /tmp/touchx_student_no_login.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/auth/login" \
    -H "content-type: application/json" \
    -d "{\"studentNo\":\"${SMOKE_STUDENT_NO_LOGIN}\",\"nickname\":\"Smoke Student\"}")"
  if [[ "${student_login_code}" != "200" ]]; then
    echo "❌ /api/v1/auth/login expected 200, got ${student_login_code}" >&2
    cat /tmp/touchx_student_no_login.json >&2 || true
    exit 1
  fi
  student_login_result="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_student_no_login.json").read_text())
data = payload.get("data") or {}
print(str(data.get("mode") or "") + "\n" + str(data.get("sessionToken") or ""))
PY
)"
  student_login_mode="$(printf '%s\n' "${student_login_result}" | sed -n '1p')"
  student_login_token="$(printf '%s\n' "${student_login_result}" | sed -n '2p')"
  if [[ "${student_login_mode}" != "legacy_student_no" || -z "${student_login_token}" ]]; then
    echo "❌ /api/v1/auth/login expected mode=legacy_student_no and sessionToken" >&2
    cat /tmp/touchx_student_no_login.json >&2 || true
    exit 1
  fi

  student_me_code="$(curl -sS -o /tmp/touchx_student_no_me.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/auth/me" \
    -H "authorization: Bearer ${student_login_token}")"
  if [[ "${student_me_code}" != "200" ]]; then
    echo "❌ /api/v1/auth/me expected 200, got ${student_me_code}" >&2
    cat /tmp/touchx_student_no_me.json >&2 || true
    exit 1
  fi
  student_me_mode="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_student_no_me.json").read_text())
data = payload.get("data") or {}
print(str(data.get("mode") or ""))
PY
)"
  if [[ "${student_me_mode}" != "legacy_student_no" ]]; then
    echo "❌ /api/v1/auth/me expected mode=legacy_student_no, got ${student_me_mode}" >&2
    cat /tmp/touchx_student_no_me.json >&2 || true
    exit 1
  fi
  echo "✅ /api/v1/auth/login + /api/v1/auth/me -> legacy_student_no"
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
  import_poll_attempts="${SMOKE_SCHEDULE_IMPORT_POLL_ATTEMPTS:-20}"
  for ((poll_index = 1; poll_index <= import_poll_attempts; poll_index += 1)); do
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

  if [[ -n "${SMOKE_REAL_PDF_PATH:-}" ]]; then
    if [[ ! -f "${SMOKE_REAL_PDF_PATH}" ]]; then
      echo "❌ SMOKE_REAL_PDF_PATH does not exist: ${SMOKE_REAL_PDF_PATH}" >&2
      exit 1
    fi
    real_pdf_file_name="$(basename "${SMOKE_REAL_PDF_PATH}")"
    real_pdf_code="$(curl -sS -o /tmp/touchx_real_pdf_preview.json -w "%{http_code}" \
      -X POST "${BASE_URL}/api/v1/calendar/me/pdf-import/preview" \
      -H "authorization: Bearer ${import_token}" \
      -F "file=@${SMOKE_REAL_PDF_PATH};filename=${real_pdf_file_name};type=application/pdf")"
    if [[ "${real_pdf_code}" != "200" ]]; then
      echo "❌ /api/v1/calendar/me/pdf-import/preview expected 200, got ${real_pdf_code}" >&2
      cat /tmp/touchx_real_pdf_preview.json >&2 || true
      exit 1
    fi
    real_pdf_result="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_real_pdf_preview.json").read_text())
data = payload.get("data") or {}
entries = data.get("previewEntries") or []
print(str(data.get("total") or len(entries)))
print(str(data.get("parsedStudentNo") or ""))
PY
)"
    real_pdf_total="$(printf '%s\n' "${real_pdf_result}" | sed -n '1p')"
    real_pdf_student_no="$(printf '%s\n' "${real_pdf_result}" | sed -n '2p')"
    min_real_pdf_entries="${SMOKE_REAL_PDF_MIN_ENTRIES:-1}"
    if [[ "${real_pdf_total}" -lt "${min_real_pdf_entries}" ]]; then
      echo "❌ real PDF preview expected at least ${min_real_pdf_entries} entries, got ${real_pdf_total}" >&2
      cat /tmp/touchx_real_pdf_preview.json >&2 || true
      exit 1
    fi
    if [[ -n "${SMOKE_REAL_PDF_EXPECT_STUDENT_NO:-}" && "${real_pdf_student_no}" != "${SMOKE_REAL_PDF_EXPECT_STUDENT_NO}" ]]; then
      echo "❌ real PDF parsedStudentNo expected ${SMOKE_REAL_PDF_EXPECT_STUDENT_NO}, got ${real_pdf_student_no:-empty}" >&2
      cat /tmp/touchx_real_pdf_preview.json >&2 || true
      exit 1
    fi
    echo "✅ /api/v1/calendar/me/pdf-import/preview real PDF -> ${real_pdf_total} entries"
  fi
fi

if [[ "${SMOKE_SOCIAL_P0:-}" == "1" ]] && is_local_base_url; then
  login_user() {
    local file="$1"
    local code="$2"
    local student_no="$3"
    local student_id="$4"
    local nickname="$5"
    local http_code
    http_code="$(curl -sS -o "${file}" -w "%{http_code}" \
      -X POST "${BASE_URL}/api/v1/auth/wechat-login" \
      -H "content-type: application/json" \
      -d "{\"code\":\"${code}\",\"studentNo\":\"${student_no}\",\"studentId\":\"${student_id}\",\"nickname\":\"${nickname}\",\"mode\":\"mock\"}")"
    if [[ "${http_code}" != "200" ]]; then
      echo "❌ /api/v1/auth/wechat-login expected 200, got ${http_code}" >&2
      cat "${file}" >&2 || true
      exit 1
    fi
  }

  login_user "/tmp/touchx_social_a_login.json" "smoke-social-a" "2305200101" "caiziling" "SmokeA"
  login_user "/tmp/touchx_social_b_login.json" "smoke-social-b" "2305200109" "linfeng" "SmokeB"

  social_token_a="$(python - <<'PY'
import json
from pathlib import Path
print(str(json.loads(Path("/tmp/touchx_social_a_login.json").read_text()).get("token") or ""))
PY
)"
  social_token_b="$(python - <<'PY'
import json
from pathlib import Path
print(str(json.loads(Path("/tmp/touchx_social_b_login.json").read_text()).get("token") or ""))
PY
)"
  if [[ -z "${social_token_a}" || -z "${social_token_b}" ]]; then
    echo "❌ social smoke login token missing" >&2
    exit 1
  fi

  search_code="$(curl -sS -o /tmp/touchx_social_search.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/social/users/search?q=2305200109" \
    -H "authorization: Bearer ${social_token_a}")"
  if [[ "${search_code}" != "200" ]]; then
    echo "❌ /api/v1/social/users/search expected 200, got ${search_code}" >&2
    cat /tmp/touchx_social_search.json >&2 || true
    exit 1
  fi

  request_code="$(curl -sS -o /tmp/touchx_social_request.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/social/subscription-requests" \
    -H "authorization: Bearer ${social_token_a}" \
    -H "content-type: application/json" \
    -d '{"targetStudentId":"linfeng","visibilityScope":"busy_free"}')"
  if [[ "${request_code}" != "200" ]]; then
    echo "❌ /api/v1/social/subscription-requests expected 200, got ${request_code}" >&2
    cat /tmp/touchx_social_request.json >&2 || true
    exit 1
  fi
  request_id="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_social_request.json").read_text())
request = payload.get("request") or {}
print(str(request.get("requestId") or ""))
PY
)"
  if [[ -z "${request_id}" ]]; then
    echo "❌ social smoke requestId missing" >&2
    cat /tmp/touchx_social_request.json >&2 || true
    exit 1
  fi

  notify_code="$(curl -sS -o /tmp/touchx_social_notifications.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/notifications?limit=5" \
    -H "authorization: Bearer ${social_token_b}")"
  if [[ "${notify_code}" != "200" ]]; then
    echo "❌ /api/v1/notifications expected 200, got ${notify_code}" >&2
    cat /tmp/touchx_social_notifications.json >&2 || true
    exit 1
  fi

  decision_code="$(curl -sS -o /tmp/touchx_social_decision.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/social/subscription-requests/${request_id}/decision" \
    -H "authorization: Bearer ${social_token_b}" \
    -H "content-type: application/json" \
    -d '{"decision":"accept","visibilityScope":"detail"}')"
  if [[ "${decision_code}" != "200" ]]; then
    echo "❌ subscription decision expected 200, got ${decision_code}" >&2
    cat /tmp/touchx_social_decision.json >&2 || true
    exit 1
  fi

  me_code="$(curl -sS -o /tmp/touchx_social_me.json -w "%{http_code}" \
    "${BASE_URL}/api/v1/social/me" \
    -H "authorization: Bearer ${social_token_a}")"
  if [[ "${me_code}" != "200" ]]; then
    echo "❌ /api/v1/social/me expected 200, got ${me_code}" >&2
    cat /tmp/touchx_social_me.json >&2 || true
    exit 1
  fi
  social_sub_count="$(python - <<'PY'
import json
from pathlib import Path
payload = json.loads(Path("/tmp/touchx_social_me.json").read_text())
print(len(payload.get("subscriptions") or []))
PY
)"
  if [[ "${social_sub_count}" -lt 1 ]]; then
    echo "❌ social smoke subscription was not visible after acceptance" >&2
    cat /tmp/touchx_social_me.json >&2 || true
    exit 1
  fi

  activity_code="$(curl -sS -o /tmp/touchx_social_activity.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/social/activities" \
    -H "authorization: Bearer ${social_token_a}" \
    -H "content-type: application/json" \
    -d '{"title":"Smoke 学习组局","activityType":"study","week":1,"day":1,"startSection":1,"endSection":1,"participantStudentIds":["linfeng"],"sendNow":true}')"
  if [[ "${activity_code}" != "200" ]]; then
    echo "❌ /api/v1/social/activities expected 200, got ${activity_code}" >&2
    cat /tmp/touchx_social_activity.json >&2 || true
    exit 1
  fi

  remove_code="$(curl -sS -o /tmp/touchx_social_remove.json -w "%{http_code}" \
    -X POST "${BASE_URL}/api/v1/social/subscribe/remove" \
    -H "authorization: Bearer ${social_token_a}" \
    -H "content-type: application/json" \
    -d '{"targetStudentId":"linfeng"}')"
  if [[ "${remove_code}" != "200" ]]; then
    echo "❌ /api/v1/social/subscribe/remove expected 200, got ${remove_code}" >&2
    cat /tmp/touchx_social_remove.json >&2 || true
    exit 1
  fi
  echo "✅ social P0 flow -> request/accept/activity/remove"
fi

echo "Smoke checks passed."
