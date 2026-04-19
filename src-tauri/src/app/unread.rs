use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{command, image::Image, AppHandle, Manager};

const TRAY_PLAIN: &[u8] = include_bytes!("../../png/tray-plain.png");
const TRAY_DOT: &[u8] = include_bytes!("../../png/tray-dot.png");

#[derive(Default)]
pub struct UnreadState {
    count: AtomicU32,
}

impl UnreadState {
    pub fn get(&self) -> u32 {
        self.count.load(Ordering::Relaxed)
    }

    fn swap(&self, new_count: u32) -> u32 {
        self.count.swap(new_count, Ordering::Relaxed)
    }
}

#[command]
pub fn set_unread(app: AppHandle, count: u32) -> Result<(), String> {
    let state = app.state::<UnreadState>();
    let previous = state.swap(count);
    if previous == count {
        return Ok(());
    }
    let handle = app.clone();
    app.run_on_main_thread(move || apply_unread(&handle, count))
        .map_err(|e| format!("dispatch to main thread failed: {e}"))
}

pub fn apply_unread(app: &AppHandle, count: u32) {
    update_tray_icon(app, count);
    set_dock_badge(count);
}

fn update_tray_icon(app: &AppHandle, count: u32) {
    let bytes = if count > 0 { TRAY_DOT } else { TRAY_PLAIN };
    let image = match Image::from_bytes(bytes) {
        Ok(img) => img,
        Err(err) => {
            eprintln!("[tanka] failed to decode tray icon: {err}");
            return;
        }
    };
    if let Some(tray) = app.tray_by_id("pake-tray") {
        if let Err(err) = tray.set_icon(Some(image)) {
            eprintln!("[tanka] tray.set_icon failed: {err}");
        }
    }
}

#[cfg(target_os = "macos")]
fn set_dock_badge(count: u32) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSString;

    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[tanka] set_dock_badge called off main thread");
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    let tile = app.dockTile();
    let label = match count {
        0 => None,
        n if n > 99 => Some(NSString::from_str("99+")),
        n => Some(NSString::from_str(&n.to_string())),
    };
    unsafe { tile.setBadgeLabel(label.as_deref()) };
}

#[cfg(not(target_os = "macos"))]
fn set_dock_badge(_count: u32) {}
