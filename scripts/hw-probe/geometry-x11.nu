#!/usr/bin/env nu
# X11 geometry/state probes (W2, plan sections E.2/E.4, G.4).
#
# These need per-window geometry, which only X11 exposes for the native player
# surface — on Wayland/KDE the mpv surface has no addressable geometry API, so
# these SKIP (that is why the plan says "Wayland runs get log+luminance only").
# The parsing/verdict logic (parse-wmctrl-geometry, nearest-corner,
# geometry-drift, parse-fullscreen-state) lives in verdict.nu and IS unit-tested
# in selftest.nu, so this file stays a thin live wrapper.
#
#   nu scripts/hw-probe/geometry-x11.nu corner --screen-w 1920 --screen-h 1080  # E.2 popout snaps to a corner
#   nu scripts/hw-probe/geometry-x11.nu fullscreen                               # G.4 _NET_WM_STATE_FULLSCREEN
#   nu scripts/hw-probe/geometry-x11.nu snapshot --out before.json              # capture geometry
#   nu scripts/hw-probe/geometry-x11.nu drift --before before.json --after after.json  # E.4 exact restore

use verdict.nu *
use lib.nu *

def require-x11 []: nothing -> bool {
    let s = (hw-session)
    if $s.type != "x11" {
        print $"(ansi yellow)SKIP(ansi reset) geometry: X11 session required — this is ($s.type); the native surface has no Wayland per-window geometry API"
        false
    } else if not (have wmctrl) {
        print $"(ansi yellow)SKIP(ansi reset) geometry: wmctrl not installed"
        false
    } else {
        true
    }
}

def find-window [name: string]: nothing -> record {
    let rows = (
        ^wmctrl -lG
        | lines
        | each { |l| parse-wmctrl-geometry $l }
        | where { |r| ($r | is-not-empty) }
    )
    let match = ($rows | where { |r| ($r.title | str downcase | str contains ($name | str downcase)) })
    if ($match | is-empty) { {} } else { $match | first }
}

# Primary screen dims via xrandr; {0,0} if unavailable.
def screen-dims []: nothing -> record {
    if not (have xrandr) { return { w: 0, h: 0 } }
    let line = (do { ^xrandr } | complete | get stdout | lines | where ($it | str contains "*") | first?)
    if ($line | is-empty) { return { w: 0, h: 0 } }
    let m = ($line | parse --regex '(?<w>\d+)x(?<h>\d+)')
    if ($m | is-empty) { { w: 0, h: 0 } } else { { w: ($m.w.0 | into int), h: ($m.h.0 | into int) } }
}

def main [] {
    print "usage: geometry-x11.nu (corner | fullscreen | snapshot | drift) [flags]"
    exit 2
}

# E.2 — popout window snaps to a screen corner.
def "main corner" [--name: string = "Prexu", --screen-w: int = 0, --screen-h: int = 0, --tolerance: int = 8] {
    if not (require-x11) { return }
    let win = (find-window $name)
    if ($win | is-empty) { print $"(ansi yellow)SKIP(ansi reset) geometry: no window matching ($name)"; return }
    let dims = (screen-dims)
    let sw = if $screen_w > 0 { $screen_w } else { $dims.w }
    let sh = if $screen_h > 0 { $screen_h } else { $dims.h }
    if $sw == 0 or $sh == 0 { print $"(ansi yellow)SKIP(ansi reset) geometry: screen dims unknown; pass --screen-w/--screen-h"; return }
    let c = (nearest-corner $win.x $win.y $win.w $win.h $sw $sh --tolerance $tolerance)
    let status = if $c.snapped { "pass" } else { "fail" }
    print $"corner: (fmt-status $status) — ($win.w)x($win.h)+($win.x)+($win.y) nearest ($c.corner) snapped=($c.snapped)"
    if $status == "fail" { exit 1 }
}

# G.4 — fullscreen state.
def "main fullscreen" [--name: string = "Prexu"] {
    if not (require-x11) { return }
    let win = (find-window $name)
    if ($win | is-empty) { print $"(ansi yellow)SKIP(ansi reset) geometry: no window matching ($name)"; return }
    let xp = (do { ^xprop -id $win.wid _NET_WM_STATE } | complete | get stdout)
    print $"fullscreen: (parse-fullscreen-state $xp)"
}

# Capture current geometry to stdout or a file (for a before/after drift check).
def "main snapshot" [--name: string = "Prexu", --out: string = ""] {
    if not (require-x11) { return }
    let win = (find-window $name)
    if ($win | is-empty) { print $"(ansi yellow)SKIP(ansi reset) geometry: no window matching ($name)"; return }
    let geo = { x: $win.x, y: $win.y, w: $win.w, h: $win.h }
    if ($out | is-empty) { print ($geo | to json) } else { $geo | to json | save -f $out; print $"saved ($out)" }
}

# E.4 — exit restores exact geometry (zero drift between two snapshots).
def "main drift" [--before: string, --after: string] {
    if ($before | is-empty) or ($after | is-empty) or (not ($before | path exists)) or (not ($after | path exists)) {
        print $"(ansi red)--before and --after snapshot files required(ansi reset)"
        exit 2
    }
    let v = (geometry-drift (open --raw $before | from json) (open --raw $after | from json))
    print $"drift: (fmt-status $v.status) — ($v.detail)"
    if $v.status == "fail" { exit 1 }
}
