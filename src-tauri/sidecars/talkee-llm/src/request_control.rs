use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct RequestControl(Mutex<HashMap<String, Arc<AtomicBool>>>);
impl RequestControl {
    pub fn register(&self, id: &str) -> Result<Arc<AtomicBool>, &'static str> {
        if id.is_empty()
            || id.len() > 128
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("invalid request_id");
        }
        let mut entries = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if entries.contains_key(id) {
            return Err("duplicate request_id");
        }
        let flag = Arc::new(AtomicBool::new(false));
        entries.insert(id.into(), flag.clone());
        Ok(flag)
    }
    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.0.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
            flag.store(true, Ordering::Release);
        }
    }
    pub fn finish(&self, id: &str) {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn queued_and_active_cancellation_are_idempotent_and_ids_reusable() {
        let control = RequestControl::default();
        let first = control.register("request-1").unwrap();
        let queued = control.register("request-2").unwrap();
        assert!(control.register("request-1").is_err());
        control.cancel("request-2");
        control.cancel("request-2");
        control.cancel("unknown");
        assert!(queued.load(Ordering::Acquire));
        assert!(!first.load(Ordering::Acquire));
        control.cancel("request-1");
        assert!(first.load(Ordering::Acquire));
        control.finish("request-1");
        control.finish("request-2");
        assert!(control.register("request-1").is_ok());
    }
}
