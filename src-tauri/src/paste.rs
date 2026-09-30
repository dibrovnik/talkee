use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::logger;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
}

fn ensure_input_event_permission() -> Result<(), String> {
    let trusted = unsafe { AXIsProcessTrusted() != 0 };
    if trusted {
        return Ok(());
    }

    Err("Accessibility permission is required to paste text into other apps".into())
}

#[tauri::command]
pub fn remember_paste_target_window() -> Result<(), String> {
    Ok(())
}

/// Simulate Cmd+V using CoreGraphics directly.
///
/// Unlike enigo (which sends separate Meta-press and V-click events that can
/// race), this creates key events with the Command flag baked into each event.
/// macOS always sees the V keystroke as "Cmd+V", eliminating the intermittent
/// bug where a bare "v" character is typed instead of paste.
fn simulate_macos_command_shortcut(keycode: u16) -> Result<(), String> {
    use std::ffi::c_void;

    type CGEventRef = *mut c_void;
    type CGEventSourceRef = *mut c_void;

    // kCGEventSourceStateCombinedSessionState
    const COMBINED_SESSION_STATE: i32 = 1;
    // kCGHIDEventTap
    const HID_EVENT_TAP: i32 = 0;
    // NX_COMMANDMASK
    const COMMAND_FLAG: u64 = 0x0010_0000;

    extern "C" {
        fn CGEventSourceCreate(state_id: i32) -> CGEventSourceRef;
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef,
            keycode: u16,
            key_down: bool,
        ) -> CGEventRef;
        fn CGEventSetFlags(event: CGEventRef, flags: u64);
        fn CGEventPost(tap: i32, event: CGEventRef);
        fn CFRelease(cf: *const c_void);
    }

    unsafe {
        let source = CGEventSourceCreate(COMBINED_SESSION_STATE);
        if source.is_null() {
            return Err("CGEventSourceCreate returned null".into());
        }

        let key_down = CGEventCreateKeyboardEvent(source, keycode, true);
        if key_down.is_null() {
            CFRelease(source as *const c_void);
            return Err("CGEventCreateKeyboardEvent (down) returned null".into());
        }
        CGEventSetFlags(key_down, COMMAND_FLAG);
        CGEventPost(HID_EVENT_TAP, key_down);

        std::thread::sleep(Duration::from_millis(20));

        let key_up = CGEventCreateKeyboardEvent(source, keycode, false);
        if key_up.is_null() {
            CFRelease(key_down as *const c_void);
            CFRelease(source as *const c_void);
            return Err("CGEventCreateKeyboardEvent (up) returned null".into());
        }
        CGEventSetFlags(key_up, COMMAND_FLAG);
        CGEventPost(HID_EVENT_TAP, key_up);

        CFRelease(key_up as *const c_void);
        CFRelease(key_down as *const c_void);
        CFRelease(source as *const c_void);
    }

    Ok(())
}

/// Simulate Cmd+V using CoreGraphics directly.
///
/// Unlike enigo (which sends separate Meta-press and V-click events that can
/// race), this creates key events with the Command flag baked into each event.
/// macOS always sees the V keystroke as "Cmd+V", eliminating the intermittent
/// bug where a bare "v" character is typed instead of paste.
fn simulate_cmd_v() -> Result<(), String> {
    simulate_macos_command_shortcut(0x09)
}

fn simulate_cmd_c() -> Result<(), String> {
    simulate_macos_command_shortcut(0x08)
}

fn paste_shortcut_label() -> &'static str {
    "Cmd+V via CGEvent"
}

fn copy_shortcut_label() -> &'static str {
    "Cmd+C via CGEvent"
}

fn clipboard_sentinel() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("__TALKEE_SELECTION_SENTINEL_{}__", nanos)
}

fn selected_text_from_clipboard(copied_text: &str, sentinel: &str) -> Option<String> {
    if copied_text == sentinel || copied_text.trim().is_empty() {
        return None;
    }

    Some(copied_text.to_string())
}

fn wait_for_selected_text_from_clipboard<F>(
    mut read_text: F,
    sentinel: &str,
    timeout: Duration,
    interval: Duration,
) -> Result<String, String>
where
    F: FnMut() -> Result<String, String>,
{
    let started = std::time::Instant::now();
    let mut last_error: Option<String> = None;

    loop {
        match read_text() {
            Ok(copied_text) => {
                if let Some(selected_text) = selected_text_from_clipboard(&copied_text, sentinel) {
                    return Ok(selected_text);
                }
            }
            Err(err) => {
                last_error = Some(err);
            }
        }

        if started.elapsed() >= timeout {
            return Err(last_error.unwrap_or_else(|| "No selected text copied".to_string()));
        }

        std::thread::sleep(interval);
    }
}

