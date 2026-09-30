//! One-time migration of user data from the legacy "Talkis" app identity.
//!
//! The bundle identifier change moves the Tauri app-data directory from
//! `com.trixter.talkis` to `com.talkee.app`. Without migration the user would
//! lose settings, history and multi-gigabyte downloaded models. This module is
//! deliberately free of any `AppHandle` dependency so it can be unit-tested on
//! temporary directories.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::history_storage::copy_dir_contents_if_missing;
use crate::logger;

/// Marker written into the new app-data dir once the migration completed. The
/// name intentionally avoids the legacy word so a fresh machine never creates
/// a path that contains it.
pub const MIGRATION_MARKER_FILE: &str = ".talkee-migrated-from-legacy";
/// Event emitted to the widget when the migration fails.
pub const MIGRATION_ERROR_EVENT: &str = "app-data-migration-error";

const LEGACY_LAYOUT_MARKER_FILE: &str = ".talkis-app-data-layout-v3";
const APP_DATA_LAYOUT_MARKER_FILE: &str = ".talkee-app-data-layout-v3";
const LEGACY_SETTINGS_FILE: &str = "talkis.json";
const SETTINGS_FILE: &str = "talkee.json";
/// Settings keys whose values are filesystem paths inside the app-data dir.
const PATH_SETTINGS_KEYS: &[&str] = &["localModelsDir", "transcriptionStorageDir"];

/// Legacy sidecar process names. Kept in the allowlisted migration module so
/// the shutdown cleanup can still terminate an orphan left by a pre-rename
/// session without the legacy word leaking into the rest of the sources.
pub const LEGACY_SIDECAR_NAMES: &[&str] = &[
    "talkis-ffmpeg",
    "talkis-stt",
    "talkis-diarize",
    "talkis-llm",
];

/// Legacy app-data layout marker, still accepted when reading an existing
/// directory that predates the rename.
pub const LEGACY_LAYOUT_MARKER: &str = LEGACY_LAYOUT_MARKER_FILE;

/// Result of a migration attempt, suitable for logging and tests.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    /// Number of files actually copied into the new directory.
    pub copied_files: u64,
    /// Number of settings path values rewritten to the new directory.
    pub rewritten_paths: u64,
    /// Whether `talkis.json` was renamed to `talkee.json`.
    pub renamed_settings: bool,
    /// Whether the legacy layout marker was renamed.
    pub renamed_layout_marker: bool,
    /// Whether the migration was skipped (marker already present or no old dir).
    pub skipped: bool,
}

/// Legacy app-data directory derived from a home directory.
pub fn legacy_data_dir(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join("com.trixter.talkis")
}

/// Resolve the legacy/new app-data directories from the running app and run the
/// migration. On failure the error is logged and emitted to the widget.
pub fn run_startup_migration(app: &tauri::AppHandle) -> Result<MigrationReport, String> {
    use tauri::{Emitter, Manager};

    let home = app
        .path()
        .home_dir()
        .map_err(|err| format!("Не удалось определить домашнюю папку: {}", err))?;
    let new_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных: {}", err))?;

    match migrate_from_talkis(&legacy_data_dir(&home), &new_dir) {
        Ok(report) => Ok(report),
        Err(err) => {
            let message = format!("Не удалось перенести данные из прежней версии: {}", err);
            logger::log_error("MIGRATION", &message);
            let _ = app.emit(MIGRATION_ERROR_EVENT, message.clone());
            Err(message)
        }
    }
}

