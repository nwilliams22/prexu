"""Copy the authorized QA pattern, preserving encoded frames in a ten-minute loop."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET

folder = pathlib.Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
client = "prexu-composition-fixture"

def request(url, token):
    return urllib.request.urlopen(urllib.request.Request(url, headers={
        "X-Plex-Token": token, "X-Plex-Client-Identifier": client,
    }), timeout=60)

try:
    with request("https://plex.tv/api/resources?includeHttps=1", os.environ["PREXU_QA_PLEX_AUTH"]) as response:
        resources = ET.fromstring(response.read())
    server = next(d for d in resources if d.get("name") == "Prexu QA Test Server" and d.get("provides") == "server")
    metadata = None
    for connection in sorted(server.findall("Connection"), key=lambda c: c.get("local") == "1"):
        try:
            base = connection.get("uri")
            with request(base + "/library/metadata/2", server.get("accessToken")) as response:
                metadata = ET.fromstring(response.read())
            break
        except Exception:
            continue
    if metadata is None:
        raise RuntimeError("QA server unreachable")
    video = metadata.find("Video")
    if video is None or video.get("title") != "Prexu QA Pattern":
        raise RuntimeError("QA pattern identity mismatch")
    part = video.find("Media/Part")
    source = folder / "pattern-source.mp4"
    with request(base + part.get("key"), server.get("accessToken")) as response, source.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    target = folder / "pattern-loop.mkv"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-stream_loop", "9", "-i", str(source), "-map", "0", "-c", "copy", str(target)], check=True)
    duration = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(target)]))
    if duration < 590:
        raise RuntimeError("Looped fixture is too short")
    def digest(path):
        with path.open("rb") as file:
            return hashlib.file_digest(file, "sha256").hexdigest()
    (folder / "fixture.json").write_text(json.dumps({"title": "Prexu QA Pattern", "ratingKey": "2", "copies": 10, "codecOperation": "stream copy; no re-encoding", "sourceSha256": digest(source), "loopSha256": digest(target), "durationSeconds": duration}, indent=2) + "\n")
except Exception as error:
    # Requests carry credentials in headers; never print their response or URL.
    raise SystemExit("QA fixture preparation failed: " + type(error).__name__) from None
