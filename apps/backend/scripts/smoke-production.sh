#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOUCHX_SMOKE_BASE_URL:-https://schedule-backend.tagzxia.com}"

request() {
  local path="$1"
  curl --fail --silent --show-error --max-time 15 "${BASE_URL}${path}" >/tmp/touchx-smoke-response.json
  echo "ok ${path}"
}

request_protected() {
  local path="$1"
  if [[ -n "${TOUCHX_SMOKE_AUTH_TOKEN:-}" ]]; then
    curl --fail --silent --show-error --max-time 15 \
      -H "Authorization: Bearer ${TOUCHX_SMOKE_AUTH_TOKEN}" \
      "${BASE_URL}${path}" >/tmp/touchx-smoke-response.json
    echo "ok ${path}"
    return
  fi
  local status_code
  status_code="$(curl --silent --show-error --output /tmp/touchx-smoke-response.json --write-out "%{http_code}" --max-time 15 "${BASE_URL}${path}")"
  if [[ "${status_code}" != "401" ]]; then
    echo "expected 401 for protected ${path}, got ${status_code}" >&2
    exit 1
  fi
  echo "ok ${path} protected"
}

request "/health"
request "/api/v1/theme-images"
request_protected "/api/v1/schedules/student?studentId=tangzixian"
