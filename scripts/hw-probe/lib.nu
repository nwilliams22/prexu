# Live I/O helpers for the hw-probe suite.
#
# Everything here touches the real machine: the compositor, /proc, ImageMagick,
# ffmpeg, xprop/wmctrl, xdotool (key/mouse injection). The pure verdicts these
# feed live in `verdict.nu` and are tested in CI; this module is exercised on
# the Linux dev box against a running
# Prexu + real Plex server. Functions degrade gracefully (return "skip"/empty)
# when a prerequisite tool or the app is absent, so a partial run still reports.

use verdict.nu [parse-wmctrl-geometry]

# Default process name for the running app (Cargo bin `name = "prexu"`).
export const APP_NAME = "prexu"

# --- Environment / tooling ---

# Describe the current graphics session.
export def hw-session []: nothing -> record {
    let wl = ($env.WAYLAND_DISPLAY? | default "")
    let x = ($env.DISPLAY? | default "")
    let type = ($env.XDG_SESSION_TYPE? | default (if ($wl | is-not-empty) { "wayland" } else if ($x | is-not-empty) { "x11" } else { "unknown" }))
    { type: $type, wayland: $wl, display: $x, desktop: ($env.XDG_CURRENT_DESKTOP? | default "") }
}

# Is a CLI tool on PATH?
export def have [tool: string]: nothing -> bool {
    (which $tool | is-not-empty)
}

# Newest tauri-plugin-log file for the app (LogDir target, identifier
# com.prexu.client). Empty string if none found.
export def discover-log []: nothing -> string {
    let base = ($env.XDG_DATA_HOME? | default ($env.HOME | path join ".local" "share"))
    let dir = ($base | path join "com.prexu.client" "logs")
    if not ($dir | path exists) { return "" }
    let files = (ls $dir | where name =~ '\.log$' | sort-by modified | reverse)
    if ($files | is-empty) { return "" }
    $files | first | get name
}

# --- Screen capture (backend fall-through) ---
# grim is present but fails on KDE (no wlr-screencopy); spectacle is the KDE
# path; import is the X11 last resort. We TRY each available backend and accept
# the first that yields a readable, non-empty PNG — presence alone is not enough.

def try-capture [backend: string, out: string]: nothing -> bool {
    # `do {..} | complete` captures stdout/stderr/exit_code without throwing or
    # leaking a failing backend's stderr (grim on KDE prints a protocol error).
    let res = (match $backend {
        "grim" => (do { ^grim $out } | complete)
        "spectacle" => (do { ^spectacle -b -n -f -o $out } | complete)
        "import" => (do { ^import -window root $out } | complete)
        _ => null
    })
    if $res == null { return false }
    if $res.exit_code != 0 { return false }
    # Valid iff ImageMagick can read a non-zero-area image.
    if not ($out | path exists) { return false }
    (try { (^identify -format '%w' $out | into int) > 0 } catch { false })
}

# Capture the full screen to `out`. Returns the backend used, or null on failure.
export def capture-screen [out: string]: nothing -> any {
    for backend in [grim spectacle import] {
        if (have $backend) {
            if (try-capture $backend $out) {
                return $backend
            }
        }
    }
    null
}

# --- Luminance measurement (feeds verdict.nu classify-luminance) ---
# Two ImageMagick passes: gray from a Gray conversion, and r/g/b forced through
# sRGB. The sRGB force is required — ImageMagick collapses an equal-channel image
# (white/grey) to single-channel storage, and then %[fx:mean.g]/%[fx:mean.b]
# read 0, which would corrupt the navy (blue-dominant) test.
export def measure-luminance [img: string]: nothing -> record {
    let gray = (^magick $img -colorspace Gray -format '%[fx:mean]' info: | into float)
    let rgb = (
        ^magick $img -colorspace sRGB -format '%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]' info:
        | split row ' '
        | each { |x| $x | into float }
    )
    { gray: $gray, r: ($rgb | get 0), g: ($rgb | get 1), b: ($rgb | get 2) }
}

# Crop an image to `WxH+X+Y` (in place to a new file); returns the new path.
export def crop-image [img: string, geom: string, out: string]: nothing -> string {
    ^magick $img -crop $geom +repage $out
    $out
}

# Ground-truth luminance: extract one frame at `t_seconds` from a media file and
# measure it. Use to compare against a live capture during playback.
export def ground-truth-luminance [src: string, t_seconds: float]: nothing -> record {
    let tmp = (mktemp -t --suffix .png)
    ^ffmpeg -y -ss $t_seconds -i $src -frames:v 1 -loglevel error $tmp
    let m = (measure-luminance $tmp)
    rm -f $tmp
    $m
}

# --- Process sampling (feeds rss/cpu/zombie/deadlock verdicts) ---

# Find running app pids by process-name substring.
export def app-pids [--name: string = "prexu"]: nothing -> list<int> {
    ps | where ($it.name | str downcase | str contains ($name | str downcase)) | get pid
}

# RSS in bytes for a pid, from /proc (portable, no ps parsing). 0 if gone.
export def sample-rss [pid: int]: nothing -> int {
    let f = $"/proc/($pid)/status"
    if not ($f | path exists) { return 0 }
    let m = (open $f | lines | where ($it | str starts-with "VmRSS") | first | parse --regex 'VmRSS:\s+(?<kb>\d+)')
    if ($m | is-empty) { return 0 }
    ($m | get kb.0 | into int) * 1024
}

