//! Personal vocabulary: Rust owns every durable mutation of the
//! `personalVocabularyV1` key; WebViews read snapshots and send typed commands.

pub mod model;
pub mod portable;
pub mod store;

use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;

use crate::logger;
use store::{
    ConfigPatch, TermInput, VocabularyError, VocabularyPersistence, VocabularyStore,
    VocabularyView, STORE_KEY,
};

const SETTINGS_STORE_FILE: &str = "talkee.json";
pub const VOCABULARY_UPDATED_EVENT: &str = "vocabulary:updated";

/// The subset of the plugin store the vocabulary needs, so the adapter can be
/// tested against a real file without a Tauri runtime.
pub trait KeyValueFile: Send + Sync {
    fn get(&self, key: &str) -> Option<Value>;
    fn set(&self, key: &str, value: Value);
    fn delete(&self, key: &str);
    fn save(&self) -> Result<(), String>;
}

impl<R: Runtime> KeyValueFile for tauri_plugin_store::Store<R> {
    fn get(&self, key: &str) -> Option<Value> {
        tauri_plugin_store::Store::get(self, key)
    }

    fn set(&self, key: &str, value: Value) {
        tauri_plugin_store::Store::set(self, key, value);
    }

    fn delete(&self, key: &str) {
        tauri_plugin_store::Store::delete(self, key);
    }

    fn save(&self) -> Result<(), String> {
        tauri_plugin_store::Store::save(self).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyUpdated {
    pub revision: u64,
    pub lexicon_revision: u64,
}

pub struct StorePersistence<K: KeyValueFile, N: Fn(VocabularyUpdated) + Send> {
    file: Arc<K>,
    on_update: N,
}

impl<K: KeyValueFile, N: Fn(VocabularyUpdated) + Send> StorePersistence<K, N> {
    pub fn new(file: Arc<K>, on_update: N) -> Self {
        Self { file, on_update }
    }
}

impl<K: KeyValueFile, N: Fn(VocabularyUpdated) + Send> VocabularyPersistence
    for StorePersistence<K, N>
{
    fn read(&self) -> Result<Option<Value>, String> {
        Ok(self.file.get(STORE_KEY))
    }

    fn write(&self, value: &Value, previous: Option<&Value>) -> Result<(), String> {
        self.file.set(STORE_KEY, value.clone());
        if let Err(error) = self.file.save() {
            match previous {
                Some(previous) => self.file.set(STORE_KEY, previous.clone()),
                None => self.file.delete(STORE_KEY),
            }
            return Err(error);
        }
        Ok(())
    }

    fn notify(&self, revision: u64, lexicon_revision: u64) {
        (self.on_update)(VocabularyUpdated {
            revision,
            lexicon_revision,
        });
    }
}

type AppPersistence = Box<dyn VocabularyPersistence>;

impl VocabularyPersistence for AppPersistence {
    fn read(&self) -> Result<Option<Value>, String> {
        self.as_ref().read()
    }

    fn write(&self, value: &Value, previous: Option<&Value>) -> Result<(), String> {
        self.as_ref().write(value, previous)
    }

    fn notify(&self, revision: u64, lexicon_revision: u64) {
        self.as_ref().notify(revision, lexicon_revision);
    }
}

/// Managed state: one short mutex around read/validate/set/save. Never held
/// across LLM or IPC waits.
pub struct VocabularyManager {
    inner: Mutex<VocabularyStore<AppPersistence>>,
}

impl VocabularyManager {
    pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let file = app.store(SETTINGS_STORE_FILE).map_err(|e| e.to_string())?;
        let emitter = app.clone();
        let persistence: AppPersistence = Box::new(StorePersistence::new(file, move |update| {
            if let Err(err) = emitter.emit(VOCABULARY_UPDATED_EVENT, update) {
                logger::log_error(
                    "VOCABULARY",
                    &format!("event=update_emit_failed error={err}"),
                );
            }
        }));
        app.manage(Self {
            inner: Mutex::new(VocabularyStore::new(persistence)),
        });
        Ok(())
    }

    fn with_store<T>(
        &self,
        action: impl FnOnce(&mut VocabularyStore<AppPersistence>) -> Result<T, VocabularyError>,
    ) -> Result<T, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "[vocabulary:save_failed] Хранилище словаря недоступно".to_owned())?;
        action(&mut guard).map_err(|error| {
            logger::log_error(
                "VOCABULARY",
                &format!("event=mutation_failed code={}", error_code(&error)),
            );
            error.to_string()
        })
    }

    fn mutate(
        &self,
        operation: &str,
        expected_revision: u64,
        change: impl FnOnce(&mut model::VocabularyState) -> Result<(), VocabularyError>,
    ) -> Result<VocabularyView, String> {
        let state = self.with_store(|store| store.mutate(expected_revision, change))?;
        logger::log_info(
            "VOCABULARY",
            &format!(
                "event=mutation operation={operation} revision={} lexicon_revision={} terms={}",
                state.revision,
                state.lexicon_revision,
                state.terms.len()
            ),
        );
        Ok(VocabularyView::Ready {
            state: Box::new(state),
        })
    }
}

