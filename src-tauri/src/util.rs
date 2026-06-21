//! Shared utility functions for the Prexu Tauri backend.

/// Mask any X-Plex-Token query value in a URL, then truncate to 80 chars for
/// logging. Truncation alone is insufficient: with a short server URI the
/// token itself falls inside the truncation window.
///
/// Promoted from `player::commands::playback` so that `downloads` and the
/// proxy can share the same redaction logic without duplicating it.
pub fn redact_url(url: &str) -> String {
    let mut out = String::with_capacity(url.len());
    let mut rest = url;
    loop {
        match rest.to_ascii_lowercase().find("x-plex-token=") {
            Some(idx) => {
                let val_start = idx + "x-plex-token=".len();
                out.push_str(&rest[..val_start]);
                out.push_str("***");
                let after = &rest[val_start..];
                rest = match after.find('&') {
                    Some(amp) => &after[amp..],
                    None => "",
                };
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }
    out.chars().take(80).collect()
}

#[cfg(test)]
mod tests {
    use super::redact_url;

    #[test]
    fn masks_token_value() {
        assert_eq!(
            redact_url("http://192.168.1.5:32400/library/parts/1/file.mkv?X-Plex-Token=supersecret"),
            "http://192.168.1.5:32400/library/parts/1/file.mkv?X-Plex-Token=***"
        );
    }

    #[test]
    fn masks_mid_query_token_and_preserves_trailing_params() {
        assert_eq!(
            redact_url("http://h/p?a=1&x-plex-token=abc&b=2"),
            "http://h/p?a=1&x-plex-token=***&b=2"
        );
    }

    #[test]
    fn passes_through_url_with_no_token() {
        assert_eq!(redact_url("http://h/path?foo=bar"), "http://h/path?foo=bar");
    }

    #[test]
    fn truncates_to_80_chars() {
        // Long URL — result must be exactly 80 chars.
        let long = format!("http://h/{}?X-Plex-Token=t", "x".repeat(100));
        let out = redact_url(&long);
        assert_eq!(out.chars().count(), 80);
    }

    #[test]
    fn no_panic_on_multibyte_truncation() {
        let long = format!("http://h/{}?X-Plex-Token=t", "é".repeat(100));
        let out = redact_url(&long);
        assert_eq!(out.chars().count(), 80);
    }

    #[test]
    fn token_only_url_is_redacted() {
        // Minimal URL where the token would be fully visible without redaction.
        let url = "http://s/p?X-Plex-Token=mysecrettoken123";
        let out = redact_url(url);
        assert!(!out.contains("mysecrettoken123"), "token must not appear in output");
        assert!(out.contains("X-Plex-Token=***"));
    }
}
