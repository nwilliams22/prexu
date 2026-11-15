# Windows click timing

Run against an unused, shut-down disposable `win11-test` VM:

```sh
node scripts/windows-composition/run.mjs /path/to/candidate /path/to/empty-evidence --click-timing
node --test scripts/windows-composition/click-timing.test.mjs
```

The normal candidate checksum, QA sign-in, real installed WebView2 app,
synthetic media fixture, cleanup and VM reset still apply. The timing mode
replaces the visual matrix; it does not certify video, GPU, audio or physical
input. `PREXU_QA_PLEX_AUTH` must be present in the environment, never in arguments.

The worker keeps three legacy PowerShell clicks followed by three compiled
wrapper clicks. Each path's first invocation is labelled `cold`; the next two
are `warm`. The compiled path is cold at its method/binding call site, **not**
a fresh process or a cold user32 DLL: it follows the legacy series. The first
UTC timestamp call occurs in the legacy series. QPC clock and CDP calibration
are already warmed by the before-sample bridge. Do not compare these as six
independent cold boots or generalize a single first-call cost to all machines.

Each sample keeps five host-QPC/browser-performance bridge round trips before
and after dispatch, all host markers, and all captured DOM click and native
pause events. The analyzer intersects all ten offset intervals, verifies the
browser time origin, and rejects incompatible clocks, missing/duplicate events,
untrusted clicks, resume events or invalid marker order. Rejected JSON remains
in the evidence directory; no retries overwrite it. The command exits nonzero
if any expected sample is missing or rejected. Use a new output directory for
every run. Attach the raw samples as well as `timing-summary.json` and reset logs.

Host markers separate the UTC timestamp call, timestamp-return-to-entry,
entry-to-mouse-down, down call, between calls, up call and wrapper return.
Legacy call intervals include PowerShell binding and instrumentation. Compiled
intervals bracket P/Invoke within C#; they can still include first-call native
stub work and scheduling. Time before compiled entry includes PowerShell
binding and JIT, not just app dispatch. These are measured intervals, not a
CPU profiler's exclusive attribution.

Cross-clock outer-to-click, outer-to-pause and down-to-click are intervals with
the full calibration width, never a point estimate. DOM-to-pause uses only the
browser monotonic clock and is reported independently even if the bridge is
rejected. An empty clock intersection is not repaired by choosing a favorable
round trip. Wall-clock timestamps are diagnostic only. This assumes a stable
QPC/performance clock offset across the short sample; bounds describe the
observed bridge consistency, not a guarantee against unobserved clock drift.

The historical uncalibrated 7383.6 ms sample remains unexplained. New traces
neither reconstruct it nor change its acceptance status.
