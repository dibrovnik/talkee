//! Single owner of the `personalVocabularyV1` root key in `talkee.json`.
//! Every mutation is compare-and-swap on `revision`, validated as a whole
//! candidate state and persisted before callers or other windows observe it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::model::{
    self, AnalysisSchedule, Provenance, Term, TermCategory, TermScope, Variant, VocabularyState,
    MAX_STATE_BYTES, SCHEMA_VERSION,
};

pub const STORE_KEY: &str = "personalVocabularyV1";

/// Storage and notification seam; the Tauri implementation lives in `mod.rs`.
pub trait VocabularyPersistence: Send {
    fn read(&self) -> Result<Option<Value>, String>;
    /// Sets the key and saves the file. On failure the previous in-memory value
    /// must be restored before returning the error.
    fn write(&self, value: &Value, previous: Option<&Value>) -> Result<(), String>;
    /// Called only after a successful write.
    fn notify(&self, revision: u64, lexicon_revision: u64);
}

#[derive(Debug, Clone, PartialEq)]
pub enum VocabularyError {
    Conflict { expected: u64, actual: u64 },
    Validation(String),
    Corrupt(String),
    NotFound(String),
    SaveFailed(String),
}

impl std::fmt::Display for VocabularyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Conflict { expected, actual } => write!(
                f,
                "[vocabulary:conflict] Словарь изменён в другом окне (версия {actual}, ожидалась {expected}). Обновите и подтвердите заново."
            ),
            Self::Validation(message) => write!(f, "[vocabulary:validation] {message}"),
            Self::Corrupt(reason) => write!(
                f,
                "[vocabulary:corrupt] Словарь не прочитан: {reason}. Данные сохранены без изменений."
            ),
            Self::NotFound(what) => write!(f, "[vocabulary:not_found] {what}"),
            Self::SaveFailed(reason) => write!(
                f,
                "[vocabulary:save_failed] Не удалось сохранить словарь: {reason}"
            ),
        }
    }
}

