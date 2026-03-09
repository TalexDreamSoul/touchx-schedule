#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:9986}"

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
echo "Smoke checks passed."