# Instantaneous CPU percent for a pid (nushell ps measures over a short window).
export def sample-cpu [pid: int]: nothing -> float {
    let row = (ps | where pid == $pid)
    if ($row | is-empty) { return 0.0 }
    $row | first | get cpu | into float
}

# Parse a tauri-plugin-log `[YYYY-MM-DD][HH:MM:SS]` prefix to a datetime (local
# TZ). Second precision — first-play timing resolves to ~1s here. null if absent.
export def parse-log-ts [line: string]: nothing -> any {
    let m = ($line | parse --regex '\[(?<d>\d{4}-\d{2}-\d{2})\]\[(?<t>\d{2}:\d{2}:\d{2})\]')
    if ($m | is-empty) { return null }
    $"($m.d.0) ($m.t.0)" | into datetime
}

# Send one keysym to the focused window via the best available injector
# (Wayland: wtype; X11: xdotool). Returns whether a key was sent.
export def send-key [keysym: string]: nothing -> bool {
    let s = (hw-session)
    if $s.type == "wayland" and (have wtype) {
        (do { ^wtype -k $keysym } | complete | get exit_code) == 0
    } else if (have xdotool) {
        (do { ^xdotool key $keysym } | complete | get exit_code) == 0
    } else {
        false
    }
}

# --- Mouse injection (X11 only — feeds the E.3/G.3 click-sweep probe; the
# pass/fail decision (click-sweep-liveness-verdict) and the point/vector math
# it drives on (sweep-points, edge-drag-vectors) live in verdict.nu) ---

# Move the pointer to (x,y) and click button 1 (X11, via xdotool). Best-effort
# — the caller judges liveness after the whole sweep, not per-click.
export def xdotool-click [x: int, y: int]: nothing -> bool {
    (do { ^xdotool mousemove --sync $x $y click 1 } | complete | get exit_code) == 0
}

# Drag button 1 from (x1,y1) to (x2,y2) — used for the edge drag-resize pass
# (E.3 axj4.3 class). X11, via xdotool mousedown/mousemove/mouseup (xdotool
# has no single "drag" verb; the button must be held across the move).
export def xdotool-drag [x1: int, y1: int, x2: int, y2: int]: nothing -> bool {
    let down = (do { ^xdotool mousemove --sync $x1 $y1 mousedown 1 } | complete | get exit_code) == 0
    let moved = (do { ^xdotool mousemove --sync $x2 $y2 } | complete | get exit_code) == 0
    let up = (do { ^xdotool mouseup 1 } | complete | get exit_code) == 0
    $down and $moved and $up
}

# Find the app window by title substring via `wmctrl -lG` (X11 only). Returns
# {} if no match. Shared by geometry-x11.nu (E.2/E.4/G.4) and the click-sweep
# probe (E.3/G.3) — both need the same window rect.
export def find-window [name: string]: nothing -> record {
    let rows = (
        ^wmctrl -lG
        | lines
        | each { |l| parse-wmctrl-geometry $l }
        | where { |r| ($r | is-not-empty) }
    )
    let match = ($rows | where { |r| ($r.title | str downcase | str contains ($name | str downcase)) })
    if ($match | is-empty) { {} } else { $match | first }
}

# All processes in a zombie/defunct state, as {pid, stat, comm} records.
export def ps-zombies []: nothing -> list<record> {
    ^ps -eo pid,stat,comm
    | lines
    | skip 1
    | each { |l|
        let m = ($l | str trim | parse --regex '^(?<pid>\d+)\s+(?<stat>\S+)\s+(?<comm>.+)$')
        if ($m | is-empty) { null } else { $m | first }
    }
    | compact
    | where ($it.stat | str contains "Z")
}

# --- Report rendering ---

# Colorize a status for the terminal.
export def fmt-status [status: string]: nothing -> string {
    match $status {
        "pass" => $"(ansi green)PASS(ansi reset)"
        "fail" => $"(ansi red)FAIL(ansi reset)"
        "skip" => $"(ansi yellow)SKIP(ansi reset)"
        _ => $"(ansi blue)($status | str upcase)(ansi reset)"
    }
}

# Render a result table (list of {name, section?, status, detail?}) as Markdown.
export def render-report [title: string, results: list<record>]: nothing -> string {
    let counts = (
        $results
        | group-by status
        | transpose k v
        | each { |x| $"($x.k)=($x.v | length)" }
        | str join " "
    )
    let rows = (
        $results
        | each { |r| $"| ($r.name) | ($r.section? | default '-') | ($r.status | str upcase) | ($r.detail? | default '') |" }
        | str join "\n"
    )
    [
        $"## ($title)"
        ""
        $"Summary: ($counts)"
        ""
        "| check | section | status | detail |"
        "| --- | --- | --- | --- |"
        $rows
        ""
    ] | str join "\n"
}

# Print a result table to the terminal and return the number of failures.
export def summarize [results: list<record>]: nothing -> int {
    let display = (
        $results
        | each { |r| { check: $r.name, section: ($r.section? | default "-"), status: (fmt-status $r.status), detail: ($r.detail? | default "") } }
    )
    print $display
    $results | where status == "fail" | length
}
