"""Offline negative controls for the published release gate."""
import base64
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import shutil
import unittest

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('check-published-linux.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def header(entries, data):
    return b'\x8e\xad\xe8\x01\0\0\0\0' + struct.pack('>II', len(entries), len(data)) + b''.join(
        struct.pack('>IIiI', *entry) for entry in entries) + data


def rpm_fixture(names=('libmpv.so.2()(64bit)',), kind=8, offset=0, count=None):
    lead = b'\xed\xab\xee\xdb' + bytes(92)
    signature = header([], b'pad')
    signature += bytes(-len(signature) % 8)
    data = b''.join(name.encode() + b'\0' for name in names)
    return lead + signature + header([(1049, kind, offset, len(names) if count is None else count)], data)


def encoded_packet(size, key=b'12345678'):
    raw = b'Ed' + key + bytes(size - 10)
    return base64.b64encode(b'untrusted comment: test\n' + base64.b64encode(raw) + b'\n').decode()


class GateTests(unittest.TestCase):
    def test_rpm_signature_padding_and_requirement_array(self):
        self.assertEqual(gate.rpm_requires(rpm_fixture()), {'libmpv.so.2()(64bit)'})

    def test_rpm_rejects_bad_bounds_and_types(self):
        valid = rpm_fixture()
        for data in (b'', valid[:95], valid[:-1], rpm_fixture(kind=6),
                     rpm_fixture(offset=-1), rpm_fixture(offset=1000), rpm_fixture(count=999)):
            with self.subTest(data=data[-20:]), self.assertRaises(ValueError):
                gate.rpm_requires(data)

    def test_each_direct_dependency_needs_a_capability(self):
        with self.assertRaisesRegex(ValueError, 'libssl'):
            gate.check_providers({'libmpv.so.2', 'libssl.so.3'}, {'libmpv.so.2()(64bit)'})
        with self.assertRaisesRegex(ValueError, 'does not need'):
            gate.check_providers({'libmpv.so.1'}, {'libmpv.so.1()(64bit)'})

    def test_digest_is_mandatory_and_detects_corruption(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'asset'
            path.write_bytes(b'abc')
            gate.check_digest(path, 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
            for digest in (None, '', 'md5:abc', 'sha256:' + '0' * 64):
                with self.subTest(digest=digest), self.assertRaises(ValueError):
                    gate.check_digest(path, digest)

    def test_updater_rejects_version_platform_url_and_key_drift(self):
        prefix = 'https://github.com/nwilliams22/prexu/releases/download/v0.8.2/'
        urls = {
            'linux-x86_64': prefix + 'Prexu_0.8.2_amd64.AppImage',
            'linux-x86_64-appimage': prefix + 'Prexu_0.8.2_amd64.AppImage',
            'linux-x86_64-rpm': prefix + 'Prexu-0.8.2-1.x86_64.rpm',
            'windows-x86_64': prefix + 'Prexu_0.8.2_x64_en-US.msi',
            'windows-x86_64-nsis': prefix + 'Prexu_0.8.2_x64-setup.exe',
            'windows-x86_64-msi': prefix + 'Prexu_0.8.2_x64_en-US.msi',
        }
        assets = set(urls.values()) | {prefix + 'latest.json', urls['linux-x86_64'] + '.sig'}
        original = {'version': '0.8.2', 'platforms': {
            platform: {'url': urls[platform], 'signature': encoded_packet(74)}
            for platform in gate.PLATFORMS}}
        def check(manifest):
            gate.check_updater(manifest, '0.8.2', encoded_packet(42), assets)
        check(original)
        for mutation in ('version', 'missing', 'extra', 'url', 'key', 'malformed', 'swap', 'metadata', 'signature'):
            manifest = json.loads(json.dumps(original))
            entry = manifest['platforms']['linux-x86_64']
            if mutation == 'version':
                manifest['version'] = '0.8.1'
            elif mutation == 'missing':
                del manifest['platforms']['windows-x86_64']
            elif mutation == 'extra':
                manifest['platforms']['unexpected'] = entry
            elif mutation == 'url':
                entry['url'] = 'https://example.test/old-asset'
            elif mutation == 'swap':
                entry['url'] = urls['windows-x86_64']
            elif mutation == 'metadata':
                entry['url'] = prefix + 'latest.json'
            elif mutation == 'signature':
                entry['url'] = urls['linux-x86_64'] + '.sig'
            elif mutation == 'key':
                entry['signature'] = encoded_packet(74, b'87654321')
            else:
                entry['signature'] = encoded_packet(42)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                check(manifest)

    def test_startup_requires_both_markers_and_full_window(self):
        good = '[player] mpv created\n[player:linux] compositor installed\n'
        gate.check_startup(124, good, 30)
        for code, log in ((0, good), (1, good), (124, ''),
                          (124, '[player] mpv created'),
                          (124, good + 'VersionMismatch'),
                          (124, good + 'falling back'),
                          (124, good + 'fallback to HTML5')):
            with self.subTest(code=code, log=log), self.assertRaises(ValueError):
                gate.check_startup(code, log, 30)

    @unittest.skipUnless(shutil.which('timeout'), 'GNU timeout required')
    def test_launch_rejects_child_exiting_124_before_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'before 30 seconds'):
                gate.launch_startup(
                    ['timeout', '--kill-after=5s', '30s', 'sh', '-c',
                     "printf '[player] mpv created\\n[player:linux] compositor installed\\n'; exit 124"],
                    Path(directory) / 'startup.log')

    def test_release_metadata_rejects_prerelease_draft_and_wrong_tag(self):
        good = {'tag_name': 'v0.8.2', 'draft': False, 'prerelease': False}
        gate.check_release_metadata(good, 'v0.8.2')
        for field, value in (('tag_name', 'v0.8.1'), ('draft', True),
                             ('prerelease', True), ('prerelease', None)):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                gate.check_release_metadata({**good, field: value}, 'v0.8.2')


if __name__ == '__main__':
    unittest.main()
