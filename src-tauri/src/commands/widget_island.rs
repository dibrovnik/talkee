use std::ptr::NonNull;
use std::sync::{Mutex, OnceLock};

use block2::RcBlock;
use objc2::{MainThreadMarker, Message};
use objc2_app_kit::{
    NSApplicationDidChangeScreenParametersNotification, NSStatusWindowLevel, NSWindow,
    NSWindowCollectionBehavior,
};
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSOperationQueue, NSPoint, NSRect, NSSize,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::logger;
use crate::notch::{self, compute_anchor, read_screens, IslandAnchor, IslandFallback};

const ANCHOR_EVENT: &str = "island-anchor-changed";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Pill,
    Island,
}

struct PillSnapshot {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    level: isize,
    behavior: usize,
    has_shadow: bool,
}

// collectionBehavior stores NSUInteger, which is usize on this target.

struct PresentationState {
    mode: Mode,
    fallback: IslandFallback,
    anchor: Option<IslandAnchor>,
    pill: Option<PillSnapshot>,
}

fn state() -> &'static Mutex<PresentationState> {
    static STATE: OnceLock<Mutex<PresentationState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(PresentationState {
            mode: Mode::Pill,
            fallback: IslandFallback::Island,
            anchor: None,
            pill: None,
        })
    })
}

fn lock_state() -> Result<std::sync::MutexGuard<'static, PresentationState>, String> {
    state()
        .lock()
        .map_err(|err| format!("Widget presentation lock failed: {err}"))
}

pub fn is_island_mode() -> bool {
    lock_state()
        .map(|state| state.mode == Mode::Island)
        .unwrap_or(false)
}

fn current_anchor() -> Option<IslandAnchor> {
    lock_state().ok().and_then(|state| state.anchor)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPresentationApplied {
    pub mode: String,
    pub anchor: Option<IslandAnchor>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnchorChanged {
    anchor: Option<IslandAnchor>,
}

pub fn apply_presentation(
    app: &AppHandle,
    mode: &str,
    fallback: Option<IslandFallback>,
) -> Result<WidgetPresentationApplied, String> {
    let requested = match mode {
        "pill" => Mode::Pill,
        "island" => Mode::Island,
        _ => return Err(format!("Unknown widget presentation: {mode}")),
    };
    if let Some(fallback) = fallback {
        lock_state()?.fallback = fallback;
    }
    run_on_main(app, move |app| apply_on_main(&app, requested))
}

pub fn set_interactive(app: &AppHandle, interactive: bool) -> Result<(), String> {
    if !is_island_mode() {
        return Ok(());
    }
    let Some(win) = app.get_webview_window("widget") else {
        return Ok(());
    };
    win.set_ignore_cursor_events(!interactive)
        .map_err(|err| err.to_string())
}

pub fn reposition_if_island(app: &AppHandle) -> Result<bool, String> {
    if !is_island_mode() {
        return Ok(false);
    }
    run_on_main(app, |app| refresh_on_main(&app))
}

pub fn try_position_below_island(
    app: &AppHandle,
    window: &WebviewWindow,
    width: f64,
    height: f64,
    gap: f64,
) -> Result<bool, String> {
    let Some(anchor) = current_anchor() else {
        return Ok(false);
    };
    let window = window.clone();
    run_on_main(app, move |_| {
        position_overlay_on_main(&window, &anchor, width, height, gap)?;
        Ok(true)
    })
}

pub fn start_screen_observer(app: &AppHandle) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.get().is_some() {
        return;
    }
    let owned = app.clone();
    if MainThreadMarker::new().is_some() {
        match register_screen_observer(&owned) {
            Ok(()) => {
                let _ = STARTED.set(());
            }
            Err(err) => logger::log_error("ISLAND", &format!("Screen observer failed: {err}")),
        }
        return;
    }
    let queued = owned.clone();
    if owned
        .run_on_main_thread(move || {
            if let Err(err) = register_screen_observer(&queued) {
                logger::log_error("ISLAND", &format!("Screen observer failed: {err}"));
            }
        })
        .is_ok()
    {
        let _ = STARTED.set(());
    }
}

fn register_screen_observer(app: &AppHandle) -> Result<(), String> {
    let app = app.clone();
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Err(err) = refresh_on_main(&app) {
            logger::log_error("ISLAND", &format!("Screen change reposition failed: {err}"));
        }
    });
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidChangeScreenParametersNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // The notification center retains the observer and the block. Forgetting
    // them keeps the subscription for the process lifetime without requiring
    // the AppKit object to be Send.
    std::mem::forget(observer);
    std::mem::forget(block);
    Ok(())
}

