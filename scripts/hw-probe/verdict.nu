# Pure verdict functions for the hw-probe suite.
#
# NOTHING in this module does I/O or shells out. Every function takes already-
# collected data (log lines, RSS samples, luminance means, ps rows) and returns
# a verdict record. That separation is deliberate: these are the functions whose
# thresholds and invariants the mutation-check guards, and `selftest.nu` drives
# them with fixtures so they run in CI with only nushell present — no running
# app, GPU, ImageMagick, or compositor required.
#
# The live I/O that feeds these (screen capture, /proc sampling, ffmpeg ground
# truth, xprop/wmctrl) lives in `lib.nu` and the entry scripts.

# --- Log invariant markers (grounded in real src-tauri log strings) ---
# Verified against src-tauri/src/player/{linux_compositor,events,commands}.rs.
export const MARK_DMABUF = "WebKit DMABUF renderer enabled"
export const MARK_COMPOSITOR = "[player:linux] compositor installed"
# Linux first-frame reveal (prexu-91t8): events.rs ARMS the compositor (it does
# NOT emit host-window-ready directly on Linux), the GLArea render handler FIRES
# it once ("first frame rendered after arm"), and a stale arm from an aborted
# load is DROPPED. Matching the bare "player://host-window-ready" over-matches
# frontend-receipt logs and the non-Linux emit path, so use the specific lines.
export const MARK_ARM = "first-frame reveal armed"
export const MARK_FIRE = "first frame rendered after arm"
export const MARK_DROP = "stale first-frame reveal arm dropped"
export const MARK_INSET_CLEAR = "clearing leftover minimize inset on enter"
# The applied sub-scale is logged by apply_video_margin_ratio (linux_compositor
# ~L730): "video-margin-ratio applied ... sub-scale=<f> sub-use-margins=<b>".
export const MARK_SUB_APPLIED = "video-margin-ratio applied"
# The Linux/WebKit path resolves EGL/GLX internally and only logs on failure; the
# definitive "native GL pipeline up" signal is the render-context creation line.
export const MARK_GL_CONTEXT = "mpv render context created (OpenGL backend)"

# Count log lines containing a substring.
export def count-matches [lines: list<string>, needle: string]: nothing -> int {
    $lines | where ($it | str contains $needle) | length
}

# Pre.2 — the WebKit DMABUF renderer must be enabled (not disabled at startup).
export def check-dmabuf [lines: list<string>]: nothing -> record {
    let n = (count-matches $lines $MARK_DMABUF)
    { name: "dmabuf-renderer", section: "Pre.2", status: (if $n >= 1 { "pass" } else { "fail" }), detail: $"($n) DMABUF-enabled lines" }
}

# Pre.3 — the native compositor installed (engine active).
export def check-compositor [lines: list<string>]: nothing -> record {
    let n = (count-matches $lines $MARK_COMPOSITOR)
    { name: "compositor-installed", section: "Pre.3", status: (if $n >= 1 { "pass" } else { "fail" }), detail: $"($n) compositor-installed lines" }
}

# F.1/Pre.4 — the native GL render pipeline came up (mpv OpenGL render context
# created). On Linux/WebKit the EGL/GLX resolver is silent on success, so this
# render-context line is the real "engine active" signal.
export def check-gl-resolver [lines: list<string>]: nothing -> record {
    let n = (count-matches $lines $MARK_GL_CONTEXT)
    { name: "gl-render-context", section: "F.1/Pre", status: (if $n >= 1 { "pass" } else { "fail" }), detail: $"render-context-created lines=($n)" }
}

# A.1/A.2/A.3 — first-frame reveal invariant. Each armed reveal is resolved
# exactly once, by either a FIRE (rendered) or a DROP (stale arm from an aborted
# load). The reveal must NOT fire without a live arm — that is the seek-re-emit
# bug (A.3). And a new load must not re-arm before the previous arm resolved. A
# single still-pending arm at end-of-log (capture ended mid-load) is fine.
export def check-first-frame-pairing [lines: list<string>]: nothing -> record {
    mut arms = 0
    mut fires = 0
    mut drops = 0
    mut pending = false
    mut violations = []
    for line in $lines {
        if ($line | str contains $MARK_ARM) {
            if $pending {
                $violations = ($violations | append "re-arm before previous reveal resolved")
            }
            $arms = $arms + 1
            $pending = true
        } else if ($line | str contains $MARK_FIRE) {
            $fires = $fires + 1
            if not $pending {
                $violations = ($violations | append "reveal fired without a live arm (seek re-emit?)")
            }
            $pending = false
        } else if ($line | str contains $MARK_DROP) {
            $drops = $drops + 1
            $pending = false
        }
    }
    let ok = ($violations | is-empty) and ($arms >= 1)
    let why = if ($arms == 0) { "no load cycles observed" } else { ($violations | str join "; ") }
    { name: "first-frame-pairing", section: "A.1-A.3", status: (if $ok { "pass" } else { "fail" }), detail: $"arms=($arms) fires=($fires) drops=($drops) ($why)" }
}

