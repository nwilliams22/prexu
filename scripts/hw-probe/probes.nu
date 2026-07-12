#!/usr/bin/env nu
# System probes (W2, plan sections N.1/N.2/N.3, G.1, G.2, E.3/G.3).
#
# Sample the running app's health and compare against the pure verdicts in
# verdict.nu. Each probe finds the app pid automatically (or takes --pid) and
# skips gracefully when the app is not running.
#
#   nu scripts/hw-probe/probes.nu rss     --samples 20 --interval 500ms  # N.1 flat-RSS on seek loop
#   nu scripts/hw-probe/probes.nu cpu     --samples 20 --interval 500ms  # N.3 idle/steady CPU
#   nu scripts/hw-probe/probes.nu timing                                  # N.2 first-play latency (from log)
#   nu scripts/hw-probe/probes.nu zombie                                  # G.2 no defunct app/mpv
#   nu scripts/hw-probe/probes.nu stress  --duration 30sec --key m        # G.1 minimize/restore watchdog
#   nu scripts/hw-probe/probes.nu click-sweep                             # E.3/G.3 X11 click/drag sweep + liveness

use verdict.nu *
use lib.nu *

def resolve-pid [pid: int]: nothing -> int {
    if $pid > 0 { return $pid }
    let found = (app-pids)
    if ($found | is-empty) { return 0 }
    $found | first
}

def main [] {
    print "usage: probes.nu (rss | cpu | timing | zombie | stress | click-sweep) [flags]"
    exit 2
}

# N.1 — RSS across a seek loop must stay flat. Operator drives seeks during it.
def "main rss" [--pid: int = 0, --samples: int = 20, --interval: duration = 500ms, --max-growth-mb: float = 50.0] {
    let p = (resolve-pid $pid)
    if $p == 0 { print $"(ansi yellow)SKIP(ansi reset) rss: app not running — no prexu pid"; return }
    print $"Sampling RSS of pid ($p) — drive a seek loop now..."
    mut acc = []
    for i in 1..$samples {
        $acc = ($acc | append (sample-rss $p))
        sleep $interval
    }
    let v = (rss-verdict $acc --max-growth-mb $max_growth_mb)
    print $"rss: (fmt-status $v.status) — ($v.detail)"
    if $v.status == "fail" { exit 1 }
}

# N.3 — steady-state CPU must stay under the pump-gate ceiling.
def "main cpu" [--pid: int = 0, --samples: int = 20, --interval: duration = 500ms, --max-avg-pct: float = 15.0] {
    let p = (resolve-pid $pid)
    if $p == 0 { print $"(ansi yellow)SKIP(ansi reset) cpu: app not running — no prexu pid"; return }
    print $"Sampling CPU of pid ($p) during steady playback..."
    mut acc = []
    for i in 1..$samples {
        $acc = ($acc | append (sample-cpu $p))
        sleep $interval
    }
    let v = (cpu-verdict $acc --max-avg-pct $max_avg_pct)
    print $"cpu: (fmt-status $v.status) — ($v.detail)"
    if $v.status == "fail" { exit 1 }
}

# N.2 — first-play latency from arm->fire timestamps in the log (worst case).
def "main timing" [--logfile: string = "", --max-ms: int = 3000] {
    let log = (if ($logfile | is-empty) { discover-log } else { $logfile })
    if ($log | is-empty) or (not ($log | path exists)) { print $"(ansi yellow)SKIP(ansi reset) timing: no log file"; return }
    let lines = (open $log | lines)
    # Pair each arm with the next fire and compute the delta.
    mut deltas = []
    mut arm_ts = null
    for line in $lines {
        if ($line | str contains "first-frame reveal armed") {
            $arm_ts = (parse-log-ts $line)
        } else if ($line | str contains "first frame rendered after arm") and ($arm_ts != null) {
            let fire_ts = (parse-log-ts $line)
            if $fire_ts != null {
                $deltas = ($deltas | append ((($fire_ts - $arm_ts) / 1ms) | into int))
            }
            $arm_ts = null
        }
    }
    if ($deltas | is-empty) { print $"(ansi yellow)SKIP(ansi reset) timing: no arm->fire pairs in log"; return }
    let worst = ($deltas | math max)
    let v = (timing-verdict $worst --max-ms $max_ms)
    print $"timing: (fmt-status $v.status) — worst first-play=($worst)ms over ($deltas | length) loads; ±1s log precision"
    if $v.status == "fail" { exit 1 }
}

