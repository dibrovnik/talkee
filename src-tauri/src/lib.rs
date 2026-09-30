#[cfg(not(target_os = "macos"))]
compile_error!("talkee supports macOS only");

mod ai;
mod app_menu;
mod app_nap;
mod call_capture;
mod commands;
mod download_cancel;
mod history_storage;
mod hotkey_capture;
mod hotkey_manager;
mod legacy_migration;
mod live_dictation;
mod live_translation;
mod llm_runtime;
mod local_stt;
mod local_translator;
mod logger;
mod media;
mod native_voice_recorder;
mod notch;
mod paste;
mod prompt_config;
pub mod realtime;
mod settings_store;
mod shutdown;
mod tray;

use commands::{accessibility, dock, runtime_info, settings_window, widget};
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::ManagerExt;

/// Passed by the login item so an autostart launch can skip the settings window.
const AUTOSTART_ARG: &str = "--autostart";

fn launched_by_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

/// The settings window opens on first run (onboarding) and on explicit
/// launches, but not when the login item starts the app.
fn should_open_settings_on_launch(autostart: bool, onboarding_complete: bool) -> bool {
    !autostart || !onboarding_complete
}

/// Login items registered before `--autostart` existed have no arguments;
/// re-enabling rewrites the LaunchAgent with the current ones.
fn refresh_autostart_registration(app: &tauri::AppHandle) {
    let autolaunch = app.autolaunch();
    if !autolaunch.is_enabled().unwrap_or(false) {
        return;
    }
    if let Err(err) = autolaunch.enable() {
        logger::log_error(
            "INIT",
            &format!("Failed to refresh the autostart login item: {err}"),
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    builder
        .menu(app_menu::build)
        .on_menu_event(app_menu::handle_event)
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let tauri::WindowEvent::Destroyed = event {
                    dock::settings_window_closed(window.app_handle());
                }
                return;
            }
            if window.label() != "widget" {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                logger::log_info("WIDGET", "Prevented the persistent widget from closing");
                if let Err(err) =
                    widget::restore_widget_window(window.app_handle(), "close-request", false)
                {
                    logger::log_error(
                        "WIDGET",
                        &format!("Failed to restore widget after close request: {err}"),
                    );
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            logger::log_info("INIT", "Application starting...");

            // Must run before the settings store, history and windows are used,
            // so the new app-data directory already contains the migrated data.
            let _ = legacy_migration::run_startup_migration(app.handle());

            if let Err(err) = native_voice_recorder::init() {
                logger::log_error(
                    "NATIVE_RECORDER",
                    &format!(
                        "Failed to initialize persistent native recorder; WebView fallback will be used: {}",
                        err
                    ),
                );
            }
            hotkey_manager::init(app);

            let autostart = launched_by_autostart();
            let onboarding_complete = settings_store::read_onboarding_complete(app.handle())
                .unwrap_or_else(|err| {
                    logger::log_error(
                        "INIT",
                        &format!("Failed to read onboarding state: {err}"),
                    );
                    false
                });
            let open_settings = should_open_settings_on_launch(autostart, onboarding_complete);
            logger::log_info(
                "INIT",
                &format!(
                    "Launch: autostart={autostart} onboarding_complete={onboarding_complete} open_settings={open_settings}"
                ),
            );
            dock::init(app.handle(), open_settings);
            tray::setup(app)?;

            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![AUTOSTART_ARG]),
            ))?;
            refresh_autostart_registration(app.handle());

            let _ = widget::ensure_widget_notice_window(app.handle());
            let _ = widget::ensure_widget_text_window(app.handle());

            if let Some(win) = app.get_webview_window("widget") {
                if let Err(err) = widget::configure_main_widget_window(&win) {
                    logger::log_error(
                        "WINDOW",
                        &format!("Failed to configure widget window during setup: {err}"),
                    );
                }
            }
            widget::start_widget_watchdog(app.handle());
            widget::start_island_screen_observer(app.handle());

            if open_settings {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = settings_window::open_settings(handle).await {
                        logger::log_error(
                            "INIT",
                            &format!("Failed to open settings on launch: {err}"),
                        );
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_window::open_settings,
            settings_window::open_settings_tab,
            settings_window::set_settings_titlebar_theme,
            dock::set_dock_visibility,
            notch::get_island_availability,
            widget::widget_resize,
            widget::set_widget_presentation,
            widget::set_island_interactive,
            widget::set_text_display,
            widget::activate_widget_for_hotkey,
            widget::show_widget_notice,
            widget::hide_widget_notice,
            widget::expand_widget_notice,
            widget::show_widget_text_overlay,
            widget::widget_text_overlay_ready,
            widget::get_widget_text_overlay_payload,
            widget::hide_widget_text_overlay,
            widget::hide_widget_text_overlay_request,
            tray::set_tray_recording,
            tray::update_cleanup_menu,
            paste::remember_paste_target_window,
            paste::copy_selected_text,
            paste::paste_text,
            ai::transcribe_and_clean,
            ai::transcribe_only,
            ai::transcribe_file_path,
            ai::process_text,
            ai::embed_text,
            history_storage::migrate_app_data_layout,
            history_storage::read_history_file,
            history_storage::read_history_index_file,
            history_storage::read_history_entry_file,
            history_storage::write_history_file,
            history_storage::get_default_transcription_storage_dir,
            history_storage::save_history_audio,
            history_storage::read_history_audio,
            history_storage::delete_history_audio,
            call_capture::list_call_capture_targets,
            call_capture::start_call_capture,
            call_capture::stop_call_capture,
            call_capture::save_call_capture_mic_track,
            call_capture::pause_call_capture_mic,
            call_capture::resume_call_capture_mic,
            call_capture::checkpoint_call_transcription,
            call_capture::recover_call_capture_sessions,
            call_capture::get_call_capture_status,
            call_capture::get_call_capture_duration_ms,
            live_translation::start_live_translation,
            live_translation::get_live_translation_audio_level,
            live_translation::stop_live_translation,
            media::prepare_media_for_transcription,
            native_voice_recorder::start_native_voice_recording,
            native_voice_recorder::pause_native_voice_recording,
            native_voice_recorder::resume_native_voice_recording,
            native_voice_recorder::stop_native_voice_recording,
            ai::test_api_connection,
            realtime::test_realtime_connection,
            ai::list_stt_models,
            ai::warm_up_local_stt_runtime,
            ai::install_stt_model,
            ai::delete_stt_model,
            local_translator::list_local_translators,
            local_translator::download_local_translator,
            local_translator::delete_local_translator,
            local_translator::translate_with_local_translator,
            local_stt::get_local_stt_default_models_dir,
            llm_runtime::list_local_llm_models,
            llm_runtime::download_local_llm_model,
            llm_runtime::delete_local_llm_model,
            llm_runtime::start_local_llm,
            llm_runtime::stop_local_llm,
            llm_runtime::get_local_llm_status,
            llm_runtime::get_llm_download_progress,
            download_cancel::cancel_local_model_download,
            logger::log_event,
            logger::get_log_path_cmd,
            logger::clear_logs,
            accessibility::open_accessibility_settings,
            accessibility::reset_accessibility_permission,
            accessibility::check_accessibility_permission,
            accessibility::check_microphone_permission,
            accessibility::check_reduce_transparency,
            runtime_info::get_app_runtime_info,
            get_cleanup_prompt_preview,
            get_cleanup_prompt,
            start_native_hotkey_capture,
            stop_native_hotkey_capture,
            hotkey_manager::register_handy_hotkey,
            hotkey_manager::unregister_handy_hotkey,
            app_nap::begin_work_activity,
            app_nap::end_work_activity,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Talkee")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = settings_window::open_settings(app).await {
                        logger::log_error(
                            "WINDOW",
                            &format!("Failed to open settings on Dock reopen: {err}"),
                        );
                    }
                });
            }
        });
}

