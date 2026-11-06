"""Negative controls for v1 traces; synthetic traces are not desktop evidence."""
import copy
import json
import unittest
from pathlib import Path

from contract import Invalid, decode, validate_script, verdict


def script_and_trace():
    script = {"schema": "prexu.probe.script", "version": 1, "runId": "selftest",
              "fixture": "av-cues-v1", "timeoutMs": 90000, "steps": [
                  {"id": "play", "action": "play", "timeoutMs": 15000,
                   "args": {"mediaId": "av-cues-v1"}},
                  {"id": "seek", "action": "seek", "timeoutMs": 5000,
                   "args": {"positionMs": 2000, "toleranceMs": 500}},
                  {"id": "stop", "action": "stop", "timeoutMs": 5000},
                  {"id": "quit", "action": "quit", "timeoutMs": 5000}]}
    events = []

    def add(event, **extra):
        events.append({"schema": "prexu.probe.event", "version": 1,
                       "runId": "selftest", "seq": len(events) + 1,
                       "elapsedMs": len(events) * 100, "event": event, **extra})
    add("run.begin")
    for step, observed in zip(script["steps"], [
            {"loaded": True, "positionMs": 320}, {"positionMs": 2100},
            {"sessionCleared": True, "idle": True}, {"ready": True}]):
        add("step.begin", stepId=step["id"], action=step["action"])
        add("step.end", stepId=step["id"], action=step["action"], observed=observed)
    add("cleanup.begin")
    add("cleanup.end")
    add("run.end", status="pass")
    return script, events


