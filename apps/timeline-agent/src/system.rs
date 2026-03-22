//! Windows integration helpers for autostart, tray actions, and opening the web UI.

use crate::state::AgentState;
use anyhow::{Context, Result};
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::time::{Duration, Instant};
use tao::event::{Event, StartCause};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
#[cfg(target_os = "windows")]
use tao::platform::windows::EventLoopBuilderExtWindows;
use time::OffsetDateTime;
use tracing::{error, info, warn};
use tray_icon::{
    Icon, MouseButton, MouseButtonState, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem, accelerator::Accelerator},
};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};

const AUTOSTART_REG_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE_NAME: &str = "TimelineAgent";
const MENU_OPEN_ID: &str = "open";
const MENU_QUIT_ID: &str = "quit";

enum TrayUserEvent {
    TrayClick {
        button: MouseButton,
        button_state: MouseButtonState,
    },
    Menu(MenuEvent),
}

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
    let operation = to_wide("open");
    let target = to_wide(url);

    let result = unsafe {
        ShellExecuteW(
            Some(HWND::default()),
            windows::core::PCWSTR(operation.as_ptr()),
            windows::core::PCWSTR(target.as_ptr()),
            windows::core::PCWSTR::null(),
            windows::core::PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // ShellExecuteW returns a pseudo-HINSTANCE; values <= 32 indicate failure.
    if result.0 as usize <= 32 {
        anyhow::bail!("ShellExecuteW failed with code {}", result.0 as usize);
    }

    Ok(())
}

fn to_wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

pub fn spawn_tray(state: AgentState) {
    std::thread::spawn(move || {
        if let Err(error) = run_tray_loop(state) {
            error!(?error, "tray loop stopped");
        }
    });
}

fn run_tray_loop(state: AgentState) -> Result<()> {
    let mut event_loop_builder = EventLoopBuilder::<TrayUserEvent>::with_user_event();
    #[cfg(target_os = "windows")]
    event_loop_builder.with_any_thread(true);

    let event_loop = event_loop_builder.build();
    let tray_menu = build_tray_menu();
    let tray_icon = build_tray_icon().context("failed to build tray icon image")?;
    let open_id = MenuId::new(MENU_OPEN_ID);
    let quit_id = MenuId::new(MENU_QUIT_ID);

    let proxy = event_loop.create_proxy();
    tray_icon::TrayIconEvent::set_event_handler(Some(move |event| {
        if let tray_icon::TrayIconEvent::Click {
            button,
            button_state,
            ..
        } = event
        {
            let _ = proxy.send_event(TrayUserEvent::TrayClick {
                button,
                button_state,
            });
        }
    }));

    let proxy = event_loop.create_proxy();
    MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(TrayUserEvent::Menu(event));
    }));

    let _tray = TrayIconBuilder::new()
        .with_tooltip("Timeline Agent")
        .with_icon(tray_icon)
        .with_menu(Box::new(tray_menu))
        .with_menu_on_left_click(false)
        .build()
        .context("failed to create tray icon")?;

    state.mark_tray_online_sync(OffsetDateTime::now_utc());
    info!("tray icon started");

    let state_for_loop = state.clone();
    event_loop.run(move |event, _, control_flow| {
        // Poll at 250ms to keep tray responsive while avoiding excessive CPU usage.
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));

        if state_for_loop.shutdown_requested() {
            *control_flow = ControlFlow::Exit;
            return;
        }

        match event {
            Event::NewEvents(StartCause::Init) => {
                state_for_loop.mark_tray_online_sync(OffsetDateTime::now_utc());
            }
            Event::UserEvent(TrayUserEvent::TrayClick {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
            }) => {
                state_for_loop.mark_tray_online_sync(OffsetDateTime::now_utc());
                if let Err(error) = open_frontend(&state_for_loop.config().effective_web_ui_url()) {
                    warn!(?error, "failed to open frontend from tray click");
                }
            }
            Event::UserEvent(TrayUserEvent::Menu(menu_event)) => {
                state_for_loop.mark_tray_online_sync(OffsetDateTime::now_utc());
                if menu_event.id == open_id {
                    if let Err(error) =
                        open_frontend(&state_for_loop.config().effective_web_ui_url())
                    {
                        warn!(?error, "failed to open frontend from tray menu");
                    }
                } else if menu_event.id == quit_id {
                    state_for_loop.request_shutdown();
                    *control_flow = ControlFlow::Exit;
                }
            }
            _ => {}
        }
    });
}

fn build_tray_menu() -> Menu {
    let menu = Menu::new();
    let open_item = MenuItem::with_id(MENU_OPEN_ID, "打开时间线", true, None::<Accelerator>);
    let quit_item = MenuItem::with_id(MENU_QUIT_ID, "退出", true, None::<Accelerator>);
    menu.append(&open_item)
        .expect("failed to append open menu item");
    menu.append(&PredefinedMenuItem::separator())
        .expect("failed to append tray separator");
    menu.append(&quit_item)
        .expect("failed to append quit menu item");
    menu
}

/// Builds a 32×32 RGBA tray icon procedurally.
///
/// The icon depicts a stylized "T" (for Timeline) on a blue background:
///
/// ```text
///   ┌──────────────────────────┐  ← dark border (2px, #0e1726)
///   │  blue background #1c5ac4 │
///   │     ┌───────────────┐    │
///   │     │  white T-bar  │    │  ← horizontal bar (x 8..23, y 7..10)
///   │     └───┬───┬───────┘    │
///   │         │   │            │
///   │         │ T │            │  ← vertical stem (x 14..17, y 6..25)
///   │         │   │            │
///   │         └───┘   ■■■■■   │  ← accent square (x 20..24, y 20..24, #568eff)
///   └──────────────────────────┘
/// ```
fn build_tray_icon() -> Result<Icon> {
    const SIZE: u32 = 32;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];

    // Color constants for the icon layers
    const BORDER: (u8, u8, u8, u8) = (14, 23, 38, 255); // dark navy border
    const BACKGROUND: (u8, u8, u8, u8) = (28, 90, 196, 255); // blue fill
    const GLYPH: (u8, u8, u8, u8) = (255, 255, 255, 255); // white "T" letter
    const ACCENT: (u8, u8, u8, u8) = (86, 142, 255, 255); // lighter blue dot

    for y in 0..SIZE {
        for x in 0..SIZE {
            let offset = ((y * SIZE + x) * 4) as usize;
            let is_border = x < 2 || x >= SIZE - 2 || y < 2 || y >= SIZE - 2;
            let is_vertical = (14..=17).contains(&x) && (6..=25).contains(&y);
            let is_horizontal = (8..=23).contains(&x) && (7..=10).contains(&y);
            let is_highlight = (20..=24).contains(&x) && (20..=24).contains(&y);

            let (r, g, b, a) = if is_border {
                BORDER
            } else if is_vertical || is_horizontal {
                GLYPH
            } else if is_highlight {
                ACCENT
            } else {
                BACKGROUND
            };

            rgba[offset] = r;
            rgba[offset + 1] = g;
            rgba[offset + 2] = b;
            rgba[offset + 3] = a;
        }
    }

    Icon::from_rgba(rgba, SIZE, SIZE).context("failed to create tray icon from rgba")
}
