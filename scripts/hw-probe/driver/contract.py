"""Pure v1 script and trace validation. No process, filesystem or network access."""

import json
import math
import re

MAX_SCRIPT_BYTES = 1024 * 1024
MAX_EVENTS = 2 * 256 + 6
ID = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
CODES = frozenset({"invalid_script", "unsupported_action", "step_timeout",
                   "predicate_failed", "player_error", "cleanup_failed"})
BASE = {"schema", "version", "runId", "seq", "elapsedMs", "event"}


class Invalid(ValueError):
    """A stable failure code; never includes untrusted input."""


def require(condition, code):
    if not condition:
        raise Invalid(code)


def fields(value, required, optional=()):
    require(type(value) is dict and set(required) <= value.keys()
            and value.keys() <= set(required) | set(optional), "invalid_fields")


def number(value, minimum, maximum):
    return (type(value) in (int, float) and (type(value) is int or math.isfinite(value))
            and minimum <= value <= maximum)


def identifier(value):
    return type(value) is str and ID.fullmatch(value) is not None


def bounded_text(raw, limit):
    require(type(raw) is str, "invalid_encoding")
    try:
        require(len(raw.encode("utf-8")) <= limit, "input_size")
    except UnicodeError:
        raise Invalid("invalid_encoding") from None


def decode(raw, limit=MAX_SCRIPT_BYTES):
    bounded_text(raw, limit)

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate_field")
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(Invalid("invalid_number")))
    except (ValueError, RecursionError) as exc:
        if isinstance(exc, Invalid):
            raise
        raise Invalid("invalid_json") from None


def validate_script(script):
    fields(script, {"schema", "version", "runId", "fixture", "timeoutMs", "steps"})
    require(script["schema"] == "prexu.probe.script" and type(script["version"]) is int
            and script["version"] == 1, "invalid_schema")
    require(identifier(script["runId"]) and script["fixture"] == "av-cues-v1", "invalid_identity")
    require(number(script["timeoutMs"], 1, 900000), "invalid_timeout")
    steps = script["steps"]
    require(type(steps) is list and 1 <= len(steps) <= 256, "invalid_steps")
    seen = set()
    active = False
    paused = False
    for index, step in enumerate(steps):
        fields(step, {"id", "action", "timeoutMs"}, {"args"})
        require(identifier(step["id"]) and step["id"] not in seen, "invalid_step_id")
        seen.add(step["id"])
        require(number(step["timeoutMs"], 1, 120000), "invalid_timeout")
        args = step.get("args", {})
        action = step["action"]
        require(type(action) is str, "unsupported_action")
        if action == "play":
            fields(args, {"mediaId"})
            require(args["mediaId"] == script["fixture"] and not active, "invalid_sequence")
            active = True
            paused = False
        elif action == "seek":
            fields(args, {"positionMs", "toleranceMs"})
            require(number(args["positionMs"], 0, 15000)
                    and number(args["toleranceMs"], 0, 2000), "invalid_args")
            require(active, "invalid_sequence")
        elif action in {"pause", "resume", "stop"}:
            fields(args, set())
            require(active, "invalid_sequence")
            if action != "stop":
                require(paused == (action == "resume"), "invalid_sequence")
                paused = action == "pause"
            else:
                active = False
        elif action in {"selectAudio", "selectSubtitle"}:
            fields(args, {"trackId"})
            require(type(args["trackId"]) is int and args["trackId"] in
                    ({1, 2} if action == "selectAudio" else {0, 1}), "invalid_args")
            require(active, "invalid_sequence")
        elif action in {"fullscreen", "miniPlayer", "popout"}:
            fields(args, {"enabled"})
            require(type(args["enabled"]) is bool, "invalid_args")
            require(active, "invalid_sequence")
        elif action == "wait":
            fields(args, {"durationMs"})
            require(number(args["durationMs"], 1, step["timeoutMs"]), "invalid_args")
        elif action == "navigate":
            fields(args, {"route"})
            require(args["route"] in ("/", "/settings"), "invalid_args")
        elif action == "setSetting":
            fields(args, {"name", "value"})
            require(args["name"] == "volume" and number(args["value"], 0, 100), "invalid_args")
        elif action in {"windowMinimize", "windowRestore", "quit"}:
            fields(args, set())
            if action == "quit":
                require(index == len(steps) - 1 and not active, "invalid_sequence")
        else:
            raise Invalid("unsupported_action")
    require(steps[-1]["action"] == "quit", "missing_quit")
    return script