def check(script, events, exit_code=0):
    return verdict(script, "\n".join(json.dumps(e) for e in events), exit_code)


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.script, self.events = script_and_trace()

    def test_shared_native_script_corpus(self):
        cases = json.loads(Path(__file__).with_name("script-corpus.json").read_text())
        for case in cases:
            with self.subTest(name=case["name"]):
                if case["valid"]:
                    validate_script(decode(case["raw"]))
                else:
                    with self.assertRaises(Invalid):
                        validate_script(decode(case["raw"]))

    def test_complete_trace(self):
        self.assertEqual(check(self.script, self.events)["status"], "pass")

    def test_every_missing_or_duplicate_event_fails(self):
        for index in range(len(self.events)):
            with self.subTest(index=index):
                missing = copy.deepcopy(self.events)
                del missing[index]
                duplicate = copy.deepcopy(self.events)
                duplicate.insert(index, duplicate[index])
                for events in (missing, duplicate):
                    # Renumbering cannot hide missing protocol states.
                    for seq, event in enumerate(events, 1):
                        event["seq"] = seq
                    self.assertEqual(check(self.script, events)["status"], "fail")

    def test_reordered_events(self):
        self.events[1], self.events[2] = self.events[2], self.events[1]
        self.assertEqual(check(self.script, self.events)["status"], "fail")

    def test_cleanup_order_with_valid_sequence_numbers(self):
        self.events[-3]["event"] = "cleanup.end"
        self.events[-2]["event"] = "cleanup.begin"
        self.assertIn("unexpected_event", check(self.script, self.events)["codes"])

    def test_event_mutations(self):
        mutations = [("schema", "wrong"), ("version", True), ("runId", "other"),
                     ("seq", 900), ("elapsedMs", -1), ("elapsedMs", float("nan")),
                     ("stepId", "wrong"), ("action", "quit"), ("url", "private")]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                events = copy.deepcopy(self.events)
                events[2][key] = value
                self.assertEqual(check(self.script, events)["status"], "fail")

    def test_predicates_and_redaction(self):
        for observed in ({"loaded": False, "positionMs": 320},
                         {"loaded": True, "positionMs": 0},
                         {"loaded": True, "positionMs": True},
                         {"loaded": True, "positionMs": 320, "token": "secret"}):
            self.events[2]["observed"] = observed
            result = check(self.script, self.events)
            self.assertEqual(result["status"], "fail")
            self.assertNotIn("secret", json.dumps(result))
        self.script, self.events = script_and_trace()
        self.events[4]["observed"]["positionMs"] = 9000
        self.assertIn("predicate_failed", check(self.script, self.events)["codes"])

    def test_process_failure(self):
        for code in (None, True, -9, 1):
            self.assertIn("process_failed", check(self.script, self.events, code)["codes"])

    def test_failure_marker(self):
        self.events[2] = {k: v for k, v in self.events[2].items() if k != "observed"}
        self.events[2].update(event="step.error", code="unsupported_action")
        self.assertIn("unsupported_action", check(self.script, self.events)["codes"])

    def test_decreasing_time(self):
        self.events[3]["elapsedMs"] = 0
        self.assertIn("invalid_time", check(self.script, self.events)["codes"])

    def test_timeouts(self):
        self.script["steps"][0]["timeoutMs"] = 1
        self.assertIn("step_timeout", check(self.script, self.events)["codes"])
        self.script, self.events = script_and_trace()
        self.events[-1]["elapsedMs"] = 11000
        self.assertIn("cleanup_timeout", check(self.script, self.events)["codes"])
        self.script["timeoutMs"] = 1
        self.assertEqual(check(self.script, self.events)["status"], "fail")

    def test_bad_json(self):
        for raw in ('{', '{}\n', '{"a":1,"a":2}', '{"a":NaN}'):
            if raw == '{}\n':
                self.assertEqual(verdict(self.script, raw, 0)["status"], "fail")
            else:
                with self.assertRaises(Invalid):
                    decode(raw)

    def test_invalid_scripts(self):
        for key, value in (("version", 2), ("version", True), ("runId", "../escape"),
                           ("timeoutMs", float("inf")), ("steps", []), ("unknown", 1)):
            script = copy.deepcopy(self.script)
            script[key] = value
            with self.subTest(key=key), self.assertRaises(Invalid):
                validate_script(script)
        self.script["steps"][1]["id"] = "play"
        with self.assertRaises(Invalid):
            validate_script(self.script)

    def test_invalid_actions_sequences_and_args(self):
        for action, args in (("eval", {}), ("seek", {"positionMs": -1, "toleranceMs": 0}),
                             ("play", {"mediaId": "av-cues-v1"}),
                             ("resume", {}), ("setSetting", {"name": "token", "value": "x"})):
            script = copy.deepcopy(self.script)
            script["steps"][1].update(action=action, args=args)
            with self.subTest(action=action), self.assertRaises(Invalid):
                validate_script(script)

    def test_all_actions(self):
        # Exercise the completion predicate of every supported action.
        from contract import observation
        cases = [("pause", {}, {"paused": True}), ("resume", {}, {"paused": False}),
                 ("selectAudio", {"trackId": 2}, {"trackId": 2}),
                 ("selectSubtitle", {"trackId": 0}, {"trackId": 0}),
                 ("windowMinimize", {}, {"minimized": True}),
                 ("windowRestore", {}, {"minimized": False}),
                 ("wait", {"durationMs": 100}, {"durationMs": 100}),
                 ("navigate", {"route": "/settings"}, {"route": "/settings"}),
                 ("setSetting", {"name": "volume", "value": 30}, {"name": "volume", "value": 30})]
        cases += [(a, {"enabled": True}, {"enabled": True})
                  for a in ("fullscreen", "miniPlayer", "popout")]
        for action, args, observed in cases:
            with self.subTest(action=action):
                step = {"action": action, "args": args, "timeoutMs": 5000}
                observation(step, observed)
                with self.assertRaises(Invalid):
                    observation(step, {})


class CommandTests(unittest.TestCase):
    def test_cli_pass_fail_and_exclusive_output(self):
        import pathlib
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            script, events = script_and_trace()
            (root / "script.json").write_text(json.dumps(script))
            (root / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events))
            command = [sys.executable, str(pathlib.Path(__file__).with_name("check.py")),
                       "--script", str(root / "script.json"), "--events", str(root / "events.jsonl"),
                       "--exit-code", "0", "--output", str(root / "pass.json")]
            process = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertEqual(json.loads((root / "pass.json").read_text())["status"], "pass")
            original = (root / "pass.json").read_bytes()
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)
            self.assertEqual((root / "pass.json").read_bytes(), original)
            (root / "events.jsonl").write_text("\n".join(json.dumps(e) for e in events[:-1]))
            command[-1] = str(root / "fail.json")
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)
            self.assertEqual(json.loads((root / "fail.json").read_text())["status"], "fail")
            (root / "events.jsonl").unlink()
            command[-1] = str(root / "missing.json")
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 1)
            self.assertEqual(json.loads((root / "missing.json").read_text())["codes"], ["input_unavailable"])


if __name__ == "__main__":
    unittest.main()
