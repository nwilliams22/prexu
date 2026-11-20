# macOS test installer

The manual **macOS candidate** Actions workflow builds a universal DMG for
Apple Silicon and Intel Macs. It packages the macOS HTML5 player from the
selected workflow commit. It does not create a release or update feed.

Run the workflow from `main`, then download its `macos-candidate-<commit>-<attempt>`
artifact. Extract the ZIP. `BUILD.txt` records the exact commit, workflow run,
and tool versions; `SHA256SUMS.txt` records the DMG checksum. From the extracted
folder, `shasum -a 256 -c SHA256SUMS.txt` verifies the download.

Open the DMG, drag Prexu into Applications, eject the image, and open Prexu.
Quit an existing Prexu instance before installing or starting the candidate.
This test app uses the normal Prexu settings and sign-in storage.

The app is ad-hoc signed, without an Apple Developer ID certificate or
notarization. If macOS blocks opening it, use System Settings → Privacy &
Security → Open Anyway after trying to open Prexu. Do not disable Gatekeeper
system-wide. Report the exact message if macOS still refuses to launch it.
See [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).

## Playback acceptance

Use the synthetic `PRX HEVC10 AAC` and `PRX H264 AC3` MP4 fixtures supplied
with the playback task. Add them to a Plex Other Videos library and scan it.

1. Set direct play to **Auto**, quality to **1080p**, and subtitles to **Off**.
   Do not use Original quality: it bypasses the codec gate being tested.
2. Stream each title from Plex using the HTML5 player; do not use downloads.
3. Confirm moving picture and audible tone for each title.
4. Report the build commit, Mac model and macOS version, each title's result,
   and the playback decision lines from `~/Library/Logs/com.prexu.client/`.
   A pass has `[playback] canDirectPlay {"canDirectPlay":true}` and no
   `[playback] buildTranscodeUrl` for that playback. Send only these decision
   lines, not full logs containing server or account information.

The workflow verifies both executable architectures, the app's ad-hoc
signature, the DMG integrity, and the focused playback tests. A successful
build does not prove installation, launch, video output or sound on a Mac.
Those checks remain the tester's responsibility.
