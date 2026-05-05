#!/usr/bin/env bash
set -euo pipefail

WAHA_URL="${WAHA_URL:-http://127.0.0.1:3001}"
WAHA_API_KEY_FILE="${WAHA_API_KEY_FILE:-/var/lib/waha/api-key}"
TMUX_TARGET="${TMUX_TARGET:-}"
CAPTURE_LINES="${CAPTURE_LINES:-160}"
START_TMUX="${START_TMUX:-0}"
SMOKE_SESSION="${SMOKE_SESSION:-waha-tui-smoke-$$}"
STARTUP_DELAY="${STARTUP_DELAY:-4}"
GALLERY_CHECK="${GALLERY_CHECK:-0}"
STRICT_SYSTEMD="${STRICT_SYSTEMD:-0}"
SYSTEMD_FAILED_PATTERN="${SYSTEMD_FAILED_PATTERN:-waha|whatsapp|cloudflared.*whatsapp}"

failures=0
started_session=""

cleanup() {
  if [ -n "$started_session" ]; then
    tmux kill-session -t "$started_session" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

note() {
  printf '[smoke] %s\n' "$*"
}

pass() {
  printf '[pass] %s\n' "$*"
}

fail() {
  printf '[fail] %s\n' "$*" >&2
  failures=$((failures + 1))
}

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "found $1: $(command -v "$1")"
  else
    fail "missing command: $1"
  fi
}

http_status() {
  local path="$1"
  local api_key="$2"

  curl -fsS -o /tmp/waha-tui-smoke-response.json -w '%{http_code}' \
    -H "X-Api-Key: $api_key" \
    "$WAHA_URL$path"
}

find_waha_pane() {
  local target pid

  while IFS='|' read -r target pid _command _title; do
    if process_tree_has_waha_tui "$pid"; then
      printf '%s\n' "$target"
      return 0
    fi
  done < <(tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}|#{pane_pid}|#{pane_current_command}|#{pane_title}' 2>/dev/null)
}

process_tree_has_waha_tui() {
  local root_pid="$1"
  local queue=("$root_pid")
  local pid args child

  while [ "${#queue[@]}" -gt 0 ]; do
    pid="${queue[0]}"
    queue=("${queue[@]:1}")
    args="$(ps -o args= -p "$pid" 2>/dev/null || true)"
    if printf '%s\n' "$args" | grep -Eq '(^|/|[[:space:]])waha-tui($|[[:space:]])'; then
      return 0
    fi
    while read -r child; do
      [ -n "$child" ] && queue+=("$child")
    done < <(pgrep -P "$pid" 2>/dev/null || true)
  done

  return 1
}

scan_capture() {
  local capture_file="$1"

  if grep -Eiq '(^|[^[:alpha:]])(error|exception):|Unhandled(PromiseRejection| rejection)|TypeError|ReferenceError|SyntaxError|RangeError|stack trace' "$capture_file"; then
    fail "tmux capture contains error or stack-trace text"
  else
    pass "tmux capture has no obvious stack-trace text"
  fi

  if grep -Eiq 'bun (run )?(build|test|x tsc)|tsc --noEmit|eslint|TypeScript|node_modules/.bin|dist/index.js' "$capture_file"; then
    fail "tmux capture contains build/test output instead of only TUI output"
  else
    pass "tmux capture has no obvious build/test output"
  fi

  if grep -Eiq 'Gallery|Images|No image messages|Open media|Recent images' "$capture_file"; then
    pass "tmux capture includes gallery/media wording"
  else
    note "tmux capture does not prove gallery view; navigate an existing TUI to gallery and rerun with TMUX_TARGET=session:window.pane"
  fi
}

note "checking local commands"
need_cmd curl
need_cmd tmux
need_cmd waha-tui
need_cmd waha-tui-tmux

note "checking WAHA API at $WAHA_URL"
if [ -r "$WAHA_API_KEY_FILE" ]; then
  api_key="$(tr -d '\r\n' < "$WAHA_API_KEY_FILE")"
  if [ -n "$api_key" ]; then
    status="$(http_status /api/server/version "$api_key" || true)"
    if [ "$status" = "200" ]; then
      pass "GET /api/server/version returned HTTP 200"
    else
      fail "GET /api/server/version returned HTTP ${status:-curl-failed}"
    fi

    status="$(http_status /api/sessions "$api_key" || true)"
    if [ "$status" = "200" ]; then
      pass "GET /api/sessions returned HTTP 200"
    else
      fail "GET /api/sessions returned HTTP ${status:-curl-failed}"
    fi
  else
    fail "WAHA API key file is empty: $WAHA_API_KEY_FILE"
  fi
else
  fail "WAHA API key file is not readable: $WAHA_API_KEY_FILE"
fi

note "checking tmux"
if tmux list-sessions >/dev/null 2>&1; then
  pass "tmux server is running"
  if [ -z "$TMUX_TARGET" ]; then
    TMUX_TARGET="$(find_waha_pane || true)"
  fi

  if [ -n "$TMUX_TARGET" ]; then
    pass "using tmux target $TMUX_TARGET"
    capture_file="$(mktemp)"
    tmux capture-pane -pt "$TMUX_TARGET" -S "-$CAPTURE_LINES" > "$capture_file"
    scan_capture "$capture_file"
    rm -f "$capture_file"
  else
    if [ "$START_TMUX" = "1" ]; then
      note "starting temporary tmux session $SMOKE_SESSION"
      tmux new-session -d -s "$SMOKE_SESSION" 'waha-tui'
      started_session="$SMOKE_SESSION"
      sleep "$STARTUP_DELAY"
      TMUX_TARGET="$SMOKE_SESSION:0.0"
      pass "using temporary tmux target $TMUX_TARGET"
      capture_file="$(mktemp)"
      if [ "$GALLERY_CHECK" = "1" ]; then
        tmux send-keys -t "$TMUX_TARGET" g
        sleep 1
      fi
      tmux capture-pane -pt "$TMUX_TARGET" -S "-$CAPTURE_LINES" > "$capture_file"
      scan_capture "$capture_file"
      rm -f "$capture_file"
    else
      fail "no tmux pane with a live waha-tui process tree; set TMUX_TARGET=session:window.pane or START_TMUX=1"
    fi
  fi
else
  fail "tmux server is not running"
fi

systemctl --no-pager --failed --plain | awk '$2 == "loaded" && $3 == "failed" { print }' >/tmp/waha-tui-smoke-failed-units.txt || true
if [ -s /tmp/waha-tui-smoke-failed-units.txt ]; then
  if grep -Eiq "$SYSTEMD_FAILED_PATTERN" /tmp/waha-tui-smoke-failed-units.txt; then
    fail "systemd reports failed WAHA/TUI-related units; see: systemctl --no-pager --failed"
    grep -Ei "$SYSTEMD_FAILED_PATTERN" /tmp/waha-tui-smoke-failed-units.txt | sed 's/^/[fail] failed unit: /' >&2
  elif [ "$STRICT_SYSTEMD" = "1" ]; then
    fail "systemd reports failed units; see: systemctl --no-pager --failed"
    sed 's/^/[fail] failed unit: /' /tmp/waha-tui-smoke-failed-units.txt >&2
  else
    pass "systemd reports no WAHA/TUI-related failed units"
    sed 's/^/[warn] unrelated failed unit: /' /tmp/waha-tui-smoke-failed-units.txt >&2
  fi
else
  pass "systemd reports no failed units"
fi

if [ "$failures" -eq 0 ]; then
  note "live smoke check passed"
else
  note "live smoke check failed with $failures problem(s)"
fi

exit "$failures"
