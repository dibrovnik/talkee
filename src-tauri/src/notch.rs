use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use objc2_foundation::{ns_string, NSNumber, NSRect};
use serde::{Deserialize, Serialize};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayIsBuiltin(display: u32) -> u32;
}

/// Global AppKit coordinates, in points (origin at bottom left).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn max_x(self) -> f64 {
        self.x + self.width
    }

    fn max_y(self) -> f64 {
        self.y + self.height
    }
}

impl From<NSRect> for Rect {
    fn from(rect: NSRect) -> Self {
        Self {
            x: rect.origin.x,
            y: rect.origin.y,
            width: rect.size.width,
            height: rect.size.height,
        }
    }
}

#[derive(Debug)]
pub struct ScreenInfo {
    pub id: u32,
    pub frame: Rect,
    pub visible_frame: Rect,
    pub scale: f64,
    pub safe_top: f64,
    pub aux_left: Option<Rect>,
    pub aux_right: Option<Rect>,
    pub is_builtin: bool,
    pub has_menu_bar: bool,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandFallback {
    Island,
    Pill,
}

/// Kept in AppKit coordinates for direct NSWindow positioning.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandAnchor {
    pub screen_id: u32,
    pub center_x: f64,
    pub top_y: f64,
    pub notch_width: f64,
    pub notch_height: f64,
    pub is_real_notch: bool,
}

pub fn compute_anchor(screens: &[ScreenInfo], fallback: IslandFallback) -> Option<IslandAnchor> {
    let real_anchor = |screen: &ScreenInfo| {
        let left = screen.aux_left?;
        let right = screen.aux_right?;
        let width = screen.frame.width - left.width - right.width;
        (screen.safe_top > 0.0 && width > 0.0).then_some(IslandAnchor {
            screen_id: screen.id,
            center_x: left.max_x() + width / 2.0,
            top_y: screen.frame.max_y(),
            notch_width: width,
            notch_height: screen.safe_top,
            is_real_notch: true,
        })
    };
    // Prefer the built-in notch even if an external display owns the menu bar.
    if let Some(anchor) = screens
        .iter()
        .filter(|screen| screen.is_builtin)
        .find_map(real_anchor)
        .or_else(|| screens.iter().find_map(real_anchor))
    {
        return Some(anchor);
    }
    if matches!(fallback, IslandFallback::Pill) {
        return None;
    }
    let screen = screens.iter().find(|screen| screen.has_menu_bar)?;
    Some(IslandAnchor {
        screen_id: screen.id,
        center_x: screen.frame.x + screen.frame.width / 2.0,
        top_y: screen.frame.max_y(),
        notch_width: 180.0,
        notch_height: (screen.frame.max_y() - screen.visible_frame.max_y()).max(24.0),
        is_real_notch: false,
    })
}

const ISLAND_SIDE_MARGIN: f64 = 140.0;
const ISLAND_MIN_WINDOW_WIDTH: f64 = 440.0;
const ISLAND_NOTICE_RESERVE: f64 = 120.0;

/// Fixed window frame for island mode. The top edge sits on the screen top.
pub fn island_window_frame(anchor: &IslandAnchor) -> Rect {
    let width = (anchor.notch_width + 2.0 * ISLAND_SIDE_MARGIN).max(ISLAND_MIN_WINDOW_WIDTH);
    let height = anchor.notch_height + ISLAND_NOTICE_RESERVE;
    Rect {
        x: anchor.center_x - width / 2.0,
        y: anchor.top_y - height,
        width,
        height,
    }
}

/// AppKit snaps window frames to the pixel grid, so a half-point difference is
/// the same place. A menu-bar height (about 32pt) is not.
pub fn same_window_frame(current: Rect, requested: Rect) -> bool {
    const EPSILON: f64 = 1.0;
    (current.x - requested.x).abs() <= EPSILON
        && (current.y - requested.y).abs() <= EPSILON
        && (current.width - requested.width).abs() <= EPSILON
        && (current.height - requested.height).abs() <= EPSILON
}

/// Overlay window in AppKit coordinates, `gap` points below the notch.
pub fn island_overlay_frame(anchor: &IslandAnchor, width: f64, height: f64, gap: f64) -> Rect {
    Rect {
        x: anchor.center_x - width / 2.0,
        y: anchor.top_y - anchor.notch_height - gap - height,
        width,
        height,
    }
}

