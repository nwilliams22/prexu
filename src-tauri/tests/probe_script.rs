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
