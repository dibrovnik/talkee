//! Dock presence: `showInDock` maps to the macOS activation policy.
//!
//! With the setting off, talkee runs as a menu-bar utility (`Accessory`): no
//! Dock icon and no ⌘Tab entry. While the settings window is open the app is
//! temporarily `Regular`, so the window can come to the front and be switched to.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{ActivationPolicy, AppHandle, Emitter, Manager};

use crate::{logger, settings_store, tray};

const DOCK_VISIBILITY_CHANGED_EVENT: &str = "dock-visibility-changed";
const SETTINGS_UPDATED_EVENT: &str = "settings-updated";

pub struct DockState {
    show_in_dock: AtomicBool,
}

pub fn show_in_dock(app: &AppHandle) -> bool {
    app.try_state::<DockState>()
        .map(|state| state.show_in_dock.load(Ordering::SeqCst))
        .unwrap_or(true)
}

fn settings_window_open(app: &AppHandle) -> bool {
    app.get_webview_window("settings")
        .and_then(|win| win.is_visible().ok())
        .unwrap_or(false)
}

fn apply_policy(app: &AppHandle, policy: ActivationPolicy) {
    if let Err(err) = app.set_activation_policy(policy) {
        logger::log_error("DOCK", &format!("Failed to set activation policy: {err}"));
    }
}

/// The app stays `Regular` while the settings window is open.
fn apply_current_policy(app: &AppHandle) {
    if show_in_dock(app) || settings_window_open(app) {
        apply_policy(app, ActivationPolicy::Regular);
    } else {
        apply_policy(app, ActivationPolicy::Accessory);
    }
}

/// Loads the preference at startup and applies it. `settings_will_open` keeps
/// the app `Regular` when the settings window is about to be shown.
pub fn init(app: &AppHandle, settings_will_open: bool) {
    let show = settings_store::read_show_in_dock(app).unwrap_or_else(|err| {
        logger::log_error(
            "DOCK",
            &format!("Failed to read Dock icon preference: {err}"),
        );
        true
    });
    app.manage(DockState {
        show_in_dock: AtomicBool::new(show),
    });
    if !show && !settings_will_open {
        apply_policy(app, ActivationPolicy::Accessory);
    }
    logger::log_info("DOCK", &format!("Dock icon preference: show={show}"));
}

fn update_preference(app: &AppHandle, show: bool) {
    if let Some(state) = app.try_state::<DockState>() {
        state.show_in_dock.store(show, Ordering::SeqCst);
    }
    tray::set_dock_checked(app, show);
    apply_current_policy(app);
}

/// Called before the settings window is shown: in utility mode the app must
/// become `Regular` and unhide so the window comes to the front.
pub fn prepare_settings_window(app: &AppHandle) {
    if show_in_dock(app) {
        return;
    }
    apply_policy(app, ActivationPolicy::Regular);
    if let Err(err) = app.show() {
        logger::log_error("DOCK", &format!("Failed to show application: {err}"));
    }
}

/// Called after the settings window is closed: returns to utility mode if the
/// Dock icon is turned off.
pub fn settings_window_closed(app: &AppHandle) {
    if !show_in_dock(app) {
        apply_policy(app, ActivationPolicy::Accessory);
    }
}

/// Tray toggle: the frontend is not involved, so the preference is persisted
/// here and open windows are told to refresh.
pub fn toggle_from_tray(app: &AppHandle) {
    let show = !show_in_dock(app);
    update_preference(app, show);
    if let Err(err) = settings_store::write_show_in_dock(app, show) {
        logger::log_error(
            "DOCK",
            &format!("Failed to save Dock icon preference: {err}"),
        );
    }
    let _ = app.emit(DOCK_VISIBILITY_CHANGED_EVENT, show);
    let _ = app.emit(SETTINGS_UPDATED_EVENT, ());
    logger::log_info("DOCK", &format!("Dock icon toggled from tray: show={show}"));
}

/// Applies a `showInDock` change made in the settings UI (already persisted by
/// the frontend).
#[tauri::command]
pub fn set_dock_visibility(app: AppHandle, show: bool) -> Result<(), String> {
    update_preference(&app, show);
    logger::log_info(
        "DOCK",
        &format!("Dock icon preference changed: show={show}"),
    );
    Ok(())
}
