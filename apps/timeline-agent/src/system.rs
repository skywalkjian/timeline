//! Windows integration helpers for autostart, tray actions, and opening the web UI.

use crate::state::AgentState;
use anyhow::{Context, Result};
use std::process::Command;
use time::OffsetDateTime;
use tracing::{error, info, warn};
use tray_menu::{
    Divider, Icon, MouseButton, MouseButtonState, PopupMenu, TextEntry, TrayIconBuilder,
    TrayIconEvent,
};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};

const AUTOSTART_REG_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE_NAME: &str = "TimelineAgent";

pub fn autostart_enabled() -> Result<bool> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = match hkcu.open_subkey_with_flags(AUTOSTART_REG_PATH, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error).context("failed to open HKCU Run key"),
    };

    Ok(key.get_value::<String, _>(AUTOSTART_VALUE_NAME).is_ok())
}

pub fn set_autostart_enabled(state: &AgentState, enabled: bool) -> Result<bool> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(AUTOSTART_REG_PATH)
        .context("failed to create HKCU Run key")?;

    if enabled {
        key.set_value(AUTOSTART_VALUE_NAME, &state.launch_command())
            .context("failed to write autostart registry value")?;
    } else {
        match key.delete_value(AUTOSTART_VALUE_NAME) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("failed to delete autostart registry value"),
        }
    }

    autostart_enabled()
}

pub fn open_frontend(url: &str) -> Result<()> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .with_context(|| format!("failed to open frontend url {}", url))?;

    Ok(())
}

pub fn spawn_tray(state: AgentState) {
    std::thread::spawn(move || {
        if let Err(error) = run_tray_loop(state) {
            error!(?error, "tray loop stopped");
        }
    });
}

fn run_tray_loop(state: AgentState) -> Result<()> {
    let icon = build_tray_icon().context("failed to build tray icon image")?;
    let _tray = TrayIconBuilder::new()
        .with_tooltip("Timeline Agent")
        .with_icon(icon)
        .build()
        .context("failed to create tray icon")?;
    let receiver = TrayIconEvent::receiver();
    state.mark_tray_online_sync(OffsetDateTime::now_utc());
    info!("tray icon started");

    loop {
        if state.shutdown_requested() {
            break;
        }

        if let Ok(event) = receiver.recv_timeout(std::time::Duration::from_millis(100)) {
            state.mark_tray_online_sync(OffsetDateTime::now_utc());

            match event {
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    if let Err(error) = open_frontend(&state.config().web_ui_url) {
                        warn!(?error, "failed to open frontend from tray click");
                    }
                }
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    position,
                    ..
                } => {
                    let mut menu = PopupMenu::new();
                    menu.add(&TextEntry::of("open", "打开时间线"));
                    menu.add(&Divider);
                    menu.add(&TextEntry::of("quit", "退出"));

                    if let Some(id) = menu.popup(position) {
                        if id.0 == "open" {
                            if let Err(error) = open_frontend(&state.config().web_ui_url) {
                                warn!(?error, "failed to open frontend from tray menu");
                            }
                        } else if id.0 == "quit" {
                            state.request_shutdown();
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    Ok(())
}

fn build_tray_icon() -> Result<Icon> {
    const SIZE: u32 = 32;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];

    for y in 0..SIZE {
        for x in 0..SIZE {
            let offset = ((y * SIZE + x) * 4) as usize;
            let is_border = x < 2 || x >= SIZE - 2 || y < 2 || y >= SIZE - 2;
            let is_vertical = (14..=17).contains(&x) && (6..=25).contains(&y);
            let is_horizontal = (8..=23).contains(&x) && (7..=10).contains(&y);
            let is_highlight = (20..=24).contains(&x) && (20..=24).contains(&y);

            let (r, g, b, a) = if is_border {
                (14, 23, 38, 255)
            } else if is_vertical || is_horizontal {
                (255, 255, 255, 255)
            } else if is_highlight {
                (86, 142, 255, 255)
            } else {
                (28, 90, 196, 255)
            };

            rgba[offset] = r;
            rgba[offset + 1] = g;
            rgba[offset + 2] = b;
            rgba[offset + 3] = a;
        }
    }

    Icon::from_rgba(rgba, SIZE, SIZE).context("failed to create tray icon from rgba")
}
