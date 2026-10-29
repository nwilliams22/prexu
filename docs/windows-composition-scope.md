# Windows composition hosting: remaining parity scope

Assessed 2026-10-29 against `eb24f6624e3f858ebf186de1db0c834ba3d4d902`
and the live Beads database. This is a source audit with historical hardware
evidence, **not a new Windows runtime certification**. Line numbers below refer
to that revision. See also [native-player status](native-player-status.md) and
[Windows candidate acceptance](windows-candidate.md).

## Decision

No small product fix is justified by the evidence. The three open beads do not
represent three unimplemented features. Composition hosting already replaced
the separate video window; DPI handling exists; file drops were deliberately
made inert; native menus and focus passed the original hardware assessment.
IME candidate placement remains unverified, with a proposed remedy already in
code. Reimplementing these paths now would risk regressions without a failing
reproduction. No product code or workflow changes accompany this report.

Prioritize **DPI/display-transition acceptance, then alt-tab regression
acceptance, menus/focus smoke checks, drop rejection, and finally IME** for the
currently documented use case. DPI affects ordinary high-scale use and has an
unexercised manual scale-change path. Alt-tab is common, but its original defect
already passed a real-GPU assessment. This differs from putting alt-tab first
as a repair: neither has a confirmed current regression. For an active CJK-input
user, IME becomes the first input check; its low position reflects the recorded
use case, not low impact when it fails.

## Symptom and source map

All source paths below are relative to the repository root. “Historical pass”
means a dated Beads record, not a test repeated on the current build.

| Area / what the user sees | Where hosting changes behavior; current implementation | Verdict and repair cost |
| --- | --- | --- |
| DPI: formerly soft text at 150%; possible wrong scale/hit targets crossing monitors | `src-tauri/vendor/wry/src/webview2/mod.rs:163` selects composition instead of windowed hosting. `src-tauri/src/player/composition_host.rs:214` configures Controller3 auto scale detection and initial rasterization scale; `:322` reapplies scale. `player/events.rs:196` handles `ScaleFactorChanged`, through `player/mod.rs:394`. | Implemented. `prexu-od2n` records a visual high-scale pass on June 26, but explicitly says the manual Tauri reapply path did not fire. Mixed-DPI acceptance remains. Budget 0.5–1 day for a hardware matrix; only after a failure, 1–3 days for an isolated event/geometry correction. |
| Alt-tab: original black video tile despite on-screen playback | The old separate top-level video surface is gone. `composition_host.rs:126` targets the main HWND; `:145` attaches the video swapchain; `:160` puts video and webview in one tree, sets the root and commits it. `video_render.rs:779` presents frames. `lib.rs:521` requests composition unconditionally on Windows. | Structural fix already shipped. `prexu-tpnq` June 25 records “Alt+Tab live video” PASS. Current GPU/fullscreen/occlusion acceptance remains unproven. Budget 0.5–1 day for reproduction; any presentation failure is a separate measured repair, plausibly 2–5 days or more, not a safe one-line fix. |
| Native menus and focus: missing edit actions, typing needing a click after return, unwanted print dialog | `vendor/wry/src/webview2/mod.rs:644` configures default context menus for both controller paths. `:1327` uses `MoveFocus` on parent focus/size-move; the container's older child-focus branch at `:221` alone is not the complete focus route. `composition_host.rs:283` installs the Ctrl+P accelerator filter. | No established menu/focus loss: June 25 assessment passed Cut/Copy/Paste/Undo, keyboard, return-from-alt-tab, minimize/restore and click focus. Native-chrome tab-out was untested and the app has no such chrome target. Printing is intentionally suppressed. 0.25–0.5 day smoke check; no repair budget until a regression is reproduced. |
| Drag/drop: copy glyph can appear although a dropped file does nothing | `tauri.conf.json:25` disables app drag/drop. Wry's handler creation is conditional at `vendor/wry/src/webview2/mod.rs:179`. `composition_host.rs:254` sets `AllowExternalDrop(false)` even without an app handler. No composition IDropTarget forwarding is implemented for a file-import feature. | Intended rejection, not lost file import. `prexu-jc8x` June 26 records user-confirmed inert drops and acceptance of the misleading copy glyph as cosmetic. The code comment at `composition_host.rs:249` overstates the no-drop cursor guarantee; use the observed record instead. 0.25 day to verify inertness. Replacing the runtime drop target for a glyph is not a justified small repair; enabling import is a new feature, likely several days plus product scope. |
| IME: candidate popup may be away from caret or fail to follow movement; composition/commit unknown | `vendor/wry/src/webview2/mod.rs:460` creates the composition controller against the Wry HWND. Keyboard continues through focus association, not a host `SendKeyboardInput` API. `composition_host.rs:346` calls `NotifyParentWindowPositionChanged`; `player/mod.rs:891` and `:943` invoke it before normal geometry work, subject to fullscreen-transition suppression. Wry also notifies parent movement at `mod.rs:1332`. | **Unverified, not a confirmed broken candidate popup.** `prexu-x2bt` records implementation in `3451d30` as a hypothesis; Korean paste was not IME testing. Budget 0.5–1 day to install/use CJK IME and capture behavior. If a defect appears, isolate focus, caret coordinates and transition notification first (1–3 days investigation); a general IME bridge is an unbounded larger slice, not authorized by this assessment. |

