use crate::{
    commands::{settings_window, widget},
    logger, shutdown,
};
use std::future::Future;
use tauri::{
    image::Image,
    menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    App, AppHandle, Manager,
};

const TRAY_ID: &str = "talkee-main-tray";

// Template images: macOS keeps only the alpha channel, so a single black glyph
// works on both light and dark menu bars. The @2x bitmap keeps the glyph crisp.
const TRAY_ICON_PNG: &[u8] = include_bytes!("../icons/tray/tray@2x.png");
const TRAY_ICON_RECORDING_PNG: &[u8] = include_bytes!("../icons/tray/tray-recording@2x.png");
const TRAY_OPEN_ID: &str = "talkee-tray-open";
const TRAY_HISTORY_ID: &str = "talkee-tray-history";
const TRAY_FILE_ID: &str = "talkee-tray-file";
const TRAY_CHAT_ID: &str = "talkee-tray-chat";
const TRAY_MODELS_ID: &str = "talkee-tray-models";
const TRAY_TRANSLATOR_ID: &str = "talkee-tray-translator";
const TRAY_PROMPTS_ID: &str = "talkee-tray-prompts";
const TRAY_SETTINGS_ID: &str = "talkee-tray-settings";
#[cfg(debug_assertions)]
const TRAY_ONBOARDING_ID: &str = "talkee-tray-onboarding";
const TRAY_QUIT_ID: &str = "talkee-tray-quit";

struct TrayState {
    _tray: TrayIcon,
}

#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    Open,
    History,
    FileTranscription,
    Chat,
    Models,
    Translator,
    Prompts,
    Settings,
    #[cfg(debug_assertions)]
    Onboarding,
    Quit,
}

fn tray_action(menu_id: &str) -> Option<TrayAction> {
    match menu_id {
        TRAY_OPEN_ID => Some(TrayAction::Open),
        TRAY_HISTORY_ID => Some(TrayAction::History),
        TRAY_FILE_ID => Some(TrayAction::FileTranscription),
        TRAY_CHAT_ID => Some(TrayAction::Chat),
        TRAY_MODELS_ID => Some(TrayAction::Models),
        TRAY_TRANSLATOR_ID => Some(TrayAction::Translator),
        TRAY_PROMPTS_ID => Some(TrayAction::Prompts),
        TRAY_SETTINGS_ID => Some(TrayAction::Settings),
        #[cfg(debug_assertions)]
        TRAY_ONBOARDING_ID => Some(TrayAction::Onboarding),
        TRAY_QUIT_ID => Some(TrayAction::Quit),
        _ => None,
    }
}

fn run_settings_action<F>(action_name: &'static str, action: F)
where
    F: Future<Output = Result<(), String>> + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        if let Err(err) = action.await {
            logger::log_error(
                "TRAY",
                &format!("Failed to run {action_name} from tray: {err}"),
            );
        }
    });
}

fn open_settings(app: &AppHandle) {
    run_settings_action("open settings", settings_window::open_settings(app.clone()));
}

fn open_talkee(app: &AppHandle) {
    if let Err(err) = widget::restore_widget_window(app, "tray-open", false) {
        logger::log_error(
            "TRAY",
            &format!("Failed to restore widget from tray: {err}"),
        );
    }
    open_settings(app);
}

