use serde::Deserialize;
use tracing::{info, warn};

/// Response from the Plex user API.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlexUserResponse {
    username: String,
    thumb: String,
}

/// Validated Plex user identity.
pub struct PlexIdentity {
    pub username: String,
    pub thumb: String,
}

/// Validate a Plex auth token by calling the Plex API.
/// Returns the verified username and thumb from Plex (not client-supplied).
///
/// When the `PREXU_TEST_MODE` environment variable is set, auth validation is
/// bypassed and the token is treated as the username (for integration testing).
pub async fn validate_plex_token(token: &str) -> Option<PlexIdentity> {
    // In test mode, accept any token and treat it as the username
    if std::env::var("PREXU_TEST_MODE").is_ok() {
        return Some(PlexIdentity {
            username: token.to_string(),
            thumb: format!("https://plex.tv/users/{}/avatar", token),
        });
    }

    let client = reqwest::Client::new();

    let resp = client
        .get("https://plex.tv/api/v2/user")
        .header("Accept", "application/json")
        .header("X-Plex-Token", token)
        .header("X-Plex-Client-Identifier", "prexu-relay")
        .header("X-Plex-Product", "Prexu Relay")
        .send()
        .await;

    match resp {
        Ok(r) if r.status().is_success() => match r.json::<PlexUserResponse>().await {
            Ok(user) => {
                info!(user = %user.username, "Plex token validated");
                Some(PlexIdentity {
                    username: user.username,
                    thumb: user.thumb,
                })
            }
            Err(e) => {
                warn!(error = %e, "Failed to parse Plex user response");
                None
            }
        },
        Ok(r) => {
            warn!(status = %r.status(), "Plex token validation failed");
            None
        }
        Err(e) => {
            warn!(error = %e, "Failed to reach Plex API");
            None
        }
    }
}
