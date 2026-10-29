#!/usr/bin/env python3
"""Run the resolved updater's tests plus extraction probes in a temporary copy.

The registry source stays untouched. No installer is launched: Windows probes
call extraction only; Linux upstream tests replace temporary AppImage files.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "src-tauri" / "Cargo.toml"


def metadata(manifest, *extra):
    return json.loads(subprocess.check_output([
        "cargo", "metadata", "--format-version", "1", "--manifest-path",
        str(manifest), *extra,
    ], text=True, encoding="utf-8"))


def main():
    resolved = metadata(MANIFEST, "--locked")
    wry = [p for p in resolved["packages"] if p["name"] == "wry"]
    if len(wry) != 1 or Path(wry[0]["manifest_path"]).resolve() != (
        ROOT / "src-tauri/vendor/wry/Cargo.toml"
    ).resolve():
        raise RuntimeError("The native player requires exactly one Wry, from the vendored fork")
    package = next(p for p in resolved["packages"] if p["name"] == "tauri-plugin-updater")
    with tempfile.TemporaryDirectory(prefix="prexu-updater-test-") as directory:
        crate = Path(directory) / "updater"
        shutil.copytree(Path(package["manifest_path"]).parent, crate)
        shutil.copyfile(MANIFEST.with_name("Cargo.lock"), crate / "Cargo.lock")
        manifest = crate / "Cargo.toml"
        with manifest.open("a", encoding="utf-8") as file:
            file.write('\n[patch.crates-io]\nwry = { path = ' + json.dumps(
                (ROOT / "src-tauri/vendor/wry").as_posix()) + ' }\n')
        source = crate / "src/updater.rs"
        text = source.read_text(encoding="utf-8")
        anchor = "mod offline_tests {"
        if text.count(anchor) != 1:
            raise RuntimeError("Updater test layout changed; review the compatibility harness")
        probes = (ROOT / "src-tauri/ci/updater-payloads.rs").read_text(encoding="utf-8")
        source.write_text(text.replace(anchor, anchor + "\n" + probes, 1), encoding="utf-8")
        tested = metadata(manifest)
        # A copied lockfile may need a root-package update, but the runtime
        # dependency versions under test must still match the application.
        for name in ("tauri", "tauri-plugin-updater", "wry", "zip", "minisign-verify"):
            expected = {p["version"] for p in resolved["packages"] if p["name"] == name}
            actual = {p["version"] for p in tested["packages"] if p["name"] == name}
            if expected != actual:
                raise RuntimeError(f"{name}: app {expected}, test {actual}")
            print(f"Testing {name}: {', '.join(sorted(actual))}", flush=True)
        env = dict(os.environ)
        env.setdefault("CARGO_TARGET_DIR", str(ROOT / "src-tauri/target"))
        subprocess.run([
            "cargo", "test", "--manifest-path", str(manifest), "--locked", "--lib",
        ], env=env, check=True)


if __name__ == "__main__":
    main()
