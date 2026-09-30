use crate::logger;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
use std::sync::Mutex;

/// Opaque `NSProcessInfo` activity handle returned by `beginActivityWithOptions:reason:`.
struct ActivityToken(Retained<ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>);

// SAFETY: the token is an opaque activity handle. `NSProcessInfo` and its
// activity objects are documented as thread-safe, and we only touch the token
// while holding `ACTIVITY`, so it is safe to keep it in a process-wide static.
unsafe impl Send for ActivityToken {}

static ACTIVITY: Mutex<Option<ActivityToken>> = Mutex::new(None);

/// Block App Nap while a dictation is being recorded, transcribed and pasted.
#[tauri::command]
pub fn begin_work_activity() -> Result<(), String> {
    let mut guard = ACTIVITY
        .lock()
        .map_err(|_| "Не удалось заблокировать состояние App Nap.".to_string())?;

    if guard.is_some() {
        return Ok(());
    }

    let process_info = NSProcessInfo::processInfo();
    let reason = NSString::from_str("Dictation");
    let token =
        process_info.beginActivityWithOptions_reason(NSActivityOptions::UserInitiated, &reason);
    *guard = Some(ActivityToken(token));

    logger::log_info(
        "APP_NAP",
        "begin_work_activity: App Nap disabled for the current dictation",
    );

    Ok(())
}

/// Release the activity started by [`begin_work_activity`].
#[tauri::command]
pub fn end_work_activity() -> Result<(), String> {
    let mut guard = ACTIVITY
        .lock()
        .map_err(|_| "Не удалось заблокировать состояние App Nap.".to_string())?;

    if let Some(token) = guard.take() {
        let process_info = NSProcessInfo::processInfo();
        // SAFETY: the token was created by the same `NSProcessInfo` and is only
        // ended once, right here.
        unsafe { process_info.endActivity(&token.0) };
        logger::log_info(
            "APP_NAP",
            "end_work_activity: App Nap restored after the dictation",
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_and_end_activity_round_trip() {
        assert!(begin_work_activity().is_ok());
        // A second begin is a no-op while an activity is held.
        assert!(begin_work_activity().is_ok());
        assert!(end_work_activity().is_ok());
        // Ending without an active activity is a no-op.
        assert!(end_work_activity().is_ok());
    }
}
