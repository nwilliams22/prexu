//! A test-enabled Cargo build must never leave a runnable unauthenticated relay.
#[test]
fn test_mode_executable_refuses_to_serve() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_prexu-relay"))
        .arg("--help")
        .output()
        .expect("run relay executable");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("test-mode relay executable cannot start")
    );
}
