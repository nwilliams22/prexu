//! AppKit backing dimensions are already physical pixels; do not apply scale twice.
pub(super) fn drawable_size(width: f64, height: f64) -> Option<(i32, i32)> {
    if [width, height]
        .iter()
        .any(|v| !v.is_finite() || *v < 1.0 || *v > i32::MAX as f64)
    {
        return None;
    }
    Some((width.round() as i32, height.round() as i32))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backing_pixels_are_not_scaled_twice() {
        assert_eq!(drawable_size(2560.0, 1440.0), Some((2560, 1440)));
        assert_eq!(drawable_size(1280.4, 720.6), Some((1280, 721)));
    }
    #[test]
    fn unavailable_or_invalid_drawables_do_not_render() {
        for value in [
            0.0,
            -1.0,
            0.5,
            f64::NAN,
            f64::INFINITY,
            i32::MAX as f64 + 1.0,
        ] {
            assert_eq!(drawable_size(value, 720.0), None);
            assert_eq!(drawable_size(1280.0, value), None);
        }
    }
}
