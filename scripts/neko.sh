#!/usr/bin/env bash
# Control script for Neko Dream Office: start | stop | status | uninstall
# Used by the /neko-start, /neko-stop, /neko-uninstall Claude Code commands.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${NEKO_PORT:-4777}"
URL="http://127.0.0.1:${PORT}"
RUN="${XDG_CACHE_HOME:-$HOME/.cache}/neko-dream-office"
PIDFILE="$RUN/server.pid"
LOG="$RUN/server.log"
mkdir -p "$RUN"

healthy() { curl -s -m 1 "$URL/api/health" 2>/dev/null | grep -q '"ok":true'; }

server_pid() {
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && grep -q "server/index.js" "/proc/$pid/cmdline" 2>/dev/null; then
    echo "$pid"; return
  fi
  # fall back to whoever owns the port, if it is our server
  pid="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
  if [[ -n "$pid" ]] && grep -q "server/index.js" "/proc/$pid/cmdline" 2>/dev/null; then echo "$pid"; fi
}

hooks_installed() { node "$DIR/scripts/install-hooks.js" status | grep -q '^installed'; }

start() {
  local open=1
  [[ "${1:-}" == "--no-open" ]] && open=0
  if healthy; then
    echo "already running: $URL (pid $(server_pid || echo '?'))"
  else
    [[ -d "$DIR/node_modules" ]] || (cd "$DIR" && npm install --no-audit --no-fund >/dev/null)
    [[ -f "$DIR/web/dist/index.html" ]] || (cd "$DIR" && npx vite build >/dev/null)
    (cd "$DIR" && setsid nohup node server/index.js >"$LOG" 2>&1 < /dev/null & echo $! >"$PIDFILE")
    for _ in $(seq 1 30); do healthy && break; sleep 0.2; done
    if healthy; then
      rm -f "$PIDFILE"; server_pid >"$PIDFILE"   # setsid forks, so record the real node pid
      echo "started: $URL (pid $(cat "$PIDFILE"))"
    else echo "failed to start — see $LOG"; tail -5 "$LOG"; exit 1; fi
  fi
  if hooks_installed; then echo "hooks: installed"
  else echo "hooks: not installed -> installing"; node "$DIR/scripts/install-hooks.js" install; fi
  if (( open )); then (xdg-open "$URL" >/dev/null 2>&1 &) && echo "opened browser"; fi
}

stop() {
  local pid
  pid="$(server_pid || true)"
  if [[ -z "$pid" ]]; then echo "not running"; rm -f "$PIDFILE"; return; fi
  kill "$pid"
  for _ in $(seq 1 15); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid"
  rm -f "$PIDFILE"
  echo "stopped (pid $pid)"
}

status() {
  if healthy; then echo "server: running $URL (pid $(server_pid || echo '?')) $(curl -s -m 1 "$URL/api/health")"
  else echo "server: not running"; fi
  node "$DIR/scripts/install-hooks.js" status | sed -n '2p'
}

uninstall() {
  stop
  node "$DIR/scripts/install-hooks.js" uninstall
  rm -rf "$RUN"
  echo "project files kept at $DIR (delete manually if you no longer want them)"
}

case "${1:-status}" in
  start) shift; start "$@" ;;
  stop) stop ;;
  status) status ;;
  uninstall) uninstall ;;
  *) echo "usage: neko.sh start [--no-open] | stop | status | uninstall"; exit 2 ;;
esac
