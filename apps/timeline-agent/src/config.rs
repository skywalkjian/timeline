//! Loads the timeline agent configuration from TOML and provides safe defaults.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DEFAULT_CONFIG_PATH: &str = "config/timeline-agent.toml";
const LEGACY_DEV_WEB_UI_URL: &str = "http://127.0.0.1:4173/#/stats";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub database_path: PathBuf,
    pub lockfile_path: PathBuf,
    pub listen_addr: String,
    pub web_ui_url: String,
    pub idle_threshold_secs: u64,
    pub poll_interval_millis: u64,
    pub debug: bool,
    pub tray_enabled: bool,
    pub record_window_titles: bool,
    pub record_page_titles: bool,
    pub ignored_apps: Vec<String>,
    pub ignored_domains: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database_path: PathBuf::from("data/timeline.sqlite"),
            lockfile_path: PathBuf::from("data/timeline-agent.lock"),
            listen_addr: "127.0.0.1:46215".to_string(),
            web_ui_url: "http://127.0.0.1:46215/#/stats".to_string(),
            idle_threshold_secs: 300,
            poll_interval_millis: 1_000,
            debug: true,
            tray_enabled: true,
            record_window_titles: true,
            record_page_titles: true,
            ignored_apps: Vec::new(),
            ignored_domains: Vec::new(),
        }
    }
}

impl AppConfig {
    pub fn load(explicit_path: Option<PathBuf>) -> Result<Self> {
        let path = explicit_path.unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_PATH));

        if !path.exists() {
            return Ok(Self::default());
        }

        let content =
            std::fs::read_to_string(&path).with_context(|| format!("failed to read {:?}", path))?;
        let mut config: Self =
            toml::from_str(&content).with_context(|| format!("failed to parse {:?}", path))?;

        if !content.contains("web_ui_url") || config.web_ui_url == LEGACY_DEV_WEB_UI_URL {
            config.web_ui_url = config.self_hosted_web_ui_url();
        }

        Ok(config)
    }

    pub fn ensure_parent_dirs(&self) -> Result<()> {
        ensure_parent(&self.database_path)?;
        ensure_parent(&self.lockfile_path)?;
        Ok(())
    }

    pub fn effective_web_ui_url(&self) -> String {
        if self.web_ui_url.trim().is_empty()
            || self.web_ui_url == LEGACY_DEV_WEB_UI_URL
            || self.web_ui_url == Self::default().web_ui_url
        {
            return self.self_hosted_web_ui_url();
        }

        self.web_ui_url.clone()
    }

    pub fn web_ui_dist_dir(&self) -> Option<PathBuf> {
        let mut candidates = vec![
            PathBuf::from("apps/web-ui/dist"),
            PathBuf::from("web-ui/dist"),
            PathBuf::from("dist"),
        ];

        if let Ok(current_exe) = std::env::current_exe()
            && let Some(exe_dir) = current_exe.parent()
        {
            candidates.push(exe_dir.join("web-ui/dist"));
            candidates.push(exe_dir.join("dist"));

            if let Some(parent) = exe_dir.parent() {
                candidates.push(parent.join("web-ui/dist"));
                candidates.push(parent.join("dist"));

                if let Some(grandparent) = parent.parent() {
                    candidates.push(grandparent.join("apps/web-ui/dist"));
                }
            }
        }

        candidates
            .into_iter()
            .find(|dir| dir.join("index.html").is_file())
    }

    fn self_hosted_web_ui_url(&self) -> String {
        let (host, port) = match self.listen_addr.rsplit_once(':') {
            Some((host, port)) => (normalize_host(host), port.trim()),
            None => ("127.0.0.1".to_string(), "46215"),
        };

        format!("http://{host}:{port}/#/stats")
    }
}

fn normalize_host(host: &str) -> String {
    let trimmed = host.trim().trim_start_matches('[').trim_end_matches(']');
    let normalized = match trimmed {
        "" | "0.0.0.0" | "::" => "127.0.0.1".to_string(),
        value => value.to_string(),
    };

    if normalized.contains(':') {
        format!("[{normalized}]")
    } else {
        normalized
    }
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directory for {:?}", path))?;
    }

    Ok(())
}
