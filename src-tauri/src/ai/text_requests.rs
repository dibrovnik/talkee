//! Addressable cancellation only for background vocabulary extraction.
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use tokio::sync::watch;

#[derive(Default)]
struct Registry {
    active: HashMap<String, watch::Sender<bool>>,
    cancelled: HashSet<String>,
}
fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}
pub struct RequestGuard(pub String);
impl Drop for RequestGuard {
    fn drop(&mut self) {
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active
            .remove(&self.0);
    }
}
pub fn begin(id: &str) -> Result<(RequestGuard, watch::Receiver<bool>), String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("[text:request_id] Некорректный идентификатор анализа".into());
    }
    let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
    if registry.active.contains_key(id) {
        return Err("[text:busy] Анализ уже запущен".into());
    }
    let cancelled = registry.cancelled.remove(id);
    let (sender, receiver) = watch::channel(cancelled);
    registry.active.insert(id.to_owned(), sender);
    Ok((RequestGuard(id.to_owned()), receiver))
}
#[tauri::command]
pub fn cancel_text_request(request_id: String) {
    let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(sender) = registry.active.get(&request_id) {
        let _ = sender.send(true);
    } else if registry.cancelled.len() < 128 && request_id.len() <= 128 {
        registry.cancelled.insert(request_id);
    }
}
pub async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    if *receiver.borrow() {
        return;
    }
    while receiver.changed().await.is_ok() {
        if *receiver.borrow() {
            return;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancel_active_and_early_requests_and_release_handles() {
        let (guard, mut receiver) = begin("test-active").unwrap();
        assert!(begin("test-active").is_err());
        cancel_text_request("test-active".into());
        tokio::time::timeout(
            std::time::Duration::from_millis(50),
            cancelled(&mut receiver),
        )
        .await
        .unwrap();
        drop(guard);
        assert!(begin("test-active").is_ok());
        cancel_text_request("test-early".into());
        let (_guard, mut receiver) = begin("test-early").unwrap();
        tokio::time::timeout(
            std::time::Duration::from_millis(50),
            cancelled(&mut receiver),
        )
        .await
        .unwrap();
    }
}