# E.5 — entering popout from a minimized state clears the leftover inset.
# `--required` is set by the caller when the minimize->popout scenario was
# actually exercised; otherwise absence is a skip, not a failure.
export def check-inset-clear [lines: list<string>, --required]: nothing -> record {
    let n = (count-matches $lines $MARK_INSET_CLEAR)
    let status = if $n >= 1 { "pass" } else if $required { "fail" } else { "skip" }
    { name: "popout-inset-clear", section: "E.5", status: $status, detail: $"($n) inset-clear lines" }
}

# B.2-B.5 — applied sub-scale values must stay in (0, 1]. Reads the committed
# "video-margin-ratio applied ... sub-scale=<f> sub-use-margins=<b>" debug line.
# Skips (does not fail) when no such lines are present (subs never exercised).
export def check-sub-scale [lines: list<string>]: nothing -> record {
    let applied = ($lines | where { |l| ($l | str contains $MARK_SUB_APPLIED) and ($l | str contains "sub-scale=") })
    if ($applied | is-empty) {
        return { name: "sub-scale-values", section: "B.2-B.5", status: "skip", detail: "no sub-scale lines (subs not exercised)" }
    }
    let vals = (
        $applied
        | each { |l| $l | parse --regex 'sub-scale=(?<s>[0-9.]+)' | get s?.0? }
        | compact
        | into float
    )
    let bad = ($vals | where { |v| $v <= 0.0 or $v > 1.0 })
    { name: "sub-scale-values", section: "B.2-B.5", status: (if ($bad | is-empty) { "pass" } else { "fail" }), detail: $"n=($vals | length) out-of-range=($bad | length)" }
}

# B.4 — use-margins pairs with the "not minimized" state. Ground truth is
# `sub_compensation` (linux_compositor.rs ~L375): zero margin ratios (left,
# right, top, bottom all 0.0 — "not minimized / cleared") return
# `sub-use-margins=true`; any non-zero margin combination returns `false`.
# Reads the same "video-margin-ratio applied left=<f> right=<f> top=<f>
# bottom=<f> sub-scale=<f> sub-use-margins=<bool>" line as check-sub-scale, but
# pairs the margins against the boolean instead of range-checking sub-scale.
# Skips (does not fail) when no such lines are present (subs never exercised).
export def check-sub-use-margins [lines: list<string>]: nothing -> record {
    let applied = ($lines | where { |l| ($l | str contains $MARK_SUB_APPLIED) and ($l | str contains "sub-use-margins=") })
    if ($applied | is-empty) {
        return { name: "sub-use-margins", section: "B.4", status: "skip", detail: "no sub-use-margins lines (subs not exercised)" }
    }
    let rows = (
        $applied
        | each { |l|
            $l | parse --regex 'left=(?<left>[0-9.]+)\s+right=(?<right>[0-9.]+)\s+top=(?<top>[0-9.]+)\s+bottom=(?<bottom>[0-9.]+)\s+sub-scale=(?<scale>[0-9.]+)\s+sub-use-margins=(?<um>true|false)'
            | get 0?
        }
        | compact
    )
    let mismatched = (
        $rows
        | where { |r|
            let zero = (($r.left | into float) == 0.0 and ($r.right | into float) == 0.0 and ($r.top | into float) == 0.0 and ($r.bottom | into float) == 0.0)
            let um = ($r.um == "true")
            $zero != $um
        }
    )
    { name: "sub-use-margins", section: "B.4", status: (if ($mismatched | is-empty) { "pass" } else { "fail" }), detail: $"n=($rows | length) mismatched=($mismatched | length)" }
}

# --- Luminance classification (A/D/F visual-state detection) ---

# Classify a captured frame from its per-channel means (each 0..1) into the
# visual state it represents. navy = dark AND blue-dominant (the #000080 stage);
# black = near-zero everywhere; content = anything brighter/balanced.
export def classify-luminance [
    gray: float
    r: float
    g: float
    b: float
    --black-max: float = 0.02
    --navy-max-gray: float = 0.15
    --navy-blue-dom: float = 0.10
]: nothing -> string {
    if $gray <= $black_max {
        "black"
    } else if ($gray <= $navy_max_gray) and (($b - ([$r $g] | math max)) >= $navy_blue_dom) {
        "navy"
    } else {
        "content"
    }
}

