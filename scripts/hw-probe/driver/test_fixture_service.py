"""Exercise the real HTTP boundary, byte seeking, isolation and lifecycle."""
import http.client
import json
from pathlib import Path
import socket
import tempfile
import unittest
from urllib.parse import urlsplit

from fixtures import digest
from fixture_service import MEDIA_PATH, METADATA_PATH, serve


class FixtureServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.media = bytes(range(256)) * 8
        (self.root / 'av-cues-v1.mkv').write_bytes(self.media)
        (self.root / 'cues.srt').write_text('synthetic cue')
        self.manifest = {'schema': 'prexu.probe.fixtures', 'version': 1,
                         'fixture': 'av-cues-v1', 'files': {
                             name: digest(self.root / name)
                             for name in ('av-cues-v1.mkv', 'cues.srt')}}
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest))

    def request(self, url, path, method='GET', headers=None):
        parsed = urlsplit(url)
        client = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=3)
        try:
            client.request(method, path, headers=headers or {})
            result = client.getresponse()
            return result.status, dict(result.getheaders()), result.read()
        finally:
            client.close()

    def test_metadata_bytes_and_cleanup(self):
        with serve(self.root) as service:
            url = service['url']
            parsed = urlsplit(url)
            self.assertEqual(parsed.hostname, '127.0.0.1')
            self.assertEqual(service['manifest'], self.manifest)
            status, _, body = self.request(url, METADATA_PATH)
            self.assertEqual(status, 200)
            item = json.loads(body)['MediaContainer']['Metadata'][0]
            self.assertEqual(item['ratingKey'], 'av-cues-v1')
            part = item['Media'][0]['Part'][0]
            self.assertEqual([s['streamType'] for s in part['Stream']], [1, 2, 2, 3])
            self.assertEqual(self.request(url, part['key'])[2], self.media)
            status, headers, body = self.request(url, MEDIA_PATH, 'HEAD')
            self.assertEqual((status, body), (200, b''))
            self.assertEqual(int(headers['Content-Length']), len(self.media))
        with self.assertRaises(OSError):
            socket.create_connection((parsed.hostname, parsed.port), timeout=1)

    def test_seek_ranges(self):
        with serve(self.root) as service:
            for value, start, end in [('bytes=20-39', 20, 39), ('bytes=2000-', 2000, 2047),
                                      ('bytes=-10', 2038, 2047), ('bytes=2000-9999', 2000, 2047)]:
                with self.subTest(value=value):
                    status, headers, body = self.request(service['url'], MEDIA_PATH,
                                                         headers={'Range': value})
                    self.assertEqual(status, 206)
                    self.assertEqual(body, self.media[start:end + 1])
                    self.assertEqual(headers['Content-Range'], f'bytes {start}-{end}/2048')
            for value in ['bytes=2048-', 'bytes=7-6', 'bytes=-0', 'bytes=-',
                          'bytes=0-1,3-4', 'items=0-1', 'bytes=wat']:
                with self.subTest(value=value):
                    status, headers, _ = self.request(service['url'], MEDIA_PATH,
                                                      headers={'Range': value})
                    self.assertEqual(status, 416)
                    self.assertEqual(headers['Content-Range'], 'bytes */2048')

    def test_routes_are_closed_and_snapshot_is_immutable(self):
        with serve(self.root) as service:
            (self.root / 'av-cues-v1.mkv').write_bytes(b'changed after startup')
            self.assertEqual(self.request(service['url'], MEDIA_PATH)[2], self.media)
            for path in ['/manifest.json', '/../../etc/passwd', '/%2e%2e/secret',
                         '/library/metadata/private', '/video/:/transcode/universal/start']:
                self.assertEqual(self.request(service['url'], path)[0], 404)
            self.assertEqual(self.request(service['url'], '/:/timeline?time=1000')[0], 200)
            self.assertEqual(self.request(service['url'], MEDIA_PATH, 'POST')[0], 501)

    def test_corruption_refuses_startup(self):
        (self.root / 'av-cues-v1.mkv').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'fixture_hash_mismatch'):
            with serve(self.root):
                self.fail('corrupt fixture served')

    def test_exception_closes_listener(self):
        with self.assertRaisesRegex(RuntimeError, 'deliberate'):
            with serve(self.root) as service:
                parsed = urlsplit(service['url'])
                raise RuntimeError('deliberate')
        with self.assertRaises(OSError):
            socket.create_connection((parsed.hostname, parsed.port), timeout=1)
