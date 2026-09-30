use tauri::{
    window::{Effect, EffectState, EffectsBuilder},
    AppHandle, Emitter, LogicalPosition, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder,
};

use crate::{commands::dock, logger};

const SETTINGS_NAVIGATE_EVENT: &str = "settings-navigate";
#[cfg(debug_assertions)]
const DEV_ONBOARDING_REQUEST_EVENT: &str = "dev-onboarding-request";

fn show_and_focus_window(win: &tauri::WebviewWindow) {
    dock::prepare_settings_window(win.app_handle());
    if let Err(err) = win.show() {
        logger::log_error(
            "WINDOW",
            &format!("Failed to show settings window: {}", err),
        );
    }
    if let Err(err) = win.unminimize() {
        logger::log_error(
            "WINDOW",
            &format!("Failed to restore settings window: {}", err),
        );
    }
    if let Err(err) = win.set_focus() {
        logger::log_error(
            "WINDOW",
            &format!("Failed to focus settings window: {}", err),
        );
    }
}

fn create_settings_window(app: &AppHandle, url: &str) -> Result<tauri::WebviewWindow, String> {
    let builder = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url.into()))
        .title("Talkee")
        .inner_size(900.0, 640.0)
        .min_inner_size(760.0, 520.0)
        .center()
        // Native macOS window chrome: real traffic lights on an overlay title
        // bar, system corner radius and shadow. The window stays transparent so
        // the whole-window Sidebar vibrancy can show through in the sidebar area.
        .decorations(true)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(20.0, 20.0))
        .transparent(true)
        .effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::FollowsWindowActiveState)
                .build(),
        );

    let win = builder.build().map_err(|e| e.to_string())?;

    show_and_focus_window(&win);
    Ok(win)
}

#[tauri::command]
pub async fn set_settings_titlebar_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let _ = (app, theme);

    Ok(())
}

#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        show_and_focus_window(&win);
        return Ok(());
    }

    create_settings_window(&app, "index.html?window=settings")?;
    Ok(())
}

#[tauri::command]
pub async fn open_settings_tab(
    app: AppHandle,
    tab: String,
    result_id: Option<String>,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        show_and_focus_window(&win);
        app.emit_to(
            "settings",
            SETTINGS_NAVIGATE_EVENT,
            serde_json::json!({ "tab": tab, "resultId": result_id }),
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = match result_id {
        Some(result_id) if !result_id.is_empty() => {
            format!(
                "index.html?window=settings&tab={}&resultId={}",
                tab, result_id
            )
        }
        _ => format!("index.html?window=settings&tab={}", tab),
    };
    create_settings_window(&app, &url)?;
    Ok(())
}

#[cfg(debug_assertions)]
pub async fn open_dev_onboarding(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        show_and_focus_window(&win);
        app.emit_to("settings", DEV_ONBOARDING_REQUEST_EVENT, ())
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    create_settings_window(&app, "index.html?window=settings&onboarding=1")?;
    Ok(())
}