# A/D — a stop/minimize/restore transition is clean only if no sampled frame is
# a navy stage or an (unexpected) black frame. `samples` are classify-luminance
# results across the transition.
export def transition-verdict [samples: list<string>]: nothing -> record {
    if ($samples | is-empty) {
        return { status: "skip", bad: 0, detail: "no samples" }
    }
    let bad = ($samples | where { |s| $s == "navy" or $s == "black" })
    { status: (if ($bad | is-empty) { "pass" } else { "fail" }), bad: ($bad | length), detail: $"samples=($samples | length) navy/black=($bad | length)" }
}

# --- System probe verdicts ---

# N.1 — flat RSS across a seek loop. `samples` are RSS in bytes, chronological.
export def rss-verdict [samples: list<int>, --max-growth-mb: float = 50.0]: nothing -> record {
    if ($samples | is-empty) {
        return { status: "skip", growth_mb: 0.0, peak_mb: 0.0, detail: "no samples" }
    }
    let baseline = ($samples | first)
    let peak = ($samples | math max)
    let growth = (($peak - $baseline) / 1024 / 1024 | math round --precision 2)
    { status: (if $growth <= $max_growth_mb { "pass" } else { "fail" }), growth_mb: $growth, peak_mb: ($peak / 1024 / 1024 | math round --precision 2), detail: $"baseline=($baseline / 1024 / 1024 | math round --precision 1)MB growth=($growth)MB" }
}

# N.3 — steady-state CPU during playback must stay under the pump-gate ceiling.
# `samples` are per-sample CPU percent.
export def cpu-verdict [samples: list<float>, --max-avg-pct: float = 15.0]: nothing -> record {
    if ($samples | is-empty) {
        return { status: "skip", avg_pct: 0.0, detail: "no samples" }
    }
    let avg = ($samples | math avg | math round --precision 1)
    { status: (if $avg <= $max_avg_pct { "pass" } else { "fail" }), avg_pct: $avg, detail: $"avg=($avg)% over ($samples | length) samples" }
}

# N.2 — first-play latency (ms from load command to first-frame-ready).
export def timing-verdict [ms: int, --max-ms: int = 3000]: nothing -> record {
    { status: (if $ms <= $max_ms { "pass" } else { "fail" }), ms: $ms, detail: $"first-play=($ms)ms ceiling=($max_ms)ms" }
}

# G.2 — no zombie/defunct app or mpv process after exit. `ps_rows` are records
# with {pid, stat, comm}.
export def zombie-verdict [ps_rows: list<record>, --names: list<string> = [prexu mpv]]: nothing -> record {
    let zombies = (
        $ps_rows
        | where { |r| ($r.stat | str contains "Z") and ($names | any { |n| $r.comm | str contains $n }) }
    )
    { status: (if ($zombies | is-empty) { "pass" } else { "fail" }), zombies: ($zombies | length), detail: (if ($zombies | is-empty) { "no zombies" } else { $zombies | each { |z| $"($z.comm)/($z.pid)" } | str join "," }) }
}

# --- X11 geometry probe parsers (live execution is X11-only; parsing is pure
# and CI-tested here so the geometry logic is covered even on a Wayland box) ---

# Parse a `wmctrl -lG` row: `wid desktop x y w h host title`.
export def parse-wmctrl-geometry [line: string]: nothing -> record {
    let m = ($line | parse --regex '^(?<wid>0x[0-9a-fA-F]+)\s+(?<desk>-?\d+)\s+(?<x>-?\d+)\s+(?<y>-?\d+)\s+(?<w>\d+)\s+(?<h>\d+)\s+(?<host>\S+)\s+(?<title>.*)$')
    if ($m | is-empty) { return {} }
    let r = ($m | first)
    { wid: $r.wid, x: ($r.x | into int), y: ($r.y | into int), w: ($r.w | into int), h: ($r.h | into int), title: $r.title }
}

# E.2 — which screen corner a WxH+X+Y window snaps to, within `tolerance` px.
export def nearest-corner [
    x: int, y: int, w: int, h: int, screen_w: int, screen_h: int
    --tolerance: int = 8
]: nothing -> record {
    let left = ($x <= $tolerance)
    let right = (($screen_w - ($x + $w)) <= $tolerance)
    let top = ($y <= $tolerance)
    let bottom = (($screen_h - ($y + $h)) <= $tolerance)
    let vert = if $top { "top" } else if $bottom { "bottom" } else { "mid" }
    let horiz = if $left { "left" } else if $right { "right" } else { "mid" }
    { corner: $"($vert)-($horiz)", snapped: (($vert != "mid") and ($horiz != "mid")) }
}

# E.4 — geometry drift between two capture points; exact restore = 0 px.
export def geometry-drift [a: record, b: record]: nothing -> record {
    let dx = (($a.x - $b.x) | math abs)
    let dy = (($a.y - $b.y) | math abs)
    let dw = (($a.w - $b.w) | math abs)
    let dh = (($a.h - $b.h) | math abs)
    let drift = ([$dx $dy $dw $dh] | math max)
    { status: (if $drift == 0 { "pass" } else { "fail" }), drift_px: $drift, detail: $"dx=($dx) dy=($dy) dw=($dw) dh=($dh)" }
}

