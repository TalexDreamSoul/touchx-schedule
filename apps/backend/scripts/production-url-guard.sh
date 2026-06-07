is_non_production_smoke_url() {
  local url="$1"
  local result
  if python - "${url}" <<'PY'
import ipaddress
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
  sys.exit(1)

ip = getattr(ip, "ipv4_mapped", None) or ip
blocked_networks = [
  ipaddress.ip_network("127.0.0.0/8"),
  ipaddress.ip_network("0.0.0.0/32"),
  ipaddress.ip_network("10.0.0.0/8"),
  ipaddress.ip_network("172.16.0.0/12"),
  ipaddress.ip_network("192.168.0.0/16"),
  ipaddress.ip_network("169.254.0.0/16"),
  ipaddress.ip_network("100.64.0.0/10"),
  ipaddress.ip_network("::1/128"),
  ipaddress.ip_network("fc00::/7"),
  ipaddress.ip_network("fe80::/10"),
]
sys.exit(0 if any(ip in network for network in blocked_networks) else 1)
PY
  then
    return 0
  else
    result=$?
    [[ "${result}" -eq 1 ]] && return 1
    return 0
  fi
}
