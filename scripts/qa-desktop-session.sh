#!/usr/bin/env bash
# Start a desktop session for Prexu that accepts automated input (xdotool) and screenshots.
#
# Mirrors daneo's scripts/qa-desktop-session.sh. The X server is Xephyr nested in the host
# desktop when one answers (KWin gates XTEST on the real display behind a Remote Control
# prompt no agent can answer), and Xvfb on a headless host such as bd-server, where the
# Paperclip agents run. Either way input and capture are clients of $QA_DISPLAY only.
#
#   scripts/qa-desktop-session.sh start    # vite + X server + debug app (idempotent)
#   scripts/qa-desktop-session.sh status   # show display, window id
#   scripts/qa-desktop-session.sh fit      # resize the app window to fill the screen
#   scripts/qa-desktop-session.sh shot FILE# screenshot the app window (--root for the screen)
#   scripts/qa-desktop-session.sh stop     # stop the app, X server and vite
#
# Driving the app once it is up:
#   export DISPLAY=:8; unset XAUTHORITY WAYLAND_DISPLAY
#   xdotool mousemove X Y click 1
#   import -window root /tmp/shot.png
#
# Rendering: do NOT set WEBKIT_DISABLE_DMABUF_RENDERER here. The native player's compositor
# (player::linux_compositor) needs WebKit's DMABUF renderer for its transparent webview, and
# with it disabled the whole window captures solid black under Xvfb (measured 2026-10-19 on
# bd-server; with the default renderer the UI and "compositor installed" both come up).
# GL runs on Mesa llvmpipe (no GPU behind Xvfb), so mpv playback is software-rendered.
# PREXU_STOCK_WEBVIEW=1 skips the compositor (browsing only, playback falls back to HTML5).
#
# Build first: `cd src-tauri && cargo build` (the debug binary loads devUrl, so no
# `npm run build` is needed for this script).

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA_DISPLAY="${QA_DISPLAY:-:8}"
QA_GEOMETRY="${QA_GEOMETRY:-1600x1000}"
QA_FIT_WINDOW="${QA_FIT_WINDOW:-1}"
QA_XSERVER="${QA_XSERVER:-auto}"
VITE_PORT="${VITE_PORT:-1420}"
RUNDIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/prexu-qa"
mkdir -p "$RUNDIR"

APP_BIN="$REPO/src-tauri/target/debug/prexu"

nested() { env -u XAUTHORITY -u WAYLAND_DISPLAY DISPLAY="$QA_DISPLAY" "$@"; }

host_xauth() { ls "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"/xauth_* 2>/dev/null | head -1; }

host_display_up() { local xa; xa="$(host_xauth)"; [ -n "$xa" ] && DISPLAY=:0 XAUTHORITY="$xa" xdpyinfo >/dev/null 2>&1; }

xserver_kind() {
  case "$QA_XSERVER" in
    xephyr|xvfb) echo "$QA_XSERVER" ;;
    *) host_display_up && echo xephyr || echo xvfb ;;
  esac
}

vite_up() { curl -sf -o /dev/null "http://localhost:$VITE_PORT/"; }

xserver_up() { nested xdpyinfo >/dev/null 2>&1; }

# Tauri creates an unnamed-looking helper window called "prexu" too; the app window is "Prexu".
app_window() { nested xdotool search --name '^Prexu$' 2>/dev/null | tail -1; }

screen_size() { nested xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2; exit}'; }

start_vite() {
  if vite_up; then echo "vite: already on :$VITE_PORT"; return 0; fi
  ( cd "$REPO" && setsid nohup npm run dev >"$RUNDIR/vite.log" 2>&1 </dev/null & )
  for _ in $(seq 1 40); do vite_up && { echo "vite: started on :$VITE_PORT"; return 0; }; sleep 0.5; done
  echo "vite: FAILED to come up -- see $RUNDIR/vite.log" >&2; return 1
}