# G.4 — fullscreen state present in an xprop _NET_WM_STATE dump.
export def parse-fullscreen-state [xprop_output: string]: nothing -> bool {
    $xprop_output | str contains "_NET_WM_STATE_FULLSCREEN"
}

# G.1 — minimize/restore stress must not deadlock. `heartbeats_ms` are the
# chronological timestamps of liveness signals; a gap over the watchdog window
# means the app hung.
export def deadlock-verdict [heartbeats_ms: list<int>, --watchdog-ms: int = 5000]: nothing -> record {
    if (($heartbeats_ms | length) < 2) {
        return { status: "skip", max_gap_ms: 0, detail: "insufficient heartbeats" }
    }
    let gaps = ($heartbeats_ms | window 2 | each { |w| ($w | last) - ($w | first) })
    let maxgap = ($gaps | math max)
    { status: (if $maxgap <= $watchdog_ms { "pass" } else { "fail" }), max_gap_ms: $maxgap, detail: $"max heartbeat gap=($maxgap)ms watchdog=($watchdog_ms)ms" }
}

# --- E.3/G.3 X11 click-sweep (coordinate math is pure and CI-tested here; the
# live xdotool/process I/O that feeds it lives in lib.nu/probes.nu) ---

# E.3/G.3 — click-sweep target points across a window: 4 corners, 4 edge
# midpoints, and the interior center (9 points), inset by `inset` px so
# xdotool doesn't land exactly on a WM resize-grip hairline. Pure coordinate
# math so the point set is unit-tested without a live X11 session.
export def sweep-points [win: record, --inset: int = 4]: nothing -> list<record> {
    let left = $win.x + $inset
    let right = $win.x + $win.w - $inset
    let top = $win.y + $inset
    let bottom = $win.y + $win.h - $inset
    let midx = $win.x + ($win.w // 2)
    let midy = $win.y + ($win.h // 2)
    [
        { x: $left, y: $top }
        { x: $midx, y: $top }
        { x: $right, y: $top }
        { x: $left, y: $midy }
        { x: $midx, y: $midy }
        { x: $right, y: $midy }
        { x: $left, y: $bottom }
        { x: $midx, y: $bottom }
        { x: $right, y: $bottom }
    ]
}

# E.3 — edge drag-resize vectors: for each of the 4 edges, a `{from, to}` drag
# starting just inside the edge (grabbing the WM resize grip) and moving
# `delta` px outward — the axj4.3 click-crash class was a resize-grab race, so
# this exercises all four grips. Pure coordinate math; unit-tested without a
# live X11 session.
export def edge-drag-vectors [win: record, --inset: int = 2, --delta: int = 20]: nothing -> list<record> {
    let midx = $win.x + ($win.w // 2)
    let midy = $win.y + ($win.h // 2)
    [
        { edge: "top", from: { x: $midx, y: ($win.y + $inset) }, to: { x: $midx, y: ($win.y - $delta) } }
        { edge: "bottom", from: { x: $midx, y: ($win.y + $win.h - $inset) }, to: { x: $midx, y: ($win.y + $win.h + $delta) } }
        { edge: "left", from: { x: ($win.x + $inset), y: $midy }, to: { x: ($win.x - $delta), y: $midy } }
        { edge: "right", from: { x: ($win.x + $win.w - $inset), y: $midy }, to: { x: ($win.x + $win.w + $delta), y: $midy } }
    ]
}

# E.3/G.3 — click-sweep process liveness: the app pid observed before the
# sweep must still be present in the post-sweep pid list, with no zombie/
# defunct process for it. A click/drag storm across the window (axj4.3
# click-crash class) must not crash or hang the app. Reuses zombie-verdict's
# zombie scan for the "no defunct process" half instead of re-deriving it.
export def click-sweep-liveness-verdict [
    pid: int
    running_after: list<int>
    ps_rows: list<record>
]: nothing -> record {
    if $pid == 0 {
        return { status: "skip", detail: "no app pid observed before sweep" }
    }
    let alive = ($running_after | any { |p| $p == $pid })
    let zv = (zombie-verdict $ps_rows)
    let status = if ($alive and $zv.status == "pass") { "pass" } else { "fail" }
    let detail = if not $alive {
        $"app pid ($pid) not found after click sweep — crashed or exited"
    } else if $zv.status != "pass" {
        $"app alive but zombie present: ($zv.detail)"
    } else {
        $"app pid ($pid) alive after sweep, ($zv.detail)"
    }
    { status: $status, detail: $detail }
}