/// Migrate data from the legacy identity directory into the new one.
///
/// Idempotent: existing files in `new_dir` are never overwritten and the
/// migration marker short-circuits a repeat run. The legacy directory is left
/// untouched.
pub fn migrate_from_talkis(old_dir: &Path, new_dir: &Path) -> Result<MigrationReport, String> {
    let marker_path = new_dir.join(MIGRATION_MARKER_FILE);
    if marker_path.is_file() {
        return Ok(MigrationReport {
            skipped: true,
            ..Default::default()
        });
    }

    fs::create_dir_all(new_dir).map_err(|err| {
        format!(
            "Не удалось создать папку данных {}: {}",
            new_dir.display(),
            err
        )
    })?;

    if !old_dir.is_dir() {
        write_marker(&marker_path)?;
        return Ok(MigrationReport {
            skipped: true,
            ..Default::default()
        });
    }

    // APFS `std::fs::copy` uses `fclonefileat`, so multi-gigabyte models are
    // cloned instantly without doubling the disk usage.
    let copied_files = copy_dir_contents_if_missing(old_dir, new_dir)?;
    let renamed_settings = finalize_file(
        &new_dir.join(LEGACY_SETTINGS_FILE),
        &new_dir.join(SETTINGS_FILE),
    )?;
    let renamed_layout_marker = finalize_file(
        &new_dir.join(LEGACY_LAYOUT_MARKER_FILE),
        &new_dir.join(APP_DATA_LAYOUT_MARKER_FILE),
    )?;
    let rewritten_paths = rewrite_settings_paths(&new_dir.join(SETTINGS_FILE), old_dir, new_dir)?;

    write_marker(&marker_path)?;

    logger::log_info(
        "MIGRATION",
        &format!(
            "Migrated {} files from {} to {} (rewritten settings paths: {})",
            copied_files,
            old_dir.display(),
            new_dir.display(),
            rewritten_paths
        ),
    );

    Ok(MigrationReport {
        copied_files,
        rewritten_paths,
        renamed_settings,
        renamed_layout_marker,
        skipped: false,
    })
}

/// Rename a legacy artifact to its current name. If the current file already
/// exists it is never overwritten: the stale legacy copy is removed instead.
fn finalize_file(legacy: &Path, current: &Path) -> Result<bool, String> {
    if !legacy.is_file() {
        return Ok(false);
    }

    if current.exists() {
        fs::remove_file(legacy).map_err(|err| {
            format!(
                "Не удалось удалить устаревший файл {}: {}",
                legacy.display(),
                err
            )
        })?;
        return Ok(false);
    }

    fs::rename(legacy, current).map_err(|err| {
        format!(
            "Не удалось переименовать {} в {}: {}",
            legacy.display(),
            current.display(),
            err
        )
    })?;

    Ok(true)
}

/// Rewrite path settings that still point into the legacy directory.
fn rewrite_settings_paths(
    settings_path: &Path,
    old_dir: &Path,
    new_dir: &Path,
) -> Result<u64, String> {
    if !settings_path.is_file() {
        return Ok(0);
    }

    let raw = fs::read_to_string(settings_path)
        .map_err(|err| format!("Не удалось прочитать {}: {}", settings_path.display(), err))?;
    let mut value: Value = serde_json::from_str(&raw)
        .map_err(|err| format!("Не удалось разобрать {}: {}", settings_path.display(), err))?;

    let Some(object) = value.as_object_mut() else {
        return Ok(0);
    };

    let mut rewritten = 0;
    for key in PATH_SETTINGS_KEYS {
        let Some(entry) = object.get_mut(*key) else {
            continue;
        };
        let Some(path) = entry.as_str() else {
            continue;
        };
        if let Some(next) = rewrite_path(path, old_dir, new_dir) {
            *entry = Value::String(next);
            rewritten += 1;
        }
    }

    if rewritten > 0 {
        let serialized = serde_json::to_string_pretty(&value)
            .map_err(|err| format!("Не удалось сериализовать настройки: {}", err))?;
        fs::write(settings_path, serialized)
            .map_err(|err| format!("Не удалось сохранить {}: {}", settings_path.display(), err))?;
    }

    Ok(rewritten)
}

fn rewrite_path(path: &str, old_dir: &Path, new_dir: &Path) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    let source = Path::new(trimmed);
    if !source.starts_with(old_dir) {
        return None;
    }

    let relative = source.strip_prefix(old_dir).ok()?;
    Some(new_dir.join(relative).to_string_lossy().to_string())
}

