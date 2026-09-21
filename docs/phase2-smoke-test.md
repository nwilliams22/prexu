# Native playback smoke test

Updated 2026-09-20. Use normal Plex playback in `npm run tauri dev` on Windows
or Linux, with Settings selecting native/auto. This validates the current
render-API implementation, not the former sibling-HWND architecture.

## Preparation

Install [Windows native binaries](../src-tauri/bin/README.md) or
[Linux prerequisites](linux-dev.md). Record commit, build profile, OS/session,
GPU/driver, media codecs, and chosen engine with the result. Use a known
HEVC 10-bit item plus an item with text subtitles. Ensure only the intended
Prexu instance is running.

## Scenarios

1. Play from a detail page. Confirm video, audio, advancing seekbar, and usable
   controls. Check logs for native selection and hardware-decoding evidence;
   codec choice alone does not prove which engine ran.
2. Pause/play, seek, change volume/mute, audio track and subtitles. Confirm
   video/audio resynchronization and subtitle rendering after seeking.
3. Resize, maximize/restore, and move between displays where available.
   Check that video and UI agree on geometry and display scaling.
4. Enter/exit fullscreen using controls and keyboard. Confirm state and geometry
   recover, including after stopping playback while fullscreen.
5. Minimize to the in-window player, browse the library, and restore using the
   restore control. Check subtitle scale and that no video margins leak afterward.
6. Enter/exit popout; resize it and repeat. Windows/X11 should restore saved
   geometry. Wayland placement and keep-above are compositor-controlled; see
   [Linux scenarios](linux-on-hardware-test-plan.md).
7. Stop and play another item. Audio must stop promptly, the application must
   recover without a blank stage or stale video, and the next session starts
   unmuted. Episode handoff within one muted session should retain mute.
8. Exercise EOF with and without a next item. Continuation should advance;
   no-continuation exit should not add a return-countdown delay.
9. Close the application during playback. Confirm no lingering audio, frozen
   process, or orphaned player process.

Record failures in Beads with logs and reproduction steps; retain the build
profile because timing differs between debug and release. Known Linux resize
presentation lag (`prexu-41cw`) and Windows fullscreen verification
(`prexu-6p8k`) are open work, not automatic passes.

This smoke pass does not certify every codec, hardware decoder, package, or
Watch Together flow. Use the [full Linux plan](linux-on-hardware-test-plan.md),
[hardware probes](hw-probe-runbook.md), and issue-specific acceptance criteria.
