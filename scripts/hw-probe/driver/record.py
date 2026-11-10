"""Linux X11 composed-root recording, independent of the app's webview.

A small override-redirect color challenge proves the selected display is live.
It occupies the top-right 16x16 pixels; consumers must exclude that rectangle.
Wayland is explicitly unsupported until portal permission/geometry is available.
"""
import ctypes
import ctypes.util
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import signal
import subprocess
import time

from contract import Invalid


def command(args, timeout=15):
    if args[0] == 'ffmpeg':
        args = [args[0], '-threads', '1', '-filter_threads', '1',
                *args[1:-1], '-threads', '1', args[-1]]
    process = None
    try:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        output, _ = process.communicate(timeout=timeout)
        if process.returncode:
            raise Invalid('capture_failed')
        return output
    except (OSError, subprocess.SubprocessError):
        raise Invalid('capture_failed') from None
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)



def video_digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class Stamp:
    def __init__(self):
        self.x = ctypes.CDLL(ctypes.util.find_library('X11'))
        # Explicit prototypes: a Display pointer must never be truncated to int.
        for name, args, result in [
            ('XOpenDisplay', [ctypes.c_char_p], ctypes.c_void_p),
            ('XDefaultRootWindow', [ctypes.c_void_p], ctypes.c_ulong),
            ('XDefaultScreen', [ctypes.c_void_p], ctypes.c_int),
            ('XDisplayWidth', [ctypes.c_void_p, ctypes.c_int], ctypes.c_int),
            ('XDisplayHeight', [ctypes.c_void_p, ctypes.c_int], ctypes.c_int),
            ('XCreateSimpleWindow', [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int,
             ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint,
             ctypes.c_ulong, ctypes.c_ulong], ctypes.c_ulong),
            ('XChangeWindowAttributes', [ctypes.c_void_p, ctypes.c_ulong,
             ctypes.c_ulong, ctypes.c_void_p], ctypes.c_int),
            ('XMapRaised', [ctypes.c_void_p, ctypes.c_ulong], ctypes.c_int),
            ('XRaiseWindow', [ctypes.c_void_p, ctypes.c_ulong], ctypes.c_int),
            ('XSetWindowBackground', [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong], ctypes.c_int),
            ('XClearWindow', [ctypes.c_void_p, ctypes.c_ulong], ctypes.c_int),
            ('XSync', [ctypes.c_void_p, ctypes.c_int], ctypes.c_int),
            ('XDestroyWindow', [ctypes.c_void_p, ctypes.c_ulong], ctypes.c_int),
            ('XCloseDisplay', [ctypes.c_void_p], ctypes.c_int),
        ]:
            func = getattr(self.x, name)
            func.argtypes, func.restype = args, result
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise Invalid('display_inaccessible')
        screen = self.x.XDefaultScreen(self.display)
        self.width = self.x.XDisplayWidth(self.display, screen)
        self.height = self.x.XDisplayHeight(self.display, screen)
        self.window = self.x.XCreateSimpleWindow(self.display,
            self.x.XDefaultRootWindow(self.display), self.width - 16, 0, 16, 16, 0, 0, 0)
        class Attributes(ctypes.Structure):
            _fields_ = [(name, kind) for name, kind in [
                ('background_pixmap', ctypes.c_ulong), ('background_pixel', ctypes.c_ulong),
                ('border_pixmap', ctypes.c_ulong), ('border_pixel', ctypes.c_ulong),
                ('bit_gravity', ctypes.c_int), ('win_gravity', ctypes.c_int),
                ('backing_store', ctypes.c_int), ('backing_planes', ctypes.c_ulong),
                ('backing_pixel', ctypes.c_ulong), ('save_under', ctypes.c_int),
                ('event_mask', ctypes.c_long), ('do_not_propagate_mask', ctypes.c_long),
                ('override_redirect', ctypes.c_int), ('colormap', ctypes.c_ulong),
                ('cursor', ctypes.c_ulong)]]
        attrs = Attributes(override_redirect=1)
        self.x.XChangeWindowAttributes(self.display, self.window, 1 << 9, ctypes.byref(attrs))
        self.x.XMapRaised(self.display, self.window)

    def color(self):
        rgb = secrets.token_bytes(3)
        self.x.XSetWindowBackground(self.display, self.window, int.from_bytes(rgb, 'big'))
        self.x.XClearWindow(self.display, self.window)
        self.x.XRaiseWindow(self.display, self.window)
        self.x.XSync(self.display, 0)
        return rgb

    def close(self):
        self.x.XDestroyWindow(self.display, self.window)
        self.x.XCloseDisplay(self.display)


