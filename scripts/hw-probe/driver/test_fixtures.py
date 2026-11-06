"""Manifest checks without requiring ffmpeg or libmpv."""
import json
from pathlib import Path
import tempfile
import unittest

from fixtures import digest, verify


class FixtureManifestTests(unittest.TestCase):
    def test_hashes_and_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('av-cues-v1.mkv', 'cues.srt'):
                (root / name).write_bytes(b'synthetic test data')
            manifest = {"schema": "prexu.probe.fixtures", "version": 1, "fixture": "av-cues-v1",
                        "files": {name: digest(root / name) for name in ('av-cues-v1.mkv', 'cues.srt')}}
            (root / 'manifest.json').write_text(json.dumps(manifest))
            self.assertEqual(verify(root), manifest)
            (root / 'av-cues-v1.mkv').write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'fixture_hash_mismatch'):
                verify(root)

    def test_manifest_cannot_escape_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({
                "schema": "prexu.probe.fixtures", "version": 1, "fixture": "av-cues-v1",
                "files": {"../secret": "ignored"}}))
            with self.assertRaisesRegex(ValueError, 'invalid_fixture_manifest'):
                verify(root)
