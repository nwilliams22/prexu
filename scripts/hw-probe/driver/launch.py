#!/usr/bin/env python3
"""Launch an isolated Linux desktop probe and verify its actual process output."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid
from urllib.parse import urlsplit

from check import read_bounded
from contract import Invalid, MAX_SCRIPT_BYTES, decode, validate_script, verdict
from fixture_service import serve


# Do not forward service credentials or caller-supplied probe settings.
APP_ENV = ('PATH', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY',
           'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY',
           'LD_LIBRARY_PATH', 'LIBGL_ALWAYS_SOFTWARE', 'GDK_BACKEND',
           'WEBKIT_DISABLE_DMABUF_RENDERER', 'WEBKIT_DISABLE_COMPOSITING_MODE')


def save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def kill_group(process):
    # A dedicated session owns the app and its WebKit children. Kill even after
    # the leader exits, since a crashed leader can leave descendants alive.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def run_child(app, environment, log, timeout):
    process = subprocess.Popen([str(app)], env=environment, stdin=subprocess.DEVNULL,
                               stdout=log, stderr=subprocess.STDOUT,
                               start_new_session=True)
    try:
        try:
            return process.wait(timeout=timeout), False
        except subprocess.TimeoutExpired:
            return None, True
    finally:
        kill_group(process)


def launch(app, script_path, fixtures, root, source_commit):
    """Reserve a fresh evidence directory; never replace an earlier run."""
    root = root.absolute()
    root.mkdir(mode=0o700)  # Caller supplies an existing parent, never a run directory.
    script = None
    exit_code = None
    failure = None
    result = None
    try:
        if sys.platform != 'linux':
            raise Invalid('unsupported_platform')
        if not source_commit or len(source_commit) != 40 or any(
                c not in '0123456789abcdef' for c in source_commit):
            raise Invalid('invalid_source_commit')
        script = decode(read_bounded(script_path, MAX_SCRIPT_BYTES))
        validate_script(script)
        script['runId'] = 'probe-' + uuid.uuid4().hex
        save(root / 'script.json', script)
        home = root / 'home'
        home.mkdir(mode=0o700)
        environment = {key: os.environ[key] for key in APP_ENV if key in os.environ}
        # Xlib's default authority path depends on the original HOME.
        if 'XAUTHORITY' not in environment and os.environ.get('HOME'):
            authority = Path(os.environ['HOME']) / '.Xauthority'
            if authority.is_file():
                environment['XAUTHORITY'] = str(authority)
        environment.update(HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'),
                           XDG_DATA_HOME=str(home / 'data'), XDG_CACHE_HOME=str(home / 'cache'),
                           PREXU_PROBE_SCRIPT=str(root / 'script.json'),
                           PREXU_PROBE_STATE_DIR=str(root / 'state'),
                           PREXU_PROBE_OUTPUT_DIR=str(root / 'output'))
        with serve(fixtures) as service:
            environment['PREXU_PROBE_FIXTURE_PORT'] = str(urlsplit(service['url']).port)
            save(root / 'manifest.json', {
                'schema': 'prexu.probe.run', 'version': 1, 'runId': script['runId'],
                'sourceCommit': source_commit, 'sourceCommitOrigin': 'caller-supplied',
                'scriptSha256': hashlib.sha256((root / 'script.json').read_bytes()).hexdigest(),
                'fixtureManifest': service['manifest'],
                'evidenceScope': 'control-state-only',
            })
            with (root / 'app.log').open('xb') as log:
                exit_code, timed_out = run_child(app.resolve(), environment, log,
                                                script['timeoutMs'] / 1000 + 10)
            save(root / 'process.json', {'exitCode': exit_code, 'timedOut': timed_out})
            if timed_out:
                raise Invalid('process_timeout')
            result = verdict(script, read_bounded(root / 'output' / 'events.jsonl',
                                                 2 * MAX_SCRIPT_BYTES), exit_code)
    except Invalid as exc:
        failure = str(exc)
    except (OSError, ValueError, subprocess.SubprocessError):
        # Never include paths, raw exception text, URLs or environment contents.
        failure = 'launch_failed'
    if result is None:
        result = verdict(script, '', exit_code)
    if failure:
        result['status'] = 'fail'
        result['codes'] = [failure]
    save(root / 'verdict.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--script', required=True, type=Path)
    parser.add_argument('--fixtures', required=True, type=Path)
    parser.add_argument('--run-dir', required=True, type=Path)
    parser.add_argument('--source-commit', required=True,
                        help='40-character revision used to build --app; recorded as caller-supplied')
    args = parser.parse_args()
    try:
        result = launch(args.app, args.script, args.fixtures, args.run_dir, args.source_commit)
    except OSError:
        result = {'status': 'fail', 'codes': ['output_unavailable']}
    print(json.dumps(result, allow_nan=False))
    return 0 if result['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
