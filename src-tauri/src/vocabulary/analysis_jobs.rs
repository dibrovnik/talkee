//! Short native lease and checked durable learning commits. No inference here.
use super::{
    learning,
    model::*,
    store::{new_id, now_ms, VocabularyError, VocabularyView},
    VocabularyManager,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::{AppHandle, State};
use tauri_plugin_store::StoreExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub id: String,
    pub data_epoch: u64,
    pub fingerprint: String,
    pub periodic: bool,
    pub expires_at: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartAnalysis {
    pub mode: JobMode,
    pub fingerprint: String,
    pub remote: bool,
}
fn invalid(message: &str) -> VocabularyError {
    VocabularyError::Validation(message.into())
}

fn backend_identity(app: &AppHandle) -> Result<(String, bool, String, String), String> {
    let file = app.store("talkee.json").map_err(|e| e.to_string())?;
    let settings = file.get("settings").unwrap_or_default();
    let endpoint = settings
        .get("llmEndpoint")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("https://api.openai.com/v1");
    let url = reqwest::Url::parse(endpoint.trim()).map_err(|_| "Некорректный endpoint")?;
    let remote = !matches!(
        url.host_str(),
        Some("127.0.0.1" | "localhost" | "[::1]" | "::1")
    );
    let local_model = settings
        .get("llmLocalModelId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let managed = !remote && !local_model.is_empty() && local_model != "none";
    let label = format!(
        "{}{}",
        url.origin().ascii_serialization(),
        url.path().trim_end_matches('/')
    );
    let model = settings
        .get("llmModel")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned();
    let encoded = serde_json::to_vec(&(
        if remote {
            "api"
        } else if managed {
            "managed-local"
        } else {
            "custom-local"
        },
        &label,
        &model,
    ))
    .map_err(|e| e.to_string())?;
    let hash = Sha256::digest(encoded)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok((hash, remote, label, model))
}

#[tauri::command]
pub fn vocabulary_analysis_start(
    app: AppHandle,
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    request: StartAnalysis,
) -> Result<Lease, String> {
    let (fingerprint, remote, _, _) = backend_identity(&app)?;
    if fingerprint != request.fingerprint || remote != request.remote {
        return Err("[vocabulary:validation] Текстовая модель изменилась".into());
    }
    let mut active = manager
        .lease
        .lock()
        .map_err(|_| "Хранилище анализа недоступно")?;
    if active
        .as_ref()
        .is_some_and(|lease| lease.expires_at > now_ms())
    {
        return Err("[vocabulary:busy] Анализ уже запущен".into());
    }
    let mut acquired = None;
    manager.mutate("analysis_start", expected_revision, |state| {
        let periodic = request.mode == JobMode::Periodic;
        if request.remote {
            let consent = if periodic {
                &state.config.periodic_api_consent
            } else {
                &state.config.manual_api_consent
            };
            if !consent
                .as_ref()
                .is_some_and(|consent| consent.fingerprint == request.fingerprint)
            {
                return Err(invalid("Нет разрешения на передачу истории этому API"));
            }
        }
        let now = now_ms();
        acquired = Some(Lease {
            id: new_id("lease"),
            data_epoch: state.data_epoch,
            fingerprint: request.fingerprint.clone(),
            periodic,
            expires_at: now + if periodic { 180000 } else { 900000 },
        });
        if periodic {
            state.config.last_scheduled_attempt_at = Some(now);
        }
        state.last_job = Some(JobRecord {
            mode: request.mode,
            status: JobStatus::Running,
            backend_fingerprint: Some(request.fingerprint),
            requests: 0,
            processed_sources: 0,
            remaining_sources: 0,
            started_at: now,
            finished_at: None,
            reason: None,
        });
        Ok(())
    })?;
    let acquired = acquired.expect("successful mutation acquired lease");
    *active = Some(acquired.clone());
    Ok(acquired)
}

#[tauri::command]
pub async fn vocabulary_analysis_commit(
    app: AppHandle,
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    lease_id: String,
    batch: learning::AnalysisBatch,
    remaining_sources: u32,
) -> Result<VocabularyView, String> {
    for fragment in &batch.fragments {
        let entry = crate::history_storage::read_history_entry_file(
            app.clone(),
            String::new(),
            fragment.source_id.clone(),
        )
        .await?
        .ok_or("[vocabulary:not_found] Исходная запись удалена")?;
        learning::validate_fragment(fragment, &entry)?;
    }
    let active = manager
        .lease
        .lock()
        .map_err(|_| "Хранилище анализа недоступно")?;
    let lease = active
        .as_ref()
        .filter(|lease| lease.id == lease_id && lease.expires_at > now_ms())
        .ok_or("[vocabulary:cancelled] Анализ отменён")?;
    if backend_identity(&app)?.0 != lease.fingerprint {
        return Err("[vocabulary:cancelled] Текстовая модель изменилась".into());
    }
    manager.mutate("analysis_commit", expected_revision, |state| {
        if state.data_epoch != lease.data_epoch {
            return Err(invalid("Источники анализа изменились"));
        }
        let job = state
            .last_job
            .as_ref()
            .ok_or_else(|| invalid("Нет активного анализа"))?;
        if job.requests >= if lease.periodic { 3 } else { 20 } {
            return Err(invalid("Лимит запросов анализа"));
        }
        let source_count = batch
            .fragments
            .iter()
            .map(|f| &f.source_id)
            .collect::<HashSet<_>>()
            .len() as u32;
        learning::commit_batch(state, batch)?;
        if let Some(job) = &mut state.last_job {
            job.requests += 1;
            job.processed_sources += source_count;
            job.remaining_sources = remaining_sources;
        }
        Ok(())
    })
}

#[tauri::command]
pub fn vocabulary_analysis_finish(
    manager: State<'_, VocabularyManager>,
    lease_id: String,
    status: JobStatus,
    reason: Option<String>,
) -> Result<VocabularyView, String> {
    let mut active = manager
        .lease
        .lock()
        .map_err(|_| "Хранилище анализа недоступно")?;
    if !active.as_ref().is_some_and(|lease| lease.id == lease_id) {
        return manager.with_store(|store| Ok(store.view()));
    }
    if !matches!(
        status,
        JobStatus::Completed
            | JobStatus::Paused
            | JobStatus::Cancelled
            | JobStatus::Failed
            | JobStatus::NeedsAttention
    ) {
        return Err("[vocabulary:validation] Некорректный статус".into());
    }
    let revision = manager.with_store(|store| Ok(store.ready_state()?.revision))?;
    let result = manager.mutate("analysis_finish", revision, |state| {
        if let Some(job) = &mut state.last_job {
            job.status = status;
            job.finished_at = Some(now_ms());
            // No transport/model bodies in durable diagnostics.
            job.reason = reason.filter(|reason| {
                [
                    "cancelled",
                    "preempted",
                    "timeout",
                    "limits",
                    "invalid-response",
                    "backend-changed",
                    "failed",
                    "restart",
                ]
                .contains(&reason.as_str())
            });
        }
        Ok(())
    });
    *active = None;
    result
}

#[tauri::command]
pub fn vocabulary_set_consent(
    app: AppHandle,
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    periodic: bool,
    consent: Option<ApiConsent>,
) -> Result<VocabularyView, String> {
    let (fingerprint, remote, endpoint_label, model) = backend_identity(&app)?;
    let consent = match consent {
        Some(consent) if remote && consent.fingerprint == fingerprint => Some(ApiConsent {
            fingerprint,
            endpoint_label,
            model,
            granted_at: now_ms(),
        }),
        Some(_) => return Err("[vocabulary:validation] Текстовая модель изменилась".into()),
        None => None,
    };
    let mut lease = manager
        .lease
        .lock()
        .map_err(|_| "Хранилище анализа недоступно")?;
    let result = manager.mutate("consent", expected_revision, |state| {
        if let Some(consent) = &consent {
            if consent.fingerprint.len() != 64
                || !consent.fingerprint.chars().all(|c| c.is_ascii_hexdigit())
                || consent.endpoint_label.len() > 256
                || consent.model.len() > 128
            {
                return Err(invalid("Некорректное разрешение"));
            }
        }
        if periodic {
            state.config.periodic_api_consent = consent;
        } else {
            state.config.manual_api_consent = consent;
        }
        state.data_epoch += 1;
        if let Some(job) = &mut state.last_job {
            if job.status == JobStatus::Running {
                job.status = JobStatus::Cancelled;
                job.reason = Some("consent-changed".into());
            }
        }
        Ok(())
    });
    if result.is_ok() {
        *lease = None;
    }
    result
}

#[tauri::command]
pub fn vocabulary_clear_learning(
    manager: State<'_, VocabularyManager>,
    expected_revision: u64,
    full_reset: bool,
) -> Result<VocabularyView, String> {
    let mut lease = manager
        .lease
        .lock()
        .map_err(|_| "Хранилище анализа недоступно")?;
    let result = manager.mutate("clear_learning", expected_revision, |state| {
        state.data_epoch += 1;
        state.suggestions.clear();
        state.evidence.clear();
        state.dismissals.clear();
        state.coverage.clear();
        state.last_job = None;
        state.config.learning_cleared_at = Some(now_ms());
        if full_reset {
            state.terms.clear();
            state.config = VocabularyConfig::default();
            state.config.learning_cleared_at = Some(now_ms());
        }
        Ok(())
    });
    if result.is_ok() {
        *lease = None;
    }
    result
}

impl VocabularyManager {
    pub fn reconcile(&self, history: &[serde_json::Value]) -> Result<(), String> {
        self.with_store(|store| {
            let Ok(state) = store.ready_state() else {
                return Ok(());
            };
            let mut invalidated = HashSet::new();
            for evidence in &state.evidence {
                let source = history
                    .iter()
                    .find(|row| {
                        row.get("id").and_then(serde_json::Value::as_str)
                            == Some(&evidence.source_id)
                    })
                    .and_then(learning::source_text);
                if !source.is_some_and(|(raw, before)| {
                    learning::source_fingerprint(&raw, &before) == evidence.source_fingerprint
                }) {
                    invalidated.insert(evidence.source_id.clone());
                }
            }
            for coverage in &state.coverage {
                let source = history
                    .iter()
                    .find(|row| {
                        row.get("id").and_then(serde_json::Value::as_str)
                            == Some(&coverage.source_id)
                    })
                    .and_then(learning::source_text);
                if !source.is_some_and(|(raw, before)| {
                    learning::source_fingerprint(&raw, &before) == coverage.fingerprint
                }) {
                    invalidated.insert(coverage.source_id.clone());
                }
            }
            let running = state.last_job.as_ref().is_some_and(|job| {
                job.status == JobStatus::Running || job.status == JobStatus::Preparing
            });
            if running || !invalidated.is_empty() {
                let revision = state.revision;
                store.mutate(revision, |state| {
                    if !invalidated.is_empty() {
                        learning::invalidate_sources(state, &invalidated);
                    }
                    if running {
                        if let Some(job) = &mut state.last_job {
                            job.status = JobStatus::Paused;
                            job.reason = Some("restart".into());
                        }
                    }
                    Ok(())
                })?;
            }
            Ok(())
        })
    }
    pub fn invalidate(&self, ids: HashSet<String>) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut lease = self
            .lease
            .lock()
            .map_err(|_| "Хранилище анализа недоступно")?;
        self.with_store(|store| {
            let Ok(state) = store.ready_state() else {
                return Ok(());
            };
            let revision = state.revision;
            store.mutate(revision, |state| {
                learning::invalidate_sources(state, &ids);
                if let Some(job) = &mut state.last_job {
                    if job.status == JobStatus::Running {
                        job.status = JobStatus::Cancelled;
                        job.reason = Some("sources-changed".into());
                    }
                }
                Ok(())
            })?;
            Ok(())
        })?;
        *lease = None;
        Ok(())
    }
}
