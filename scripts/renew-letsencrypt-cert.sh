#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTBOT_BIN="${CERTBOT_BIN:-certbot}"
LE_STATE_DIR="${LE_STATE_DIR:-$ROOT_DIR/.appctl/letsencrypt}"
LE_STAGING="${LE_STAGING:-0}"

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
  renew
  --config-dir "$CONFIG_DIR"
  --work-dir "$WORK_DIR"
  --logs-dir "$LOGS_DIR"
)

if [[ "$LE_STAGING" == "1" ]]; then
  cmd+=(--test-cert)
fi

echo "Renewing Let's Encrypt certificates..."
"${cmd[@]}"
