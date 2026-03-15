#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTBOT_BIN="${CERTBOT_BIN:-certbot}"
LE_DOMAIN="${LE_DOMAIN:-${1:-}}"
LE_EMAIL="${LE_EMAIL:-${2:-}}"
LE_CHALLENGE_MODE="${LE_CHALLENGE_MODE:-dns-manual}"
LE_HTTP_PORT="${LE_HTTP_PORT:-80}"
LE_WEBROOT="${LE_WEBROOT:-}"
LE_STAGING="${LE_STAGING:-0}"
LE_STATE_DIR="${LE_STATE_DIR:-$ROOT_DIR/.appctl/letsencrypt}"

usage() {
  cat <<'EOF'
Usage:
  LE_DOMAIN=purview.killercloud.com.au LE_EMAIL=admin@example.com ./scripts/issue-letsencrypt-cert.sh

Environment variables:
  LE_DOMAIN             Certificate domain (required)
  LE_EMAIL              Let's Encrypt registration email (required)
  LE_CHALLENGE_MODE     dns-manual | standalone | webroot (default: dns-manual)
  LE_HTTP_PORT          HTTP-01 port for standalone mode (default: 80)
  LE_WEBROOT            Webroot path for webroot mode
  LE_STAGING            1 to use Let's Encrypt staging CA (default: 0)
  LE_STATE_DIR          Working state directory (default: ./.appctl/letsencrypt)
  CERTBOT_BIN           Certbot executable path (default: certbot)
EOF
}

if [[ -z "$LE_DOMAIN" || -z "$LE_EMAIL" ]]; then
  usage
  exit 1
fi

if ! command -v "$CERTBOT_BIN" >/dev/null 2>&1; then
  echo "certbot was not found. Install certbot or set CERTBOT_BIN." >&2
  exit 1
fi

CONFIG_DIR="$LE_STATE_DIR/config"
WORK_DIR="$LE_STATE_DIR/work"
LOGS_DIR="$LE_STATE_DIR/logs"
mkdir -p "$CONFIG_DIR" "$WORK_DIR" "$LOGS_DIR"

cmd=(
  "$CERTBOT_BIN"
  certonly
  --agree-tos
  --email "$LE_EMAIL"
  --config-dir "$CONFIG_DIR"
  --work-dir "$WORK_DIR"
  --logs-dir "$LOGS_DIR"
  -d "$LE_DOMAIN"
)

if [[ "$LE_STAGING" == "1" ]]; then
  cmd+=(--test-cert)
fi

case "$LE_CHALLENGE_MODE" in
  dns-manual)
    cmd+=(
      --manual
      --preferred-challenges dns
    )
    ;;
  standalone)
    cmd+=(
      --standalone
      --preferred-challenges http-01
      --http-01-port "$LE_HTTP_PORT"
    )
    ;;
  webroot)
    if [[ -z "$LE_WEBROOT" ]]; then
      echo "LE_WEBROOT is required when LE_CHALLENGE_MODE=webroot." >&2
      exit 1
    fi
    if [[ ! -d "$LE_WEBROOT" ]]; then
      echo "LE_WEBROOT does not exist: $LE_WEBROOT" >&2
      exit 1
    fi
    cmd+=(
      --webroot
      -w "$LE_WEBROOT"
    )
    ;;
  *)
    echo "Unsupported LE_CHALLENGE_MODE: $LE_CHALLENGE_MODE" >&2
    exit 1
    ;;
esac

echo "Issuing Let's Encrypt certificate for $LE_DOMAIN (mode=$LE_CHALLENGE_MODE)..."
"${cmd[@]}"

LIVE_DIR="$CONFIG_DIR/live/$LE_DOMAIN"
KEY_PATH="$LIVE_DIR/privkey.pem"
CERT_PATH="$LIVE_DIR/fullchain.pem"

if [[ ! -f "$KEY_PATH" || ! -f "$CERT_PATH" ]]; then
  echo "Certificate issuance did not produce expected files:" >&2
  echo "  $KEY_PATH" >&2
  echo "  $CERT_PATH" >&2
  exit 1
fi

echo "Let's Encrypt certificate issued:"
echo "  key:  $KEY_PATH"
echo "  cert: $CERT_PATH"
echo
echo "Start app with this certificate:"
echo "  LETSENCRYPT_DOMAIN=$LE_DOMAIN APP_URL_HOST=$LE_DOMAIN ./appctl.sh start"
echo
echo "Or use explicit paths:"
echo "  DASHBOARD_TLS_KEY=$KEY_PATH DASHBOARD_TLS_CERT=$CERT_PATH APP_URL_OVERRIDE=https://$LE_DOMAIN:5173 ./appctl.sh start"
