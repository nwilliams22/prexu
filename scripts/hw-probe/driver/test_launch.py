"""Real child-process controls. Synthetic executables are not desktop evidence."""
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from fixtures import digest
from launch import launch, run_child
from test_contract import script_and_trace


@unittest.skipUnless(sys.platform == 'linux', 'Linux process-group launcher')
class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.fixtures = self.root / 'fixtures'
        self.fixtures.mkdir()
        for name in ('av-cues-v1.mkv', 'cues.srt'):
            (self.fixtures / name).write_bytes(b'synthetic transport bytes')
        (self.fixtures / 'manifest.json').write_text(json.dumps({
            'schema': 'prexu.probe.fixtures', 'version': 1, 'fixture': 'av-cues-v1',
            'files': {name: digest(self.fixtures / name)
                      for name in ('av-cues-v1.mkv', 'cues.srt')}}))
        script, self.events = script_and_trace()
        self.script = self.root / 'input.json'
        self.script.write_text(json.dumps(script))
        self.app = self.root / 'app'
        self.output = self.root / 'run'

    def executable(self, body):
        self.app.write_text('#!' + sys.executable + '\n' + body)
        self.app.chmod(0o700)

    def run_probe(self):
        return launch(self.app, self.script, self.fixtures, self.output, 'a' * 40)

    def trace_app(self, exit_code=0):
        self.executable('''import json, os
from pathlib import Path
from urllib.request import urlopen
script = json.loads(Path(os.environ['PREXU_PROBE_SCRIPT']).read_text())
assert 'PRIVATE_TEST_SECRET' not in os.environ
assert not Path(os.environ['PREXU_PROBE_STATE_DIR']).exists()
output = Path(os.environ['PREXU_PROBE_OUTPUT_DIR'])
output.mkdir()
with urlopen('http://127.0.0.1:' + os.environ['PREXU_PROBE_FIXTURE_PORT'] + '/identity', timeout=2) as response:
    assert response.status == 200
''' + 'events = ' + repr(self.events) + '''
for event in events:
    event['runId'] = script['runId']
(output / 'events.jsonl').write_text('\\n'.join(json.dumps(e) for e in events))
''' + f'raise SystemExit({exit_code})\n')

    def test_actual_exit_and_generated_identity(self):
        self.trace_app()
        with patch.dict(os.environ, {'PRIVATE_TEST_SECRET': 'must-not-reach-child'}):
            result = self.run_probe()
        self.assertEqual(result['status'], 'pass')
        saved_script = json.loads((self.output / 'script.json').read_text())
        self.assertNotEqual(saved_script['runId'], 'selftest')
        manifest = json.loads((self.output / 'manifest.json').read_text())
        self.assertEqual(manifest['scriptSha256'], digest(self.output / 'script.json'))
        self.assertEqual(manifest['runId'], saved_script['runId'])
        self.assertEqual(json.loads((self.output / 'process.json').read_text()),
                         {'exitCode': 0, 'timedOut': False})
        before = (self.output / 'verdict.json').read_bytes()
        with self.assertRaises(FileExistsError):
            self.run_probe()
        self.assertEqual((self.output / 'verdict.json').read_bytes(), before)

    def test_nonzero_exit_rejects_complete_success_markers(self):
        self.trace_app(7)
        result = self.run_probe()
        self.assertEqual(result['status'], 'fail')
        self.assertIn('process_failed', result['codes'])
        self.assertEqual(json.loads((self.output / 'process.json').read_text())['exitCode'], 7)

    def test_missing_trace_and_missing_executable_fail_closed(self):
        self.executable('pass\n')
        self.assertEqual(self.run_probe()['status'], 'fail')
        self.output = self.root / 'run2'
        self.app.unlink()
        self.assertEqual(self.run_probe()['codes'], ['launch_failed'])

    def test_invalid_script_and_corrupt_fixture_never_start_child(self):
        marker = self.root / 'started'
        self.executable(f'from pathlib import Path\nPath({str(marker)!r}).touch()\n')
        original = self.script.read_text()
        self.script.write_text('{}')
        self.assertEqual(self.run_probe()['status'], 'fail')
        self.assertFalse(marker.exists())
        self.script.write_text(original)
        self.output = self.root / 'run2'
        (self.fixtures / 'av-cues-v1.mkv').write_bytes(b'corrupt')
        self.assertEqual(self.run_probe()['status'], 'fail')
        self.assertFalse(marker.exists())

    def test_timeout_writes_failure_verdict_and_process_record(self):
        self.executable('import time\ntime.sleep(60)\n')
        with patch('launch.run_child', side_effect=lambda app, env, log, timeout:
                   run_child(app, env, log, 0.05)):
            result = self.run_probe()
        self.assertEqual(result['status'], 'fail')
        self.assertEqual(result['codes'], ['process_timeout'])
        self.assertEqual(json.loads((self.output / 'verdict.json').read_text()), result)
        self.assertEqual(json.loads((self.output / 'process.json').read_text()),
                         {'exitCode': None, 'timedOut': True})

    def test_watchdog_kills_child_and_descendant(self):
        pidfile = self.root / 'pids'
        self.executable(f'''import os, signal, time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
child = os.fork()
if child:
    Path({str(pidfile)!r}).write_text(str(os.getpid()) + ' ' + str(child))
time.sleep(60)
''')
        with (self.root / 'log').open('wb') as log:
            code, timed_out = run_child(self.app, {}, log, 0.5)
        self.assertTrue(timed_out)
        self.assertIsNone(code)
        pids = [int(value) for value in pidfile.read_text().split()]
        self.addCleanup(self.remove_survivors, pids)
        for pid in pids:
            for _ in range(100):
                stat = Path(f'/proc/{pid}/stat')
                if not stat.exists() or stat.read_text().split()[2] == 'Z':
                    break
                time.sleep(0.01)
            else:
                self.fail('watchdog left a running process')

    @staticmethod
    def remove_survivors(pids):
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
