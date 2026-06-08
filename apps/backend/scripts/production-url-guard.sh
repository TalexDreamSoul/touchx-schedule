is_non_production_smoke_url() {
  local url="$1"
  local result
  if python - "${url}" <<'PY'
import ipaddress
import re
import sys
from urllib.parse import urlsplit

try:
  parsed = urlsplit(sys.argv[1])
except ValueError:
  sys.exit(0)

if parsed.scheme != "https":
  sys.exit(0)

host = (parsed.hostname or "").rstrip(".").lower()
if not host or host == "localhost":
  sys.exit(0)

try:
  ip = ipaddress.ip_address(host)
except ValueError:
  reserved_exact_hosts = {
    "example",
    "example.com",
    "example.net",
    "example.org",
    "invalid",
    "local",
    "localhost",
    "test",
  }
  reserved_suffixes = (
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".invalid",
    ".local",
    ".localhost",
    ".test",
  )
  if host in reserved_exact_hosts or host.endswith(reserved_suffixes):
    sys.exit(0)
  if "." not in host:
    sys.exit(0)
  if len(host) > 253:
    sys.exit(0)
  label_pattern = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
  if any(not label_pattern.match(label) for label in host.split(".")):
    sys.exit(0)
  sys.exit(1)

ip = getattr(ip, "ipv4_mapped", None) or ip
sys.exit(1 if ip.is_global and not ip.is_multicast else 0)
PY
  then
    return 0
  else
    result=$?
    [[ "${result}" -eq 1 ]] && return 1
    return 0
  fi
}

is_ambiguous_smoke_base_url() {
  local url="$1"
  python - "${url}" <<'PY'
import sys
from urllib.parse import urlsplit

try:
  parsed = urlsplit(sys.argv[1])
  _ = parsed.port
except ValueError:
  sys.exit(0)

if (
  any(char.isspace() for char in sys.argv[1])
  or not parsed.scheme
  or not parsed.hostname
  or parsed.path not in ("", "/")
  or parsed.username
  or parsed.password
  or parsed.query
  or parsed.fragment
):
  sys.exit(0)
sys.exit(1)
PY
}
