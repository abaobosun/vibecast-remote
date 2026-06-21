#!/bin/zsh
set -e

cd "$(dirname "$0")"

PORT="${PORT:-8765}"
LABEL="${LABEL:-com.vibecast.remote}"
PID_FILE=".vibecast.pid"
LOG_DIR="${HOME}/Library/Logs/VibeCast Remote"
LOG_FILE="${LOG_DIR}/vibecast.log"
ERROR_LOG_FILE="${LOG_DIR}/vibecast.error.log"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_FILE="${PLIST_DIR}/${LABEL}.plist"
DOMAIN="gui/$(id -u)"
SERVICE="${DOMAIN}/${LABEL}"

mkdir -p "$LOG_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "start-background.command currently uses macOS launchd."
  echo "Use npm start on this platform."
  exit 1
fi

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "Node.js was not found in PATH."
  exit 1
fi
if command -v realpath >/dev/null 2>&1; then
  NODE_BIN="$(realpath "$NODE_BIN")"
fi

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\&apos;/g"
}

if launchctl print "$SERVICE" >/dev/null 2>&1; then
  echo "VibeCast Remote is already loaded as a background service."
  echo "Service: $LABEL"
  echo "Health: http://127.0.0.1:$PORT/health"
  echo "Desktop: http://127.0.0.1:$PORT/desktop"
  echo "Log: $LOG_FILE"
  exit 0
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use."
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  exit 1
fi

mkdir -p "$PLIST_DIR"

PROJECT_DIR="$(pwd)"
cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd &quot;\$VIBECAST_PROJECT_DIR&quot; &amp;&amp; exec &quot;\$VIBECAST_NODE_BIN&quot; server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$PROJECT_DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>$(xml_escape "$PORT")</string>
    <key>PATH</key>
    <string>$(xml_escape "$PATH")</string>
    <key>HOME</key>
    <string>$(xml_escape "$HOME")</string>
    <key>VIBECAST_PROJECT_DIR</key>
    <string>$(xml_escape "$PROJECT_DIR")</string>
    <key>VIBECAST_NODE_BIN</key>
    <string>$(xml_escape "$NODE_BIN")</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG_FILE")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$ERROR_LOG_FILE")</string>
</dict>
</plist>
PLIST

echo "Starting VibeCast Remote as a macOS background service..."
echo "Service: $LABEL"
echo "Log: $LOG_FILE"
echo "Error log: $ERROR_LOG_FILE"

{
  echo ""
  echo "----- $(date '+%Y-%m-%d %H:%M:%S') starting $LABEL on port $PORT -----"
} >> "$LOG_FILE"
{
  echo ""
  echo "----- $(date '+%Y-%m-%d %H:%M:%S') starting $LABEL on port $PORT -----"
} >> "$ERROR_LOG_FILE"

launchctl bootstrap "$DOMAIN" "$PLIST_FILE"
launchctl kickstart -k "$SERVICE" >/dev/null 2>&1 || true

PORT_PID=""
for _ in {1..20}; do
  PORT_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [ -n "$PORT_PID" ]; then
    break
  fi
  sleep 0.5
done

if [ -n "$PORT_PID" ]; then
  echo "$PORT_PID" > "$PID_FILE"
  echo "Started."
  echo "PID: $PORT_PID"
  echo "Health: http://127.0.0.1:$PORT/health"
  echo "Desktop: http://127.0.0.1:$PORT/desktop"
  echo ""
  tail -n 40 "$LOG_FILE"
else
  echo "Failed to start. Recent log:"
  tail -n 80 "$LOG_FILE" 2>/dev/null || true
  tail -n 80 "$ERROR_LOG_FILE" 2>/dev/null || true
  launchctl bootout "$DOMAIN" "$PLIST_FILE" >/dev/null 2>&1 || true
  exit 1
fi