/// The marker prevents AppKit screen queries from running off the main thread.
pub fn read_screens(mtm: MainThreadMarker) -> Result<Vec<ScreenInfo>, String> {
    NSScreen::screens(mtm)
        .iter()
        .enumerate()
        .map(|(index, screen)| {
            let description = screen.deviceDescription();
            let number = description
                .objectForKey(ns_string!("NSScreenNumber"))
                .ok_or("Screen has no display ID")?;
            let id = number
                .downcast_ref::<NSNumber>()
                .ok_or("Screen display ID is not a number")?
                .unsignedIntValue();
            let safe_top = screen.safeAreaInsets().top;
            Ok(ScreenInfo {
                id,
                frame: screen.frame().into(),
                visible_frame: screen.visibleFrame().into(),
                scale: screen.backingScaleFactor(),
                safe_top,
                aux_left: (safe_top > 0.0).then(|| screen.auxiliaryTopLeftArea().into()),
                aux_right: (safe_top > 0.0).then(|| screen.auxiliaryTopRightArea().into()),
                // CoreGraphics takes a display ID and has no object ownership requirements.
                is_builtin: unsafe { CGDisplayIsBuiltin(id) != 0 },
                has_menu_bar: index == 0,
            })
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandAvailability {
    has_notch_screen: bool,
    active_anchor: Option<IslandAnchor>,
}

#[tauri::command]
pub async fn get_island_availability(
    app: tauri::AppHandle,
    fallback: Option<IslandFallback>,
) -> Result<IslandAvailability, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = MainThreadMarker::new()
            .ok_or_else(|| "Screen geometry requires the main thread".to_string())
            .and_then(read_screens)
            .map(|screens| {
                for screen in &screens {
                    crate::logger::log_info(
                        "ISLAND",
                        &format!(
                            "Screen {}: scale={} safe_top={} builtin={}",
                            screen.id, screen.scale, screen.safe_top, screen.is_builtin
                        ),
                    );
                }
                IslandAvailability {
                    has_notch_screen: screens.iter().any(|screen| screen.safe_top > 0.0),
                    active_anchor: compute_anchor(
                        &screens,
                        fallback.unwrap_or(IslandFallback::Island),
                    ),
                }
            });
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(notch: bool) -> ScreenInfo {
        ScreenInfo {
            id: 1,
            frame: Rect {
                x: 0.0,
                y: 0.0,
                width: 1512.0,
                height: 982.0,
            },
            visible_frame: Rect {
                x: 0.0,
                y: 40.0,
                width: 1512.0,
                height: 904.0,
            },
            scale: 2.0,
            safe_top: if notch { 38.0 } else { 0.0 },
            aux_left: notch.then_some(Rect {
                x: 0.0,
                y: 944.0,
                width: 656.0,
                height: 38.0,
            }),
            aux_right: notch.then_some(Rect {
                x: 856.0,
                y: 944.0,
                width: 656.0,
                height: 38.0,
            }),
            is_builtin: true,
            has_menu_bar: true,
        }
    }

    #[test]
    fn macbook_notch() {
        let anchor = compute_anchor(&[screen(true)], IslandFallback::Pill).unwrap();
        assert_eq!(
            anchor,
            IslandAnchor {
                screen_id: 1,
                center_x: 756.0,
                top_y: 982.0,
                notch_width: 200.0,
                notch_height: 38.0,
                is_real_notch: true,
            }
        );
    }

    #[test]
    fn macbook_with_external_menu_display() {
        let mut builtin = screen(true);
        builtin.has_menu_bar = false;
        builtin.frame.x = -1512.0;
        builtin.frame.y = 200.0;
        builtin.aux_left.as_mut().unwrap().x -= 1512.0;
        builtin.aux_right.as_mut().unwrap().x -= 1512.0;
        let mut external = screen(false);
        external.id = 2;
        external.is_builtin = false;
        let anchor = compute_anchor(&[external, builtin], IslandFallback::Island).unwrap();
        assert_eq!(anchor.screen_id, 1);
        assert_eq!(anchor.center_x, -756.0);
        assert_eq!(anchor.top_y, 1182.0);
    }

    #[test]
    fn closed_lid_external_only() {
        let mut external = screen(false);
        external.is_builtin = false;
        external.id = 2;
        let anchor = compute_anchor(&[external], IslandFallback::Island).unwrap();
        assert_eq!(anchor.screen_id, 2);
        assert_eq!(anchor.notch_width, 180.0);
        assert_eq!(anchor.notch_height, 38.0);
        assert!(!anchor.is_real_notch);
    }

    #[test]
    fn no_notch_island_fallback() {
        let mut plain = screen(false);
        plain.visible_frame = plain.frame; // Auto-hidden menu bar.
        let anchor = compute_anchor(&[plain], IslandFallback::Island).unwrap();
        assert_eq!(anchor.notch_height, 24.0);
        assert_eq!(anchor.center_x, 756.0);
        assert!(compute_anchor(&[], IslandFallback::Island).is_none());
    }

    #[test]
    fn no_notch_pill_fallback() {
        assert!(compute_anchor(&[screen(false)], IslandFallback::Pill).is_none());
    }

    fn anchor() -> IslandAnchor {
        IslandAnchor {
            screen_id: 1,
            center_x: 756.0,
            top_y: 982.0,
            notch_width: 179.0,
            notch_height: 32.0,
            is_real_notch: true,
        }
    }

    #[test]
    fn island_window_frame_is_centered_on_the_notch() {
        let frame = island_window_frame(&anchor());
        assert!((frame.width - 459.0).abs() < 0.01);
        assert!((frame.height - 152.0).abs() < 0.01);
        assert!((frame.x + frame.width / 2.0 - 756.0).abs() < 0.01);
        assert!((frame.y + frame.height - 982.0).abs() < 0.01);
    }

    #[test]
    fn island_window_frame_keeps_the_minimum_width() {
        let mut narrow = anchor();
        narrow.notch_width = 100.0;
        let frame = island_window_frame(&narrow);
        assert!((frame.width - 440.0).abs() < 0.01);
    }

    #[test]
    fn half_point_snap_is_the_same_window_frame() {
        let requested = island_window_frame(&anchor());
        let mut snapped = requested;
        snapped.x = requested.x.floor();
        assert!(same_window_frame(snapped, requested));
        snapped.y -= 32.0;
        assert!(!same_window_frame(snapped, requested));
    }

    #[test]
    fn overlay_frame_sits_below_the_notch() {
        let frame = island_overlay_frame(&anchor(), 200.0, 40.0, 8.0);
        assert!((frame.x - 656.0).abs() < 0.01);
        assert!((frame.y - (982.0 - 32.0 - 8.0 - 40.0)).abs() < 0.01);
    }
}
