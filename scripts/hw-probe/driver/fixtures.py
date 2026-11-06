#!/usr/bin/env python3
"""Generate the synthetic v1 probe corpus; no downloads or private media."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

SUBTITLES = """1
00:00:01,000 --> 00:00:03,000
CUE ONE

2
00:00:06,000 --> 00:00:08,000
CUE TWO

3
00:00:11,000 --> 00:00:13,000
CUE THREE
"""


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def generate(directory):
    directory.mkdir(parents=True, exist_ok=False)
    subtitles = directory / "cues.srt"
    subtitles.write_text(SUBTITLES, encoding="utf-8")
    media = directory / "av-cues-v1.mkv"
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
               "-f", "lavfi", "-i", "color=c=red:s=320x180:r=25:d=5",
               "-f", "lavfi", "-i", "color=c=green:s=320x180:r=25:d=5",
               "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=25:d=5",
               "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=15",
               "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=15",
               "-i", str(subtitles), "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
               "-map", "[v]", "-map", "3:a", "-map", "4:a", "-map", "5:s",
               "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact",
               "-flags:a", "+bitexact", "-c:v", "mpeg4", "-q:v", "2", "-g", "25",
               "-threads:v", "1", "-c:a", "pcm_s16le", "-c:s", "srt",
               "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=deu",
               "-metadata:s:s:0", "language=eng", "-t", "15", str(media)]
    subprocess.run(command, check=True, timeout=60, capture_output=True)
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                            "-of", "json", str(media)], check=True, capture_output=True,
                           text=True, timeout=10)
    info = json.loads(probe.stdout)
    streams = info["streams"]
    if ([s["codec_type"] for s in streams] != ["video", "audio", "audio", "subtitle"]
            or abs(float(info["format"]["duration"]) - 15) >= 0.05):
        raise ValueError("invalid_generated_streams")
    version = subprocess.run(["ffmpeg", "-version"], check=True, capture_output=True,
                             text=True, timeout=10).stdout.splitlines()[0]
    manifest = {"schema": "prexu.probe.fixtures", "version": 1, "fixture": "av-cues-v1",
                "provenance": "Generated mathematical color/sine sources and original cue text; CC0-1.0",
                "generator": version, "durationMs": 15000,
                "files": {p.name: digest(p) for p in (media, subtitles)},
                "videoCues": [{"startMs": 0, "endMs": 5000, "color": "red"},
                              {"startMs": 5000, "endMs": 10000, "color": "green"},
                              {"startMs": 10000, "endMs": 15000, "color": "blue"}],
                "audioTracks": [{"mpvId": 1, "streamIndex": 1, "frequencyHz": 440},
                                {"mpvId": 2, "streamIndex": 2, "frequencyHz": 880}],
                "subtitleTracks": [{"mpvId": 1, "streamIndex": 3,
                                    "cueIntervalsMs": [[1000, 3000], [6000, 8000], [11000, 13000]]}]}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def verify(directory):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if (type(manifest) is not dict or manifest.get("schema") != "prexu.probe.fixtures" or manifest.get("version") != 1
            or manifest.get("fixture") != "av-cues-v1"
            or set(manifest.get("files", {})) != {"av-cues-v1.mkv", "cues.srt"}):
        raise ValueError("invalid_fixture_manifest")
    for name, expected in manifest["files"].items():
        path = directory / name
        if path.is_symlink() or digest(path) != expected:
            raise ValueError("fixture_hash_mismatch")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    try:
        manifest = verify(args.directory) if args.verify else generate(args.directory)
        print(json.dumps(manifest, indent=2))
    except (OSError, ValueError, AssertionError, subprocess.SubprocessError):
        # External tool diagnostics can contain paths; only a stable code leaves this CLI.
        print(json.dumps({"status": "fail", "code": "fixture_failed"}))
        raise SystemExit(1)
