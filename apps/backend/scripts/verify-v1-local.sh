#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${ROOT_DIR}"

run_step() {
  local label="$1"
  shift
  echo "==> ${label}"
  "$@"
}

run_step "backend type-check" pnpm --filter "@touchx/backend" type-check
run_step "backend node tests" node --test "apps/backend/server/services"/*.test.mjs
run_step "api-client tests" pnpm --filter "@touchx/api-client" test
run_step "calendar-core tests" pnpm --filter "@touchx/calendar-core" test
run_step "miniapp type-check" pnpm --filter "@touchx/miniapp" type-check
run_step "mobile type-check" pnpm --filter "@touchx/mobile" type-check
run_step "API boundary smoke" pnpm --filter "@touchx/backend" smoke:api-boundaries
run_step "admin UI boundary smoke" pnpm --filter "@touchx/backend" smoke:admin-ui-boundaries
run_step "client boundary smoke" pnpm --filter "@touchx/backend" smoke:client-boundaries
run_step "data boundary smoke" pnpm --filter "@touchx/backend" smoke:data-boundaries
run_step "Cloudflare config smoke" pnpm --filter "@touchx/backend" smoke:cloudflare-config
run_step "smoke script syntax" bash -n "apps/backend/scripts/smoke-production.sh" "apps/backend/scripts/smoke-local.sh" "apps/backend/scripts/verify-v1-production.sh"
run_step "diff whitespace check" git diff --check

echo "ok V1 local verification gate"