fn apply_on_main(app: &AppHandle, requested: Mode) -> Result<WidgetPresentationApplied, String> {
    let Some(win) = app.get_webview_window("widget") else {
        return Err("Widget window not found".to_string());
    };
    let fallback = lock_state()?.fallback;
    match requested {
        Mode::Pill => {
            restore_pill_on_main(&win)?;
            let mut state = lock_state()?;
            state.mode = Mode::Pill;
            state.anchor = None;
            emit_anchor(app, None);
            Ok(WidgetPresentationApplied {
                mode: "pill".to_string(),
                anchor: None,
            })
        }
        Mode::Island => match resolve_anchor(fallback)? {
            Some(anchor) => {
                enter_island_on_main(&win, &anchor)?;
                let mut state = lock_state()?;
                state.mode = Mode::Island;
                state.anchor = Some(anchor);
                emit_anchor(app, Some(anchor));
                Ok(WidgetPresentationApplied {
                    mode: "island".to_string(),
                    anchor: Some(anchor),
                })
            }
            None => {
                restore_pill_on_main(&win)?;
                let mut state = lock_state()?;
                state.mode = Mode::Pill;
                state.anchor = None;
                emit_anchor(app, None);
                Ok(WidgetPresentationApplied {
                    mode: "pill".to_string(),
                    anchor: None,
                })
            }
        },
    }
}

fn refresh_on_main(app: &AppHandle) -> Result<bool, String> {
    if !is_island_mode() {
        return Ok(false);
    }
    let Some(win) = app.get_webview_window("widget") else {
        return Ok(false);
    };
    let fallback = lock_state()?.fallback;
    match resolve_anchor(fallback)? {
        Some(anchor) => {
            let moved = place_island_on_main(&win, &anchor)?;
            if moved || lock_state()?.anchor != Some(anchor) {
                lock_state()?.anchor = Some(anchor);
                emit_anchor(app, Some(anchor));
            }
            Ok(moved)
        }
        None => {
            restore_pill_on_main(&win)?;
            let mut state = lock_state()?;
            state.mode = Mode::Pill;
            state.anchor = None;
            emit_anchor(app, None);
            Ok(true)
        }
    }
}

fn resolve_anchor(fallback: IslandFallback) -> Result<Option<IslandAnchor>, String> {
    let marker = MainThreadMarker::new().ok_or("Screen geometry requires the main thread")?;
    let screens = read_screens(marker)?;
    Ok(compute_anchor(&screens, fallback))
}

