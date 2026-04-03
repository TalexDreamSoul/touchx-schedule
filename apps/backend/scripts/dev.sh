#!/usr/bin/env bash
set -euo pipefail

load_env_defaults() {
  local env_file="$1"
  local var_name=""
  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source <(
    while IFS= read -r line || [[ -n "${line}" ]]; do
      if [[ "${line}" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)= ]]; then
        var_name="${BASH_REMATCH[2]}"
        if [[ "${!var_name+x}" == "x" ]]; then
          continue
        fi
      fi
      printf '%s\n' "${line}"
    done < "${env_file}"
  )
  set +a
}

load_env_defaults ".env"
load_env_defaults ".env.local"

PORT="${NEXUS_DEV_PORT:-9986}"
HOST="${NEXUS_DEV_HOST:-0.0.0.0}"
CURRENT_DIR="$(pwd)"
NUXT_DEV_CLEAR="${NEXUS_DEV_CLEAR:-0}"

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
if [[ "${NUXT_DEV_CLEAR}" == "1" ]]; then
  exec nuxt dev --host "${HOST}" --port "${PORT}" --clear
fi
exec nuxt dev --host "${HOST}" --port "${PORT}"
