//! Read access to the frontend settings store (`talkee.json`) for startup
//! decisions made in Rust. The store instance is shared with the WebView through
//! `tauri-plugin-store`, so reads and writes here see the same data.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const SETTINGS_STORE_FILE: &str = "talkee.json";
const SETTINGS_KEY: &str = "settings";
const SHOW_IN_DOCK_KEY: &str = "showInDock";
const PERMISSIONS_PASSED_KEY: &str = "permissions_passed";
const PERMISSIONS_VERSION_KEY: &str = "permissions_version";
/// Mirrors `CURRENT_PERMISSIONS_VERSION` in `src/lib/store.ts`.
const CURRENT_PERMISSIONS_VERSION: u64 = 3;

fn show_in_dock_from_settings(settings: Option<&Value>) -> bool {
    settings
        .and_then(|value| value.get(SHOW_IN_DOCK_KEY))
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn onboarding_passed(passed: Option<&Value>, version: Option<&Value>) -> bool {
    let passed = passed.and_then(Value::as_bool).unwrap_or(false);
    let version = version.and_then(Value::as_u64).unwrap_or(1);
    passed && version >= CURRENT_PERMISSIONS_VERSION
}

/// Persisted `showInDock` preference (defaults to `true`).
pub fn read_show_in_dock(app: &AppHandle) -> Result<bool, String> {
    let store = app.store(SETTINGS_STORE_FILE).map_err(|e| e.to_string())?;
    Ok(show_in_dock_from_settings(store.get(SETTINGS_KEY).as_ref()))
}

/// Whether the first-run onboarding (permissions step) has been completed.
pub fn read_onboarding_complete(app: &AppHandle) -> Result<bool, String> {
    let store = app.store(SETTINGS_STORE_FILE).map_err(|e| e.to_string())?;
    Ok(onboarding_passed(
        store.get(PERMISSIONS_PASSED_KEY).as_ref(),
        store.get(PERMISSIONS_VERSION_KEY).as_ref(),
    ))
}

/// Writes `showInDock` into the saved settings object.
pub fn write_show_in_dock(app: &AppHandle, show: bool) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE_FILE).map_err(|e| e.to_string())?;
    let mut settings = store
        .get(SETTINGS_KEY)
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Default::default()));
    if let Some(object) = settings.as_object_mut() {
        object.insert(SHOW_IN_DOCK_KEY.to_owned(), Value::Bool(show));
    }
    store.set(SETTINGS_KEY, settings);
    store.save().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn show_in_dock_defaults_to_true() {
        assert!(show_in_dock_from_settings(None));
        assert!(show_in_dock_from_settings(Some(&json!({}))));
        assert!(show_in_dock_from_settings(Some(
            &json!({ "showInDock": "no" })
        )));
    }

    #[test]
    fn show_in_dock_reads_saved_value() {
        assert!(!show_in_dock_from_settings(Some(
            &json!({ "showInDock": false })
        )));
        assert!(show_in_dock_from_settings(Some(
            &json!({ "showInDock": true })
        )));
    }

    #[test]
    fn onboarding_requires_current_permissions_version() {
        assert!(!onboarding_passed(None, None));
        assert!(!onboarding_passed(Some(&json!(true)), None));
        assert!(!onboarding_passed(Some(&json!(true)), Some(&json!(2))));
        assert!(!onboarding_passed(Some(&json!(false)), Some(&json!(3))));
        assert!(onboarding_passed(Some(&json!(true)), Some(&json!(3))));
    }
}
