#!/usr/bin/env bash
set -euo pipefail

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

PORT="${NEXUS_DEV_PORT:-9986}"
HOST="${NEXUS_DEV_HOST:-0.0.0.0}"
CURRENT_DIR="$(pwd)"

if command -v lsof >/dev/null 2>&1; then
  LISTEN_PID="$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN | head -n 1 || true)"
  if [[ -n "${LISTEN_PID}" ]]; then
    LISTEN_CWD="$(lsof -a -p "${LISTEN_PID}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
    echo "❌ 端口 ${PORT} 已被进程 ${LISTEN_PID} 占用（cwd=${LISTEN_CWD:-unknown}）" >&2
    echo "请先停止占用进程后再启动：kill ${LISTEN_PID}" >&2
    exit 1
  fi
fi

unset NUXT_VITE_NODE_OPTIONS
exec nuxt dev --host "${HOST}" --port "${PORT}" --clear
