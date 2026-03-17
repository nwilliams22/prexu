use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use tracing::warn;

use crate::state::SharedState;

/// Query params for search endpoints.
#[derive(Deserialize)]
pub struct SearchParams {
    pub query: String,
    #[serde(default = "default_page")]
    pub page: u32,
}

fn default_page() -> u32 {
    1
}

const TMDB_API_BASE: &str = "https://api.themoviedb.org/3";

/// Get the TMDb API key from environment, or return a 503 error.
fn get_api_key() -> Result<String, Response> {
    std::env::var("TMDB_API_KEY").map_err(|_| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            "TMDb API key not configured on relay server",
        )
            .into_response()
    })
}

/// Build a reqwest client with the TMDb auth header.
fn tmdb_request(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    client
        .get(url)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
}

/// Proxy a TMDb request and return the raw JSON response.
async fn proxy_tmdb(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
) -> Result<Json<serde_json::Value>, Response> {
    let resp = tmdb_request(client, url, api_key)
        .send()
        .await
        .map_err(|e| {
            warn!(error = %e, "TMDb proxy request failed");
            (StatusCode::BAD_GATEWAY, "Failed to reach TMDb API").into_response()
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        return Err((
            StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
            format!("TMDb API returned {}", status),
        )
            .into_response());
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| {
        warn!(error = %e, "Failed to parse TMDb response");
        (StatusCode::BAD_GATEWAY, "Invalid TMDb response").into_response()
    })?;

    Ok(Json(data))
}

/// GET /tmdb/search/movie?query=...&page=...
pub async fn search_movie(
    State(_state): State<SharedState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/search/movie?query={}&page={}&include_adult=false&language=en-US",
        TMDB_API_BASE,
        urlencoding::encode(&params.query),
        params.page,
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/search/tv?query=...&page=...
pub async fn search_tv(
    State(_state): State<SharedState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/search/tv?query={}&page={}&include_adult=false&language=en-US",
        TMDB_API_BASE,
        urlencoding::encode(&params.query),
        params.page,
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/search/person?query=...
pub async fn search_person(
    State(_state): State<SharedState>,
    Query(params): Query<SearchParams>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/search/person?query={}&include_adult=false&language=en-US",
        TMDB_API_BASE,
        urlencoding::encode(&params.query),
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/find/:id
pub async fn find_by_external_id(
    State(_state): State<SharedState>,
    Path(external_id): Path<String>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/find/{}?external_source=imdb_id&language=en-US",
        TMDB_API_BASE, external_id,
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/person/:id
pub async fn person_detail(
    State(_state): State<SharedState>,
    Path(person_id): Path<u64>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!("{}/person/{}?language=en-US", TMDB_API_BASE, person_id);
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/person/:id/credits
pub async fn person_credits(
    State(_state): State<SharedState>,
    Path(person_id): Path<u64>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/person/{}/combined_credits?language=en-US",
        TMDB_API_BASE, person_id,
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/movie/:id
pub async fn movie_detail(
    State(_state): State<SharedState>,
    Path(movie_id): Path<u64>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/movie/{}?language=en-US&append_to_response=credits",
        TMDB_API_BASE, movie_id,
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/tv/:id
pub async fn tv_detail(
    State(_state): State<SharedState>,
    Path(tv_id): Path<u64>,
) -> Result<Json<serde_json::Value>, Response> {
    let api_key = get_api_key()?;
    let client = reqwest::Client::new();
    let url = format!(
        "{}/tv/{}?language=en-US&append_to_response=credits",
        TMDB_API_BASE, tv_id,
    );
    proxy_tmdb(&client, &url, &api_key).await
}

/// GET /tmdb/status — check if TMDb API key is configured
pub async fn tmdb_status() -> impl IntoResponse {
    if std::env::var("TMDB_API_KEY").is_ok() {
        (StatusCode::OK, "TMDb proxy available")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "TMDb API key not configured")
    }
}
