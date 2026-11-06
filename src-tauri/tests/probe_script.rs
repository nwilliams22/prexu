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
