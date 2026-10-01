//! Cooperative cancellation for long-running file transcription requests.
//!
//! A file job is one `transcribe_file_path` invocation identified by the
//! frontend `request_id`. The UI can only *request* cancellation: the running
//! pipeline checks the flag before preparation, between chunks and before
//! assembly, then releases its temporary files and returns an error. Nothing
//! stops the shared local runtime, so the next job starts normally.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// Returned for a cancelled request; the widget maps it to "interrupted".
pub const CANCELLED_MESSAGE: &str = "Обработка прервана";

struct Registry {
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Registry {
        flags: Mutex::new(HashMap::new()),
    })
}

/// Registered for the lifetime of one native file request.
///
/// Dropping the guard removes the entry again, so a finished (or failed) job
/// never leaves a cancel flag behind for a later request with the same id.
pub struct FileJobGuard {
    request_id: String,
    flag: Arc<AtomicBool>,
}

impl FileJobGuard {
    /// True once the UI asked for cancellation of this request.
    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Early-exit helper for pipeline stages that cannot continue once cancelled.
    pub fn check(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(CANCELLED_MESSAGE.to_string())
        } else {
            Ok(())
        }
    }
}

impl Drop for FileJobGuard {
    fn drop(&mut self) {
        if let Ok(mut flags) = registry().flags.lock() {
            // Only drop our own flag: a replacement job could already have
            // registered the same id.
            if let Some(current) = flags.get(&self.request_id) {
                if Arc::ptr_eq(current, &self.flag) {
                    flags.remove(&self.request_id);
                }
            }
        }
    }
}

/// Registers a cancellable native request.
///
/// An empty id returns a detached guard: legacy callers without a request id
/// keep working and simply cannot be cancelled from the UI.
pub fn begin(request_id: &str) -> FileJobGuard {
    let flag = Arc::new(AtomicBool::new(false));
    let request_id = request_id.trim().to_string();
    if !request_id.is_empty() {
        if let Ok(mut flags) = registry().flags.lock() {
            flags.insert(request_id.clone(), Arc::clone(&flag));
        }
    }
    FileJobGuard { request_id, flag }
}

/// Marks a registered request as cancelled. Returns false for unknown ids,
/// which includes requests that already settled.
pub fn request_cancel(request_id: &str) -> bool {
    let trimmed = request_id.trim();
    if trimmed.is_empty() {
        return false;
    }
    let flag = registry()
        .flags
        .lock()
        .ok()
        .and_then(|flags| flags.get(trimmed).map(Arc::clone));
    match flag {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Native cancellation endpoint used by the widget-owned file job queue.
///
/// Returns `true` when a live request was flagged. A `false` result is not an
/// error: the request may have finished between the click and the command.
#[tauri::command]
pub fn cancel_file_job(request_id: String) -> Result<bool, String> {
    Ok(request_cancel(&request_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_flag_survives_until_the_guard_drops() {
        let guard = begin("request-a");
        assert!(!guard.is_cancelled());
        assert!(request_cancel("request-a"));
        assert!(guard.is_cancelled());
        assert_eq!(guard.check().unwrap_err(), CANCELLED_MESSAGE);

        // A repeated request is idempotent and still reported.
        assert!(request_cancel("request-a"));

        drop(guard);
        // The settled request is unknown, so a stale cancel cannot affect it.
        assert!(!request_cancel("request-a"));
    }

    #[test]
    fn unknown_and_detached_requests_are_never_cancelled() {
        assert!(!request_cancel("never-started"));
        assert!(!request_cancel("   "));

        let detached = begin("  ");
        assert!(!request_cancel(""));
        assert!(!detached.is_cancelled());
        assert!(detached.check().is_ok());
    }

    #[test]
    fn a_new_request_replaces_the_previous_flag() {
        let first = begin("same-id");
        assert!(request_cancel("same-id"));

        let second = begin("same-id");
        assert!(!second.is_cancelled());

        // Dropping the stale guard must not unregister the live one.
        drop(first);
        assert!(request_cancel("same-id"));
        assert!(second.is_cancelled());
    }
}