impl From<VocabularyError> for String {
    fn from(error: VocabularyError) -> Self {
        error.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum VocabularyView {
    Ready { state: Box<VocabularyState> },
    Corrupt { reason: String },
}

#[derive(Debug, Clone, PartialEq)]
enum Loaded {
    Ready(Box<VocabularyState>),
    Corrupt(String),
}

/// Never writes: an unreadable or newer key stays on disk untouched.
fn parse_stored(value: Option<Value>) -> Loaded {
    let Some(value) = value else {
        return Loaded::Ready(Box::default());
    };
    let version = value.get("schemaVersion").and_then(Value::as_u64);
    match version {
        None => return Loaded::Corrupt("нет версии схемы".to_owned()),
        Some(version) if version > u64::from(SCHEMA_VERSION) => {
            return Loaded::Corrupt(format!(
                "версия {version} новее поддерживаемой {SCHEMA_VERSION}"
            ))
        }
        Some(version) if version < u64::from(SCHEMA_VERSION) => {
            return Loaded::Corrupt(format!("неизвестная версия {version}"))
        }
        Some(_) => {}
    }
    let state: VocabularyState = match serde_json::from_value(value) {
        Ok(state) => state,
        Err(_) => return Loaded::Corrupt("структура не соответствует версии 1".to_owned()),
    };
    match model::validate_state(&state) {
        Ok(()) => Loaded::Ready(Box::new(state)),
        Err(reason) => Loaded::Corrupt(reason),
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// Opaque local id; uniqueness within the state is re-checked by validation.
pub fn new_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let digest = Sha256::digest(format!("{nanos}:{counter}:{}", std::process::id()));
    let hex: String = digest[..12].iter().map(|b| format!("{b:02x}")).collect();
    format!("{prefix}-{hex}")
}

pub struct VocabularyStore<P: VocabularyPersistence> {
    persistence: P,
    loaded: Option<Loaded>,
    raw: Option<Value>,
}

impl<P: VocabularyPersistence> VocabularyStore<P> {
    pub fn new(persistence: P) -> Self {
        Self {
            persistence,
            loaded: None,
            raw: None,
        }
    }

    fn ensure_loaded(&mut self) -> &Loaded {
        if self.loaded.is_none() {
            let (raw, loaded) = match self.persistence.read() {
                Ok(raw) => (raw.clone(), parse_stored(raw)),
                Err(reason) => (None, Loaded::Corrupt(reason)),
            };
            self.raw = raw;
            self.loaded = Some(loaded);
        }
        self.loaded.as_ref().expect("loaded above")
    }

    pub fn view(&mut self) -> VocabularyView {
        match self.ensure_loaded() {
            Loaded::Ready(state) => VocabularyView::Ready {
                state: state.clone(),
            },
            Loaded::Corrupt(reason) => VocabularyView::Corrupt {
                reason: reason.clone(),
            },
        }
    }

    /// Ready state without cloning for read-only checks.
    pub fn ready_state(&mut self) -> Result<&VocabularyState, VocabularyError> {
        match self.ensure_loaded() {
            Loaded::Ready(state) => Ok(state),
            Loaded::Corrupt(reason) => Err(VocabularyError::Corrupt(reason.clone())),
        }
    }

    /// Applies `change` to a copy of the current state and persists it only if
    /// the revision still matches and the whole candidate validates.
    pub fn mutate<F>(
        &mut self,
        expected_revision: u64,
        change: F,
    ) -> Result<VocabularyState, VocabularyError>
    where
        F: FnOnce(&mut VocabularyState) -> Result<(), VocabularyError>,
    {
        let current = self.ready_state()?.clone();
        if current.revision != expected_revision {
            return Err(VocabularyError::Conflict {
                expected: expected_revision,
                actual: current.revision,
            });
        }
        let mut candidate = current.clone();
        change(&mut candidate)?;
        self.commit(current, candidate)
    }

    fn commit(
        &mut self,
        current: VocabularyState,
        mut candidate: VocabularyState,
    ) -> Result<VocabularyState, VocabularyError> {
        candidate.schema_version = SCHEMA_VERSION;
        candidate.revision = current.revision + 1;
        candidate.lexicon_revision =
            if candidate.lexicon_fingerprint() == current.lexicon_fingerprint() {
                current.lexicon_revision
            } else {
                current.lexicon_revision + 1
            };
        model::validate_state(&candidate).map_err(VocabularyError::Validation)?;
        let value = serde_json::to_value(&candidate)
            .map_err(|e| VocabularyError::SaveFailed(e.to_string()))?;
        let size = serde_json::to_vec(&value)
            .map(|bytes| bytes.len())
            .unwrap_or(usize::MAX);
        if size > MAX_STATE_BYTES {
            return Err(VocabularyError::Validation(
                "Словарь превысил 5 МиБ: удалите примеры или экспортируйте данные".to_owned(),
            ));
        }
        self.persistence
            .write(&value, self.raw.as_ref())
            .map_err(VocabularyError::SaveFailed)?;
        self.raw = Some(value);
        self.loaded = Some(Loaded::Ready(Box::new(candidate.clone())));
        self.persistence
            .notify(candidate.revision, candidate.lexicon_revision);
        Ok(candidate)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VariantInput {
    #[serde(default)]
    pub id: Option<String>,
    pub source: String,
    pub enabled: bool,
    pub case_sensitive: bool,
    #[serde(default)]
    pub context_words: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TermInput {
    #[serde(default)]
    pub id: Option<String>,
    pub canonical: String,
    pub language: String,
    pub category: TermCategory,
    pub scope: TermScope,
    pub enabled: bool,
    pub use_as_hint: bool,
    #[serde(default)]
    pub provenance: Option<Provenance>,
    pub variants: Vec<VariantInput>,
}

fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigPatch {
    #[serde(default)]
    pub enabled: Option<bool>,
    /// Absent keeps the domain, `null` selects "global only".
    #[serde(default, deserialize_with = "double_option")]
    pub active_domain: Option<Option<String>>,
    #[serde(default)]
    pub analysis_schedule: Option<AnalysisSchedule>,
}

/// Inserts or replaces one term; existing ids, timestamps and provenance stay.
pub fn upsert_term(
    state: &mut VocabularyState,
    input: TermInput,
) -> Result<String, VocabularyError> {
    let now = now_ms();
    let existing_index = input
        .id
        .as_deref()
        .and_then(|id| state.terms.iter().position(|term| term.id == id));
    if input.id.is_some() && existing_index.is_none() {
        return Err(VocabularyError::NotFound(
            "Термин уже удалён в другом окне".to_owned(),
        ));
    }
    let previous = existing_index.map(|index| state.terms[index].clone());
    let provenance = previous
        .as_ref()
        .map(|term| term.provenance)
        .or(input.provenance)
        .unwrap_or(Provenance::Manual);
    let variants = input
        .variants
        .into_iter()
        .map(|variant| {
            let kept = variant.id.as_deref().and_then(|id| {
                previous
                    .as_ref()
                    .and_then(|term| term.variants.iter().find(|item| item.id == id))
            });
            Variant {
                id: kept
                    .map(|item| item.id.clone())
                    .unwrap_or_else(|| new_id("variant")),
                source: variant.source,
                enabled: variant.enabled,
                case_sensitive: variant.case_sensitive,
                context_words: variant.context_words,
                provenance: kept.map(|item| item.provenance).unwrap_or(provenance),
            }
        })
        .collect();
    let term = Term {
        id: previous
            .as_ref()
            .map(|term| term.id.clone())
            .unwrap_or_else(|| new_id("term")),
        canonical: input.canonical,
        language: input.language,
        category: input.category,
        scope: input.scope,
        enabled: input.enabled,
        use_as_hint: input.use_as_hint,
        provenance,
        variants,
        created_at: previous.as_ref().map(|term| term.created_at).unwrap_or(now),
        updated_at: now,
    };
    let id = term.id.clone();
    match existing_index {
        Some(index) => state.terms[index] = term,
        None => state.terms.push(term),
    }
    Ok(id)
}

pub fn delete_term(state: &mut VocabularyState, term_id: &str) -> Result<(), VocabularyError> {
    let before = state.terms.len();
    state.terms.retain(|term| term.id != term_id);
    if state.terms.len() == before {
        return Err(VocabularyError::NotFound(
            "Термин уже удалён в другом окне".to_owned(),
        ));
    }
    Ok(())
}

pub fn apply_config_patch(
    state: &mut VocabularyState,
    patch: ConfigPatch,
) -> Result<(), VocabularyError> {
    if let Some(enabled) = patch.enabled {
        state.config.enabled = enabled;
    }
    if let Some(domain) = patch.active_domain {
        if let Some(name) = &domain {
            model::validate_domain(name).map_err(VocabularyError::Validation)?;
        }
        state.config.active_domain = domain;
    }
    if let Some(schedule) = patch.analysis_schedule {
        state.config.analysis_schedule = schedule;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    /// Mirrors the plugin store: one in-memory map plus a "disk" copy.
    #[derive(Clone, Default)]
    pub(crate) struct MemoryPersistence {
        pub memory: Arc<Mutex<Option<Value>>>,
        pub disk: Arc<Mutex<Option<Value>>>,
        pub fail_save: Arc<Mutex<bool>>,
        pub events: Arc<Mutex<Vec<(u64, u64)>>>,
    }

    impl VocabularyPersistence for MemoryPersistence {
        fn read(&self) -> Result<Option<Value>, String> {
            Ok(self.disk.lock().unwrap().clone())
        }

        fn write(&self, value: &Value, previous: Option<&Value>) -> Result<(), String> {
            *self.memory.lock().unwrap() = Some(value.clone());
            if *self.fail_save.lock().unwrap() {
                *self.memory.lock().unwrap() = previous.cloned();
                return Err("disk full".to_owned());
            }
            *self.disk.lock().unwrap() = Some(value.clone());
            Ok(())
        }

        fn notify(&self, revision: u64, lexicon_revision: u64) {
            self.events
                .lock()
                .unwrap()
                .push((revision, lexicon_revision));
        }
    }

    fn pim_input() -> TermInput {
        TermInput {
            id: None,
            canonical: "PIM".to_owned(),
            language: "any".to_owned(),
            category: TermCategory::Service,
            scope: TermScope::domain("Разработка"),
            enabled: true,
            use_as_hint: true,
            provenance: None,
            variants: vec![VariantInput {
                id: None,
                source: "пи ай эм".to_owned(),
                enabled: true,
                case_sensitive: false,
                context_words: Vec::new(),
            }],
        }
    }

    fn ready(store: &mut VocabularyStore<MemoryPersistence>) -> VocabularyState {
        match store.view() {
            VocabularyView::Ready { state } => *state,
            VocabularyView::Corrupt { reason } => panic!("corrupt: {reason}"),
        }
    }

    #[test]
    fn missing_key_loads_defaults_without_writing() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence.clone());
        let state = ready(&mut store);
        assert_eq!(state, VocabularyState::default());
        assert!(persistence.disk.lock().unwrap().is_none());
        assert!(persistence.events.lock().unwrap().is_empty());
    }

    #[test]
    fn future_version_and_corrupt_keys_are_preserved_untouched() {
        for raw in [
            json!({ "schemaVersion": 2, "terms": "from the future" }),
            json!({ "schemaVersion": 1, "terms": 42 }),
            json!("garbage"),
        ] {
            let persistence = MemoryPersistence::default();
            *persistence.disk.lock().unwrap() = Some(raw.clone());
            let mut store = VocabularyStore::new(persistence.clone());
            assert!(matches!(store.view(), VocabularyView::Corrupt { .. }));
            let error = store
                .mutate(0, |state| upsert_term(state, pim_input()).map(|_| ()))
                .unwrap_err();
            assert!(matches!(error, VocabularyError::Corrupt(_)));
            assert_eq!(persistence.disk.lock().unwrap().clone(), Some(raw));
        }
    }

    #[test]
    fn restart_round_trip_keeps_terms_and_revisions() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence.clone());
        let saved = store
            .mutate(0, |state| upsert_term(state, pim_input()).map(|_| ()))
            .unwrap();
        assert_eq!((saved.revision, saved.lexicon_revision), (1, 1));

        let mut restarted = VocabularyStore::new(persistence.clone());
        assert_eq!(ready(&mut restarted), saved);
    }

    #[test]
    fn stale_expected_revision_is_rejected_without_losing_data() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence.clone());
        store
            .mutate(0, |state| upsert_term(state, pim_input()).map(|_| ()))
            .unwrap();
        let mut dev = pim_input();
        dev.canonical = "Dev".to_owned();
        dev.variants[0].source = "дев".to_owned();
        let error = store
            .mutate(0, |state| upsert_term(state, dev.clone()).map(|_| ()))
            .unwrap_err();
        assert_eq!(
            error,
            VocabularyError::Conflict {
                expected: 0,
                actual: 1
            }
        );
        let fresh = ready(&mut store);
        assert_eq!(fresh.terms.len(), 1);
        let merged = store
            .mutate(fresh.revision, |state| upsert_term(state, dev).map(|_| ()))
            .unwrap();
        assert_eq!(merged.terms.len(), 2);
    }

    #[test]
    fn concurrent_windows_serialize_through_the_shared_store() {
        let persistence = MemoryPersistence::default();
        let store = Arc::new(Mutex::new(VocabularyStore::new(persistence.clone())));
        let handles: Vec<_> = ["Alpha", "Beta", "Gamma", "Delta"]
            .into_iter()
            .map(|name| {
                let store = Arc::clone(&store);
                std::thread::spawn(move || loop {
                    let mut guard = store.lock().unwrap();
                    let revision = guard.ready_state().unwrap().revision;
                    let mut input = pim_input();
                    input.canonical = name.to_owned();
                    input.variants.clear();
                    match guard.mutate(revision, |state| upsert_term(state, input).map(|_| ())) {
                        Ok(_) => break,
                        Err(VocabularyError::Conflict { .. }) => continue,
                        Err(other) => panic!("{other}"),
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }
        let state = ready(&mut store.lock().unwrap());
        assert_eq!(state.terms.len(), 4);
        assert_eq!(state.revision, 4);
    }

    #[test]
    fn failed_save_keeps_previous_snapshot_and_emits_nothing() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence.clone());
        let before = store
            .mutate(0, |state| upsert_term(state, pim_input()).map(|_| ()))
            .unwrap();
        let events_before = persistence.events.lock().unwrap().len();
        let memory_before = persistence.memory.lock().unwrap().clone();

        *persistence.fail_save.lock().unwrap() = true;
        let error = store
            .mutate(before.revision, |state| {
                apply_config_patch(
                    state,
                    ConfigPatch {
                        enabled: Some(true),
                        ..ConfigPatch::default()
                    },
                )
            })
            .unwrap_err();
        assert!(matches!(error, VocabularyError::SaveFailed(_)));
        assert_eq!(persistence.events.lock().unwrap().len(), events_before);
        assert_eq!(ready(&mut store), before);
        assert_eq!(*persistence.memory.lock().unwrap(), memory_before);
    }

    #[test]
    fn invalid_candidate_is_rejected_before_writing() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence.clone());
        let mut bad = pim_input();
        bad.variants[0].source = "https://localhost/pim".to_owned();
        let error = store
            .mutate(0, |state| upsert_term(state, bad).map(|_| ()))
            .unwrap_err();
        assert!(matches!(error, VocabularyError::Validation(_)));
        assert!(persistence.disk.lock().unwrap().is_none());
    }

    #[test]
    fn lexicon_revision_ignores_non_lexicon_changes() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence.clone());
        let first = store
            .mutate(0, |state| upsert_term(state, pim_input()).map(|_| ()))
            .unwrap();
        let scheduled = store
            .mutate(first.revision, |state| {
                apply_config_patch(
                    state,
                    ConfigPatch {
                        analysis_schedule: Some(AnalysisSchedule::Daily),
                        ..ConfigPatch::default()
                    },
                )
            })
            .unwrap();
        assert_eq!(scheduled.revision, first.revision + 1);
        assert_eq!(scheduled.lexicon_revision, first.lexicon_revision);
        let enabled = store
            .mutate(scheduled.revision, |state| {
                apply_config_patch(
                    state,
                    ConfigPatch {
                        enabled: Some(true),
                        ..ConfigPatch::default()
                    },
                )
            })
            .unwrap();
        assert_eq!(enabled.lexicon_revision, first.lexicon_revision + 1);
        assert_eq!(
            persistence.events.lock().unwrap().as_slice(),
            &[(1, 1), (2, 1), (3, 2)]
        );
    }

    #[test]
    fn upsert_keeps_ids_and_provenance_and_delete_detects_races() {
        let persistence = MemoryPersistence::default();
        let mut store = VocabularyStore::new(persistence);
        let mut starter = pim_input();
        starter.provenance = Some(Provenance::Starter);
        let saved = store
            .mutate(0, |state| upsert_term(state, starter).map(|_| ()))
            .unwrap();
        let existing = saved.terms[0].clone();
        let mut edit = pim_input();
        edit.id = Some(existing.id.clone());
        edit.provenance = Some(Provenance::Manual);
        edit.variants[0].id = Some(existing.variants[0].id.clone());
        edit.variants.push(VariantInput {
            id: None,
            source: "пим".to_owned(),
            enabled: false,
            case_sensitive: false,
            context_words: Vec::new(),
        });
        let edited = store
            .mutate(saved.revision, |state| upsert_term(state, edit).map(|_| ()))
            .unwrap();
        let term = &edited.terms[0];
        assert_eq!(term.id, existing.id);
        assert_eq!(term.provenance, Provenance::Starter);
        assert_eq!(term.created_at, existing.created_at);
        assert_eq!(term.variants[0].id, existing.variants[0].id);
        assert_eq!(term.variants.len(), 2);

        let deleted = store
            .mutate(edited.revision, |state| delete_term(state, &existing.id))
            .unwrap();
        assert!(deleted.terms.is_empty());
        let error = store
            .mutate(deleted.revision, |state| delete_term(state, &existing.id))
            .unwrap_err();
        assert!(matches!(error, VocabularyError::NotFound(_)));
    }
}
