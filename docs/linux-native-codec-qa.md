# Linux native-player codec verification

## Result for 2026-10-30

**All eight supplied codec cases selected direct play through the Linux native player.**
The initial seven-case run used local debug build revision `8059c02` on Linux/X11 under Xvfb
`:97`, Mesa software rendering, with a session D-Bus. The selected Plex server
was **Prexu QA Test Server**. The board supplied the synthetic title map; I
independently inspected the AC3 item's Plex metadata and played each available
codec case. These results establish the app's runtime source decision. They do
not establish GPU rendering or audible output. The eighth case was added in
the separately identified DTS-HD MA follow-up below.

The corrected Plex resources check returned HTTP 200 and one `<resource>` named
**Prexu QA Test Server**. The initial sign-in attempt left no sanitized opener
trace, so it did not establish that the shell opener ran. I used the board's
isolated-profile seeding option instead: the run's protected credential was
written only to the temporary profile's Tauri `secure-store.json` with mode
0600, and the app validated it against Plex. The app then discovered and showed
the QA server. The credential, PIN, and token-bearing URLs were not printed or
recorded.

| duna.3 gap | QA title as displayed | Runtime log evidence from `runtime/prexu-qa/app.log` | Native verdict |
| --- | --- | --- | --- |
| HEVC 8-bit | Prexu QA HEVC8 (2023) | `18:44:37 [player] prepareSource {"ratingKey":"12","directPlayFailed":false,"skipCodecCheck":true}`<br>`18:44:37 [player] URL chosen: direct play {"container":"mkv","videoCodec":"hevc","audioCodec":"aac"}`<br>`18:44:37 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>.plex.direct:32500/library/parts/10/1793380084/"}` | **Direct-play** |
| HEVC 10-bit | Prexu QA (2022) | `18:45:16 [player] prepareSource {"ratingKey":"1","directPlayFailed":false,"skipCodecCheck":true}`<br>`18:45:16 [player] URL chosen: direct play {"container":"mkv","videoCodec":"hevc","audioCodec":"eac3"}`<br>`18:45:16 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>.plex.direct:32500/library/parts/1/1793168362/f"}` | **Direct-play** |
| AV1 | Prexu QA AV1 (2024) | `18:45:39 [player] prepareSource {"ratingKey":"11","directPlayFailed":false,"skipCodecCheck":true}`<br>`18:45:39 [player] URL chosen: direct play {"container":"mkv","videoCodec":"av1","audioCodec":"aac"}`<br>`18:45:39 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>.plex.direct:32500/library/parts/9/1793380096/f"}` | **Direct-play** |
| AC3 | Prexu QA Surround | `18:46:44 [player] prepareSource {"ratingKey":"3","directPlayFailed":false,"skipCodecCheck":true}`<br>`18:46:44 [player] URL chosen: direct play {"container":"mkv","videoCodec":"h264","audioCodec":"ac3"}`<br>`18:46:44 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>.plex.direct:32500/library/parts/3/1793168347/f"}` | **Direct-play** |
| E-AC3 | Prexu QA (2022), same file as HEVC 10-bit | Same playback as HEVC 10-bit: `18:45:16 [player] URL chosen: direct play {"container":"mkv","videoCodec":"hevc","audioCodec":"eac3"}`; direct URL `/library/parts/1/1793168362/f` | **Direct-play** |
| TrueHD | Prexu QA (2025) | `18:45:51 [player] prepareSource {"ratingKey":"10","directPlayFailed":false,"skipCodecCheck":true}`<br>`18:45:51 [player] URL chosen: direct play {"container":"mkv","videoCodec":"h264","audioCodec":"truehd"}`<br>`18:45:51 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>.plex.direct:32500/library/parts/8/1793380108/f"}` | **Direct-play** |
| DTS | Prexu QA (2019) | `18:46:03 [player] prepareSource {"ratingKey":"9","directPlayFailed":false,"skipCodecCheck":true}`<br>`18:46:03 [player] URL chosen: direct play {"container":"mkv","videoCodec":"h264","audioCodec":"dca"}`<br>`18:46:03 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>.plex.direct:32500/library/parts/7/1793380119/f"}` | **Direct-play** |
| DTS-HD MA | Prexu QA Lossless Surround (2018) | `19:37:05 [player] prepareSource {"ratingKey":"13","directPlayFailed":false,"skipCodecCheck":true}`<br>`19:37:05 [player] URL chosen: direct play {"container":"mkv","videoCodec":"h264","audioCodec":"dca-ma"}`<br>`19:37:05 [player] URL chosen {"kind":"direct","url":"https://<QA_SERVER>/library/parts/11/1793387220/"}` | **Direct-play** |

