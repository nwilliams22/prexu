#!/usr/bin/env nu
# hw-probe orchestrator (W2). One command for the Linux dev box.
#
# Runs the fully-automatable checks (log invariants, first-play timing from the
# log, zombie scan, one luminance sample) and prints the operator-driven probes
# to run by hand (RSS/CPU/stress seek loops, transition sampling, X11 geometry).
# Writes a combined Markdown report for human review.
#
#   nu scripts/hw-probe/run.nu                       # auto checks + report
#   nu scripts/hw-probe/run.nu --report out.md       # custom report path
#   nu scripts/hw-probe/run.nu --require-inset       # after a minimize->popout run

use verdict.nu *
use lib.nu *
use log-assert.nu [assert-log]

# Normalize a verdict record into a unified result row.
def row [name: string, section: string, v: record]: nothing -> record {
    { name: $name, section: $section, status: $v.status, detail: ($v.detail? | default "") }
}

# First-play timing from arm->fire pairs in a log.
def timing-from-log [log: string]: nothing -> record {
    let lines = (open $log | lines)
    mut deltas = []
    mut arm_ts = null
    for line in $lines {
        if ($line | str contains "first-frame reveal armed") {
            $arm_ts = (parse-log-ts $line)
        } else if ($line | str contains "first frame rendered after arm") and ($arm_ts != null) {
            let fire_ts = (parse-log-ts $line)
            if $fire_ts != null { $deltas = ($deltas | append ((($fire_ts - $arm_ts) / 1ms) | into int)) }
            $arm_ts = null
        }
    }
    if ($deltas | is-empty) { return { status: "skip", detail: "no arm->fire pairs" } }
    let worst = ($deltas | math max)
    let v = (timing-verdict $worst)
    { status: $v.status, detail: $"worst=($worst)ms over ($deltas | length) loads ±1s" }
}

# One luminance sample of the current screen.
def luminance-sample []: nothing -> record {
    let raw = (mktemp -t --suffix .png)
    let backend = (capture-screen $raw)
    if $backend == null { rm -f $raw; return { status: "skip", detail: "no capture backend" } }
    let m = (measure-luminance $raw)
    rm -f $raw
    let class = (classify-luminance $m.gray $m.r $m.g $m.b)
    let status = if ($class == "navy" or $class == "black") { "fail" } else { "pass" }
    { status: $status, detail: $"class=($class) gray=($m.gray | math round --precision 3) via ($backend)" }
}

def main [--logfile: string = "", --report: string = "hw-probe-report.md", --require-inset] {
    let s = (hw-session)
    print $"hw-probe — session=($s.type) desktop=($s.desktop)  ((date now) | format date '%Y-%m-%d %H:%M:%S')"
    let app = (app-pids)
    print $"app: (if ($app | is-empty) { 'not running' } else { $'running pid ($app | first)' })\n"

    mut results = []

    # 1. Log invariants + 2. first-play timing (from the newest app log)
    let log = (if ($logfile | is-empty) { discover-log } else { $logfile })
    if ($log | is-not-empty) and ($log | path exists) {
        $results = ($results | append (assert-log $log --require-inset=$require_inset))
        $results = ($results | append (row "first-play-timing" "N.2" (timing-from-log $log)))
    } else {
        $results = ($results | append { name: "log-suite", section: "Pre/A/B/E/N.2", status: "skip", detail: "no log file — run the app first" })
    }

    # 3. Zombie scan (meaningful after an app-exit run)
    $results = ($results | append (row "zombie-check" "G.2" (zombie-verdict (ps-zombies))))

    # 4. One luminance sample
    $results = ($results | append (row "luminance-sample" "A/D/F" (luminance-sample)))

    # 5. X11 geometry (skips on Wayland)
    if $s.type != "x11" {
        $results = ($results | append { name: "geometry-x11", section: "E.2/E.4/G.4", status: "skip", detail: $"X11-only; this is ($s.type)" })
    }

    let fails = (summarize $results)
    let skips = ($results | where status == "skip" | length)

    # Operator-driven probes (need a running app + hands on the transition)
    print $"\n(ansi cyan)Operator-driven probes(ansi reset) — run with the app playing:"
    print "  nu scripts/hw-probe/probes.nu rss --samples 20        # N.1 seek-loop RSS"
    print "  nu scripts/hw-probe/probes.nu cpu --samples 20        # N.3 steady CPU"
    print "  nu scripts/hw-probe/probes.nu stress --duration 30sec # G.1 minimize/restore watchdog"
    print "  nu scripts/hw-probe/luminance.nu transition --samples 8 # A/D navy-stage scan"

    # Report file
    let md = (render-report $"hw-probe report — ($s.type)" $results)
    $md | save -f $report
    print $"\nreport written: ($report)  [(ansi red)($fails) fail(ansi reset), (ansi yellow)($skips) skip(ansi reset)]"
    if $fails > 0 { exit 1 }
}
