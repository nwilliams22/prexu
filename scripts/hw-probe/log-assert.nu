#!/usr/bin/env nu
# Structured-log assertion runner (W2, plan sections Pre/A/B/E/F).
#
# Drives the ordered log invariants over a tauri-plugin-log file produced by a
# real Prexu run. The heavy lifting (the invariants themselves) lives in
# verdict.nu and is mutation-checked in CI; this entry just loads the log,
# runs the checks, and reports.
#
#   nu scripts/hw-probe/log-assert.nu                 # newest app log, auto-found
#   nu scripts/hw-probe/log-assert.nu path/to.log     # explicit file
#   nu scripts/hw-probe/log-assert.nu --require-inset  # after a minimize->popout run
#   nu scripts/hw-probe/log-assert.nu --json          # machine-readable

use verdict.nu *
use lib.nu *

# Run the full log-invariant suite; returns the list of result records.
export def assert-log [logfile: string, --require-inset]: nothing -> list<record> {
    let lines = (open $logfile | lines)
    [
        (check-dmabuf $lines)
        (check-compositor $lines)
        (check-gl-resolver $lines)
        (check-first-frame-pairing $lines)
        (check-sub-scale $lines)
        (check-inset-clear $lines --required=$require_inset)
    ]
}

def main [
    logfile?: string   # tauri-plugin-log file; defaults to the newest app log
    --require-inset    # fail (not skip) when the popout inset-clear line is absent
    --json             # emit results as JSON instead of a table
] {
    let path = ($logfile | default (discover-log))
    if ($path | is-empty) or (not ($path | path exists)) {
        print $"(ansi red)log file not found(ansi reset): pass a path, or run the app first. Default location ~/.local/share/com.prexu.client/logs/"
        exit 2
    }
    let results = (assert-log $path --require-inset=$require_inset)
    if $json {
        print ($results | to json)
        return
    }
    print $"Log-assertion runner — ($path)"
    let fails = (summarize $results)
    print $"\n($fails) failure/s"
    if $fails > 0 { exit 1 }
}
