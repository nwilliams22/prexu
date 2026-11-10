"""Recorder failure controls; real native acceptance is a separate desktop run."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from contract import Invalid
from launch import run_child
from record import Recorder


@unittest.skipUnless(sys.platform == 'linux', 'Linux capture stage')
class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_missing_session_and_wayland_are_not_passes(self):
        for env, code in [({}, 'no_graphical_session'),
                          ({'WAYLAND_DISPLAY': 'wayland-test'}, 'capture_wayland_unsupported')]:
            with self.subTest(code=code), patch.dict(os.environ, env, clear=True):
                recorder = Recorder(self.root)
                with self.assertRaisesRegex(Invalid, code):
                    recorder.start()
                recorder.close()
                self.assertTrue((self.root / 'capture-observations.json').exists())

    def test_recording_failure_kills_running_app(self):
        recorder = Mock()
        recorder.tick.side_effect = Invalid('capture_failed')
        pid = self.root / 'pid'
        app = self.root / 'app'
        app.write_text('#!/bin/sh\necho $$ > "$PID_FILE"\nexec sleep 60\n')
        app.chmod(0o700)
        def tick(process):
            self.pid = process.pid
            raise Invalid('capture_failed')
        recorder.tick.side_effect = tick
        with (self.root / 'log').open('wb') as log:
            with self.assertRaisesRegex(Invalid, 'capture_failed'):
                run_child(app, {'PATH': os.environ['PATH'], 'PID_FILE': str(pid)}, log, 10, recorder)
        with self.assertRaises(ProcessLookupError):
            os.kill(self.pid, 0)

    def test_wrong_display_screenshot_rejected(self):
        recorder = Recorder(self.root)
        recorder.stamp = Mock(width=1280)
        with patch('record.command', side_effect=[b'import\n', b'old']):
            with self.assertRaisesRegex(Invalid, 'capture_not_current_display'):
                recorder.screenshot('frame.png', b'new')

    @unittest.skipUnless(__import__('shutil').which('ffmpeg'), 'requires ffmpeg')
    def test_real_stale_video_rejected(self):
        video = self.root / 'desktop.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'color=red:size=32x32:duration=0.3', '-c:v', 'ffv1',
                        '-threads', '1', str(video)], check=True)
        recorder = Recorder(self.root)
        recorder.stamp = Mock(width=32, height=32)
        recorder.first = b'\xff\x00\x00'
        recorder.stamp.color.return_value = b'\x00\xff\x00'
        recorder.screenshot = Mock()
        with self.assertRaisesRegex(Invalid, 'capture_stale_frames'):
            recorder.finish()

    @unittest.skipUnless(__import__('shutil').which('ffmpeg'), 'requires ffmpeg')
    def test_corrupt_video_is_never_accepted(self):
        (self.root / 'desktop.mkv').write_bytes(b'not a video')
        recorder = Recorder(self.root)
        recorder.stamp = Mock(width=32, height=32)
        recorder.screenshot = Mock()
        with self.assertRaisesRegex(Invalid, 'capture_failed'):
            recorder.finish()
