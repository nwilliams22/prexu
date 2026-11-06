#!/usr/bin/env python3
"""Check a completed probe trace. Exit zero only for a complete passing verdict."""
import argparse
import json
from pathlib import Path

from contract import Invalid, MAX_SCRIPT_BYTES, decode, verdict


def read_bounded(path, limit):
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise Invalid("input_size")
    try:
        return raw.decode("utf-8")
    except UnicodeError:
        raise Invalid("invalid_encoding") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--script", required=True, type=Path)
    parser.add_argument("--events", required=True, type=Path)
    parser.add_argument("--exit-code", required=True, type=int,
                        help="Actual app process exit status, recorded by the launcher")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        script = decode(read_bounded(args.script, MAX_SCRIPT_BYTES))
        result = verdict(script, read_bounded(args.events, 2 * MAX_SCRIPT_BYTES), args.exit_code)
    except (OSError, Invalid) as exc:
        result = verdict(None, "", args.exit_code)
        result["codes"] = [str(exc) if isinstance(exc, Invalid) else "input_unavailable"]
    serialized = json.dumps(result, allow_nan=False, indent=2) + "\n"
    # Do not overwrite existing evidence, even on a failed run.
    try:
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(serialized)
    except OSError:
        print(json.dumps({"status": "fail", "codes": ["output_unavailable"]}))
        return 1
    print(serialized, end="")
    return 0 if result["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
