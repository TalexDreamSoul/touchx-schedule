#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

DEV_MODE=0
FORWARD_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--dev" ]; then
    DEV_MODE=1
    continue
  fi
  FORWARD_ARGS+=("$arg")
done

if [ ! -d ".venv" ]; then
  python3 -m venv ".venv"
fi

source ".venv/bin/activate"

REQ_FILE="requirements.txt"
REQ_STAMP_FILE=".venv/.requirements.stamp"

calc_requirements_hash() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$REQ_FILE" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$REQ_FILE" | awk '{print $1}'
    return
  fi
  python - <<'PY'
import hashlib
from pathlib import Path
print(hashlib.sha256(Path("requirements.txt").read_bytes()).hexdigest())
PY
}

PY_VERSION="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
REQ_HASH="$(calc_requirements_hash)"
CURRENT_STAMP="${PY_VERSION}:${REQ_HASH}"
LAST_STAMP=""
if [ -f "$REQ_STAMP_FILE" ]; then
  LAST_STAMP="$(cat "$REQ_STAMP_FILE")"
fi

if [ "$CURRENT_STAMP" != "$LAST_STAMP" ]; then
  echo "[start.sh] 检测到依赖变化，正在安装..."
  python -m pip install -r "$REQ_FILE"
  printf '%s\n' "$CURRENT_STAMP" > "$REQ_STAMP_FILE"
else
  echo "[start.sh] 依赖无变化，跳过安装。"
fi

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

if [ "$DEV_MODE" -eq 1 ]; then
  if [ "${#FORWARD_ARGS[@]}" -eq 0 ]; then
    ./reminder serve --reload --port 9986
  else
    ./reminder serve --reload "${FORWARD_ARGS[@]}"
  fi
else
  if [ "${#FORWARD_ARGS[@]}" -eq 0 ]; then
    ./reminder serve --port 9986
  else
    ./reminder serve "${FORWARD_ARGS[@]}"
  fi
fi