#[cfg(test)]
mod tests {
    use super::should_open_settings_on_launch;

    #[test]
    fn autostart_skips_settings_only_after_onboarding() {
        assert!(should_open_settings_on_launch(false, true));
        assert!(should_open_settings_on_launch(false, false));
        assert!(should_open_settings_on_launch(true, false));
        assert!(!should_open_settings_on_launch(true, true));
    }
}

#[tauri::command]
fn get_cleanup_prompt(
    language: String,
    style: String,
) -> Result<prompt_config::PromptPreview, String> {
    prompt_config::build_cleanup_prompt_preview(&language, &style)
}

#[tauri::command]
fn get_cleanup_prompt_preview(
    language: String,
    style: String,
) -> Result<prompt_config::PromptPreview, String> {
    prompt_config::build_cleanup_prompt_preview(&language, &style)
}

#[tauri::command]
fn start_native_hotkey_capture(
    window: tauri::WebviewWindow,
    request_id: String,
    target: String,
) -> Result<(), String> {
    hotkey_capture::start_capture(&window, request_id, target)
}

#[tauri::command]
fn stop_native_hotkey_capture(
    window: tauri::WebviewWindow,
    request_id: String,
    target: String,
) -> Result<(), String> {
    hotkey_capture::stop_capture(&window, request_id, target)
}
