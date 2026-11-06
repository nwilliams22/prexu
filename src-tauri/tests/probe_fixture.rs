//! Signal-only regression checks using the generated av-cues-v1 corpus.
//! Generate with scripts/hw-probe/driver/fixtures.py, then set
//! PREXU_TEST_FIXTURE to its av-cues-v1.mkv absolute path. Null outputs do
//! not establish visible frames, audible tones, or hardware correctness.

#[path = "../src/probe_snapshot.rs"]
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod probe_snapshot;

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod tests {
    use libmpv2::{
        events::{Event, EventContext, PropertyData},
        Format, Mpv,
    };
    use std::time::{Duration, Instant};

    fn player() -> Mpv {
        Mpv::with_initializer(|init| {
            init.set_property("vo", "null")?;
            init.set_property("ao", "null")?;
            init.set_property("hwdec", "no")?;
            init.set_property("keep-open", "always")?;
            init.set_property("pause", true)?;
            Ok(())
        })
        .expect("mpv initialization failed")
    }

    fn wait_for(events: &mut EventContext, predicate: impl Fn(&Event) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Some(Ok(event)) = events.wait_event(0.05) {
                if predicate(&event) {
                    return;
                }
            }
        }
        panic!("expected mpv event missing after 10 seconds");
    }

    #[test]
    #[ignore = "requires generated fixture and real libmpv"]
    fn seek_tracks_and_stop() {
        let path = std::env::var("PREXU_TEST_FIXTURE").expect("PREXU_TEST_FIXTURE required");
        assert!(
            std::path::Path::new(&path).is_absolute(),
            "fixture path must be absolute"
        );
        let mpv = player();
        let mut events = EventContext::new(mpv.ctx);
        mpv.command("loadfile", &[&path]).unwrap();
        wait_for(&mut events, |e| matches!(e, Event::PlaybackRestart));
        // mpv can normalize Windows separators. Verify file identity before
        // using its spelling for the snapshot's exact transport-path check.
        let loaded_path = mpv.get_property::<String>("path").unwrap();
        assert_eq!(
            std::fs::canonicalize(&loaded_path).unwrap(),
            std::fs::canonicalize(&path).unwrap(),
            "mpv loaded a different fixture"
        );
        let path = loaded_path;
        let snapshot = super::probe_snapshot::sample(&mpv, &path);
        assert!(!serde_json::to_string(&snapshot).unwrap().contains(&path));
        assert!(snapshot.initialized && snapshot.fixture_matches && !snapshot.idle);
        assert_eq!(snapshot.paused, Some(true));
        assert!(!super::probe_snapshot::sample(&mpv, "wrong-fixture").fixture_matches);
        assert!(!super::probe_snapshot::Snapshot::absent().initialized);
        assert!((mpv.get_property::<f64>("duration").unwrap() - 15.0).abs() < 0.05);
        assert_eq!(mpv.get_property::<i64>("track-list/count").unwrap(), 4);
        for (index, kind) in [(0, "video"), (1, "audio"), (2, "audio"), (3, "sub")] {
            assert_eq!(
                mpv.get_property::<String>(&format!("track-list/{index}/type"))
                    .unwrap(),
                kind
            );
        }
        for position in [2.0_f64, 11.0, 6.0] {
            mpv.command("seek", &[&position.to_string(), "absolute+exact"])
                .unwrap();
            wait_for(&mut events, |e| matches!(e, Event::PlaybackRestart));
            let actual = super::probe_snapshot::sample(&mpv, &path)
                .position_ms
                .unwrap()
                / 1000.0;
            assert!(
                (actual - position).abs() <= 0.15,
                "seek: expected {position}, got {actual}"
            );
        }
        for track in [2_i64, 1] {
            mpv.set_property("aid", track).unwrap();
            assert_eq!(
                super::probe_snapshot::sample(&mpv, &path).audio_track,
                Some(track)
            );
        }
        mpv.set_property("sid", 1_i64).unwrap();
        assert_eq!(
            super::probe_snapshot::sample(&mpv, &path).subtitle_track,
            Some(1)
        );
        mpv.set_property("sid", "no").unwrap();
        assert_eq!(
            super::probe_snapshot::sample(&mpv, &path).subtitle_track,
            Some(0)
        );
        mpv.set_property("pause", false).unwrap();
        assert_eq!(
            super::probe_snapshot::sample(&mpv, &path).paused,
            Some(false)
        );
        events
            .observe_property("idle-active", Format::Flag, 9)
            .unwrap();
        mpv.command("stop", &[]).unwrap();
        wait_for(&mut events, |e| {
            matches!(
                e,
                Event::PropertyChange {
                    reply_userdata: 9,
                    change: PropertyData::Flag(true),
                    ..
                }
            )
        });
        let stopped = super::probe_snapshot::sample(&mpv, &path);
        assert!(stopped.idle && !stopped.fixture_matches);
        let serialized = serde_json::to_string(&stopped).unwrap();
        assert!(!serialized.contains(&path));
        drop(events);
        let start = Instant::now();
        drop(mpv);
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "teardown exceeded deadline"
        );
        eprintln!("[probe-fixture] PASS duration, 4 streams, 3 seeks, audio/subtitle selection, idle, teardown (null outputs)");
    }

    #[test]
    #[ignore = "requires real libmpv"]
    fn invalid_input_reports_error() {
        let mpv = player();
        let mut events = EventContext::new(mpv.ctx);
        mpv.command("loadfile", &["prexu-invalid-protocol://invalid"])
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut failed = false;
        while Instant::now() < deadline {
            // libmpv2 maps mpv_event_end_file.error to Err, not EndFile.
            if matches!(events.wait_event(0.05), Some(Err(_))) {
                failed = true;
                break;
            }
        }
        assert!(failed, "invalid media did not produce an mpv error");
        eprintln!("[probe-fixture] PASS invalid input produced mpv error");
    }
}
