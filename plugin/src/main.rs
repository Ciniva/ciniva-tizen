//! Ciniva plugin `tv-ui`: serves the Samsung TV app's interface (the files `src/ui.json` lists) through Ciniva, so a
//! TV running the installed shell picks up a new interface by restarting the app, without reinstalling it.
//!
//! TVs fetch `GET /api/plugins/tv-ui/ui/tv/ui.json` and then each file it lists from Ciniva, which forwards to
//! `{PLUGIN_URL}/ui/tv/...` here with the service key. The plugin adds no pages or actions.

use axum::{
    extract::{Path, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc, time::Duration};

struct Config {
    ciniva_url: String,
    secret: String,
    plugin_url: String,
    port: u16,
    ui_dir: PathBuf,
}

struct App {
    cfg: Config,
    /// src/ui.json as shipped in the image.
    ui: Value,
    http: reqwest::Client,
}

type Shared = Arc<App>;

/// `NAME`, or the contents of the file named by `NAME_FILE` (Docker/Compose secrets).
fn env(name: &str, default: &str) -> String {
    let from_file = || std::env::var(format!("{name}_FILE")).ok().and_then(|path| std::fs::read_to_string(path).ok());
    std::env::var(name).ok().or_else(from_file).map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

fn manifest(app: &App) -> Value {
    let ui = app.ui["version"].as_str().unwrap_or("?");
    json!({
        "id": "tv-ui",
        "name": "Samsung TV app",
        "version": env!("CARGO_PKG_VERSION"),
        "description": format!("Serves the Samsung TV app's interface {ui}, so TVs update without reinstalling."),
        "icon": "tv",
        "url": app.cfg.plugin_url,
        "settings": [],
        "pages": [],
        "actions": []
    })
}

async fn register(app: &Shared) -> bool {
    let resp = app.http.post(format!("{}/api/plugins/register", app.cfg.ciniva_url)).bearer_auth(&app.cfg.secret).json(&manifest(app)).send().await;
    match resp {
        Ok(r) if r.status().is_success() => true,
        Ok(r) => {
            tracing::warn!(status = %r.status(), "Ciniva refused registration");
            false
        }
        Err(e) => {
            tracing::warn!("cannot reach Ciniva: {e:#}");
            false
        }
    }
}

async fn require_ciniva(State(app): State<Shared>, req: Request, next: Next) -> Response {
    let ok = !app.cfg.secret.is_empty() && req.headers().get("x-ciniva-secret").and_then(|v| v.to_str().ok()) == Some(app.cfg.secret.as_str());
    if ok {
        next.run(req).await
    } else {
        (StatusCode::FORBIDDEN, Json(json!({ "error": "only Ciniva may call this plugin" }))).into_response()
    }
}

/// The files ui.json lists; nothing else in the image is served.
fn listed(ui: &Value, path: &str) -> bool {
    ["css", "js"].iter().any(|k| ui[k].as_array().is_some_and(|files| files.iter().any(|f| f.as_str() == Some(path))))
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        _ => "application/octet-stream",
    }
}

async fn ui_json(State(app): State<Shared>) -> Response {
    ([(header::CACHE_CONTROL, "no-cache")], Json(app.ui.clone())).into_response()
}

async fn file(State(app): State<Shared>, Path(path): Path<String>) -> Response {
    if !listed(&app.ui, &path) {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "not part of the TV interface" }))).into_response();
    }
    match tokio::fs::read(app.cfg.ui_dir.join(&path)).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, content_type(&path)), (header::CACHE_CONTROL, "no-cache")], bytes).into_response(),
        Err(e) => {
            tracing::error!(%path, "cannot read: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "file missing from the image" }))).into_response()
        }
    }
}