fn error_code(error: &VocabularyError) -> &'static str {
    match error {
        VocabularyError::Conflict { .. } => "conflict",
        VocabularyError::Validation(_) => "validation",
        VocabularyError::Corrupt(_) => "corrupt",
        VocabularyError::NotFound(_) => "not_found",
        VocabularyError::SaveFailed(_) => "save_failed",
    }
}

#[tauri::command]
pub fn vocabulary_get_state(
    manager: State<'_, VocabularyManager>,
) -> Result<VocabularyView, String> {
    manager.with_store(|store| Ok(store.view()))
}

#[tauri::command]
pub fn vocabulary_save_term(
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    term: TermInput,
) -> Result<VocabularyView, String> {
    manager.mutate("save_term", expected_revision, |state| {
        store::upsert_term(state, term).map(|_| ())
    })
}

#[tauri::command]
pub fn vocabulary_delete_term(
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    term_id: String,
) -> Result<VocabularyView, String> {
    manager.mutate("delete_term", expected_revision, |state| {
        store::delete_term(state, &term_id)
    })
}

#[tauri::command]
pub fn vocabulary_update_config(
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    patch: ConfigPatch,
) -> Result<VocabularyView, String> {
    manager.mutate("update_config", expected_revision, |state| {
        store::apply_config_patch(state, patch)
    })
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportSource {
    Import,
    Starter,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFilePreview {
    /// The exact file text; sent back on apply and parsed again there.
    pub text: String,
    pub preview: portable::ImportPreview,
}

fn read_portable_file(path: &Path) -> Result<String, VocabularyError> {
    let size = std::fs::metadata(path)
        .map_err(|_| VocabularyError::Validation("Не удалось открыть файл".to_owned()))?
        .len();
    if size > portable::MAX_PORTABLE_BYTES as u64 {
        return Err(VocabularyError::Validation(
            "Файл словаря больше 1 МиБ".to_owned(),
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|_| VocabularyError::Validation("Не удалось прочитать файл".to_owned()))?;
    String::from_utf8(bytes)
        .map_err(|_| VocabularyError::Validation("Файл не в кодировке UTF-8".to_owned()))
}

fn preview_text(
    store: &mut VocabularyStore<AppPersistence>,
    text: &str,
) -> Result<portable::ImportPreview, VocabularyError> {
    let document = portable::parse_portable(text)?;
    Ok(portable::preview_import(store.ready_state()?, &document))
}

#[tauri::command]
pub fn vocabulary_preview_import(
    manager: State<'_, VocabularyManager>,
    text: String,
) -> Result<portable::ImportPreview, String> {
    manager.with_store(|store| preview_text(store, &text))
}

#[tauri::command]
pub fn vocabulary_preview_import_file(
    manager: State<'_, VocabularyManager>,
    path: String,
) -> Result<ImportFilePreview, String> {
    manager.with_store(|store| {
        let text = read_portable_file(Path::new(&path))?;
        let preview = preview_text(store, &text)?;
        Ok(ImportFilePreview { text, preview })
    })
}

#[tauri::command]
pub fn vocabulary_apply_import(
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    text: String,
    selection: Vec<portable::ImportSelection>,
    source: ImportSource,
    enable_application: bool,
) -> Result<VocabularyView, String> {
    let document = portable::parse_portable(&text).map_err(|error| error.to_string())?;
    let provenance = match source {
        ImportSource::Import => model::Provenance::Import,
        ImportSource::Starter => model::Provenance::Starter,
    };
    manager.mutate("apply_import", expected_revision, |state| {
        portable::apply_import(state, &document, &selection, provenance)?;
        if enable_application {
            state.config.enabled = true;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn vocabulary_export_file(
    manager: State<'_, VocabularyManager>,
    path: String,
) -> Result<usize, String> {
    manager.with_store(|store| {
        let document = portable::export_portable(store.ready_state()?);
        let json = serde_json::to_string_pretty(&document)
            .map_err(|e| VocabularyError::SaveFailed(e.to_string()))?;
        std::fs::write(&path, json)
            .map_err(|_| VocabularyError::SaveFailed("Не удалось записать файл".to_owned()))?;
        logger::log_info(
            "VOCABULARY",
            &format!("event=export terms={}", document.terms.len()),
        );
        Ok(document.terms.len())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map};
    use std::path::PathBuf;
    use store::{upsert_term, VariantInput};

    /// A JSON file holding all root keys, saved and reloaded like `talkee.json`.
    struct JsonFile {
        path: PathBuf,
        map: Mutex<Map<String, Value>>,
        fail: Mutex<bool>,
    }

    impl JsonFile {
        fn open(path: PathBuf) -> Self {
            let map = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            Self {
                path,
                map: Mutex::new(map),
                fail: Mutex::new(false),
            }
        }
    }

    impl KeyValueFile for JsonFile {
        fn get(&self, key: &str) -> Option<Value> {
            self.map.lock().unwrap().get(key).cloned()
        }
        fn set(&self, key: &str, value: Value) {
            self.map.lock().unwrap().insert(key.to_owned(), value);
        }
        fn delete(&self, key: &str) {
            self.map.lock().unwrap().remove(key);
        }
        fn save(&self) -> Result<(), String> {
            if *self.fail.lock().unwrap() {
                return Err("read-only volume".to_owned());
            }
            let bytes = serde_json::to_vec(&*self.map.lock().unwrap()).unwrap();
            std::fs::write(&self.path, bytes).map_err(|e| e.to_string())
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("talkee-vocab-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("talkee.json")
    }

    fn input() -> TermInput {
        TermInput {
            id: None,
            canonical: "PIM".to_owned(),
            language: "any".to_owned(),
            category: model::TermCategory::Service,
            scope: model::TermScope::global(),
            enabled: true,
            use_as_hint: true,
            provenance: None,
            variants: vec![VariantInput {
                id: None,
                source: "пим".to_owned(),
                enabled: true,
                case_sensitive: false,
                context_words: Vec::new(),
            }],
        }
    }

    #[test]
    fn writes_keep_unrelated_settings_and_survive_restart() {
        let path = temp_path("restart");
        let settings = json!({ "settings": { "hotkey": "Alt+Space", "cleanupEnabled": true } });
        std::fs::write(&path, serde_json::to_vec(&settings).unwrap()).unwrap();

        let file = Arc::new(JsonFile::open(path.clone()));
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let mut store = VocabularyStore::new(StorePersistence::new(file, move |update| {
            sink.lock().unwrap().push(update.revision)
        }));
        let saved = store
            .mutate(0, |state| upsert_term(state, input()).map(|_| ()))
            .unwrap();
        assert_eq!(*events.lock().unwrap(), vec![1]);

        let reopened = Arc::new(JsonFile::open(path.clone()));
        assert_eq!(reopened.get("settings"), Some(settings["settings"].clone()));
        let mut restarted = VocabularyStore::new(StorePersistence::new(reopened, |_| {}));
        assert_eq!(
            restarted.view(),
            VocabularyView::Ready {
                state: Box::new(saved)
            }
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_save_restores_previous_key_and_skips_event() {
        let path = temp_path("fail");
        let file = Arc::new(JsonFile::open(path.clone()));
        let events = Arc::new(Mutex::new(0));
        let sink = Arc::clone(&events);
        let mut store = VocabularyStore::new(StorePersistence::new(Arc::clone(&file), move |_| {
            *sink.lock().unwrap() += 1
        }));
        *file.fail.lock().unwrap() = true;
        let error = store
            .mutate(0, |state| upsert_term(state, input()).map(|_| ()))
            .unwrap_err();
        assert!(matches!(error, VocabularyError::SaveFailed(_)));
        assert_eq!(file.get(STORE_KEY), None);
        assert_eq!(*events.lock().unwrap(), 0);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn errors_carry_stable_codes_for_the_frontend() {
        let conflict = VocabularyError::Conflict {
            expected: 1,
            actual: 2,
        };
        assert!(conflict.to_string().starts_with("[vocabulary:conflict]"));
        assert!(VocabularyError::Corrupt("x".into())
            .to_string()
            .starts_with("[vocabulary:corrupt]"));
    }

    #[test]
    fn import_file_is_size_checked_and_must_be_utf8() {
        let dir = std::env::temp_dir().join(format!("talkee-vocab-file-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big.json");
        std::fs::write(&big, vec![b' '; portable::MAX_PORTABLE_BYTES + 1]).unwrap();
        assert!(read_portable_file(&big)
            .unwrap_err()
            .to_string()
            .contains("1 МиБ"));
        let binary = dir.join("binary.json");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_portable_file(&binary)
            .unwrap_err()
            .to_string()
            .contains("UTF-8"));
        let ok = dir.join("ok.json");
        std::fs::write(&ok, include_str!("fixtures/starter-development.json")).unwrap();
        assert!(portable::parse_portable(&read_portable_file(&ok).unwrap()).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }
}