For every available playback the preceding app log included
`[player] prepareSource` with `skipCodecCheck:true`, followed by the quoted
`URL chosen: direct play` decision and a `kind:"direct"` `/library/parts/…`
URL. No `[playback] canDirectPlay` or `buildTranscodeUrl` decision was emitted
for these native-player loads: the native path deliberately skips the HTML5
codec whitelist. The direct part URLs establish that Prexu did not select the
Plex `/video/:/transcode/…` route. Plex's transcode-session endpoint was not
usable from this runner, so there is no independent server-session assertion.

The original duna.3 titles remain unavailable in the QA library. The synthetic
items are substitutes, not line-for-line title matches. Plex displayed the
HEVC 10-bit, TrueHD, and DTS items as `Prexu QA` with years 2022, 2025, and
2019; the selected streams and app logs identify the codecs shown above.

The original duna.3 comparison titles remain: The Abyss (HEVC 8-bit), 2 Fast 2
Furious (4K HEVC 10-bit), 21 Jump Street (AC3), and Air (E-AC3). The synthetic
titles are substitutions, not the original titles, and their use must be stated
in any later comparison. Plex may display the board-noted release years instead
of codec names for the HEVC 10-bit, TrueHD, and DTS rows.

The source of truth for each codec verdict is the running app's log for that
specific playback. On this native path the app logged
`skipCodecCheck:true` and `[player] URL chosen: direct play`, then selected a
Plex `/library/parts/…` URL. It did not call the HTML5-only
`[playback] canDirectPlay` helper or `buildTranscodeUrl`. The URLs above redact
the server's unique hostname while retaining the direct source path. Source
inspection, media metadata, server visibility, or successful app startup alone
is not a codec verdict.

An Xvfb screenshot during HEVC 8-bit playback showed the fixture's color bars,
but this matrix did not measure visible pixels for every codec. The GPU and
audio acceptance waiver remains in force: Xvfb uses software rendering and has
no audio sink. No 0.8.x release is evidence that native rendering works on real
hardware. Name the display/GPU or sound device and test host if those checks are
later run; leave them unproven until then.

## DTS-HD MA follow-up, 2026-10-30

At 19:37:05 UTC, the existing local native debug binary selected direct play
for ratingKey 13 on the same QA server. This follow-up used checkout `6d7abb3`
for the Vite frontend, Xvfb `:98` at 1280×800, and a session D-Bus. The binary
was not rebuilt; its SHA-256 was
`b81ff0c61c93b9ebb033d1f34464ebb2a7d938dd0e5cb5a85410aa5180b4c62a`.
The earlier seven-row build record above is unchanged.

The board supplied this fixture as a bit-exact `-c copy` clip of an owned
Blu-ray rip, not synthetic media: H.264 High 8-bit plus six-channel DTS-HD MA,
61.8 seconds. The previous authenticated metadata check returned HTTP 200,
media audio `dca-ma`, profile `ma`, and stream audio `dca`, profile `ma`,
6 channels. The app detail page displayed `DCA-MA · 5.1`; the quoted runtime
lines, rather than that metadata, establish the source-selection verdict.

Launch used the isolated-profile seed above and:

```bash
dbus-run-session -- bash -c 'export QA_DISPLAY=:98 QA_GEOMETRY=1280x800 QA_XSERVER=xvfb QA_FIT_WINDOW=1 VITE_PORT=1420 XDG_RUNTIME_DIR=/tmp/prexu-dts-qa/runtime XDG_CONFIG_HOME=/tmp/prexu-dts-qa/config XDG_DATA_HOME=/tmp/prexu-dts-qa/data; scripts/qa-desktop-session.sh start; exec sleep 1800'
```

Search for `Lossless`, open **Prexu QA Lossless Surround (2018)**, and click
Play on its detail page. Avoid using the rotating home carousel: an initial
click in this run opened ratingKey 11 (AV1), which is excluded from the
DTS-HD MA verdict. Confirm `ratingKey:"13"` in the log. The follow-up did not
measure rendered frames, audible output, lossless passthrough, or Plex server
transcode sessions. Those limits and the real-hardware waiver still apply.
The run-owned app, Xvfb, Vite and session holder were stopped; the temporary
credential store was removed. Sanitized decision lines are attached to the
tracking issue; temporary runtime paths are not the durable evidence store.

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
   the app directly); Xvfb alone does not supply a session bus. If its temporary
   `xdg-open` shim is used, keep only sanitized invocation metadata in its trace;
   never record argv values, because the auth URL contains the PIN.