# G.2 — no zombie/defunct app or mpv after exit. Run this AFTER quitting the app.
def "main zombie" [] {
    let rows = (ps-zombies)
    let v = (zombie-verdict $rows)
    print $"zombie: (fmt-status $v.status) — ($v.detail)"
    if $v.status == "fail" { exit 1 }
}

# G.1 — minimize/restore stress watchdog. Monitors log growth as a liveness
# heartbeat; a gap over the watchdog window means the UI thread hung (skr2
# class). With --key, auto-drives the keysym each interval; otherwise the
# operator drives minimize/restore per the runbook.
def "main stress" [
    --logfile: string = ""
    --duration: duration = 30sec
    --interval: duration = 500ms
    --watchdog-ms: int = 5000
    --key: string = ""
] {
    let log = (if ($logfile | is-empty) { discover-log } else { $logfile })
    if ($log | is-empty) or (not ($log | path exists)) { print $"(ansi yellow)SKIP(ansi reset) stress: no log file"; return }
    let drive = ($key | is-not-empty)
    if $drive { print $"Auto-driving key '($key)' every ($interval) for ($duration)..." } else { print $"Monitoring for ($duration) — drive minimize/restore now..." }
    let start = (date now)
    mut last_size = (ls $log | get size | first)
    mut heartbeats = [0]
    while ((date now) - $start) < $duration {
        if $drive { send-key $key | ignore }
        sleep $interval
        let sz = (ls $log | get size | first)
        if $sz > $last_size {
            $heartbeats = ($heartbeats | append (((date now) - $start) / 1ms | into int))
            $last_size = $sz
        }
    }
    let v = (deadlock-verdict $heartbeats --watchdog-ms $watchdog_ms)
    print $"stress: (fmt-status $v.status) — ($v.detail), ($heartbeats | length) heartbeats"
    if $v.status == "fail" { exit 1 }
}

# E.3/G.3 — X11 click/drag sweep across the app window (4 corners, 4 edge
# midpoints, interior center) plus an edge drag-resize pass, then a
# process-liveness verdict (axj4.3 click-crash class). X11-only — the native
# surface has no addressable per-window geometry on Wayland, so xdotool can't
# target it there; that leg stays manual per the plan (mirrors
# geometry-x11.nu's X11 gate). The point/vector math (sweep-points,
# edge-drag-vectors) and the pass/fail decision (click-sweep-liveness-verdict)
# are pure, in verdict.nu; this driver is the only I/O.
def "main click-sweep" [--pid: int = 0, --name: string = "Prexu", --settle: duration = 100ms] {
    let s = (hw-session)
    if $s.type != "x11" {
        print $"(ansi yellow)SKIP(ansi reset) click-sweep: X11 session required — this is ($s.type); xdotool needs an addressable window \(Wayland stays manual per the plan\)"
        return
    }
    if not (have xdotool) {
        print $"(ansi yellow)SKIP(ansi reset) click-sweep: xdotool not installed"
        return
    }
    if not (have wmctrl) {
        print $"(ansi yellow)SKIP(ansi reset) click-sweep: wmctrl not installed"
        return
    }
    let p = (resolve-pid $pid)
    if $p == 0 { print $"(ansi yellow)SKIP(ansi reset) click-sweep: app not running — no prexu pid"; return }
    let win = (find-window $name)
    if ($win | is-empty) { print $"(ansi yellow)SKIP(ansi reset) click-sweep: no window matching ($name)"; return }

    print $"Click sweep over ($win.w)x($win.h)+($win.x)+($win.y) — pid ($p)..."
    for pt in (sweep-points $win) {
        xdotool-click $pt.x $pt.y | ignore
        sleep $settle
    }
    print "Edge drag-resize pass..."
    for d in (edge-drag-vectors $win) {
        xdotool-drag $d.from.x $d.from.y $d.to.x $d.to.y | ignore
        sleep $settle
    }

    let running = (app-pids)
    let zrows = (ps-zombies)
    let v = (click-sweep-liveness-verdict $p $running $zrows)
    print $"click-sweep: (fmt-status $v.status) — ($v.detail)"
    if $v.status == "fail" { exit 1 }
}
