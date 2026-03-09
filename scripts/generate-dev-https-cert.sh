#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT_DIR/.appctl/certs}"
CERT_KEY="${CERT_KEY:-$CERT_DIR/dashboard-dev-key.pem}"
CERT_CERT="${CERT_CERT:-$CERT_DIR/dashboard-dev-cert.pem}"
DEV_CERT_DAYS="${DEV_CERT_DAYS:-825}"
DEV_CERT_FORCE="${DEV_CERT_FORCE:-0}"

mkdir -p "$CERT_DIR"

if [[ "$DEV_CERT_FORCE" != "1" && -f "$CERT_KEY" && -f "$CERT_CERT" ]]; then
  echo "Using existing dev certificate:"
  echo "  key:  $CERT_KEY"
  echo "  cert: $CERT_CERT"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "OpenSSL is required to generate a development certificate." >&2
  exit 1
fi

detect_lan_ip() {
  if command -v ipconfig >/dev/null 2>&1; then
    local default_if=""
    default_if="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)"
    if [[ -n "$default_if" ]]; then
      ipconfig getifaddr "$default_if" 2>/dev/null || true
    fi
    ipconfig getifaddr en0 2>/dev/null || true
    ipconfig getifaddr en1 2>/dev/null || true
    return
  fi
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null || true
    return
  fi
}

hosts=("localhost" "127.0.0.1" "::1")
if [[ -n "${DEV_CERT_HOSTS:-}" ]]; then
  IFS=',' read -r -a extra_hosts <<<"${DEV_CERT_HOSTS}"
  for host in "${extra_hosts[@]}"; do
    host_trimmed="$(echo "$host" | xargs)"
    if [[ -n "$host_trimmed" ]]; then
      hosts+=("$host_trimmed")
    fi
  done
fi

if [[ "${DEV_CERT_INCLUDE_LAN_IP:-1}" == "1" ]]; then
  lan_detected="$(detect_lan_ip | tr ' ' '\n' | rg -N '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || true)"
  if [[ -n "$lan_detected" ]]; then
    while IFS= read -r ip; do
      [[ -n "$ip" ]] && hosts+=("$ip")
    done <<<"$lan_detected"
  fi
fi

unique_hosts=()
for host in "${hosts[@]}"; do
  key="$(echo "$host" | tr '[:upper:]' '[:lower:]')"
  existing_hosts="$(printf '%s\n' "${unique_hosts[@]-}" | tr '[:upper:]' '[:lower:]')"
  if ! printf '%s\n' "$existing_hosts" | rg -qx "$key"; then
    unique_hosts+=("$host")
  fi
done

tmp_cfg="$(mktemp)"
trap 'rm -f "$tmp_cfg"' EXIT

{
  echo "[req]"
  echo "default_bits = 2048"
  echo "distinguished_name = req_distinguished_name"
  echo "x509_extensions = v3_req"
  echo "prompt = no"
  echo
  echo "[req_distinguished_name]"
  echo "CN = Purview Workbench Dev"
  echo
  echo "[v3_req]"
  echo "subjectAltName = @alt_names"
  echo "keyUsage = critical, digitalSignature, keyEncipherment"
  echo "extendedKeyUsage = serverAuth"
  echo
  echo "[alt_names]"
} >"$tmp_cfg"

dns_i=1
ip_i=1
for host in "${unique_hosts[@]}"; do
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ || "$host" == "::1" ]]; then
    echo "IP.$ip_i = $host" >>"$tmp_cfg"
    ip_i=$((ip_i + 1))
  else
    echo "DNS.$dns_i = $host" >>"$tmp_cfg"
    dns_i=$((dns_i + 1))
  fi
done

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -sha256 \
  -days "$DEV_CERT_DAYS" \
  -keyout "$CERT_KEY" \
  -out "$CERT_CERT" \
  -config "$tmp_cfg"

chmod 600 "$CERT_KEY"

echo "Generated development HTTPS certificate:"
echo "  key:  $CERT_KEY"
echo "  cert: $CERT_CERT"
echo "  SANs: ${unique_hosts[*]}"
