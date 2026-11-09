//! Explicit real-libmpv clock check. No GPU or audible output acceptance.
#[cfg(any(target_os = "windows", target_os = "linux"))]
#[test]
#[ignore = "requires runtime libmpv; run explicitly with --ignored --nocapture"]
fn speed_changes_media_clock() {
    use libmpv2::Mpv;
    use std::time::{Duration, Instant};
    let mpv = Mpv::with_initializer(|init| {
        init.set_property("vo", "null")?;
        init.set_property("ao", "null")?;
        init.set_property("keep-open", "always")
    })
    .unwrap();
    mpv.command(
        "loadfile",
        &["av://lavfi:testsrc=duration=30:size=32x24:rate=25"],
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while mpv.get_property::<f64>("time-pos").is_err() {
        assert!(Instant::now() < deadline, "source did not load");
        std::thread::sleep(Duration::from_millis(20));
    }
    for rate in [0.5_f64, 1.0, 2.0] {
        mpv.set_property("speed", rate).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let start = mpv.get_property::<f64>("time-pos").unwrap();
        let clock = Instant::now();
        std::thread::sleep(Duration::from_secs(2));
        let end = mpv.get_property::<f64>("time-pos").unwrap();
        let measured = (end - start) / clock.elapsed().as_secs_f64();
        println!(
            "requested={rate:.1} measured={measured:.3} media_delta={:.3}",
            end - start
        );
        assert!(
            (measured - rate).abs() < 0.15,
            "media clock does not match speed"
        );
    }
}
