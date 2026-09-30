//! Native macOS application menu (Talkee / Правка / Окно) with Russian labels.
//! Predefined AppKit items get system behavior and shortcuts; the bundle
//! declares `ru` as its development region so AppKit localizes them too.

use tauri::{
    menu::{
        AboutMetadata, AboutMetadataBuilder, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
    },
    AppHandle, Manager, Runtime,
};

use crate::{commands::settings_window, logger, shutdown};

const MENU_SETTINGS_ID: &str = "talkee-menu-settings";
const MENU_QUIT_ID: &str = "talkee-menu-quit";

pub fn about_metadata<R: Runtime, M: Manager<R>>(manager: &M) -> AboutMetadata<'static> {
    AboutMetadataBuilder::new()
        .name(Some("Talkee"))
        .version(Some(manager.package_info().version.to_string()))
        .comments(Some("Голос в текст, транскрибация и перевод."))
        .build()
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_submenu = Submenu::with_items(
        app,
        "Talkee",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("О программе Talkee"), Some(about_metadata(app)))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_SETTINGS_ID,
                "Настройки…",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("Службы"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Скрыть Talkee"))?,
            &PredefinedMenuItem::hide_others(app, Some("Скрыть остальные"))?,
            &PredefinedMenuItem::show_all(app, Some("Показать все"))?,
            &PredefinedMenuItem::separator(app)?,
            // A regular item (not `PredefinedMenuItem::quit`) so ⌘Q goes through
            // the same graceful shutdown as the tray, stopping managed sidecars.
            &MenuItem::with_id(
                app,
                MENU_QUIT_ID,
                "Завершить Talkee",
                true,
                Some("CmdOrCtrl+Q"),
            )?,
        ],
    )?;

    let edit_submenu = Submenu::with_items(
        app,
        "Правка",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Отменить"))?,
            &PredefinedMenuItem::redo(app, Some("Повторить"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Вырезать"))?,
            &PredefinedMenuItem::copy(app, Some("Копировать"))?,
            &PredefinedMenuItem::paste(app, Some("Вставить"))?,
            &PredefinedMenuItem::select_all(app, Some("Выбрать всё"))?,
        ],
    )?;

    let window_submenu = Submenu::with_items(
        app,
        "Окно",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Свернуть"))?,
            &PredefinedMenuItem::close_window(app, Some("Закрыть"))?,
        ],
    )?;

    Menu::with_items(app, &[&app_submenu, &edit_submenu, &window_submenu])
}

pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_SETTINGS_ID => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = settings_window::open_settings(app).await {
                    logger::log_error(
                        "MENU",
                        &format!("Failed to open settings from app menu: {err}"),
                    );
                }
            });
        }
        MENU_QUIT_ID => shutdown::quit(app),
        _ => {}
    }
}
