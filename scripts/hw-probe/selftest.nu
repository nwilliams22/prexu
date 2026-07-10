#!/usr/bin/env nu
# Self-tests for the hw-probe verdict core (mutation-check harness).
#
# Runs in CI with only nushell present — no app, GPU, compositor, or ImageMagick.
# Every assertion here proves a verdict function returns "fail" (or "pass") for a
# known-bad (or known-good) input, so that if someone weakens a threshold or
# breaks an invariant, this suite goes red. This is the W2 answer to the epic's
# rule: "new tests must FAIL when the guarded behavior is broken."
#
# The optional end-to-end luminance leg (generate synthetic PNGs -> measure ->
# classify) runs only when ImageMagick is available; it is skipped, not failed,
# otherwise.

use verdict.nu *

const HERE = path self
const FIX = ($HERE | path dirname | path join "fixtures" "logs")

# Assertion helper: record the outcome instead of throwing so the run reports
# every failure at once.
def expect [label: string, got: any, want: any]: nothing -> record {
    { label: $label, ok: ($got == $want), got: ($got | to nuon), want: ($want | to nuon) }
}

def load-log [name: string]: nothing -> list<string> {
    open ($FIX | path join $name) | lines | where ($it | str trim | is-not-empty)
}

def main [] {
    mut t = []

    # --- Log invariant checks against fixtures ---
    let good = (load-log "good-load-cycle.log")
    $t = ($t | append (expect "good: dmabuf present" (check-dmabuf $good | get status) "pass"))
    $t = ($t | append (expect "good: compositor installed" (check-compositor $good | get status) "pass"))
    $t = ($t | append (expect "good: gl resolver" (check-gl-resolver $good | get status) "pass"))
    $t = ($t | append (expect "good: first-frame pairing" (check-first-frame-pairing $good | get status) "pass"))
    $t = ($t | append (expect "good: sub-scale in range" (check-sub-scale $good | get status) "pass"))

    let seek = (load-log "bad-reveal-on-seek.log")
    $t = ($t | append (expect "MUTATION: reveal re-emit on seek -> fail" (check-first-frame-pairing $seek | get status) "fail"))

    let rearm = (load-log "bad-rearm-before-fire.log")
    $t = ($t | append (expect "MUTATION: re-arm before fire -> fail" (check-first-frame-pairing $rearm | get status) "fail"))

    # A dropped stale arm resolves the pending arm — must NOT be flagged.
    let drop = (load-log "good-drop-then-rearm.log")
    $t = ($t | append (expect "good: drop-then-rearm -> pass" (check-first-frame-pairing $drop | get status) "pass"))

    let nodmabuf = (load-log "bad-missing-dmabuf.log")
    $t = ($t | append (expect "MUTATION: DMABUF disabled -> fail" (check-dmabuf $nodmabuf | get status) "fail"))

    let badsub = (load-log "bad-sub-scale-out-of-range.log")
    $t = ($t | append (expect "MUTATION: sub-scale 1.42 out of range -> fail" (check-sub-scale $badsub | get status) "fail"))

    # inset-clear: absent + not required = skip; absent + required = fail; present = pass
    $t = ($t | append (expect "inset-clear absent, optional -> skip" (check-inset-clear $good | get status) "skip"))
    $t = ($t | append (expect "MUTATION: inset-clear absent, required -> fail" (check-inset-clear $good --required | get status) "fail"))
    let inset = ($good | append "[player:popout] clearing leftover minimize inset on enter")
    $t = ($t | append (expect "inset-clear present, required -> pass" (check-inset-clear $inset --required | get status) "pass"))

    # --- Luminance classification (measured means from real ImageMagick output) ---
    $t = ($t | append (expect "classify navy (#000080)" (classify-luminance 0.0362 0.0 0.0 0.5019) "navy"))
    $t = ($t | append (expect "classify black" (classify-luminance 0.0 0.0 0.0 0.0) "black"))
    $t = ($t | append (expect "classify content" (classify-luminance 0.5906 0.5333 0.6 0.6667) "content"))
    # A dark-but-balanced frame is content, not navy (blue not dominant)
    $t = ($t | append (expect "classify dark-grey -> content (not navy)" (classify-luminance 0.10 0.10 0.10 0.10) "content"))

    $t = ($t | append (expect "transition clean -> pass" (transition-verdict [content content content] | get status) "pass"))
    $t = ($t | append (expect "MUTATION: navy stage in transition -> fail" (transition-verdict [content navy content] | get status) "fail"))
    $t = ($t | append (expect "MUTATION: black frame in transition -> fail" (transition-verdict [content black content] | get status) "fail"))

    # --- System probe verdicts ---
    $t = ($t | append (expect "rss flat -> pass" (rss-verdict [104857600 105906176 104857600] | get status) "pass"))
    $t = ($t | append (expect "MUTATION: rss leak +80MB -> fail" (rss-verdict [104857600 188743680] | get status) "fail"))
    $t = ($t | append (expect "cpu idle -> pass" (cpu-verdict [2.1 3.4 1.9] | get status) "pass"))
    $t = ($t | append (expect "MUTATION: cpu pegged -> fail" (cpu-verdict [45.0 60.0 55.0] | get status) "fail"))
    $t = ($t | append (expect "timing fast -> pass" (timing-verdict 850 | get status) "pass"))
    $t = ($t | append (expect "MUTATION: timing slow -> fail" (timing-verdict 6000 | get status) "fail"))
    $t = ($t | append (expect "no zombie -> pass" (zombie-verdict [[pid stat comm]; [111 S prexu] [222 R mpv]] | get status) "pass"))
    $t = ($t | append (expect "MUTATION: defunct mpv -> fail" (zombie-verdict [[pid stat comm]; [222 "Z" "mpv <defunct>"]] | get status) "fail"))
    $t = ($t | append (expect "heartbeats steady -> pass" (deadlock-verdict [0 1000 2000 3000] | get status) "pass"))
    $t = ($t | append (expect "MUTATION: 9s heartbeat gap -> fail" (deadlock-verdict [0 1000 10000] | get status) "fail"))

    # --- X11 geometry parsers (live probes are X11-only; parsing tested here) ---
    let wm = (parse-wmctrl-geometry "0x03a00007  0 2560 1440 1280 720  host Prexu — Popout")
    $t = ($t | append (expect "wmctrl parse x" $wm.x 2560))
    $t = ($t | append (expect "wmctrl parse w" $wm.w 1280))
    $t = ($t | append (expect "wmctrl parse title" $wm.title "Prexu — Popout"))
    $t = ($t | append (expect "nearest-corner bottom-right snapped" (nearest-corner 2560 1440 1280 720 3840 2160 | get snapped) true))
    $t = ($t | append (expect "nearest-corner mid not snapped" (nearest-corner 800 400 1280 720 3840 2160 | get snapped) false))
    $t = ($t | append (expect "geometry-drift zero -> pass" (geometry-drift {x: 0, y: 0, w: 1280, h: 720} {x: 0, y: 0, w: 1280, h: 720} | get status) "pass"))
    $t = ($t | append (expect "MUTATION: geometry-drift 3px -> fail" (geometry-drift {x: 0, y: 0, w: 1280, h: 720} {x: 3, y: 0, w: 1280, h: 720} | get status) "fail"))
    $t = ($t | append (expect "fullscreen present" (parse-fullscreen-state "_NET_WM_STATE(ATOM) = _NET_WM_STATE_FULLSCREEN") true))
    $t = ($t | append (expect "fullscreen absent" (parse-fullscreen-state "_NET_WM_STATE(ATOM) = _NET_WM_STATE_MAXIMIZED_VERT") false))

    # --- Optional end-to-end luminance (only if ImageMagick present) ---
    if (which magick | is-not-empty) {
        let tmp = (mktemp -d)
        magick -size 16x16 xc:'#000080' ($tmp | path join navy.png)
        magick -size 16x16 xc:black ($tmp | path join black.png)
        magick -size 16x16 xc:'#8899aa' ($tmp | path join content.png)
        for case in [[file want]; [navy.png navy] [black.png black] [content.png content]] {
            let img = ($tmp | path join $case.file)
            let gray = (magick $img -colorspace Gray -format '%[fx:mean]' info: | into float)
            let rgb = (magick $img -colorspace sRGB -format '%[fx:mean.r] %[fx:mean.g] %[fx:mean.b]' info: | split row ' ' | each { |x| $x | into float })
            let r = ($rgb | get 0)
            let g = ($rgb | get 1)
            let b = ($rgb | get 2)
            $t = ($t | append (expect $"e2e luminance ($case.file)" (classify-luminance $gray $r $g $b) $case.want))
        }
        rm -rf $tmp
    } else {
        print "note: ImageMagick absent — skipping end-to-end luminance leg"
    }

    # --- Report ---
    let failed = ($t | where not ok)
    print ($t | select label ok got want)
    print $"\n(($t | where ok | length))/($t | length) assertions passed"
    if ($failed | is-not-empty) {
        print $"\n(ansi red)FAILED ($failed | length) assertion\(s\):(ansi reset)"
        print ($failed | select label got want)
        exit 1
    }
    print $"(ansi green)hw-probe selftest: all green(ansi reset)"
}
