# Linux native-player codec verification

## Result for 2026-10-30

**Codec verdicts: unproven.** The configured Plex account can now discover the
dedicated QA server, and the board supplied a map of synthetic media for seven
codec gaps. I launched the local native-player debug build under Xvfb and
confirmed the Linux compositor installed, but the isolated QA profile remained
at the Plex sign-in screen. This runner has no browser for the sign-in handoff,
so I could not open the library or capture playback-decision logs. A reachable
server, a compositor startup, and synthetic media descriptions do not establish
direct-play or transcode behavior.

Plex visibility was checked against
`https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1` using the
configured `PREXU_QA_PLEX_AUTH` credential. The XML response was HTTP 200 with
one `<resource>` entry named **Prexu QA Test Server**. The earlier zero-resource
result was a false negative: the checker searched for the old `<Device>` element
name. No credential or token-bearing URL is recorded here.

The QA server's board-provided synthetic title map is below. These title and
stream descriptions have not been independently inspected or played in this
run. The DTS-HD MA fixture is unavailable because the board reports that its
ffmpeg build has no encoder for that codec.

| Gap | QA server title (board-provided) | Board-reported streams | Native verdict | Evidence still required |
| --- | --- | --- | --- | --- |
| HEVC 8-bit | Prexu QA HEVC8 | HEVC Main, yuv420p + AAC | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| HEVC 10-bit | Prexu QA (HEVC 2022) | HEVC Main 10 + E-AC3 5.1 | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| AV1 | Prexu QA AV1 | AV1 Main 10-bit + AAC | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| AC3 | Prexu QA Surround | H.264 + AC3 5.1 | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| E-AC3 | Prexu QA (HEVC 2022) | Same file as HEVC 10-bit | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| TrueHD | Prexu QA (2025) | H.264 + TrueHD 5.1 | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| DTS | Prexu QA (2019) | H.264 + DTS core 5.1 | Unproven | Play the selected item and capture the runtime decision and chosen URL. |
| DTS-HD MA | Not available | No synthetic fixture; board reports no ffmpeg encoder | Untestable with the supplied synthetic media | Provide a source item containing DTS-HD MA and then capture the runtime decision and chosen URL. |

The original duna.3 comparison titles remain: The Abyss (HEVC 8-bit), 2 Fast 2
Furious (4K HEVC 10-bit), 21 Jump Street (AC3), and Air (E-AC3). The synthetic
titles are substitutions, not the original titles, and their use must be stated
in any later comparison. Plex may display the board-noted release years instead
of codec names for the HEVC 10-bit, TrueHD, and DTS rows.

The source of truth for each codec verdict is the running app's log for that
specific playback: the `[playback] canDirectPlay` decision, whether
`buildTranscodeUrl` ran, and the `[player]` URL selected. Quote those real lines
verbatim in the table before marking a row **direct-play** or **transcode**.
Redact URL credentials while retaining enough structure to identify a source
URL versus a transcode URL. Source inspection, media metadata, server visibility,
or successful app startup is not a codec verdict.

This run did not establish visible video or audible sound. The GPU and audio
acceptance waiver remains in force: Xvfb uses software rendering and has no
audio sink. No 0.8.x release is evidence that native rendering works on real
hardware. Name the display/GPU or sound device and test host if those checks are
later run; leave them unproven until then.

## Repeat procedure

1. Record the local build revision or published artifact, host OS/session, and
   Plex server identity. Do not record credentials or token-bearing URLs.
2. Confirm the server and test items are visible. The Plex resources endpoint
   returns XML `<resource>` elements; do not search for `<Device>`. Record each
   item's displayed title, selected media version, and video/audio codecs. If
   an original duna.3 title is absent, name the exact substitute.
3. Launch Prexu with the native player enabled. Follow
   [the Linux Xvfb playback QA runbook](linux-xvfb-qa-runbook.md). It supplies a
   session D-Bus as well as Xvfb (`dbus-run-session -- xvfb-run …` when invoking
   the app directly); Xvfb alone does not supply a session bus.
4. Complete the Plex sign-in handoff, open the named server and library, and
   play one item at a time. Capture the app log from before the playback
   decision through URL selection. Preserve the relevant real log lines.
5. Mark a row **direct-play** only when the runtime decision and selected URL
   establish that the server transcode path was not selected. Mark it
   **transcode** when the runtime logs show that path. If the logs are absent or
   ambiguous, leave the row **unproven** and state what evidence is missing.
6. Separately record whether a frame was visible and audio was audible, naming
   the hardware used. A headless result must say these were not tested.

## Validation gates on local revision `1836066`

Commands run on 2026-10-30:

| Command | Result | Interpretation |
| --- | --- | --- |
| `npx playwright test --project=chromium --project=player-chrome` | **Exit 1**; 147 passed, 17 failed | At the default 16 workers, 17 Chromium tests failed with blank-page/timeout symptoms; captured failure screenshots were black. This run is not a pass. |
| `npx playwright test --project=chromium --project=player-chrome --workers=4` | **Exit 0**; 164 passed | Pass at four workers, including all six player-chrome tests. |
| `npx vitest run` | **Exit 0**; 201 files, 2,331 tests passed | Pass. |
| `npx tsc --noEmit && npm run lint && npm run build` | **Exit 0** | Pass. Lint emitted the existing warnings at `src/services/watch-sync.test.ts:77` and `src/services/plex-playback.test.ts:569`; Vite emitted dependency annotation and chunk-size warnings. |
| `mise run clippy-tauri` | **Exit 0** | Pass with `-D warnings`. |
| `mise run test-tauri` | **Exit 0**; 217 passed, 0 failed, 3 ignored | Pass. |
| `mise run clippy-relay` | **Exit 0** | Pass with `-D warnings`. |
| `mise run test-relay` | **Exit 0**; 37 integration tests passed | Pass. |
| `cargo build` from `src-tauri/` | **Exit 0** | Pass; native-player debug build completed. |
| `mise run hw-probe:selftest` | **Exit 0**; 64/64 assertions passed | Pass. Nushell emitted its existing `str downcase` deprecation warning. |
| `ldd /home/paperclip/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell` | **Exit 0**; no missing-library entries | Chromium headless-shell system libraries are present. |

`mise run ci` was not run because its E2E task first invokes
`npx playwright install --with-deps chromium`, which calls `sudo apt-get` even
when the browser is installed. The direct checks above cover the remaining gate
tasks, and `ldd` found no missing headless-shell libraries. The default-worker
E2E failure remains an observed issue despite the four-worker pass; do not
describe the unqualified default command as green.

Codec closure remains pending: complete the authenticated playback matrix,
record all per-title log decisions or explicit missing-item requirements, and
obtain Duncan's review. The outstanding `prexu-axj4.5` Beads prerequisite must
also be resolved before its gated children can close. Xvfb results do not
establish real-GPU rendering or audible playback.
