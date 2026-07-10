#!/usr/bin/env nu
# Luminance pipeline (W2, plan sections A/D/F).
#
# Screenshot -> ImageMagick mean luminance -> classify (content/navy/black), to
# catch the audio-over-navy (prexu-91t8) and navy-stage (prexu-hg1j) classes: a
# dark blue or black frame where content or UI should be. Optionally compares a
# live capture against an ffmpeg-extracted ground-truth frame.
#
# Capture is slow on KDE (spectacle; grim needs wlr-screencopy which KWin lacks),
# so transition sampling is coarse here; on wlroots/X11 grim/import are fast.
#
#   nu scripts/hw-probe/luminance.nu sample
#   nu scripts/hw-probe/luminance.nu transition --samples 8 --interval 400ms
#   nu scripts/hw-probe/luminance.nu ground-truth --src movie.mkv --at 120
#   ... add --crop 1280x720+320+180 to sample only the player region

use verdict.nu *
use lib.nu *

# Capture the screen (optionally cropped) and classify the frame.
def capture-and-classify [crop: string]: nothing -> record {
    let raw = (mktemp -t --suffix .png)
    let backend = (capture-screen $raw)
    if $backend == null {
        rm -f $raw
        return { class: "error", gray: 0.0, r: 0.0, g: 0.0, b: 0.0, backend: null }
    }
    let img = if ($crop | is-empty) { $raw } else { crop-image $raw $crop (mktemp -t --suffix .png) }
    let m = (measure-luminance $img)
    rm -f $raw
    if $img != $raw { rm -f $img }
    { class: (classify-luminance $m.gray $m.r $m.g $m.b), gray: $m.gray, r: $m.r, g: $m.g, b: $m.b, backend: $backend }
}

def main [] {
    print "usage: luminance.nu (sample | transition | ground-truth) [flags]"
    print "  sample                          one capture, classify"
    print "  transition --samples N --interval MS   sample across a transition, flag navy/black"
    print "  ground-truth --src FILE --at SEC       compare capture to an extracted frame"
    exit 2
}

# One capture -> classification.
def "main sample" [--crop: string = ""] {
    let r = (capture-and-classify $crop)
    if $r.class == "error" {
        print $"(ansi red)capture failed(ansi reset) — no working backend: grim/spectacle/import"
        exit 2
    }
    print $"backend=($r.backend) class=(ansi_class $r.class) gray=($r.gray | into float | math round --precision 4) rgb=[($r.r),($r.g),($r.b)]"
}

# Sample across a transition the operator drives (stop / minimize / restore).
def "main transition" [--samples: int = 8, --interval: duration = 400ms, --crop: string = ""] {
    print $"Sampling ($samples) frames every ($interval) — drive the transition now..."
    mut classes = []
    for i in 1..$samples {
        let r = (capture-and-classify $crop)
        $classes = ($classes | append $r.class)
        print $"  [($i)/($samples)] ($r.class) gray=($r.gray | into float | math round --precision 3)"
        if $i < $samples { sleep $interval }
    }
    let v = (transition-verdict ($classes | where $it != "error"))
    print $"\ntransition verdict: (fmt-status $v.status) — ($v.detail)"
    if $v.status == "fail" { exit 1 }
}

# Compare a live capture against an ffmpeg-extracted ground-truth frame.
def "main ground-truth" [--src: string, --at: float = 0.0, --crop: string = "", --tolerance: float = 0.2] {
    if ($src | is-empty) or (not ($src | path exists)) {
        print $"(ansi red)--src media file required and must exist(ansi reset)"
        exit 2
    }
    let gt = (ground-truth-luminance $src $at)
    let live = (capture-and-classify $crop)
    let delta = (($live.gray - $gt.gray) | math abs)
    let status = if ($live.class == "navy" or $live.class == "black") { "fail" } else if ($delta <= $tolerance) { "pass" } else { "skip" }
    print $"ground-truth gray=($gt.gray | math round --precision 3)  live gray=($live.gray | math round --precision 3) class=($live.class)  |delta|=($delta | math round --precision 3)"
    print $"verdict: (fmt-status $status) tolerance=($tolerance)"
    if $status == "fail" { exit 1 }
}

# Small color helper for a class label.
def ansi_class [class: string]: nothing -> string {
    match $class {
        "content" => $"(ansi green)content(ansi reset)"
        "navy" => $"(ansi red)navy(ansi reset)"
        "black" => $"(ansi red)black(ansi reset)"
        _ => $class
    }
}
