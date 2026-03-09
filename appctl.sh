#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$ROOT_DIR/.appctl"
LOG_DIR="$STATE_DIR/logs"
PID_DIR="$STATE_DIR/pids"

DASHBOARD_DIR="$ROOT_DIR/dashboard"
WORKER_DIR="$ROOT_DIR/worker"

mkdir -p "$LOG_DIR" "$PID_DIR"
DEBUG=0
ACTION=""
APP_URL="http://localhost:5173"

usage() {
  echo "Usage: $0 [--debug] {start|stop|restart}"
  exit 1
}

is_running() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  kill -0 "$pid" >/dev/null 2>&1
}

write_pid() {
  local name="$1"
  local pid="$2"
  echo "$pid" >"$PID_DIR/$name.pid"
}

read_pid() {
  local name="$1"
  if [[ -f "$PID_DIR/$name.pid" ]]; then
    cat "$PID_DIR/$name.pid"
  fi
}

start_component() {
  local name="$1"
  local workdir="$2"
  local cmd="$3"
  local pid

  pid="$(read_pid "$name" || true)"
  if is_running "$pid"; then
    echo "$name already running (pid=$pid)"
    return 0
  fi

  echo "Starting $name..."
  if [[ "$DEBUG" -eq 1 ]]; then
    (
      cd "$workdir"
      /bin/zsh -lc "$cmd" &
      echo $! >"$PID_DIR/$name.pid"
    )
  else
    (
      cd "$workdir"
      nohup /bin/zsh -lc "$cmd" >"$LOG_DIR/$name.log" 2>&1 &
      echo $! >"$PID_DIR/$name.pid"
    )
  fi
  sleep 1
  pid="$(read_pid "$name" || true)"
  if is_running "$pid"; then
    echo "$name started (pid=$pid)"
  else
    echo "Failed to start $name. Check $LOG_DIR/$name.log"
    return 1
  fi
}

open_browser() {
  sleep 5
  if command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
    return 0
  fi
  echo "Could not open browser automatically. Open $APP_URL manually."
}

stop_component() {
  local name="$1"
  local pid
  pid="$(read_pid "$name" || true)"

  if is_running "$pid"; then
    echo "Stopping $name (pid=$pid)..."
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if is_running "$pid"; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  else
    echo "$name not running"
  fi

  rm -f "$PID_DIR/$name.pid"
}

start_all() {
  start_component "api" "$ROOT_DIR" "env MAX_JSON_BODY_MB=80 AAD_TENANT_ID=organizations ALLOW_MULTI_TENANT=true AAD_AUDIENCE=api://63eefc68-2d4b-45c0-a619-65b45c5fada9 REQUIRED_SCOPES=Capsule.Submit ALLOW_DUMMY_WORKER_FALLBACK=false node server/index.js"
  start_component "worker" "$WORKER_DIR" "func start"
  start_component "dashboard" "$DASHBOARD_DIR" "npm run dev"
  echo "All components started."
  if [[ "$DEBUG" -eq 1 ]]; then
    echo "Debug mode enabled: component output is attached to this console."
  else
    echo "Logs: $LOG_DIR"
  fi
  open_browser
}

stop_all() {
  stop_component "dashboard"
  stop_component "worker"
  stop_component "api"
  echo "All components stopped."
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --debug)
        DEBUG=1
        ;;
      start|stop|restart)
        if [[ -n "$ACTION" ]]; then
          usage
        fi
        ACTION="$1"
        ;;
      *)
        usage
        ;;
    esac
    shift
  done

  if [[ -z "$ACTION" ]]; then
    usage
  fi

  case "$ACTION" in
    start)
      start_all
      ;;
    stop)
      stop_all
      ;;
    restart)
      stop_all
      start_all
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
