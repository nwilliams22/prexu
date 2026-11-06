//! Probe environment policy, evaluated before any application initialization.
use std::ffi::OsString;
use std::path::PathBuf;

pub const KEYS: [&str; 4] = [
    "PREXU_PROBE_SCRIPT",
    "PREXU_PROBE_STATE_DIR",
    "PREXU_PROBE_OUTPUT_DIR",
    "PREXU_PROBE_FIXTURE_PORT",
];

#[derive(Debug, PartialEq)]
pub struct Startup {
    pub paths: [PathBuf; 3],
    pub fixture_port: u16,
}

pub fn paths(values: [Option<OsString>; 4]) -> Result<Option<Startup>, &'static str> {
    if values.iter().all(Option::is_none) {
        return Ok(None);
    }
    // Presence, including an empty value, must fail closed in production.
    if !cfg!(debug_assertions) {
        return Err("probe_disabled");
    }
    let [Some(script), Some(state), Some(output), Some(port)] = values else {
        return Err("invalid_probe_environment");
    };
    let port = port.to_str().ok_or("invalid_probe_environment")?;
    if port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()) {
        return Err("invalid_probe_environment");
    }
    let fixture_port = port
        .parse::<u16>()
        .ok()
        .filter(|p| *p != 0)
        .ok_or("invalid_probe_environment")?;
    let paths = [
        PathBuf::from(script),
        PathBuf::from(state),
        PathBuf::from(output),
    ];
    if paths.iter().any(|path| !path.is_absolute()) {
        return Err("invalid_probe_path");
    }
    Ok(Some(Startup {
        paths,
        fixture_port,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_environment_preserves_normal_startup() {
        assert_eq!(paths([None, None, None, None]), Ok(None));
        assert_eq!(KEYS.len(), 4);
    }

    #[test]
    fn every_partial_or_empty_environment_fails_closed() {
        for mask in 1..16 {
            let values = std::array::from_fn(|i| {
                if mask & (1 << i) != 0 {
                    Some(OsString::new())
                } else {
                    None
                }
            });
            let error = paths(values).unwrap_err();
            if !cfg!(debug_assertions) {
                assert_eq!(error, "probe_disabled");
            }
        }
    }

    #[test]
    fn complete_environment_requires_debug_build() {
        let root = std::env::temp_dir();
        let expected = [
            root.join("script.json"),
            root.join("state"),
            root.join("output"),
        ];
        let [script, state, output] = expected.clone().map(|p| Some(p.into_os_string()));
        let result = paths([script, state, output, Some("12345".into())]);
        if cfg!(debug_assertions) {
            assert_eq!(
                result,
                Ok(Some(Startup {
                    paths: expected,
                    fixture_port: 12345
                }))
            );
        } else {
            assert_eq!(result, Err("probe_disabled"));
        }
    }
    #[test]
    fn fixture_port_cannot_supply_a_remote_endpoint() {
        let root = std::env::temp_dir();
        for port in [
            "0",
            "65536",
            "-1",
            "+80",
            " 80",
            "80 ",
            "127.0.0.1:80",
            "https://example.com",
            "80/path",
            "",
        ] {
            let result = paths([
                Some(root.join("script").into_os_string()),
                Some(root.join("state").into_os_string()),
                Some(root.join("output").into_os_string()),
                Some(port.into()),
            ]);
            assert!(result.is_err(), "{}", port);
        }
    }
}
