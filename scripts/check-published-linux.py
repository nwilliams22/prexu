#!/usr/bin/env python3
"""Check published x86_64 Linux release assets; no rpm Python/module dependency."""
import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile

REPO = 'nwilliams22/prexu'
PLATFORMS = {'linux-x86_64', 'linux-x86_64-appimage', 'linux-x86_64-rpm',
             'windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def passed(message):
    print(f'PASS {message}', flush=True)


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True,
                          timeout=300, **kwargs).stdout


def download(url, path):
    status = run(['curl', '--silent', '--show-error', '--fail', '--location',
                  '--proto', '=https', '--proto-redir', '=https',
                  '--connect-timeout', '30', '--max-time', '240',
                  '--output', str(path), '--write-out', '%{http_code}', url])
    require(status == '200', f'{path.name}: expected HTTP 200, got {status}')
    passed(f'{path.name}: HTTP 200')


def check_digest(path, digest):
    require(isinstance(digest, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', digest),
            f'{path.name}: missing/unsupported release API digest')
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    require(digest == 'sha256:' + actual, f'{path.name}: SHA-256 mismatch')
    passed(f'{path.name}: SHA-256 {actual}')


def rpm_requires(data):
    # RPM v4 lead, padded signature header, then package header.
    # https://rpm.org/docs/6.0.x/manual/format_v4.html
    # https://rpm.org/docs/latest/manual/tags (REQUIRENAME=1049)
    require(len(data) >= 96 and data[:4] == b'\xed\xab\xee\xdb', 'Invalid rpm lead')

    def header(offset):
        require(data[offset:offset + 8] == b'\x8e\xad\xe8\x01\0\0\0\0'
                and offset + 16 <= len(data), 'Invalid/truncated rpm header')
        count, size = struct.unpack_from('>II', data, offset + 8)
        start = offset + 16 + count * 16
        end = start + size
        require(end <= len(data), 'Truncated rpm index/data')
        return offset + 16, count, start, end

    _, _, _, end = header(96)
    index, count, start, end = header((end + 7) & ~7)
    matches = []
    for i in range(count):
        tag, kind, offset, length = struct.unpack_from('>IIiI', data, index + i * 16)
        if tag != 1049:
            continue
        require(kind == 8 and 0 <= offset < end - start and length > 0,
                'Invalid rpm REQUIRENAME array')
        cursor = start + offset
        names = []
        for _ in range(length):
            stop = data.find(b'\0', cursor, end)
            require(stop > cursor, 'Invalid/truncated rpm requirement string')
            names.append(data[cursor:stop].decode('utf-8'))
            cursor = stop + 1
        matches.append(names)
    require(len(matches) == 1, 'Expected one rpm REQUIRENAME array')
    return set(matches[0])


def check_providers(needed, requirements):
    require('libmpv.so.2' in needed, 'Executable does not need libmpv.so.2')
    for soname in sorted(needed):
        capability = soname + '()(64bit)'
        require(capability in requirements, f'Missing rpm requirement: {capability}')
        passed(f'rpm declares provider capability {capability}')


def packet(encoded, size):
    lines = base64.b64decode(encoded, validate=True).decode('utf-8').splitlines()
    require(len(lines) >= 2 and lines[0].startswith('untrusted comment:'),
            'Invalid minisign envelope')
    raw = base64.b64decode(lines[1], validate=True)
    require(len(raw) == size and raw[:2] in (b'Ed', b'ED'), 'Invalid minisign packet')
    return raw


def check_updater(manifest, version, pubkey, assets):
    require(manifest.get('version') == version, 'latest.json version mismatch')
    platforms = manifest.get('platforms', {})
    require(set(platforms) == PLATFORMS, 'latest.json platform keys mismatch')
    key_id = packet(pubkey, 42)[2:10]
    for platform, entry in sorted(platforms.items()):
        require(entry.get('url') in assets, f'{platform}: URL is not a release asset')
        require(packet(entry.get('signature', ''), 74)[2:10] == key_id,
                f'{platform}: updater signature key ID mismatch')
        passed(f'{platform}: signature key ID {key_id[::-1].hex().upper()}')
    passed(f'latest.json: version {version}, exact six platform keys')


def check_startup(code, log):
    require(code == 124, f'AppImage exited early (status {code}; expected timeout 124)')
    for marker in ('[player] mpv created', '[player:linux] compositor installed'):
        require(marker in log, f'Missing startup marker: {marker}')
        passed(marker)
    require(not re.search(r'VersionMismatch|falling back|fallback to HTML5', log, re.I),
            'Native startup reported version mismatch or fallback')
    passed('30-second native startup: no VersionMismatch or fallback')


def probe_api(root):
    # Runs in a fresh interpreter, without host LD_LIBRARY_PATH, like release.yml.
    libroot = root / 'usr/lib'
    for name in ('avutil', 'swresample', 'swscale', 'avcodec', 'avformat', 'avfilter'):
        paths = sorted(libroot.glob(f'lib{name}.so.*'))
        require(bool(paths), f'Missing bundled lib{name}')
        ctypes.CDLL(str(paths[0]), mode=os.RTLD_GLOBAL)
    lib = ctypes.CDLL(str(libroot / 'libmpv.so.2'))
    lib.mpv_client_api_version.restype = ctypes.c_ulong
    api = lib.mpv_client_api_version()
    require(api >> 16 == 2, f'Bundled mpv client API is {api >> 16}, expected 2')
    passed(f'bundled mpv client API {api >> 16}.{api & 65535}')


def check_release(tag, work, config):
    require(re.fullmatch(r'v\d+\.\d+\.\d+', tag), 'Expected stable release tag vN.N.N')
    for tool in ('curl', 'readelf', 'timeout', 'xvfb-run', 'Xvfb', 'dbus-run-session'):
        require(shutil.which(tool), f'Missing prerequisite: {tool}')
    metadata = work / 'release.json'
    download(f'https://api.github.com/repos/{REPO}/releases/tags/{tag}', metadata)
    release = json.loads(metadata.read_text())
    require(release.get('tag_name') == tag and not release.get('draft'), 'Wrong/unpublished release')
    assets = release['assets']
    selected = []
    for pattern in (r'.*_amd64\.AppImage', r'.*\.x86_64\.rpm', r'latest\.json'):
        matches = [a for a in assets if re.fullmatch(pattern, a['name'])]
        require(len(matches) == 1, f'Expected one release asset matching {pattern}')
        asset = matches[0]
        name = asset['name']
        require(Path(name).name == name, 'Invalid asset filename')
        path = work / name
        download(asset['browser_download_url'], path)
        check_digest(path, asset.get('digest'))
        selected.append(path)
    appimage, rpm, latest = selected
    check_updater(json.loads(latest.read_text()), tag[1:],
                  json.loads(config.read_text())['plugins']['updater']['pubkey'],
                  {a['browser_download_url'] for a in assets})
    appimage.chmod(0o700)
    (work / 'extract.log').write_text(run([str(appimage), '--appimage-extract'], cwd=work))
    root = work / 'squashfs-root'
    require(not list(root.rglob('libmpv.so.1*')), 'Bundle contains libmpv.so.1*')
    require((root / 'usr/lib/libmpv.so.2').is_file(), 'Bundle lacks libmpv.so.2')
    passed('bundle contains libmpv.so.2 and no libmpv.so.1*')
    elf = run(['readelf', '-d', str(root / 'usr/bin/prexu')])
    (work / 'needed.log').write_text(elf)
    needed = set(re.findall(r'\(NEEDED\).*?\[([^\]]+)\]', elf))
    requirements = rpm_requires(rpm.read_bytes())
    (work / 'rpm-requires.log').write_text('\n'.join(sorted(requirements)) + '\n')
    check_providers(needed, requirements)
    env = os.environ.copy()
    for key in ('LD_LIBRARY_PATH', 'LD_PRELOAD', 'WEBKIT_DISABLE_DMABUF_RENDERER',
                'PREXU_STOCK_WEBVIEW', 'PREXU_NO_COMPOSITOR', 'DISPLAY', 'WAYLAND_DISPLAY'):
        env.pop(key, None)
    api = run([sys.executable, str(Path(__file__).resolve()), '--probe-api', str(root)], env=env)
    (work / 'media-runtime.log').write_text(api)
    print(api, end='', flush=True)
    for key, directory in (('HOME', 'home'), ('XDG_CONFIG_HOME', 'config'),
                           ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'),
                           ('XDG_RUNTIME_DIR', 'runtime')):
        path = work / directory
        path.mkdir(mode=0o700)
        env[key] = str(path)
    env.update(LIBGL_ALWAYS_SOFTWARE='1', RUST_LOG='info', GDK_BACKEND='x11')
    with (work / 'native-startup.log').open('w') as log:
        result = subprocess.run(['dbus-run-session', '--', 'timeout', '--kill-after=5s',
                                 '30s', 'xvfb-run', '-a', str(root / 'AppRun')],
                                cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT,
                                timeout=45)
    check_startup(result.returncode, (work / 'native-startup.log').read_text(errors='replace'))
    passed(f'{tag}: published Linux release gate')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag', nargs='?')
    parser.add_argument('--output', type=Path, help='New directory for assets and evidence (must not exist)')
    parser.add_argument('--config', type=Path, default=Path(__file__).resolve().parents[1] / 'src-tauri/tauri.conf.json')
    parser.add_argument('--probe-api', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.probe_api:
            probe_api(args.probe_api)
            return 0
        require(args.tag is not None, 'Release tag is required')
        if args.output:
            args.output.mkdir(parents=True, exist_ok=False)
            work = args.output.resolve()
        else:
            work = Path(tempfile.mkdtemp(prefix='prexu-published-'))
        print(f'Evidence directory: {work}', flush=True)
        check_release(args.tag, work, args.config)
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'FAIL {error}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
