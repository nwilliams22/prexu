# Scripted probe contract v1

This directory currently implements **offline script/trace verification only**.
The desktop bootstrap, fixture service, Rust marker writer and serial UI runner
are not implemented yet. Passing these selftests is not an end-to-end run.

Run the negative controls with:

```sh
mise run probe-driver:selftest
```

Check recorded evidence with:

```sh
python3 scripts/hw-probe/driver/check.py \
  --script run/script.json --events run/events.jsonl \
  --exit-code 0 --output run/verdict.json
```

The launcher must supply the actual app exit status. This offline command cannot
attest to how the inputs were obtained. It exits zero only for a complete valid
success trace and exit status zero. Input failures produce a failing verdict;
output files are created exclusively to preserve prior evidence.

## Scripts

`schema: prexu.probe.script`, integer `version: 1`, an ASCII `runId` (1–64
letters, digits, `_`, `-`), `fixture: av-cues-v1`, `timeoutMs` (1–900000), and
1–256 `steps` are required. Scripts are limited to 1 MiB. Unknown fields, duplicate
JSON keys, non-finite numbers, booleans in numeric fields, duplicate step IDs,
unknown actions and invalid playback sequences are rejected.

Each step has `id`, `action`, `timeoutMs` (1–120000), and optional `args`.
`quit` is required and last; stop active playback before quitting. A new play
requires the previous session to be stopped. Pause/resume must alternate.

| Action | Arguments | Completion observation |
| --- | --- | --- |
| play | mediaId: av-cues-v1 | loaded: true, advancing positionMs > 0 |
| seek | positionMs: 0–15000, toleranceMs: 0–2000 | positionMs within tolerance |
| pause / resume | none | paused: true / false |
| selectAudio | trackId: 1 or 2 | matching trackId |
| selectSubtitle | trackId: 0 (off) or 1 | matching trackId |
| fullscreen / miniPlayer / popout | enabled: boolean | matching enabled |
| windowMinimize / windowRestore | none | minimized: true / false |
| stop | none | sessionCleared: true, idle: true |
| wait | durationMs: 1–step timeout | durationMs at least requested duration |
| navigate | route: / or /settings | matching route |
| setSetting | name: volume, value: 0–100 | matching name and value |
| quit | none | ready: true |

The fixture-specific track IDs and duration are the planned v1 fixture contract.
The app must fail explicitly when an action is unsupported on its platform.

## Markers

Each line is a JSON object with `schema: prexu.probe.event`, integer `version: 1`,
matching `runId`, sequential integer `seq` starting at 1, nondecreasing
`elapsedMs`, and `event`. Unknown fields are rejected. Maximum line size is
4096 bytes and maximum trace size is 2 MiB.

Successful ordering:

1. `run.begin`
2. `step.begin` and `step.end` for each script step, in order; both have matching
   `stepId` and `action`. The end carries the allowlisted `observed` object above.
3. `cleanup.begin`, `cleanup.end`, `run.end` with `status: pass`.

Steps must complete within both their own and the run deadline. Cleanup and
terminal output must finish within 10 seconds. Missing, extra, reordered or
mismatched markers fail. Error markers always fail; their allowed codes are
`invalid_script`, `unsupported_action`, `step_timeout`, `predicate_failed`,
`player_error`, `cleanup_failed`. No raw exceptions or personal metadata enter
the verdict. This verifier does not certify a failure trace's cleanup: failure
remains failure regardless of subsequent markers.

The future Rust writer owns sequence/time assignment and validates observations;
frontend completion must establish new-load correlation and register listeners
before dispatch. Marker observations establish control/state only. They cannot
prove visible video, audible sound, GPU correctness or display transitions.