Estimates are engineering planning ranges, not measured implementation times;
they exclude obtaining hardware. The code comments asserting candidate placement
or universal input loss are design claims: ordinary keyboard already passed.
Microsoft documents parent-position notification for moved ancestor HWNDs and
certain dialogs, but that does not establish IME candidate correctness in this
app ([controller reference](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller)).
A future drop feature would require host IDropTarget forwarding and coordinate
conversion, as described in the [composition drag/drop reference](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2compositioncontroller3).

## Reproduction boundary and actual evidence

This audit ran on Linux (`uname -s` returned `Linux`). No Windows desktop was
available. **None of the five visible symptoms was reproduced in this run.**
No candidate or acceptance workflow was changed or dispatched. The existing
hosted job can exercise libmpv lifecycle but cannot establish this parity.

Read live records, not the stale JSONL export:

```sh
/home/paperclip/.local/bin/bd show prexu-0oc3 prexu-x2bt prexu-ga3x
/home/paperclip/.local/bin/bd show prexu-tpnq prexu-od2n prexu-jc8x prexu-c7bu prexu-ga3x.2
GH_REPO=nwilliams22/prexu gh run view 40847915615 --json headSha,jobs
```

Observed Beads statuses: `0oc3` and `ga3x` IN_PROGRESS; `x2bt` OPEN;
`tpnq`, `od2n`, `jc8x`, `c7bu` CLOSED; `ga3x.2` OPEN despite landed architecture.
The hardware findings cited above are the June 25–26 comments in those records.
The June 26 IME record explicitly deferred active CJK testing.