/// Copy selected text by temporarily using the clipboard and simulating Cmd/Ctrl+C.
#[tauri::command]
pub async fn copy_selected_text(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    ensure_input_event_permission()?;

    let previous_clipboard_text = app.clipboard().read_text().ok();
    let sentinel = clipboard_sentinel();
    let handle = app.clone();
    let (tx, rx) = mpsc::channel::<Result<String, String>>();

    app.run_on_main_thread(move || {
        let started = std::time::Instant::now();
        let result = (|| -> Result<String, String> {
            logger::log_info(
                "PASTE",
                "Preparing clipboard sentinel for selected text copy",
            );
            handle
                .clipboard()
                .write_text(sentinel.clone())
                .map_err(|e| format!("Clipboard sentinel write failed: {}", e))?;

            let copy_result = (|| -> Result<String, String> {
                std::thread::sleep(Duration::from_millis(90));

                logger::log_info("PASTE", &format!("Simulating {}", copy_shortcut_label()));
                simulate_cmd_c()?;

                wait_for_selected_text_from_clipboard(
                    || {
                        handle
                            .clipboard()
                            .read_text()
                            .map_err(|e| format!("Clipboard read after copy failed: {}", e))
                    },
                    &sentinel,
                    Duration::from_millis(1200),
                    Duration::from_millis(60),
                )
            })();

            let restore_result: Result<(), String> = match &previous_clipboard_text {
                Some(previous_text) => {
                    handle
                        .clipboard()
                        .write_text(previous_text.clone())
                        .map_err(|e| format!("Clipboard restore failed: {}", e))?;
                    Ok(())
                }
                None => {
                    handle
                        .clipboard()
                        .clear()
                        .map_err(|e| format!("Clipboard clear failed: {}", e))?;
                    Ok(())
                }
            };

            restore_result?;
            copy_result
        })();

        match &result {
            Ok(text) => logger::log_info(
                "PASTE",
                &format!(
                    "Selected text copy completed: chars={}, elapsed_ms={}",
                    text.chars().count(),
                    started.elapsed().as_millis()
                ),
            ),
            Err(err) => logger::log_error(
                "PASTE",
                &format!("{} (elapsed_ms={})", err, started.elapsed().as_millis()),
            ),
        }

        let _ = tx.send(result);
    })
    .map_err(|e| {
        format!(
            "Failed to schedule selected text copy on main thread: {}",
            e
        )
    })?;

    tokio::task::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("Failed waiting for selected text copy: {}", e))?
        .map_err(|e| format!("Failed receiving selected text copy result: {}", e))?
}

/// After Cmd+V the dictated text stays on the clipboard instead of restoring
/// whatever was there before the paste.
pub(crate) fn clipboard_text_after_paste<'a>(pasted: &'a str, _previous: Option<&str>) -> &'a str {
    pasted
}

/// Paste text by writing to clipboard and simulating Cmd+V
#[tauri::command]
pub async fn paste_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    ensure_input_event_permission()?;

    let char_count = text.chars().count();
    let previous_clipboard_text = app.clipboard().read_text().ok();

    logger::log_info(
        "PASTE",
        &format!("Scheduling paste on main thread, chars={}", char_count),
    );

    let handle = app.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    app.run_on_main_thread(move || {
        let result = (|| -> Result<(), String> {
            logger::log_info(
                "PASTE",
                &format!("Writing text to clipboard, chars={}", char_count),
            );
            handle
                .clipboard()
                .write_text(text.clone())
                .map_err(|e| format!("Clipboard write failed: {}", e))?;

            std::thread::sleep(Duration::from_millis(100));

            logger::log_info("PASTE", &format!("Simulating {}", paste_shortcut_label()));
            simulate_cmd_v()?;

            std::thread::sleep(Duration::from_millis(500));

            let kept = clipboard_text_after_paste(&text, previous_clipboard_text.as_deref());
            logger::log_info("PASTE", "Leaving dictated text on the clipboard");
            handle
                .clipboard()
                .write_text(kept)
                .map_err(|e| format!("Clipboard write failed: {}", e))?;

            Ok(())
        })();

        if let Err(err) = &result {
            logger::log_error("PASTE", err);
        } else {
            logger::log_info("PASTE", "Paste completed on main thread");
        }

        let _ = tx.send(result);
    })
    .map_err(|e| format!("Failed to schedule paste on main thread: {}", e))?;

    tokio::task::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("Failed waiting for paste completion: {}", e))?
        .map_err(|e| format!("Failed receiving paste result: {}", e))??;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        clipboard_text_after_paste, selected_text_from_clipboard,
        wait_for_selected_text_from_clipboard,
    };

    #[test]
    fn dictated_text_stays_on_the_clipboard() {
        assert_eq!(
            clipboard_text_after_paste("привет", Some("старое")),
            "привет"
        );
        assert_eq!(clipboard_text_after_paste("привет", None), "привет");
    }

    #[test]
    fn sentinel_means_no_selected_text() {
        assert_eq!(
            selected_text_from_clipboard("__sentinel__", "__sentinel__"),
            None
        );
    }

    #[test]
    fn blank_clipboard_means_no_selected_text() {
        assert_eq!(selected_text_from_clipboard(" \n\t", "__sentinel__"), None);
    }

    #[test]
    fn non_empty_clipboard_is_selected_text() {
        assert_eq!(
            selected_text_from_clipboard("hello", "__sentinel__"),
            Some("hello".to_string())
        );
    }

    #[test]
    fn waits_for_delayed_selected_text() {
        let mut attempts = 0;
        let selected_text = wait_for_selected_text_from_clipboard(
            || {
                attempts += 1;
                Ok(if attempts < 3 {
                    "__sentinel__".to_string()
                } else {
                    "delayed text".to_string()
                })
            },
            "__sentinel__",
            Duration::from_millis(50),
            Duration::from_millis(1),
        );

        assert_eq!(selected_text, Ok("delayed text".to_string()));
    }

    #[test]
    fn sentinel_timeout_means_no_selected_text() {
        let selected_text = wait_for_selected_text_from_clipboard(
            || Ok("__sentinel__".to_string()),
            "__sentinel__",
            Duration::ZERO,
            Duration::from_millis(1),
        );

        assert_eq!(selected_text, Err("No selected text copied".to_string()));
    }
}