4. Complete Plex sign-in. If no browser is available, seed the isolated profile
   with the app's normal storage shape. This command fetches the active user
   from Plex and writes only to the isolated profile; it does not print the
   credential or response body:

   ```bash
   python3 - <<'PY'
   import json, os, pathlib, urllib.request, uuid

   token = os.environ["PREXU_QA_PLEX_AUTH"]
   client_id = str(uuid.uuid4())
   request = urllib.request.Request(
       "https://clients.plex.tv/api/v2/user",
       headers={
           "X-Plex-Token": token,
           "X-Plex-Client-Identifier": client_id,
           "X-Plex-Product": "Prexu QA",
           "Accept": "application/json",
       },
   )
   with urllib.request.urlopen(request, timeout=20) as response:
       user = json.load(response)
   profile = {
       "auth_data": {"authToken": token, "clientIdentifier": client_id},
       "active_user": {
           "id": user["id"],
           "title": user.get("friendlyName") or user.get("username"),
           "username": user.get("username"),
           "thumb": user.get("thumb") or "",
           "isAdmin": True,
           "isHomeUser": False,
       },
   }
   store = pathlib.Path(os.environ["XDG_DATA_HOME"]) / "com.prexu.client" / "secure-store.json"
   store.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
   store.write_text(json.dumps(profile), encoding="utf-8")
   store.chmod(0o600)
   print("seeded isolated Plex profile")
   PY
   ```

   Omit `server_data`; the app will discover the shared QA server. Never print
   or attach the credential. Open the named server and library, and play one
   item at a time. Capture the app log from before the playback decision through
   URL selection. Preserve the relevant real log lines, redacting server
   hostnames and any URL credentials.
5. Mark a row **direct-play** only when the runtime decision and selected URL
   establish that the server transcode path was not selected. Mark it
   **transcode** when the runtime logs show that path. If the logs are absent or
   ambiguous, leave the row **unproven** and state what evidence is missing.
6. Separately record whether a frame was visible and audio was audible, naming
   the hardware used. A headless result must say these were not tested.

## Validation gates on local build `1836066` (checkout `8059c02`)

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

The validation output was recorded earlier on this checkout, not rerun during
the codec playback attempt. The default-worker E2E failure remains observed
even though the four-worker command passed. The original seven-row report was
reviewed; the DTS-HD MA follow-up needs its own review. Worker-count remediation
is tracked separately from this report. The `prexu-axj4.5` Beads prerequisite
remains explicit. Xvfb results do not
establish real-GPU rendering or audible playback.

## Current native playback verification, 2026-11-10

**All eight codec rows passed direct-play selection and visible-frame checks on
the current checkout `3338007`.** The run used Linux/X11, Xvfb `:98` at
1280×800, Mesa software GL, an isolated XDG profile, session D-Bus, Vite on
port 1420, and the Prexu QA Test Server. The debug executable was rebuilt from
this checkout. Its playback runtime was the checksum-verified patched libmpv
from the BAD-292 QA attachment: `libmpv.so.2` SHA-256
`bd8fbceb286353c0069fbfc007e307052966f8d0a771b5f39c6a5dc918c721c1`. The
baseline system library produced a black capture on the first attempt; the
codec verdicts below use the patched library, confirmed in the running
process's `/proc/<pid>/maps`.

Each row was played in the native player. The sanitized runtime log records
`skipCodecCheck:true`, the codec-specific `URL chosen: direct play` line and a
selected `/library/parts/…` URL. No `buildTranscodeUrl` or `canDirectPlay`
helper line was present in the playback log. Captures show the rendered test
pattern at two points; ImageMagick grayscale means were nonzero and the
normalized mean absolute error (MAE) between each capture pair was nonzero.
The exact sanitized log lines and captures are attached to BAD-358 in
`linux-native-codec-qa-2026-11-10.tar.gz`.