def observation(step, observed):
    """Validate both the allowlist and the action's completion predicate."""
    action = step["action"]
    args = step.get("args", {})
    if action == "play":
        fields(observed, {"loaded", "positionMs"})
        ok = observed["loaded"] is True and number(observed["positionMs"], 1, 15000)
    elif action == "seek":
        fields(observed, {"positionMs"})
        ok = (number(observed["positionMs"], 0, 17000) and
              abs(observed["positionMs"] - args["positionMs"]) <= args["toleranceMs"])
    elif action in {"pause", "resume"}:
        fields(observed, {"paused"})
        ok = observed["paused"] is (action == "pause")
    elif action in {"selectAudio", "selectSubtitle"}:
        fields(observed, {"trackId"})
        ok = type(observed["trackId"]) is int and observed["trackId"] == args["trackId"]
    elif action in {"fullscreen", "miniPlayer", "popout"}:
        fields(observed, {"enabled"})
        ok = observed["enabled"] is args["enabled"]
    elif action in {"windowMinimize", "windowRestore"}:
        fields(observed, {"minimized"})
        ok = observed["minimized"] is (action == "windowMinimize")
    elif action == "stop":
        fields(observed, {"sessionCleared", "idle"})
        ok = observed["sessionCleared"] is True and observed["idle"] is True
    elif action == "wait":
        fields(observed, {"durationMs"})
        ok = number(observed["durationMs"], args["durationMs"], step["timeoutMs"])
    elif action == "navigate":
        fields(observed, {"route"})
        ok = observed["route"] == args["route"]
    elif action == "setSetting":
        fields(observed, {"name", "value"})
        ok = (observed["name"] == args["name"] and number(observed["value"], 0, 100)
              and observed["value"] == args["value"])
    else:  # quit
        fields(observed, {"ready"})
        ok = observed["ready"] is True
    require(ok, "predicate_failed")


def verdict(script, raw_events, exit_code):
    """Only a complete, ordered, bounded success trace and exit 0 may pass."""
    result = {"schema": "prexu.probe.verdict", "version": 1, "runId": None,
              "status": "fail", "steps": [], "codes": [],
              "evidenceScope": "control-state-only; no visible-video or audible-audio proof"}
    try:
        validate_script(script)
        result["runId"] = script["runId"]
        bounded_text(raw_events, 2 * MAX_SCRIPT_BYTES)
        lines = raw_events.splitlines()
        require(0 < len(lines) <= MAX_EVENTS, "invalid_event_count")
        events = [decode(line, 4096) for line in lines]
        last_time = 0
        for seq, event in enumerate(events, 1):
            require(type(event) is dict and BASE <= event.keys(), "invalid_event")
            require(event["schema"] == "prexu.probe.event" and type(event["version"]) is int
                    and event["version"] == 1, "invalid_schema")
            require(event["runId"] == script["runId"], "wrong_run")
            require(type(event["seq"]) is int and event["seq"] == seq, "invalid_sequence")
            require(number(event["elapsedMs"], last_time, script["timeoutMs"] + 10000), "invalid_time")
            last_time = event["elapsedMs"]
            if event["event"] in ("step.error", "run.error"):
                fields(event, BASE | {"code"} | ({"stepId", "action"} if event["event"] == "step.error" else set()))
                require(type(event["code"]) is str and event["code"] in CODES, "invalid_error")
                raise Invalid(event["code"])
        cursor = 0

        def take(kind, extra=()):
            nonlocal cursor
            require(cursor < len(events), "missing_event")
            event = events[cursor]
            fields(event, BASE | set(extra))
            require(event["event"] == kind, "unexpected_event")
            cursor += 1
            return event

        take("run.begin")
        for step in script["steps"]:
            begin = take("step.begin", {"stepId", "action"})
            end = take("step.end", {"stepId", "action", "observed"})
            for event in (begin, end):
                require(event["stepId"] == step["id"] and event["action"] == step["action"], "wrong_step")
                require(event["elapsedMs"] <= script["timeoutMs"], "run_timeout")
            require(end["elapsedMs"] - begin["elapsedMs"] <= step["timeoutMs"], "step_timeout")
            observation(step, end["observed"])
            result["steps"].append({"id": step["id"], "action": step["action"], "status": "pass"})
        cleanup = take("cleanup.begin")
        clean_end = take("cleanup.end")
        terminal = take("run.end", {"status"})
        require(terminal["elapsedMs"] - cleanup["elapsedMs"] <= 10000, "cleanup_timeout")
        require(clean_end["elapsedMs"] >= cleanup["elapsedMs"], "invalid_time")
        require(terminal["status"] == "pass", "run_failed")
        require(cursor == len(events), "trailing_event")
        require(type(exit_code) is int and exit_code == 0, "process_failed")
        result["status"] = "pass"
    except Invalid as exc:
        result["codes"].append(str(exc))
    return result
