//! Headless mpv integration test — validates the signal chain that production
//! code relies on for episode queue advancement (prexu-0cs / prexu-ta9).
//!
//! Signal sequence under test:
//!   mpv init succeeds
//!     → FileLoaded observed
//!       → positive duration property observed
//!         → eof-reached true-edge observed
//!
//! The synthetic source `av://lavfi:testsrc` is used so no fixture file is
//! required. Spike verdict (prexu-fbk.2): lavfi IS available in the bundled
//! libmpv-2.dll — confirmed by running the probe on 2026-05-29 against
//! libmpv2 = "4.1.0" / libmpv-2.dll Windows binary.
//!
//! GATING:
//!   #[ignore]              — keeps test out of `cargo test` default run;
//!                            requires explicit `-- --ignored` to run.
//!   #[cfg(target_os = "windows")] — bundled libmpv-2.dll is a Windows binary;
//!                            linux/mac runners cannot load it.
//!
//! Running locally:
//!   cd src-tauri
//!   cargo test --test headless_mpv -- --nocapture --ignored
//!
//! The test binary locates libmpv-2.dll via the PATH or the DLL already
//! copied to target\debug\deps\ at build time (see CI job for details).

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod inner {
    use libmpv2::{
        events::{Event, EventContext, PropertyData},
        Format, Mpv,
    };
    use std::time::{Duration, Instant};

    // reply_userdata IDs — mirror events.rs conventions
    const REPLY_DURATION: u64 = 1;
    const REPLY_EOF_REACHED: u64 = 2;

    /// A 1-second synthetic video from lavfi/testsrc at the smallest practical
    /// resolution.  The 5 fps rate keeps CPU time minimal on CI runners.
    const LAVFI_URL: &str = "av://lavfi:testsrc=duration=1:size=32x24:rate=5";

    /// Maximum wall-clock time the event loop is allowed to run.  If all four
    /// signals arrive the loop exits in ~2 s on real hardware; 20 s gives
    /// ample headroom for slow CI runners without hanging indefinitely.
    const MAX_WALL: Duration = Duration::from_secs(20);
    /// Safety cap on loop iterations so the test cannot spin forever even if
    /// wait_event returns immediately every call.
    const MAX_ITERS: u32 = 2_000;

    /// Create a headless Mpv instance configured to match the headless subset
    /// of the production init (keep-open=always, same EOF semantics).
    fn headless_mpv() -> Mpv {
        Mpv::with_initializer(|init| {
            // No window — headless render
            init.set_property("vo", "null")?;
            // No audio output — headless
            init.set_property("ao", "null")?;
            // No hardware decode — software only for reproducibility
            init.set_property("hwdec", "no")?;
            // No physical window — matches production force-window=no
            init.set_property("force-window", "no")?;
            // No embedded cover art display
            init.set_property("audio-display", "no")?;
            // CRITICAL: keep-open=always matches production. With this set mpv
            // pauses at EOF instead of unloading, and raises eof-reached=true
            // rather than always firing EndFile for natural EOF.
            init.set_property("keep-open", "always")?;
            // Speed up playback so the 1s clip finishes quickly on CI
            init.set_property("speed", 100_i64)?;
            Ok(())
        })
        .expect("headless mpv init failed — is libmpv-2.dll on PATH or in the test binary dir?")
    }

    #[test]
    #[ignore]
    fn signal_chain_init_fileloaded_duration_eof() {
        let mpv = headless_mpv();

        let mut ev_ctx = EventContext::new(mpv.ctx);

        ev_ctx
            .observe_property("duration", Format::Double, REPLY_DURATION)
            .expect("observe duration failed");
        ev_ctx
            .observe_property("eof-reached", Format::Flag, REPLY_EOF_REACHED)
            .expect("observe eof-reached failed");

        // Issue loadfile — this is the equivalent of the production
        // player_load_file Tauri command
        mpv.command("loadfile", &[LAVFI_URL, "replace"])
            .expect("loadfile command failed");

        // ── Event loop ───────────────────────────────────────────────────────
        // Poll with a 0.5s wait_event timeout.  The loop exits early as soon as
        // all four signals are observed, or hard-stops at MAX_WALL / MAX_ITERS
        // (whichever comes first) so it can never hang CI.

        let deadline = Instant::now() + MAX_WALL;
        let mut iters: u32 = 0;

        let got_init = true; // satisfied by successful headless_mpv() above
        let mut got_file_loaded = false;
        let mut got_positive_duration = false;
        let mut got_eof = false;

        while iters < MAX_ITERS && Instant::now() < deadline {
            iters += 1;

            match ev_ctx.wait_event(0.5) {
                Some(Ok(Event::FileLoaded)) => {
                    eprintln!("[headless_mpv] FileLoaded (iter {})", iters);
                    got_file_loaded = true;
                }
                Some(Ok(Event::PropertyChange {
                    reply_userdata: REPLY_DURATION,
                    change: PropertyData::Double(d),
                    ..
                })) => {
                    eprintln!("[headless_mpv] duration={:.3} (iter {})", d, iters);
                    if d > 0.0 {
                        got_positive_duration = true;
                    }
                }
                Some(Ok(Event::PropertyChange {
                    reply_userdata: REPLY_EOF_REACHED,
                    change: PropertyData::Flag(reached),
                    ..
                })) => {
                    eprintln!("[headless_mpv] eof-reached={} (iter {})", reached, iters);
                    if reached {
                        got_eof = true;
                        // Rising edge seen — no need to keep looping
                        break;
                    }
                }
                Some(Err(e)) => {
                    // mpv errors are unexpected; record and keep going so the
                    // asserts below emit the clearest possible failure message
                    eprintln!("[headless_mpv] mpv error: {:?} (iter {})", e, iters);
                }
                None => {
                    // wait_event timed out — normal, keep iterating
                }
                Some(Ok(other)) => {
                    eprintln!("[headless_mpv] event: {:?} (iter {})", other, iters);
                }
            }

            // Fast-exit once all four signals collected
            if got_init && got_file_loaded && got_positive_duration && got_eof {
                break;
            }
        }

        // ── Assertions ───────────────────────────────────────────────────────
        // Ordered so the failure message names the earliest missing signal.

        assert!(
            got_init,
            "SIGNAL 1 MISSING: mpv init did not succeed (unreachable — init panics above)"
        );
        assert!(
            got_file_loaded,
            "SIGNAL 2 MISSING: FileLoaded was never observed (lavfi source failed to open?)"
        );
        assert!(
            got_positive_duration,
            "SIGNAL 3 MISSING: positive duration was never observed (demuxer did not parse headers?)"
        );
        assert!(
            got_eof,
            "SIGNAL 4 MISSING: eof-reached true-edge was never observed \
             (keep-open=always requires eof-reached, not EndFile) — \
             ran {} iters / {:.1?} wall time",
            iters,
            MAX_WALL
        );

        eprintln!(
            "[headless_mpv] PASS — all 4 signals observed in {} iters",
            iters
        );
    }
}

// On non-Windows platforms the bundled DLL cannot be loaded; the test is
// skipped rather than erroring so `cargo test` on Linux (CI ubuntu job) is
// not broken.
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
#[test]
#[ignore]
fn signal_chain_init_fileloaded_duration_eof() {
    eprintln!(
        "[headless_mpv] skipped on non-Windows — libmpv-2.dll is a Windows binary. \
         Run this test on Windows with: \
         cd src-tauri && cargo test --test headless_mpv -- --nocapture --ignored"
    );
}