| Codec row | QA title shown | Runtime selection | Capture pair (gray means; normalized MAE) | Verdict |
| --- | --- | --- | --- | --- |
| H.264/AAC | Prexu QA Pattern (2020) | `ratingKey:2`, `h264` / `aac`, direct `/library/parts/2/1793168329/f` | `11-h264aac-playback.png`, `12-h264aac-playback-later.png` (`0.419241`, `0.429989`; `0.068827`) | **PASS** |
| HEVC 8-bit | Prexu QA HEVC8 (2023) | `ratingKey:12`, `hevc` / `aac`, direct `/library/parts/10/1793380084/` | `03-hevc8-playback.png`, `04-hevc8-playback-later.png` (`0.431020`, `0.739167`; `0.541612`) | **PASS** |
| HEVC 10-bit | Prexu QA (2022) | `ratingKey:1`, `hevc` / `eac3`, direct `/library/parts/1/1793168362/f` | `80-hevc10-playback.png`, `81-hevc10-later.png` (`0.422065`, `0.429917`; `0.052001`) | **PASS** |
| AV1 | Prexu QA AV1 (2024) | `ratingKey:11`, `av1` / `aac`, direct `/library/parts/9/1793380096/f` | `31-av1-playback.png`, `32-av1-later.png` (`0.421653`, `0.428769`; `0.051696`) | **PASS** |
| AC3 | Prexu QA Surround (2021) | `ratingKey:3`, `h264` / `ac3`, direct `/library/parts/3/1793168347/f` | `41-ac3-playback.png`, `42-ac3-later.png` (`0.420408`, `0.429740`; `0.060670`) | **PASS** |
| E-AC3 | Prexu QA (2022), same file as HEVC 10-bit | `ratingKey:1`, `hevc` / `eac3`, direct `/library/parts/1/1793168362/f`; separately replayed | `82-eac3-playback.png`, `83-eac3-later.png` (`0.419063`, `0.423346`; `0.038891`) | **PASS** |
| TrueHD | Prexu QA (2025) | `ratingKey:10`, `h264` / `truehd`, direct `/library/parts/8/1793380108/f` | `52-truehd-playback.png`, `53-truehd-later.png` (`0.425369`, `0.424151`; `0.023795`) | **PASS** |
| DTS | Prexu QA (2019) | `ratingKey:9`, `h264` / `dca`, direct `/library/parts/7/1793380119/f` | `61-dts-playback.png`, `62-dts-later.png` (`0.421535`, `0.422913`; `0.023030`) | **PASS** |
| DTS-HD MA | Prexu QA Lossless Surround (2018) | `ratingKey:13`, `h264` / `dca-ma`, direct `/library/parts/11/1793387220/` | `71-dtsma-playback.png`, `72-dtsma-later.png` (`0.201759`, `0.258451`; `0.181547`) | **PASS** |

The direct URL and runtime log establish that Prexu did not choose the Plex
transcode route. The Xvfb captures establish visible, changing pixels for this
software-rendered Linux session only. They do not establish hardware video
decoding. No real audio device was available: audible output and lossless audio
passthrough remain unverified. No real-GPU rendering was tested.

## Validation gates on local checkout `3338007`

Commands rerun on 2026-11-10:

| Command | Result | Interpretation |
| --- | --- | --- |
| `npx tsc --noEmit` | **Exit 0** | TypeScript check passed. |
| `npx vitest run` | **Exit 0**; 214 files, 2,414 tests passed | Full frontend unit suite passed. |
| `npx vitest run src/hooks/player/engineResolution.test.ts src/hooks/player/useNativePlayer.test.ts` | **Exit 0**; 2 files, 58 tests passed | HTML5 fallback and native-player hook tests passed. |
| `mise run clippy-tauri` | **Exit 0** | Frontend production build and desktop `cargo clippy --all-targets -- -D warnings` passed. Vite emitted dependency-annotation and chunk-size warnings. |
| `mise run clippy-relay` | **Exit 0** | Relay `cargo clippy --all-targets -- -D warnings` passed. |
| `CARGO_TARGET_DIR="$PAPERCLIP_TASK_SCRATCH_DIR/prexu-qa98/clean-native-target" cargo build --manifest-path src-tauri/Cargo.toml` | **Exit 0** | Fresh Linux build; `ldd` confirmed a link to `libmpv.so.2`. The temporary target was removed after verification. |
| `mise run hw-probe:selftest` | **Exit 0**; 64/64 assertions passed | Probe self-test passed; Nushell emitted its existing `str downcase` deprecation warning. |

These checks are local results on `3338007`; CI has not yet run against an
updated QA document. A passing local build/test run does not certify GPU,
audible audio or lossless passthrough.