Existing [CI run 40847915615](https://github.com/nwilliams22/prexu/actions/runs/40847915615)
was read at job level for source revision `eb24f6624e3f858ebf186de1db0c834ba3d4d902`:
`ci`, Linux src-tauri build, Windows headless mpv, Linux headless mpv and the
advisory Linux Xvfb smoke job all concluded `success`. This is baseline evidence,
not CI for the report commit. `src-tauri/tests/headless_mpv.rs:65` sets `vo=null`
and `:67` sets `ao=null`; that job never tests the DComp/WebView2 composition.
The report commit's own job conclusions are recorded in the task review evidence.

| Check | Hosted runner finding | Required evidence / hardware |
| --- | --- | --- |
| DPI | Not reproducible on the available hosted path: no physical mixed-DPI monitors or interactive visual assessment. Static wiring/build checks do not prove crispness or hit testing. | Windows PC with GPU, displays at 100% and 150%/200%. Record text, click targets and video bounds before/after crossing both directions, including mini-player. Capture scale logs; distinguish auto detection from manual handler. |
| Alt-tab | Not reproducible on the available hosted path: no interactive desktop/GPU acceptance; the null-output mpv test excludes the render tree. Production creation requests `D3D_DRIVER_TYPE_HARDWARE` at `composition_host.rs:459`, not a test WARP path. | Windows 11 GPU PC with a second application and non-sensitive local moving test clip. Capture alt-tab tile with live video in windowed/fullscreen modes; return after occlusion and minimize/restore; verify video continues and keys work without a click. |
| Menus/focus | Not reproduced: existing hosted tests do not create and interact with the native WebView2 menus. Browser DOM tests are not native-menu evidence. | Same interactive Windows PC. Right-click a search field; test edit actions, Tab/Shift+Tab, return focus, F5/Ctrl+R, and verify Ctrl+P does not open printing. |
| Drops | Not reproduced: no Explorer-to-app OLE drag in current tests. A setting assertion is not a real drop. | Same Windows PC and a harmless local file. Drag and drop over library and player; require no navigation, import or crash; separately record glyph, without making glyph correctness a release gate. |
| IME | Not reproducible on the available hosted path: no configured interactive CJK input session/candidate popup observation. Pasting text is explicitly insufficient. | Same PC with Microsoft Japanese, Chinese or Korean IME installed. Type actual composition in search, observe inline string and candidate at caret, move window and cross DPI, select/commit/cancel, then repeat after focus and fullscreen transitions. Record OS, IME, WebView2, GPU/driver, scale and app revision. |

These are limits of the available runner and existing harness, not a claim that
Windows GUI automation can never be built. Such a harness would need its own
scope. Compiler checks can guard Windows types; pure tests can guard geometry
math. Neither certifies DWM thumbnails, native menus, DPI appearance or IME.

## Verdicts and proposed slices

All three requested beads receive the **unreproducible-in-CI / hardware
acceptance required** verdict; none is closed as fixed by this report.

- `prexu-0oc3`: implementation largely present, historical passes recorded;
  remaining umbrella acceptance needs the Windows GPU/mixed-DPI/IME setup above.
  Do not reopen already accepted menu/drop behavior as missing features.
- `prexu-x2bt`: unverified IME hypothesis; requires actual CJK composition on
  that interactive PC. Keep the existing bead for this work, not a duplicate.
- `prexu-ga3x`: single-surface implementation and historical alt-tab pass exist;
  current windowed/fullscreen/occlusion acceptance needs Windows 11 + GPU.
  Reconcile `prexu-ga3x.2` after that evidence rather than rebuilding Path C.

Proposed successor titles below are **names for the owner to file**, not claimed
existing bead IDs. The existing beads remain the backlog of record.

| Order / proposed slice | Dependency and size | Finish condition |
| --- | --- | --- |
| WIN-PARITY-1: capture current Windows composition baseline | First; one GPU desktop session, 0.5–1 day. Covers alt-tab, focus, menus, inert drops. | Revision-labelled recordings and pass/fail table for the scenarios above. A failed case gets a minimal repro before any repair scope. |
| WIN-PARITY-2: verify mixed-DPI composition transitions | After baseline; 0.5–1 day with two scaled displays. Keep distinct from broad fullscreen acceptance in existing `prexu-6p8k`. | Crisp text, aligned clicks/video through both monitor directions; log which scale path ran; no claim that an untriggered backup path was tested. |
| Existing `prexu-x2bt`: verify CJK candidate placement | After baseline; can run independently of the DPI slice except cross-monitor IME acceptance. 0.5–1 day initial investigation. | Active composition/commit/cancel and candidate-at-caret pass before/after movement, DPI and focus changes, or a captured defect with bounded repair proposal. |
| WIN-PARITY-3: reconcile composition umbrella acceptance | After baseline, DPI slice and `x2bt` verdict; less than half a day. | Update `0oc3`, `ga3x.2`, `ga3x` with current evidence; close only when their acceptance holds, or record explicit retained limitations with owner decision. |

If any baseline check fails, insert one narrowly named repair bead between the
failing check and the final reconciliation. Do not pre-authorize replacement
IME, menu or drop subsystems. The next engineering action is obtaining the
revision-labelled baseline; the scope report itself requires review, not a
hardware pass to pretend to complete its investigation.