start_xserver() {
  if xserver_up; then echo "xserver: $QA_DISPLAY already running"; return 0; fi
  KIND="$(xserver_kind)"
  # -ac drops access control so the app and xdotool connect without an auth file.
  # Xephyr is nested inside the host session and Xvfb gets -nolisten tcp, so neither
  # is reachable off-box.
  if [ "$KIND" = xephyr ]; then
    DISPLAY=:0 XAUTHORITY="$(host_xauth)" \
      setsid nohup Xephyr "$QA_DISPLAY" -screen "$QA_GEOMETRY" -ac -resizeable \
        -title "Prexu QA nested session" >"$RUNDIR/xephyr.log" 2>&1 </dev/null &
  else
    setsid nohup Xvfb "$QA_DISPLAY" -screen 0 "${QA_GEOMETRY}x24" -ac -nolisten tcp \
      >"$RUNDIR/xvfb.log" 2>&1 </dev/null &
  fi
  for _ in $(seq 1 30); do xserver_up && { echo "xserver: $KIND $QA_DISPLAY up ($QA_GEOMETRY)"; return 0; }; sleep 0.5; done
  echo "xserver: FAILED to come up -- see $RUNDIR/$KIND.log" >&2; return 1
}

fit_window() {
  WID="${1:-$(app_window)}"
  [ -n "$WID" ] || { echo "fit: no app window on $QA_DISPLAY" >&2; return 1; }
  DIM="$(screen_size)"; [ -n "$DIM" ] || DIM="$QA_GEOMETRY"
  W="${DIM%x*}"; H="${DIM#*x}"
  nested xdotool windowmove "$WID" 0 0 windowsize "$WID" "$W" "$H" || return 1
  sleep 0.5
  echo "fit: window $WID resized to ${W}x${H}"
}

start_app() {
  if [ -n "$(app_window)" ]; then echo "app: already running on $QA_DISPLAY"; return 0; fi
  [ -x "$APP_BIN" ] || { echo "app: $APP_BIN missing -- run cargo build in src-tauri first" >&2; return 1; }
  ( cd "$REPO" && env -u WAYLAND_DISPLAY -u XAUTHORITY \
      DISPLAY="$QA_DISPLAY" GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
      setsid nohup "$APP_BIN" >"$RUNDIR/app.log" 2>&1 </dev/null & )
  for _ in $(seq 1 60); do
    WID="$(app_window)"
    if [ -n "$WID" ]; then
      nested xdotool windowfocus "$WID"
      echo "app: window $WID focused on $QA_DISPLAY"
      [ "$QA_FIT_WINDOW" = "1" ] && fit_window "$WID"
      return 0
    fi
    sleep 1
  done
  echo "app: window never appeared -- see $RUNDIR/app.log" >&2; return 1
}

case "${1:-start}" in
  start)
    start_vite && start_xserver && start_app || exit 1
    echo
    echo "Ready. Drive it with:  export DISPLAY=$QA_DISPLAY; unset XAUTHORITY WAYLAND_DISPLAY"
    echo "Logs: $RUNDIR/{vite,$(xserver_kind),app}.log"
    ;;
  status)
    vite_up && echo "vite:    up on :$VITE_PORT" || echo "vite:    down"
    xserver_up && echo "xserver: up on $QA_DISPLAY" || echo "xserver: down"
    WID="$(app_window)"
    [ -n "$WID" ] && echo "app:     window $WID" || echo "app:     down"
    ;;
  fit)
    fit_window || exit 1
    ;;
  shot)
    TARGET=root
    if [ "${2:-}" = "--root" ]; then shift; else TARGET="$(app_window)"; [ -n "$TARGET" ] || TARGET=root; fi
    OUT="${2:-$RUNDIR/shot.png}"
    nested import -window "$TARGET" "$OUT" && echo "wrote $OUT (window $TARGET)"
    ;;
  stop)
    pkill -f "$APP_BIN" 2>/dev/null   # the debug binary only, never an installed Prexu
    pkill -f "Xephyr $QA_DISPLAY" 2>/dev/null
    pkill -f "Xvfb $QA_DISPLAY" 2>/dev/null
    pkill -f "$REPO/node_modules/.bin/vite" 2>/dev/null
    echo "stopped app, $QA_DISPLAY and vite"
    ;;
  *)
    echo "usage: $0 {start|status|fit|shot [--root] [FILE]|stop}" >&2; exit 2
    ;;
esac
