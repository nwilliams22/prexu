//! Keep per-file resume options compatible with system and bundled mpv.
use libmpv2::{mpv_node::MpvNode, Mpv, Result};

/// mpv 0.38 added an insertion index before the per-file options. Inspect
/// command metadata instead of guessing from the client API or version string.
fn has_insertion_index(mpv: &Mpv) -> Result<bool> {
    let commands = mpv.get_property::<MpvNode>("command-list")?;
    for command in commands.array().into_iter().flatten() {
        let fields: Vec<_> = command.map().into_iter().flatten().collect();
        if !fields
            .iter()
            .any(|(key, value)| key == "name" && value.str() == Some("loadfile"))
        {
            continue;
        }
        return Ok(fields.into_iter().any(|(key, value)| {
            key == "args"
                && value.array().into_iter().flatten().any(|arg| {
                    arg.map()
                        .into_iter()
                        .flatten()
                        .any(|(key, value)| key == "name" && value.str() == Some("index"))
                })
        }));
    }
    Ok(false)
}

/// `quoted_url` has already been escaped for libmpv2's flat command syntax.
pub(crate) fn loadfile(mpv: &Mpv, quoted_url: &str, start_offset_ms: u64) -> Result<()> {
    let opts = format!("start={}", start_offset_ms as f64 / 1000.0);
    if has_insertion_index(mpv)? {
        mpv.command("loadfile", &[quoted_url, "replace", "-1", &opts])
    } else {
        mpv.command("loadfile", &[quoted_url, "replace", &opts])
    }
}