fn enter_island_on_main(win: &WebviewWindow, anchor: &IslandAnchor) -> Result<(), String> {
    let already_island = is_island_mode();
    let ns_win = ns_window(win)?;
    if !already_island {
        let frame = ns_win.frame();
        lock_state()?.pill = Some(PillSnapshot {
            x: frame.origin.x,
            y: frame.origin.y,
            width: frame.size.width,
            height: frame.size.height,
            level: ns_win.level(),
            behavior: ns_win.collectionBehavior().0,
            has_shadow: ns_win.hasShadow(),
        });
    }
    // set_always_on_top queues NSFloatingWindowLevel, which sits under the menu
    // bar and hides the part of the island that should fill the notch.
    place_ns_island(ns_win, anchor)?;
    log_island_geometry_once(ns_win);
    if !already_island {
        win.set_ignore_cursor_events(true)
            .map_err(|err| err.to_string())?;
        if let Ok(false) = win.is_visible() {
            win.show().map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn place_island_on_main(win: &WebviewWindow, anchor: &IslandAnchor) -> Result<bool, String> {
    place_ns_island(ns_window(win)?, anchor)
}

fn place_ns_island(ns_win: &NSWindow, anchor: &IslandAnchor) -> Result<bool, String> {
    // Above the menu bar before moving. A floating window is clamped into the
    // visible frame, so the island would sit under the notch.
    let level = NSStatusWindowLevel;
    let level_changed = ns_win.level() != level;
    if level_changed {
        ns_win.setLevel(level);
        // set_always_on_top queues NSFloatingWindowLevel on the main queue.
        let retained = ns_win.retain();
        let block = RcBlock::new(move || {
            if retained.level() != level {
                retained.setLevel(level);
            }
        });
        unsafe {
            NSOperationQueue::mainQueue().addOperationWithBlock(&block);
        }
    }
    let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::IgnoresCycle;
    if ns_win.collectionBehavior() != behavior {
        ns_win.setCollectionBehavior(behavior);
    }
    if ns_win.hasShadow() {
        ns_win.setHasShadow(false);
    }
    let frame = notch::island_window_frame(anchor);
    let current = ns_rect_to_rect(ns_win.frame());
    let moved = !notch::same_window_frame(current, frame);
    if moved {
        ns_win.setFrame_display(ns_rect(&frame), true);
        let applied = ns_rect_to_rect(ns_win.frame());
        if !notch::same_window_frame(applied, frame) {
            logger::log_info(
                "ISLAND",
                &format!(
                    "Island frame did not stick: requested=({:.1},{:.1},{:.1},{:.1}) applied=({:.1},{:.1},{:.1},{:.1}) level={}",
                    frame.x,
                    frame.y,
                    frame.width,
                    frame.height,
                    applied.x,
                    applied.y,
                    applied.width,
                    applied.height,
                    ns_win.level()
                ),
            );
        }
    }
    if level_changed {
        ns_win.orderFrontRegardless();
    }
    Ok(moved || level_changed)
}

fn log_island_geometry_once(ns_win: &NSWindow) {
    static LOGGED: OnceLock<()> = OnceLock::new();
    if LOGGED.set(()).is_err() {
        return;
    }
    let frame = ns_win.frame();
    let layout = ns_win.contentLayoutRect();
    let safe_top = ns_win
        .contentView()
        .map(|view| view.safeAreaInsets().top)
        .unwrap_or(0.0);
    logger::log_info(
        "ISLAND",
        &format!(
            "Island geometry: window=({:.1},{:.1},{:.1},{:.1}) content_layout=({:.1},{:.1},{:.1},{:.1}) safe_top={safe_top:.1} level={}",
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height,
            layout.origin.x,
            layout.origin.y,
            layout.size.width,
            layout.size.height,
            ns_win.level()
        ),
    );
}

fn ns_rect_to_rect(rect: NSRect) -> notch::Rect {
    notch::Rect {
        x: rect.origin.x,
        y: rect.origin.y,
        width: rect.size.width,
        height: rect.size.height,
    }
}

fn restore_pill_on_main(win: &WebviewWindow) -> Result<(), String> {
    let snapshot = lock_state()?.pill.take();
    let ns_win = ns_window(win)?;
    if let Some(snapshot) = snapshot {
        ns_win.setFrame_display(
            NSRect::new(
                NSPoint::new(snapshot.x, snapshot.y),
                NSSize::new(snapshot.width, snapshot.height),
            ),
            true,
        );
        ns_win.setLevel(snapshot.level);
        ns_win.setCollectionBehavior(
            NSWindowCollectionBehavior(snapshot.behavior)
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        ns_win.setHasShadow(snapshot.has_shadow);
    }
    let _ = win.set_always_on_top(true);
    win.set_ignore_cursor_events(false)
        .map_err(|err| err.to_string())
}

fn position_overlay_on_main(
    window: &WebviewWindow,
    anchor: &IslandAnchor,
    width: f64,
    height: f64,
    gap: f64,
) -> Result<(), String> {
    let frame = notch::island_overlay_frame(anchor, width, height, gap);
    ns_window(window)?.setFrame_display(ns_rect(&frame), true);
    Ok(())
}

fn ns_window(window: &WebviewWindow) -> Result<&NSWindow, String> {
    let pointer = window.ns_window().map_err(|err| err.to_string())?;
    Ok(unsafe { &*pointer.cast() })
}

fn ns_rect(frame: &crate::notch::Rect) -> NSRect {
    NSRect::new(
        NSPoint::new(frame.x, frame.y),
        NSSize::new(frame.width, frame.height),
    )
}

fn emit_anchor(app: &AppHandle, anchor: Option<IslandAnchor>) {
    if let Err(err) = app.emit(ANCHOR_EVENT, AnchorChanged { anchor }) {
        logger::log_error("ISLAND", &format!("Failed to emit anchor: {err}"));
    }
}

fn run_on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if MainThreadMarker::new().is_some() {
        return work(app.clone());
    }
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    let app_for_work = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(work(app_for_work));
    })
    .map_err(|err| err.to_string())?;
    rx.recv()
        .map_err(|err| format!("Widget presentation main-thread result failed: {err}"))?
}
