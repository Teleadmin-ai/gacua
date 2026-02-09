#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# gacua.sh — Start / Stop / Restart / Status for GACUA server
#
# Usage:  bash ~/gacua/gacua.sh [start|stop|restart|status|token]
#
# Stores PID + token in /tmp/gacua.env so they survive across
# different shell invocations (important for Claude Code where
# each Bash call = new shell).
# ─────────────────────────────────────────────────────────────────

set -uo pipefail

GACUA_DIR="$HOME/gacua"
STATE_FILE="/tmp/gacua.env"
LOG_FILE="/tmp/gacua-server.log"
HOST="192.168.11.13"
PORT_API=3000
PORT_MCP=10001

# screenshot-desktop uses a bat+exe in Temp\screenCapture.
# The bat calls %~n0.exe (relative), so the dir must be in PATH.
SCREENCAP_DIR="$APPDATA/../Local/Temp/screenCapture"
if [[ -d "$SCREENCAP_DIR" ]]; then
  export PATH="$PATH:$SCREENCAP_DIR"
fi

# ── Helpers ──────────────────────────────────────────────────────

load_state() {
  GACUA_PID=""
  GACUA_TOKEN=""
  if [[ -f "$STATE_FILE" ]]; then
    source "$STATE_FILE"
  fi
}

save_state() {
  cat > "$STATE_FILE" <<EOF
GACUA_PID=$GACUA_PID
GACUA_TOKEN=$GACUA_TOKEN
EOF
}

clear_state() {
  rm -f "$STATE_FILE"
}

# Kill a process by PID (Windows-compatible via powershell)
kill_pid() {
  local pid=$1
  if powershell -Command "Get-Process -Id $pid -ErrorAction SilentlyContinue" &>/dev/null; then
    powershell -Command "Stop-Process -Id $pid -Force" 2>/dev/null
    echo "  Killed PID $pid"
  fi
}

# Find PIDs listening on a given port
find_pids_on_port() {
  local port=$1
  netstat -ano 2>/dev/null | grep ":$port " | grep "LISTENING" | awk '{print $NF}' | sort -u || true
}

# ── Commands ─────────────────────────────────────────────────────

cmd_start() {
  # Check if already running
  local existing_pids
  existing_pids=$(find_pids_on_port $PORT_API)
  if [[ -n "$existing_pids" ]]; then
    echo "GACUA already running on port $PORT_API (PIDs: $existing_pids)"
    echo "Use 'restart' to stop and start fresh, or 'status' to see details."
    load_state
    if [[ -n "$GACUA_TOKEN" ]]; then
      echo "Token: $GACUA_TOKEN"
    fi
    return 1
  fi

  echo "Starting GACUA server..."

  # Build first if needed (check if dist exists)
  if [[ ! -d "$GACUA_DIR/packages/gacua/backend/dist" ]]; then
    echo "  Building project first..."
    cd "$GACUA_DIR" && npm run build 2>&1 | tail -3
  fi

  # Launch server in background
  cd "$GACUA_DIR"
  nohup npm run start:gacua > "$LOG_FILE" 2>&1 &
  local bg_pid=$!

  echo "  Waiting for server startup..."
  local attempts=0
  local max_attempts=30
  GACUA_TOKEN=""

  while [[ $attempts -lt $max_attempts ]]; do
    sleep 1
    attempts=$((attempts + 1))

    # Try to extract token from log
    if [[ -z "$GACUA_TOKEN" ]]; then
      GACUA_TOKEN=$(grep -oP 'token=\K[0-9a-f]{64}' "$LOG_FILE" 2>/dev/null | head -1 || true)
    fi

    # Check if server is responding
    if [[ -n "$GACUA_TOKEN" ]]; then
      local health
      health=$(curl -s --max-time 2 "http://$HOST:$PORT_API/api/health?token=$GACUA_TOKEN" 2>/dev/null || true)
      if echo "$health" | grep -q "healthy"; then
        break
      fi
    fi
  done

  if [[ -z "$GACUA_TOKEN" ]]; then
    echo "  FAILED: Could not extract token after ${max_attempts}s"
    echo "  Check log: $LOG_FILE"
    return 1
  fi

  # Find the actual node PID (not the npm wrapper)
  GACUA_PID=$(find_pids_on_port $PORT_API | head -1)
  save_state

  echo ""
  echo "═══════════════════════════════════════════════"
  echo "  GACUA server started successfully!"
  echo "  Token : $GACUA_TOKEN"
  echo "  PID   : $GACUA_PID"
  echo "  API   : http://$HOST:$PORT_API"
  echo "  MCP   : http://localhost:$PORT_MCP"
  echo "  Log   : $LOG_FILE"
  echo "═══════════════════════════════════════════════"
}

cmd_stop() {
  echo "Stopping GACUA server..."

  local killed=0

  # Kill processes on API port
  for pid in $(find_pids_on_port $PORT_API); do
    kill_pid "$pid"
    killed=1
  done

  # Kill processes on MCP port
  for pid in $(find_pids_on_port $PORT_MCP); do
    kill_pid "$pid"
    killed=1
  done

  # Also try saved PID
  load_state
  if [[ -n "$GACUA_PID" ]]; then
    kill_pid "$GACUA_PID" 2>/dev/null || true
  fi

  clear_state

  if [[ $killed -eq 1 ]]; then
    # Wait a moment for ports to free up
    sleep 2
    echo "  GACUA stopped."
  else
    echo "  GACUA was not running."
  fi
}

cmd_restart() {
  cmd_stop
  echo ""
  cmd_start
}

cmd_status() {
  load_state

  local api_pids mcp_pids
  api_pids=$(find_pids_on_port $PORT_API)
  mcp_pids=$(find_pids_on_port $PORT_MCP)

  if [[ -n "$api_pids" ]]; then
    echo "GACUA is RUNNING"
    echo "  API port $PORT_API : PIDs $api_pids"
    echo "  MCP port $PORT_MCP : PIDs ${mcp_pids:-none}"

    if [[ -n "$GACUA_TOKEN" ]]; then
      # Verify token still works
      local health
      health=$(curl -s --max-time 2 "http://$HOST:$PORT_API/api/health?token=$GACUA_TOKEN" 2>/dev/null || true)
      if echo "$health" | grep -q "healthy"; then
        echo "  Token : $GACUA_TOKEN (valid)"
      else
        echo "  Token : $GACUA_TOKEN (INVALID — server may have restarted)"
      fi
    else
      echo "  Token : unknown (use 'restart' to get a fresh token)"
    fi
  else
    echo "GACUA is NOT running."
    clear_state
  fi
}

cmd_token() {
  load_state
  if [[ -n "$GACUA_TOKEN" ]]; then
    echo "$GACUA_TOKEN"
  else
    echo "No token saved. Is GACUA running? Try 'status' or 'start'." >&2
    return 1
  fi
}

# ── Main ─────────────────────────────────────────────────────────

case "${1:-status}" in
  start)   cmd_start   ;;
  stop)    cmd_stop    ;;
  restart) cmd_restart ;;
  status)  cmd_status  ;;
  token)   cmd_token   ;;
  *)
    echo "Usage: bash ~/gacua/gacua.sh [start|stop|restart|status|token]"
    echo ""
    echo "  start   — Build (if needed), launch server, show token + PIDs"
    echo "  stop    — Kill server + MCP processes"
    echo "  restart — Stop then start"
    echo "  status  — Show running state, PIDs, token validity"
    echo "  token   — Print just the token (for scripting)"
    exit 1
    ;;
esac
