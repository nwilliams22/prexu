"""Exercise bootstrap recovery without installing packages on the developer host."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("install-playwright-deps.sh")


class BootstrapTests(unittest.TestCase):
    def run_bootstrap(self, statuses):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sudo = root / "sudo"
            sudo.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ["BOOTSTRAP_TEST_DIR"])
log = root / "calls"
calls = log.read_text().splitlines() if log.exists() else []
config = next(a.split("=", 1)[1] for a in sys.argv if a.startswith("APT_CONFIG="))
with log.open("a") as out:
    out.write(json.dumps({"args": sys.argv[1:], "config": pathlib.Path(config).read_text(), "path": config}) + "\\n")
statuses = json.loads(os.environ["BOOTSTRAP_TEST_STATUSES"])
sys.exit(statuses[min(len(calls), len(statuses) - 1)])
''')
            sudo.chmod(0o755)
            sleeper = root / "sleep"
            sleeper.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOTSTRAP_TEST_DIR/sleeps"\n')
            sleeper.chmod(0o755)
            result = subprocess.run(
                ["bash", str(SCRIPT)], capture_output=True, text=True, timeout=5,
                env={**os.environ, "BASH_ENV": "/dev/null", "PATH": f"{root}:{os.environ['PATH']}",
                     "BOOTSTRAP_TEST_DIR": directory,
                     "BOOTSTRAP_TEST_STATUSES": json.dumps(statuses)},
            )
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()]
            sleeps = (root / "sleeps").read_text() if (root / "sleeps").exists() else ""
            for call in calls:
                self.assertFalse(Path(call["path"]).exists(), "temporary apt config leaked")
                self.assertEqual(call["args"][:5], ["-n", "timeout", "--kill-after=10s", "180s", "env"])
                self.assertEqual(call["args"][-3:], ["node_modules/playwright/cli.js", "install-deps", "chromium"])
                for option in ['Acquire::Retries "0";', 'Acquire::http::Timeout "20";',
                               'Acquire::https::Timeout "20";', 'APT::Update::Error-Mode "any";',
                               'DPkg::Lock::Timeout "30";']:
                    self.assertIn(option, call["config"])
            return result, calls, sleeps

    def test_success_needs_no_retry(self):
        result, calls, sleeps = self.run_bootstrap([0])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, "")

    def test_mirror_failure_recovers(self):
        result, calls, sleeps = self.run_bootstrap([100, 0])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, "10\n")
        self.assertIn("mirror DNS/HTTP failures", result.stdout)

    def test_persistent_failure_blocks_browser_tests(self):
        result, calls, sleeps = self.run_bootstrap([100])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(sleeps, "10\n")
        self.assertIn("::error::", result.stdout)

    def test_hung_attempts_are_not_success(self):
        for status in (124, 137):
            with self.subTest(status=status):
                result, calls, _ = self.run_bootstrap([status])
                self.assertEqual(result.returncode, 1)
                self.assertEqual(len(calls), 2)
                self.assertIn(f"exit {status}", result.stdout)


if __name__ == "__main__":
    unittest.main()