fn open_settings_tab(app: &AppHandle, tab: &'static str) {
    run_settings_action(
        "open settings tab",
        settings_window::open_settings_tab(app.clone(), tab.to_owned(), None),
    );
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, TRAY_OPEN_ID, "Открыть Talkee", true, None::<&str>)?;
    let navigation_separator = PredefinedMenuItem::separator(app)?;
    let history_item = MenuItem::with_id(app, TRAY_HISTORY_ID, "История", true, None::<&str>)?;
    let file_item =
        MenuItem::with_id(app, TRAY_FILE_ID, "Транскрибация файла", true, None::<&str>)?;
    let chat_item = MenuItem::with_id(app, TRAY_CHAT_ID, "Чат", true, None::<&str>)?;
    let models_item =
        MenuItem::with_id(app, TRAY_MODELS_ID, "Диктовка и модели", true, None::<&str>)?;
    let translator_item =
        MenuItem::with_id(app, TRAY_TRANSLATOR_ID, "Переводчик", true, None::<&str>)?;
    let prompts_item =
        MenuItem::with_id(app, TRAY_PROMPTS_ID, "Стиль и промпты", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(
        app,
        TRAY_SETTINGS_ID,
        "Настройки и горячие клавиши",
        true,
        None::<&str>,
    )?;
    #[cfg(debug_assertions)]
    let onboarding_item = MenuItem::with_id(
        app,
        TRAY_ONBOARDING_ID,
        "Онбординг (DEV)",
        true,
        None::<&str>,
    )?;
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Talkee"))
        .version(Some(app.package_info().version.to_string()))
        .comments(Some("Голос в текст, транскрибация и перевод."))
        .build();
    let about_item = PredefinedMenuItem::about(app, Some("О Talkee"), Some(about_metadata))?;
    let quit_separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Выйти из Talkee", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_item,
            &navigation_separator,
            &history_item,
            &file_item,
            &chat_item,
            &models_item,
            &translator_item,
            &prompts_item,
            &settings_item,
            #[cfg(debug_assertions)]
            &onboarding_item,
            &about_item,
            &quit_separator,
            &quit_item,
        ],
    )?;

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Talkee")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match tray_action(event.id().as_ref()) {
            Some(TrayAction::Open) => open_talkee(app),
            Some(TrayAction::History) => open_settings_tab(app, "main"),
            Some(TrayAction::FileTranscription) => open_settings_tab(app, "file"),
            Some(TrayAction::Chat) => open_settings_tab(app, "chat"),
            Some(TrayAction::Models) => open_settings_tab(app, "model"),
            Some(TrayAction::Translator) => open_settings_tab(app, "interpreter"),
            Some(TrayAction::Prompts) => open_settings_tab(app, "style"),
            Some(TrayAction::Settings) => open_settings_tab(app, "settings"),
            #[cfg(debug_assertions)]
            Some(TrayAction::Onboarding) => run_settings_action(
                "open onboarding",
                settings_window::open_dev_onboarding(app.clone()),
            ),
            Some(TrayAction::Quit) => shutdown::quit(app),
            None => {}
        });

    let icon = Image::from_bytes(TRAY_ICON_PNG)?;
    let tray = builder.icon(icon).icon_as_template(true).build(app)?;
    app.manage(TrayState { _tray: tray });
    logger::log_info("TRAY", "System tray initialized");
    Ok(())
}

/// Switches the menu-bar icon between the idle and recording variants.
///
/// Called from the frontend while dictation or call capture is running. The
/// icon is re-applied with `set_icon_with_as_template` so the template flag is
/// preserved without a second render pass (avoids a visible flicker).
#[tauri::command]
pub fn set_tray_recording(app: AppHandle, recording: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray icon is not initialized".to_string())?;
    let bytes = if recording {
        TRAY_ICON_RECORDING_PNG
    } else {
        TRAY_ICON_PNG
    };
    let icon = Image::from_bytes(bytes).map_err(|error| error.to_string())?;
    tray.set_icon_with_as_template(Some(icon), true)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_supported_tray_menu_actions() {
        assert_eq!(tray_action(TRAY_OPEN_ID), Some(TrayAction::Open));
        assert_eq!(tray_action(TRAY_HISTORY_ID), Some(TrayAction::History));
        assert_eq!(
            tray_action(TRAY_FILE_ID),
            Some(TrayAction::FileTranscription)
        );
        assert_eq!(tray_action(TRAY_CHAT_ID), Some(TrayAction::Chat));
        assert_eq!(tray_action(TRAY_MODELS_ID), Some(TrayAction::Models));
        assert_eq!(
            tray_action(TRAY_TRANSLATOR_ID),
            Some(TrayAction::Translator)
        );
        assert_eq!(tray_action(TRAY_PROMPTS_ID), Some(TrayAction::Prompts));
        assert_eq!(tray_action(TRAY_SETTINGS_ID), Some(TrayAction::Settings));
        #[cfg(debug_assertions)]
        assert_eq!(
            tray_action(TRAY_ONBOARDING_ID),
            Some(TrayAction::Onboarding)
        );
        assert_eq!(tray_action(TRAY_QUIT_ID), Some(TrayAction::Quit));
        assert_eq!(tray_action("unknown"), None);
    }
}
