#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT="${PORT:-8765}"
LABEL="${LABEL:-com.vibecast.remote}"
PID_FILE=".vibecast.pid"
LOG_FILE="${HOME}/Library/Logs/VibeCast Remote/vibecast.log"
ERROR_LOG_FILE="${HOME}/Library/Logs/VibeCast Remote/vibecast.error.log"
PLIST_FILE="${HOME}/Library/LaunchAgents/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
SERVICE="${DOMAIN}/${LABEL}"

echo "VibeCast Remote status"
echo "Project: $(pwd)"
echo "Port: $PORT"
echo "Service: $LABEL"

if [ "$(uname -s)" = "Darwin" ]; then
  echo ""
  echo "launchd:"
  if launchctl print "$SERVICE" >/dev/null 2>&1; then
    echo "Loaded"
    launchctl print "$SERVICE" 2>/dev/null | sed -n '1,24p'
  else
    echo "Not loaded"
  fi

  if [ -f "$PLIST_FILE" ]; then
    echo "Plist: $PLIST_FILE"
  fi
fi

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "PID file: $PID_FILE -> $PID, running"
  else
    echo "PID file: $PID_FILE exists, but the process is not running"
  fi
else
  echo "PID file: not found"
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo ""
  echo "Listening process:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
else
  echo ""
  echo "No process is listening on port $PORT."
fi

echo ""
echo "Health:"
if command -v curl >/dev/null 2>&1; then
  curl -s --max-time 2 "http://127.0.0.1:$PORT/health" || true
  echo ""
else
  echo "curl is not installed."
fi

if [ -f "$LOG_FILE" ]; then
  echo ""
  echo "Recent log: $LOG_FILE"
  tail -n 40 "$LOG_FILE"
else
  echo ""
  echo "Log file not found yet: $LOG_FILE"
fi

if [ -f "$ERROR_LOG_FILE" ]; then
  echo ""
  echo "Recent error log: $ERROR_LOG_FILE"
  tail -n 40 "$ERROR_LOG_FILE"
fi
