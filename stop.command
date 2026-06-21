#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT="${PORT:-8765}"
LABEL="${LABEL:-com.vibecast.remote}"
PID_FILE=".vibecast.pid"
PLIST_FILE="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
SERVICE="${DOMAIN}/${LABEL}"

stop_pid() {
  local pid="$1"

  if [ -z "$pid" ]; then
    return 0
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping VibeCast Remote PID $pid..."
    kill "$pid"
    sleep 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "Process $pid is still running. Try again, or stop it from Activity Monitor."
    exit 1
  fi
}

if [ "$(uname -s)" = "Darwin" ] && launchctl print "$SERVICE" >/dev/null 2>&1; then
  echo "Stopping launchd service $LABEL..."
  launchctl bootout "$DOMAIN" "$PLIST_FILE" >/dev/null 2>&1 || launchctl bootout "$SERVICE" >/dev/null 2>&1 || true
fi

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  stop_pid "$PID"
  rm -f "$PID_FILE"
fi

PORT_PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$PORT_PIDS" ]; then
  echo "Found process listening on port $PORT:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  echo "$PORT_PIDS" | while read pid; do
    stop_pid "$pid"
  done
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is still in use."
  exit 1
fi

echo "VibeCast Remote is stopped."
