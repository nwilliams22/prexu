//! Keep the decorated Windows window inside the taskbar-excluding work area.
//! Call on the UI thread, after restoring decorations and before syncing video.
use tauri::WebviewWindow;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, IsZoomed, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
};

/// Preserve a fitting rectangle; shrink and translate only what is out of bounds.
fn fitted(window: [i32; 4], work: [i32; 4]) -> [i32; 4] {
    let width = (window[2] - window[0]).min(work[2] - work[0]);
    let height = (window[3] - window[1]).min(work[3] - work[1]);
    let x = window[0].clamp(work[0], work[2] - width);
    let y = window[1].clamp(work[1], work[3] - height);
    [x, y, x + width, y + height]
}

pub(crate) fn fit(window: &WebviewWindow) {
    let result = (|| -> Result<(), String> {
        if window.is_fullscreen().map_err(|e| e.to_string())? {
            return Ok(());
        }
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        // Maximized placement is already managed by Windows. Do not turn it
        // into a restored window or disturb its saved normal placement.
        unsafe {
            if IsZoomed(hwnd).as_bool() {
                return Ok(());
            }
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return Err("GetMonitorInfoW failed".into());
            }
            let mut outer = RECT::default();
            GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
            let work = info.rcWork;
            if work.right <= work.left || work.bottom <= work.top {
                return Err("monitor work area is empty".into());
            }
            let before = [outer.left, outer.top, outer.right, outer.bottom];
            let after = fitted(before, [work.left, work.top, work.right, work.bottom]);
            if before != after {
                // Both rectangles are physical screen pixels, including the
                // non-client frame. No logical-size/DPI conversion is needed.
                SetWindowPos(
                    hwnd,
                    None,
                    after[0],
                    after[1],
                    after[2] - after[0],
                    after[3] - after[1],
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
                .map_err(|e| e.to_string())?;
                log::info!("[window] work-area fit {:?} -> {:?}", before, after);
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        log::warn!("[window] work-area fit failed: {}", error);
    }
}

#[cfg(test)]
mod tests {
    use super::fitted;
    #[test]
    fn small_desktop_includes_frame_and_excludes_taskbar() {
        assert_eq!(
            fitted([-8, -31, 1288, 808], [0, 0, 1280, 752]),
            [0, 0, 1280, 752]
        );
    }
    #[test]
    fn preserves_user_size_and_position_when_it_fits() {
        assert_eq!(
            fitted([100, 70, 1000, 700], [0, 0, 1280, 752]),
            [100, 70, 1000, 700]
        );
    }
    #[test]
    fn handles_negative_monitor_origin_and_top_taskbar() {
        assert_eq!(
            fitted([-2000, -20, -400, 1000], [-1920, 48, 0, 1080]),
            [-1920, 48, -320, 1068]
        );
    }
    #[test]
    fn moves_small_offscreen_window_without_growing_it() {
        assert_eq!(
            fitted([1200, 700, 2000, 1300], [0, 0, 1280, 752]),
            [480, 152, 1280, 752]
        );
    }
}