fn write_marker(marker_path: &Path) -> Result<(), String> {
    if let Some(parent) = marker_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Не удалось создать папку {}: {}", parent.display(), err))?;
    }

    fs::write(marker_path, b"migrated\n")
        .map_err(|err| format!("Не удалось записать маркер миграции: {}", err))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn dirs() -> (TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let old_dir = root.path().join("old");
        let new_dir = root.path().join("new");
        (root, old_dir, new_dir)
    }

    #[test]
    fn missing_old_dir_writes_marker_and_skips() {
        let (_root, old_dir, new_dir) = dirs();

        let report = migrate_from_talkis(&old_dir, &new_dir).unwrap();

        assert!(report.skipped);
        assert_eq!(report.copied_files, 0);
        assert!(new_dir.join(MIGRATION_MARKER_FILE).is_file());
    }

    #[test]
    fn empty_old_dir_writes_marker() {
        let (_root, old_dir, new_dir) = dirs();
        fs::create_dir_all(&old_dir).unwrap();

        let report = migrate_from_talkis(&old_dir, &new_dir).unwrap();

        assert!(!report.skipped);
        assert_eq!(report.copied_files, 0);
        assert!(new_dir.join(MIGRATION_MARKER_FILE).is_file());
    }

    #[test]
    fn full_old_dir_copies_history_models_and_settings() {
        let (_root, old_dir, new_dir) = dirs();
        write_file(&old_dir.join("history/history.json"), r#"{"entries":[]}"#);
        write_file(&old_dir.join("models/stt/ggml-tiny.bin"), "model-bytes");
        write_file(&old_dir.join(LEGACY_LAYOUT_MARKER_FILE), "");
        let settings = serde_json::json!({
            "uiLanguage": "en",
            "localModelsDir": old_dir.join("models/stt").to_string_lossy(),
            "transcriptionStorageDir": old_dir.join("storage").to_string_lossy(),
            "apiKey": "secret",
        });
        write_file(&old_dir.join(LEGACY_SETTINGS_FILE), &settings.to_string());

        let report = migrate_from_talkis(&old_dir, &new_dir).unwrap();

        assert!(!report.skipped);
        assert_eq!(report.copied_files, 4);
        assert!(report.renamed_settings);
        assert!(report.renamed_layout_marker);
        assert_eq!(report.rewritten_paths, 2);
        assert!(!new_dir.join(LEGACY_SETTINGS_FILE).exists());
        assert!(new_dir.join(SETTINGS_FILE).is_file());
        assert!(new_dir.join(APP_DATA_LAYOUT_MARKER_FILE).is_file());
        assert_eq!(
            fs::read_to_string(new_dir.join("models/stt/ggml-tiny.bin")).unwrap(),
            "model-bytes"
        );
        assert!(new_dir.join("history/history.json").is_file());
    }

    #[test]
    fn existing_new_settings_is_not_overwritten() {
        let (_root, old_dir, new_dir) = dirs();
        write_file(&old_dir.join(LEGACY_SETTINGS_FILE), r#"{"apiKey":"old"}"#);
        write_file(&new_dir.join(SETTINGS_FILE), r#"{"apiKey":"new"}"#);

        let report = migrate_from_talkis(&old_dir, &new_dir).unwrap();

        assert!(!report.renamed_settings);
        assert!(!new_dir.join(LEGACY_SETTINGS_FILE).exists());
        assert_eq!(
            fs::read_to_string(new_dir.join(SETTINGS_FILE)).unwrap(),
            r#"{"apiKey":"new"}"#
        );
    }

    #[test]
    fn second_run_with_marker_is_skipped() {
        let (_root, old_dir, new_dir) = dirs();
        write_file(&old_dir.join("history/history.json"), "{}");

        migrate_from_talkis(&old_dir, &new_dir).unwrap();
        // New data appears after the first, completed migration.
        write_file(&old_dir.join("history/late.json"), "{}");

        let report = migrate_from_talkis(&old_dir, &new_dir).unwrap();

        assert!(report.skipped);
        assert_eq!(report.copied_files, 0);
        assert!(!new_dir.join("history/late.json").exists());
    }

    #[test]
    fn settings_paths_are_rewritten_into_new_dir() {
        let (_root, old_dir, new_dir) = dirs();
        let settings = serde_json::json!({
            "localModelsDir": old_dir.join("models").to_string_lossy(),
            "transcriptionStorageDir": "/somewhere/else".to_string(),
        });
        write_file(&old_dir.join(LEGACY_SETTINGS_FILE), &settings.to_string());

        migrate_from_talkis(&old_dir, &new_dir).unwrap();

        let migrated: Value =
            serde_json::from_str(&fs::read_to_string(new_dir.join(SETTINGS_FILE)).unwrap())
                .unwrap();
        assert_eq!(
            migrated["localModelsDir"].as_str().unwrap(),
            new_dir.join("models").to_string_lossy()
        );
        assert_eq!(
            migrated["transcriptionStorageDir"].as_str().unwrap(),
            "/somewhere/else"
        );
    }
}
