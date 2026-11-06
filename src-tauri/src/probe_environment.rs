//! Probe environment policy, evaluated before any application initialization.
use std::ffi::OsString;
use std::path::PathBuf;

pub const KEYS: [&str; 3] = [
    "PREXU_PROBE_SCRIPT",
    "PREXU_PROBE_STATE_DIR",
    "PREXU_PROBE_OUTPUT_DIR",
];

pub fn paths(values: [Option<OsString>; 3]) -> Result<Option<[PathBuf; 3]>, &'static str> {
    if values.iter().all(Option::is_none) {
        return Ok(None);
    }
    // Presence, including an empty value, must fail closed in production.
    if !cfg!(debug_assertions) {
        return Err("probe_disabled");
    }
    let [Some(script), Some(state), Some(output)] = values else {
        return Err("invalid_probe_environment");
    };
    let paths = [
        PathBuf::from(script),
        PathBuf::from(state),
        PathBuf::from(output),
    ];
    if paths.iter().any(|path| !path.is_absolute()) {
        return Err("invalid_probe_path");
    }
    Ok(Some(paths))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_environment_preserves_normal_startup() {
        assert_eq!(paths([None, None, None]), Ok(None));
        assert_eq!(KEYS.len(), 3);
    }

    #[test]
    fn every_partial_or_empty_environment_fails_closed() {
        for mask in 1..8 {
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
        let result = paths(expected.clone().map(|p| Some(p.into_os_string())));
        if cfg!(debug_assertions) {
            assert_eq!(result, Ok(Some(expected)));
        } else {
            assert_eq!(result, Err("probe_disabled"));
        }
    }
}
