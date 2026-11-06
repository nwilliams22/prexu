//! Exercise the native preflight parser without starting Tauri or reading stores.
#[path = "../src/probe_script.rs"]
mod probe_script;

#[test]
fn contract_corpus() {
    let corpus: serde_json::Value = serde_json::from_str(include_str!(
        "../../scripts/hw-probe/driver/script-corpus.json"
    ))
    .unwrap();
    for case in corpus.as_array().unwrap() {
        let raw = case["raw"].as_str().unwrap();
        assert_eq!(
            probe_script::parse(raw.as_bytes()).is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn bounded_input() {
    assert_eq!(
        probe_script::parse(&vec![b' '; probe_script::MAX_BYTES + 1]),
        Err("input_size")
    );
    assert!(probe_script::parse(&[0xff]).is_err());
    assert!(
        probe_script::parse(format!("{}0{}", "[".repeat(200), "]".repeat(200)).as_bytes()).is_err()
    );
}

#[path = "../src/probe_bootstrap.rs"]
mod probe_bootstrap;

#[test]
fn isolated_preflight() {
    use std::fs;
    use std::io::Write;
    let root = std::env::temp_dir().join(format!(
        "prexu-preflight-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&root).unwrap();
    let script = root.join("script.json");
    let state = root.join("state");
    let output = root.join("output");
    let raw = r#"{"schema":"prexu.probe.script","version":1,"runId":"test","fixture":"av-cues-v1","timeoutMs":1000,"steps":[{"id":"quit","action":"quit","timeoutMs":1000}]}"#;
    fs::write(&script, raw).unwrap();
    let mut prepared = probe_bootstrap::prepare(&script, &state, &output).unwrap();
    assert_eq!(prepared.script["runId"], "test");
    assert_eq!(prepared.state_dir, fs::canonicalize(&state).unwrap());
    prepared.events.write_all(b"sentinel").unwrap();
    drop(prepared);
    assert!(probe_bootstrap::prepare(&script, &state, &output).is_err());
    assert_eq!(fs::read(output.join("events.jsonl")).unwrap(), b"sentinel");
    let unused = root.join("unused");
    assert!(probe_bootstrap::prepare(&script, &state, &unused).is_err());
    assert!(!unused.exists());
    assert!(probe_bootstrap::prepare(&script, &unused, &unused).is_err());
    assert!(!unused.exists());
    assert!(probe_bootstrap::prepare(&script, std::path::Path::new("relative"), &unused).is_err());
    let existing_output = root.join("existing-output");
    fs::create_dir(&existing_output).unwrap();
    fs::write(existing_output.join("private"), b"preserve").unwrap();
    assert!(
        probe_bootstrap::prepare(&script, &root.join("fresh-state"), &existing_output).is_err()
    );
    assert_eq!(
        fs::read(existing_output.join("private")).unwrap(),
        b"preserve"
    );
    #[cfg(unix)]
    {
        let alias = root.join("alias");
        std::os::unix::fs::symlink(&state, &alias).unwrap();
        assert!(probe_bootstrap::prepare(&script, &alias, &unused).is_err());
        assert!(!unused.exists());
    }
    assert!(probe_bootstrap::prepare(&root, &unused, &root.join("unused-output")).is_err());
    fs::write(&script, vec![b' '; probe_script::MAX_BYTES + 1]).unwrap();
    assert!(probe_bootstrap::prepare(&script, &unused, &root.join("unused-output")).is_err());
    assert!(!unused.exists());
    fs::write(&script, b"invalid").unwrap();
    assert!(probe_bootstrap::prepare(&script, &unused, &root.join("unused-output")).is_err());
    assert!(!unused.exists());
    fs::remove_dir_all(root).unwrap();
}

#[path = "../src/probe_environment.rs"]
mod probe_environment;

#[path = "../src/probe_events.rs"]
mod probe_events;

#[test]
fn marker_order_and_redaction() {
    use serde_json::json;
    let script = json!({"schema":"prexu.probe.script","version":1,"runId":"test","fixture":"av-cues-v1","timeoutMs":10000,"steps":[{"id":"quit","action":"quit","timeoutMs":1000}]});
    let mut bytes = Vec::new();
    {
        let mut events = probe_events::Events::new(script.clone(), &mut bytes).unwrap();
        assert!(events.begin("quit").is_err());
        assert_eq!(events.ready().unwrap(), script);
        assert!(events.ready().is_err());
        assert!(events.cleanup().is_err());
        assert!(events.begin("wrong").is_err());
        events.begin("quit").unwrap();
        assert!(events.begin("quit").is_err());
        events.end("quit", json!({"ready":true})).unwrap();
        events.cleanup().unwrap();
        events.finish(true).unwrap();
        assert!(events.finish(true).is_err());
    }
    let lines: Vec<serde_json::Value> = String::from_utf8(bytes)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 6);
    for (i, line) in lines.iter().enumerate() {
        assert_eq!(line["seq"], i + 1);
    }
    assert_eq!(lines[5]["status"], "pass");
    let mut bytes = Vec::new();
    {
        let mut events = probe_events::Events::new(script, &mut bytes).unwrap();
        events.ready().unwrap();
        events.begin("quit").unwrap();
        assert!(events.fail("SECRET").is_err());
        assert_eq!(
            events.end("quit", json!({"ready":true,"url":"SECRET"})),
            Err("predicate_failed")
        );
        assert!(events.end("quit", json!({"ready":true})).is_err());
        events.cleanup().unwrap();
        events.finish(true).unwrap();
    }
    let text = String::from_utf8(bytes).unwrap();
    assert!(!text.contains("SECRET"));
    assert!(text.contains("step.error"));
    assert!(text.contains("\"status\":\"fail\""));
}

#[test]
fn broken_marker_sink_cannot_resume() {
    struct Broken;
    impl std::io::Write for Broken {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("private detail"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let script = probe_script::parse(br#"{"schema":"prexu.probe.script","version":1,"runId":"test","fixture":"av-cues-v1","timeoutMs":1000,"steps":[{"id":"quit","action":"quit","timeoutMs":1000}]}"#).unwrap();
    let mut events = probe_events::Events::new(script, Broken).unwrap();
    assert_eq!(events.ready(), Err("marker_io"));
    assert_eq!(events.ready(), Err("invalid_sequence"));
    assert!(events.cleanup().is_err());
}

#[test]
fn observation_allowlists_and_predicates() {
    use serde_json::json;
    let cases = [
        (
            "play",
            json!({}),
            json!({"loaded":true,"positionMs":1}),
            json!({"loaded":true,"positionMs":0}),
        ),
        (
            "seek",
            json!({"positionMs":2000,"toleranceMs":500}),
            json!({"positionMs":2001}),
            json!({"positionMs":0}),
        ),
        (
            "pause",
            json!({}),
            json!({"paused":true}),
            json!({"paused":false}),
        ),
        (
            "resume",
            json!({}),
            json!({"paused":false}),
            json!({"paused":true}),
        ),
        (
            "selectAudio",
            json!({"trackId":2}),
            json!({"trackId":2}),
            json!({"trackId":1}),
        ),
        (
            "selectSubtitle",
            json!({"trackId":0}),
            json!({"trackId":0}),
            json!({"trackId":1}),
        ),
        (
            "fullscreen",
            json!({"enabled":true}),
            json!({"enabled":true}),
            json!({"enabled":false}),
        ),
        (
            "miniPlayer",
            json!({"enabled":false}),
            json!({"enabled":false}),
            json!({"enabled":true}),
        ),
        (
            "popout",
            json!({"enabled":true}),
            json!({"enabled":true}),
            json!({"enabled":false}),
        ),
        (
            "windowMinimize",
            json!({}),
            json!({"minimized":true}),
            json!({"minimized":false}),
        ),
        (
            "windowRestore",
            json!({}),
            json!({"minimized":false}),
            json!({"minimized":true}),
        ),
        (
            "stop",
            json!({}),
            json!({"sessionCleared":true,"idle":true}),
            json!({"sessionCleared":true,"idle":false}),
        ),
        (
            "wait",
            json!({"durationMs":5}),
            json!({"durationMs":6}),
            json!({"durationMs":4}),
        ),
        (
            "navigate",
            json!({"route":"/settings"}),
            json!({"route":"/settings"}),
            json!({"route":"/"}),
        ),
        (
            "setSetting",
            json!({"name":"volume","value":50}),
            json!({"name":"volume","value":50}),
            json!({"name":"volume","value":51}),
        ),
        (
            "quit",
            json!({}),
            json!({"ready":true}),
            json!({"ready":false}),
        ),
    ];
    for (action, args, good, bad) in cases {
        let step = json!({"action":action,"args":args,"timeoutMs":1000});
        assert_eq!(probe_events::observation(&step, &good), Ok(()), "{action}");
        assert!(probe_events::observation(&step, &bad).is_err(), "{action}");
        let mut extra = good.clone();
        extra["url"] = json!("private");
        assert!(
            probe_events::observation(&step, &extra).is_err(),
            "{action}"
        );
        assert!(
            probe_events::observation(&step, &json!({})).is_err(),
            "{action}"
        );
    }
}