fn router(app: Shared) -> Router {
    let ui_routes = Router::new()
        .route("/ui/tv/ui.json", get(ui_json))
        .route("/ui/tv/{*path}", get(file))
        .layer(middleware::from_fn_with_state(app.clone(), require_ciniva));
    Router::new().route("/health", get(|| async { "ok" })).merge(ui_routes).with_state(app)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "ciniva_tv_ui=info".into()))
        .init();
    let cfg = Config {
        ciniva_url: env("CINIVA_URL", "http://ciniva:8484").trim_end_matches('/').to_string(),
        secret: env("CINIVA_PLUGIN_SECRET", ""),
        plugin_url: env("PLUGIN_URL", "http://ciniva-tv-ui:8092"),
        port: env("PORT", "8092").parse().unwrap_or(8092),
        ui_dir: PathBuf::from(env("UI_DIR", "/ui")),
    };
    if cfg.secret.is_empty() {
        anyhow::bail!("CINIVA_PLUGIN_SECRET is required");
    }
    let ui: Value = serde_json::from_slice(&std::fs::read(cfg.ui_dir.join("ui.json"))?)?;
    tracing::info!(version = ui["version"].as_str().unwrap_or("?"), "serving the TV interface");
    let app: Shared = Arc::new(App { http: reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?, ui, cfg });

    let heartbeat = app.clone();
    tokio::spawn(async move {
        loop {
            let ok = register(&heartbeat).await;
            tokio::time::sleep(Duration::from_secs(if ok { 60 } else { 5 })).await;
        }
    });

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", app.cfg.port)).await?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, router(app)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    fn app(dir: &std::path::Path) -> Shared {
        Arc::new(App {
            cfg: Config { ciniva_url: String::new(), secret: "s3cret".into(), plugin_url: String::new(), port: 0, ui_dir: dir.to_path_buf() },
            ui: json!({ "version": "9.9.9", "shell": 1, "css": ["css/app.css"], "js": ["js/app.js"] }),
            http: reqwest::Client::new(),
        })
    }

    async fn get(app: Shared, path: &str, secret: Option<&str>) -> (StatusCode, String, String) {
        let mut req = axum::http::Request::builder().uri(path);
        if let Some(s) = secret {
            req = req.header("x-ciniva-secret", s);
        }
        let resp = router(app).oneshot(req.body(Body::empty()).unwrap()).await.unwrap();
        let status = resp.status();
        let ctype = resp.headers().get(header::CONTENT_TYPE).map(|v| v.to_str().unwrap().to_string()).unwrap_or_default();
        let body = axum::body::to_bytes(resp.into_body(), 1 << 20).await.unwrap();
        (status, ctype, String::from_utf8_lossy(&body).into_owned())
    }

    fn ui_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tv-ui-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("js")).unwrap();
        std::fs::write(dir.join("js/app.js"), "C.boot();").unwrap();
        std::fs::write(dir.join("secret.txt"), "not served").unwrap();
        dir
    }

    #[tokio::test]
    async fn serves_listed_files_to_ciniva_only() {
        let dir = ui_dir();
        let (status, ctype, body) = get(app(&dir), "/ui/tv/js/app.js", Some("s3cret")).await;
        assert_eq!((status, ctype.as_str(), body.as_str()), (StatusCode::OK, "text/javascript; charset=utf-8", "C.boot();"));
        assert_eq!(get(app(&dir), "/ui/tv/js/app.js", None).await.0, StatusCode::FORBIDDEN);
        assert_eq!(get(app(&dir), "/ui/tv/js/app.js", Some("wrong")).await.0, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn refuses_files_ui_json_does_not_list() {
        let dir = ui_dir();
        assert_eq!(get(app(&dir), "/ui/tv/secret.txt", Some("s3cret")).await.0, StatusCode::NOT_FOUND);
        assert_eq!(get(app(&dir), "/ui/tv/../secret.txt", Some("s3cret")).await.0, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn answers_ui_json() {
        let dir = ui_dir();
        let (status, _, body) = get(app(&dir), "/ui/tv/ui.json", Some("s3cret")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["version"], "9.9.9");
    }
}
