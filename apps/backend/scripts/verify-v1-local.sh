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

check_shell_syntax() {
  local script
  for script in "apps/backend/scripts"/*.sh; do
    bash -n "${script}"
  done
}

run_step "backend type-check" pnpm --filter "@touchx/backend" type-check
run_step "backend node tests" node --test "apps/backend/server/services"/*.test.mjs
run_step "workspace package tests" pnpm test:packages
run_step "miniapp type-check" pnpm --filter "@touchx/miniapp" type-check
run_step "mobile type-check" pnpm --filter "@touchx/mobile" type-check
run_step "API boundary smoke" pnpm --filter "@touchx/backend" smoke:api-boundaries
run_step "admin UI boundary smoke" pnpm --filter "@touchx/backend" smoke:admin-ui-boundaries
run_step "client boundary smoke" pnpm --filter "@touchx/backend" smoke:client-boundaries
run_step "miniapp parity smoke" pnpm --filter "@touchx/backend" smoke:miniapp-parity
run_step "data boundary smoke" pnpm --filter "@touchx/backend" smoke:data-boundaries
run_step "Cloudflare config smoke" pnpm --filter "@touchx/backend" smoke:cloudflare-config
run_step "backend shell script syntax" check_shell_syntax
run_step "diff whitespace check" git diff --check

echo "ok V1 local verification gate"
