"""Loopback-only synthetic Plex subset for the scripted desktop probe.

This is a context-managed harness component, not a general-purpose Plex server.
Only verified, bounded fixture bytes are served; request text is never logged.
"""
from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from threading import Thread
from urllib.parse import urlsplit

from fixtures import verify

MEDIA_PATH = '/library/parts/1/file.mkv'
METADATA_PATH = '/library/metadata/av-cues-v1'
MAX_FILE_BYTES = 32 * 1024 * 1024


def metadata(size):
    return {'ratingKey': 'av-cues-v1', 'key': METADATA_PATH, 'type': 'movie',
            'title': 'Synthetic AV cues', 'duration': 15000, 'viewOffset': 0,
            'librarySectionID': 1,
            'Media': [{'id': 1, 'duration': 15000, 'container': 'mkv',
                       'videoCodec': 'mpeg4', 'audioCodec': 'pcm_s16le',
                       'width': 320, 'height': 180, 'audioChannels': 1,
                       'Part': [{'id': 1, 'key': MEDIA_PATH, 'size': size,
                                 'duration': 15000, 'container': 'mkv',
                                 'Stream': [
                                     {'id': 1, 'streamType': 1, 'index': 0, 'codec': 'mpeg4'},
                                     {'id': 2, 'streamType': 2, 'index': 1, 'codec': 'pcm_s16le',
                                      'languageCode': 'eng', 'channels': 1, 'selected': True},
                                     {'id': 3, 'streamType': 2, 'index': 2, 'codec': 'pcm_s16le',
                                      'languageCode': 'deu', 'channels': 1},
                                     {'id': 4, 'streamType': 3, 'index': 3, 'codec': 'srt',
                                      'languageCode': 'eng'}]}]}]}


def byte_range(value, size):
    """One RFC 9110 byte range; reject malformed/multipart/unsatisfiable input."""
    match = re.fullmatch(r'bytes=([0-9]{0,12})-([0-9]{0,12})', value)
    if not match or not any(match.groups()) or not size:
        raise ValueError('invalid_range')
    first, last = match.groups()
    if not first:
        length = int(last)
        if not length:
            raise ValueError('invalid_range')
        return max(0, size - length), size - 1
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError('invalid_range')
    return start, end


@contextmanager
def serve(directory):
    manifest = verify(directory)
    # Snapshot after verification and hash again: later disk writes cannot change
    # the bytes served or make the run's manifest disagree with its media.
    blobs = {}
    for name, expected in manifest['files'].items():
        with (directory / name).open('rb') as stream:
            data = stream.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('fixture_hash_mismatch')
        blobs[name] = data
    media = blobs['av-cues-v1.mkv']

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(2)

        def log_message(self, *_args):
            pass  # URL query strings may contain client-supplied credentials.

        def reply(self, status, data=b'', content_type='application/json', headers=None):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Connection', 'close')
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != 'HEAD':
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass  # Media clients close an old range when seeking.

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            # Exact route table, no filesystem URL mapping and no proxy fallback.
            try:
                path = urlsplit(self.path).path
            except ValueError:
                self.reply(400)
                return
            if path == MEDIA_PATH:
                headers = {'Accept-Ranges': 'bytes'}
                if self.headers.get('Range') is not None:
                    try:
                        start, end = byte_range(self.headers['Range'], len(media))
                    except ValueError:
                        self.reply(416, headers={'Content-Range': f'bytes */{len(media)}'})
                        return
                    headers['Content-Range'] = f'bytes {start}-{end}/{len(media)}'
                    self.reply(206, media[start:end + 1], 'video/x-matroska', headers)
                else:
                    self.reply(200, media, 'video/x-matroska', headers)
                return
            if path in ('/:/timeline', '/:/scrobble', '/:/unscrobble'):
                self.reply(200)
                return
            if path == '/identity':
                container = {'machineIdentifier': 'prexu-probe-fixture', 'version': '1.0.0'}
            elif path == METADATA_PATH:
                container = {'size': 1, 'Metadata': [metadata(len(media))]}
            elif path == '/library/sections':
                container = {'size': 1, 'Directory': [{'key': '1', 'title': 'Probe', 'type': 'movie'}]}
            elif path in ('/library/recentlyAdded', '/library/sections/1/all',
                          '/library/sections/1/recentlyAdded'):
                container = {'size': 1, 'Metadata': [metadata(len(media))]}
            elif path in ('/library/onDeck', '/hubs', '/playlists'):
                container = {'size': 0, 'Metadata': []}
            else:
                self.reply(404)
                return
            self.reply(200, json.dumps({'MediaContainer': container}).encode())

    class Server(ThreadingHTTPServer):
        daemon_threads = False  # server_close joins bounded request handlers.

        def handle_error(self, _request, _client_address):
            self.failed = True  # Never print raw request diagnostics.

    server = Server(('127.0.0.1', 0), Handler)
    server.failed = False
    thread = Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05})
    thread.start()
    try:
        yield {'url': f'http://127.0.0.1:{server.server_port}', 'manifest': manifest}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        if thread.is_alive() or server.failed:
            raise RuntimeError('fixture_cleanup_failed')