class Recorder:
    def __init__(self, root, window_size=None):
        self.root = root
        self.window_size = window_size
        self.stamp = None
        self.process = None
        self.log = None
        self.windows = []
        self.focused = set()
        self.markers = []
        self.last_geometry = 0
        self.started = None

    def screenshot(self, name, color):
        output = self.root / name
        backend = command(['nu', str(Path(__file__).with_name('capture-screen.nu')), str(output)]).decode().strip()
        raw = command(['ffmpeg', '-v', 'error', '-i', str(output), '-vf',
                       f'format=rgb24,crop=1:1:{self.stamp.width - 8}:8',
                       '-frames:v', '1', '-f', 'rawvideo', '-'])
        if raw != color:
            raise Invalid('capture_not_current_display')
        return backend

    def start(self):
        if os.environ.get('WAYLAND_DISPLAY'):
            raise Invalid('capture_wayland_unsupported')
        if not os.environ.get('DISPLAY'):
            raise Invalid('no_graphical_session')
        if self.window_size is not None and not re.fullmatch(r'[1-9][0-9]{2,3}x[1-9][0-9]{2,3}', self.window_size):
            raise Invalid('invalid_capture_window_size')
        self.stamp = Stamp()
        self.first = self.stamp.color()
        self.backend = self.screenshot('capture-before.png', self.first)
        self.log = (self.root / 'capture-progress.log').open('xb')
        self.started = time.monotonic()
        self.process = subprocess.Popen([
            'ffmpeg', '-nostdin', '-v', 'error', '-f', 'x11grab', '-draw_mouse', '0',
            '-framerate', '30', '-video_size', f'{self.stamp.width}x{self.stamp.height}',
            '-i', os.environ['DISPLAY'], '-c:v', 'ffv1', '-threads', '2',
            '-progress', 'pipe:1', '-nostats', str(self.root / 'desktop.mkv')],
            stdin=subprocess.DEVNULL, stdout=self.log, stderr=subprocess.DEVNULL,
            start_new_session=True)
        # Do not launch the app before the recorder has actually written frames.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise Invalid('capture_failed')
            if b'frame=' in (self.root / 'capture-progress.log').read_bytes():
                return
            time.sleep(.05)
        raise Invalid('capture_start_timeout')

    def tick(self, process):
        if self.process.poll() is not None:
            raise Invalid('capture_failed')
        now = time.monotonic()
        trace = self.root / 'output' / 'events.jsonl'
        if trace.exists():
            lines = trace.read_bytes()[:2 * 1024 * 1024].splitlines(keepends=True)
            for line in lines[len(self.markers):]:
                if not line.endswith(b'\n'):
                    break
                marker = json.loads(line)
                self.markers.append({'seq': marker['seq'], 'observedSeconds': now - self.started})
        if now - self.last_geometry < .1:
            return
        self.last_geometry = now
        # PID scopes the search to this launch, never an unrelated Prexu session.
        found = subprocess.run(['xdotool', 'search', '--onlyvisible', '--pid', str(process.pid),
                                '--name', '^Prexu$'], stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, timeout=2)
        for wid in found.stdout.decode().split():
            if wid not in self.focused:
                if self.window_size:
                    width, height = self.window_size.split('x')
                    command(['xdotool', 'windowsize', '--sync', wid, width, height])
                command(['xdotool', 'windowfocus', wid])
                self.focused.add(wid)
            geometry = command(['xdotool', 'getwindowgeometry', '--shell', wid]).decode()
            data = dict(line.split('=', 1) for line in geometry.splitlines() if '=' in line)
            x, y, width, height = (int(data[key]) for key in ('X', 'Y', 'WIDTH', 'HEIGHT'))
            if width < 100 or height < 100:
                continue
            item = {'seconds': now - self.started, 'window': wid,
                    'x': x, 'y': y, 'width': width, 'height': height}
            self.windows.append(item)
            if x < 0 or y < 0 or x + width > self.stamp.width or y + height > self.stamp.height:
                raise Invalid('capture_window_outside_desktop')

    def finish(self):
        self.last = self.stamp.color()
        self.screenshot('capture-after.png', self.last)
        time.sleep(.6)
        self.stop_video()
        metadata = json.loads(command(['ffprobe', '-v', 'error', '-show_streams',
            '-of', 'json', str(self.root / 'desktop.mkv')]))['streams'][0]
        if (metadata['width'], metadata['height']) != (self.stamp.width, self.stamp.height):
            raise Invalid('capture_dimensions')
        # Full decode, not just a header probe. Both unpredictable challenges must
        # appear in the lossless stream, proving fresh frames across the run.
        raw = command(['ffmpeg', '-v', 'error', '-xerror', '-i', str(self.root / 'desktop.mkv'),
            '-vf', f'format=rgb24,crop=1:1:{self.stamp.width - 8}:8',
            '-f', 'rawvideo', '-'], timeout=120)
        pixels = {raw[i:i+3] for i in range(0, len(raw), 3)}
        if self.first not in pixels or self.last not in pixels or self.first == self.last:
            raise Invalid('capture_stale_frames')
        if not self.windows:
            raise Invalid('capture_window_missing')
        events = [json.loads(line) for line in (self.root / 'output' / 'events.jsonl').read_text().splitlines()]
        begin = next(event for event in events if event['event'] == 'run.begin')
        observed = next(item for item in self.markers if item['seq'] == begin['seq'])
        origin = observed['observedSeconds'] - begin['elapsedMs'] / 1000
        steps = []
        for event in events:
            if event['event'] == 'step.begin':
                steps.append({'id': event['stepId'], 'beginSeq': event['seq'],
                              'beginSeconds': origin + event['elapsedMs'] / 1000})
            elif event['event'] == 'step.end':
                steps[-1].update(endSeq=event['seq'], endSeconds=origin + event['elapsedMs'] / 1000)
        # The continuous stream retains fast steps even when no screenshot
        # poll can land inside them. Images are navigation aids, not assertions.
        for step in steps:
            if 'endSeconds' not in step:
                continue
            midpoint = (step['beginSeconds'] + step['endSeconds']) / 2
            image = f"step-{step['id']}.png"
            command(['ffmpeg', '-v', 'error', '-ss', str(midpoint), '-i',
                     str(self.root / 'desktop.mkv'), '-frames:v', '1',
                     str(self.root / image)])
            if not (self.root / image).is_file():
                raise Invalid('capture_step_not_covered')
            step.update(image=image, imageSeconds=midpoint)
        return {'status': 'pass', 'backend': self.backend, 'video': 'desktop.mkv',
                'decodedFrames': len(raw) // 3, 'fps': 30, 'steps': steps,
                'timingScope': 'approximate cue correlation; not transition timing assertions',
                'videoStartMonotonic': self.started, 'markerReceipts': self.markers,
                'windowSamples': self.windows, 'excludedRect': [self.stamp.width - 16, 0, 16, 16],
                'freshnessChallenges': [self.first.hex(), self.last.hex()],
                'videoSha256': video_digest(self.root / 'desktop.mkv')}

    def stop_video(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.send_signal(signal.SIGINT)
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(self.process.pid, signal.SIGKILL)
                    self.process.wait(timeout=5)
                    raise Invalid('capture_stop_timeout')
            if self.process.returncode not in (0, 255):
                raise Invalid('capture_failed')

    def close(self):
        try:
            self.stop_video()
        finally:
            if self.log:
                self.log.close()
            if self.stamp:
                self.stamp.close()
                self.stamp = None
            # Preserve partial observations even when validation fails.
            (self.root / 'capture-observations.json').write_text(json.dumps({
                'windowSamples': self.windows, 'markerReceipts': self.markers,
                'videoStartMonotonic': self.started}, indent=2) + '\n')
