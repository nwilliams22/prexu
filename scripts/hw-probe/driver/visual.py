#!/usr/bin/env python3
"""Fail-closed visual assertions over composed recordings and native cue markers."""
import argparse
import json
import math
from pathlib import Path
import re

from check import read_bounded
from contract import Invalid, MAX_SCRIPT_BYTES, decode, verdict
from record import command, video_digest


SIZE = (64, 36)
FRAME_BYTES = SIZE[0] * SIZE[1] * 3


def number(value, low, high):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        raise Invalid('visual_invalid_number')
    return value


def keys(value, required, optional=()):
    if type(value) is not dict or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise Invalid('visual_invalid_fields')


def local(root, name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', name):
        raise Invalid('visual_invalid_filename')
    path = root / name
    if path.is_symlink():
        raise Invalid('visual_symlink')
    return path


def load(path):
    return decode(read_bounded(path, MAX_SCRIPT_BYTES))


def rectangle(value, width, height):
    if type(value) is not list or len(value) != 4 or any(type(v) is not int for v in value):
        raise Invalid('visual_invalid_rect')
    x, y, w, h = value
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > width or y + h > height:
        raise Invalid('visual_invalid_rect')
    return value


def overlap(a, b):
    return a[0] < b[0]+b[2] and b[0] < a[0]+a[2] and a[1] < b[1]+b[3] and b[1] < a[1]+a[3]


def pixels(path, rect, start=None, duration=None):
    x, y, w, h = rect
    args = ['ffmpeg', '-v', 'error', '-xerror']
    if start is not None:
        args += ['-ss', str(start)]
    args += ['-i', str(path)]
    if duration is not None:
        args += ['-t', str(duration)]
    else:
        args += ['-frames:v', '1']
    args += ['-vf', f'format=rgb24,crop={w}:{h}:{x}:{y},scale=64:36:flags=area',
             '-vsync', '0', '-f', 'rawvideo', '-']
    return command(args, timeout=120)


def score(frame, reference, tolerance):
    differences = [abs(a-b) for a, b in zip(frame, reference)]
    return {'meanAbsoluteError': sum(differences) / len(differences),
            'badPixelFraction': sum(max(differences[i:i+3]) > tolerance
                                    for i in range(0, len(differences), 3)) / (len(differences)/3)}


def clock_bounds(capture, events, slack_ms):
    origin = capture['videoOriginBoundsSeconds']
    if len(origin) != 2:
        raise Invalid('visual_clock_missing')
    for v in origin:
        number(v, -1000, 1000)
    if origin[0] > origin[1]:
        raise Invalid('visual_clock_invalid')
    receipts = capture['markerReceipts']
    if [r['seq'] for r in receipts] != [e['seq'] for e in events]:
        raise Invalid('visual_marker_receipts_missing')
    lower, upper = [], []
    for receipt, event in zip(receipts, events):
        lo = number(receipt['earliestSeconds'], 0, 1000)
        hi = number(receipt['observedSeconds'], 0, 1000)
        if lo > hi:
            raise Invalid('visual_clock_invalid')
        lower.append(lo - event['elapsedMs']/1000 - slack_ms/1000)
        upper.append(hi - event['elapsedMs']/1000 + slack_ms/1000)
    lo, hi = max(lower), min(upper)
    if lo > hi:
        raise Invalid('visual_clock_inconsistent')
    return [lo - origin[1], hi - origin[0]]


def allocation_result(log, expected_exits, ceiling):
    lines = read_bounded(log, MAX_SCRIPT_BYTES).splitlines()
    if sum(line.startswith('exit geometry applied t=') for line in lines) != expected_exits:
        raise Invalid('visual_allocation_markers_missing')
    result = json.loads(command(['nu', str(Path(__file__).with_name('allocation-verdict.nu')),
                                 str(log), str(int(ceiling))]))
    if result['status'] != 'pass':
        raise Invalid('visual_allocation_failed')
    return result


def evaluate(root, plan_path):
    """Plans are reviewed expectations, never generated from the tested capture."""
    report = {'schema': 'prexu.probe.visual-verdict', 'version': 1, 'status': 'fail',
              'codes': [], 'checks': [], 'scope': 'composed pixels and bounded cue timing; no GPU/audio certification'}
    try:
        plan = load(plan_path)
        keys(plan, ['schema', 'version', 'calibration', 'checks', 'allocationGapMs'])
        if plan['schema'] != 'prexu.probe.visual-plan' or type(plan['version']) is not int or plan['version'] != 1:
            raise Invalid('visual_invalid_plan')
        calibration = plan['calibration']
        keys(calibration, ['profile', 'source', 'reference', 'maxClockUncertaintyMs', 'clockSlackMs'])
        if calibration['profile'] not in ('debug', 'release') or calibration['reference'] != 'prexu-xxct':
            raise Invalid('visual_calibration_missing')
        if not isinstance(calibration['source'], str) or not calibration['source'].strip():
            raise Invalid('visual_calibration_missing')
        uncertainty_limit = number(calibration['maxClockUncertaintyMs'], 1, 1000)
        slack = number(calibration['clockSlackMs'], 0, 100)
        report['calibration'] = calibration
        report['planSha256'] = video_digest(plan_path)
        script = load(root / 'script.json')
        trace = read_bounded(root / 'output' / 'events.jsonl', 2 * MAX_SCRIPT_BYTES)
        process = load(root / 'process.json')
        control = verdict(script, trace, process['exitCode'])
        if control['status'] != 'pass' or process.get('timedOut', False):
            raise Invalid('visual_control_failed')
        events = [decode(line) for line in trace.splitlines()]
        capture = load(root / 'capture.json')
        if capture['status'] != 'pass' or capture['video'] != 'desktop.mkv':
            raise Invalid('visual_capture_failed')
        video = root / 'desktop.mkv'
        if video_digest(video) != capture['videoSha256']:
            raise Invalid('visual_video_hash_mismatch')
        report['videoSha256'] = capture['videoSha256']
        bounds = clock_bounds(capture, events, slack)
        uncertainty = (bounds[1] - bounds[0])*1000
        report['clock'] = {'offsetBoundsSeconds': bounds, 'uncertaintyMs': uncertainty,
                           'ceilingMs': uncertainty_limit}
        if uncertainty > uncertainty_limit:
            raise Invalid('visual_clock_uncertain')
        metadata = json.loads(command(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_streams', '-show_frames', '-show_entries',
            'stream=width,height:frame=best_effort_timestamp_time', '-of', 'json', str(video)], timeout=120))
        width, height = (metadata['streams'][0][key] for key in ('width', 'height'))
        times = [float(f['best_effort_timestamp_time']) for f in metadata['frames']]
        report['frames'] = {'decoded': len(times), 'declared': capture['decodedFrames'],
                            'maxRequiredGapMs': 200}
        if len(times) != capture['decodedFrames'] or len(times) < 2 or any(a >= b for a,b in zip(times,times[1:])):
            raise Invalid('visual_frames_missing')
        excluded = rectangle(capture['excludedRect'], width, height)
        by_id = {s['id']: s for s in script['steps']}
        if not isinstance(plan['checks'], list) or not 1 <= len(plan['checks']) <= 256:
            raise Invalid('visual_checks_missing')
        covered = set()
        names = set()
        for check in plan['checks']:
            keys(check, ['name', 'step', 'anchor', 'afterMs', 'withinMs', 'holdMs', 'rect',
                         'kind', 'pixelTolerance', 'maxBadPixelFraction'],
                 ['rgb', 'template', 'templateSha256', 'windowRect', 'windowTolerancePx'])
            name = check['name']
            if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', name) or name in names:
                raise Invalid('visual_invalid_check_name')
            names.add(name)
            step = by_id[check['step']]
            covered.add(step['id'])
            if check['anchor'] not in ('begin', 'end'):
                raise Invalid('visual_invalid_anchor')
            anchor = next(e for e in events if e.get('stepId') == step['id'] and e['event'] == 'step.'+check['anchor'])
            delay = number(check['afterMs'], 0, 120000)/1000
            within = number(check['withinMs'], 1, 120000)/1000
            hold = number(check['holdMs'], 100, 30000)/1000
            rect = rectangle(check['rect'], width, height)
            if overlap(rect, excluded):
                raise Invalid('visual_challenge_overlap')
            tolerance = number(check['pixelTolerance'], 0, 80)
            max_bad = number(check['maxBadPixelFraction'], 0, .25)
            if check['kind'] == 'video':
                rgb = check['rgb']
                if rgb not in ([253, 0, 0], [0, 127, 0], [0, 0, 254]):
                    raise Invalid('visual_fixture_color_invalid')
                reference = bytes(rgb) * (SIZE[0]*SIZE[1])
            elif check['kind'] in ('subtitle', 'chrome', 'geometry'):
                template = local(plan_path.parent, check['template'])
                if video_digest(template) != check['templateSha256']:
                    raise Invalid('visual_template_hash_mismatch')
                # References are full-desktop images in the same calibrated layout.
                reference = pixels(template, rect)
                if len(reference) != FRAME_BYTES or max(reference)-min(reference) < 30:
                    raise Invalid('visual_template_empty')
            else:
                raise Invalid('visual_invalid_kind')
            t0 = anchor['elapsedMs']/1000 + bounds[0] + delay
            deadline = anchor['elapsedMs']/1000 + bounds[0] + delay + within
            end = anchor['elapsedMs']/1000 + bounds[1] + delay + within + hold
            indices = [i for i,t in enumerate(times) if t0 <= t <= end]
            if len(indices) < 2 or t0 < 0 or end > times[-1] or any(times[b]-times[a] > .2 for a,b in zip(indices,indices[1:])):
                raise Invalid('visual_frames_missing')
            # Decode by timestamp through the same stream; raw output order is PTS order.
            raw = pixels(video, rect, times[indices[0]], times[indices[-1]]-times[indices[0]]+.001)
            if len(raw) != len(indices)*FRAME_BYTES:
                raise Invalid('visual_decode_frame_count')
            measures = [score(raw[i*FRAME_BYTES:(i+1)*FRAME_BYTES], reference, tolerance) for i in range(len(indices))]
            stable = None
            for j, index in enumerate(indices):
                # Conservative upper latency bound must fit the budget.
                if times[index] > deadline:
                    break
                finish = next((k for k in range(j, len(indices)) if times[indices[k]] >= times[index]+hold), None)
                if finish is not None and all(m['badPixelFraction'] <= max_bad for m in measures[j:finish+1]):
                    stable = (j, finish)
                    break
            item = {'name': name, 'step': step['id'], 'kind': check['kind'],
                    'status': 'pass' if stable else 'fail', 'rect': rect,
                    'pixelTolerance': tolerance, 'maxBadPixelFraction': max_bad,
                    'bestBadPixelFraction': min(m['badPixelFraction'] for m in measures),
                    'bestMeanAbsoluteError': min(m['meanAbsoluteError'] for m in measures),
                    'worstBadPixelFraction': max(m['badPixelFraction'] for m in measures),
                    'sampleCount': len(indices), 'withinMs': within*1000, 'holdMs': hold*1000,
                    'maxFrameGapMs': max((times[b]-times[a])*1000 for a,b in zip(indices,indices[1:])),
                    'clip': {'file': 'desktop.mkv', 'startSeconds': times[indices[0]], 'endSeconds': times[indices[-1]]},
                    'logSlice': [e for e in events if e.get('stepId') == step['id']]}
            if stable:
                first = times[indices[stable[0]]]
                item['latencyBoundsMs'] = [(first-anchor['elapsedMs']/1000-bounds[1]-delay)*1000,
                                           (first-anchor['elapsedMs']/1000-bounds[0]-delay)*1000]
                item['steadyWorstBadPixelFraction'] = max(m['badPixelFraction'] for m in measures[stable[0]:stable[1]+1])
            else:
                item['stableStartNotObservedWithinMs'] = within*1000
            if 'windowRect' in check:
                expected = rectangle(check['windowRect'], width, height)
                tol = number(check['windowTolerancePx'], 0, 20)
                samples = [w for w in capture['windowSamples'] if t0 <= w['seconds']-capture['videoOriginBoundsSeconds'][0] <= end]
                error = max((max(abs(w[k]-v) for k,v in zip(('x','y','width','height'),expected)) for w in samples), default=None)
                item['windowMaxErrorPx'], item['windowTolerancePx'] = error, tol
                if error is None or error > tol:
                    item['status'] = 'fail'
            report['checks'].append(item)
        # Quit is the only marker-only step. No silent opt-out or unexpected skip.
        if covered != {s['id'] for s in script['steps'] if s['action'] != 'quit'}:
            raise Invalid('visual_required_step_missing')
        exits = [s for s in script['steps'] if s['action'] == 'popout' and not s['args']['enabled']]
        if exits:
            ceiling = number(plan['allocationGapMs'], 1, 10000)
            report['allocation'] = allocation_result(root / 'allocation.log', len(exits), ceiling)
        elif plan['allocationGapMs'] is not None:
            raise Invalid('visual_unexpected_allocation_check')
        report['status'] = 'pass' if all(c['status'] == 'pass' for c in report['checks']) else 'fail'
        if report['status'] == 'fail':
            report['codes'] = ['visual_assertion_failed']
    except Invalid as exc:
        report['codes'] = [str(exc)]
    except (OSError, KeyError, ValueError, TypeError, IndexError, StopIteration):
        report['codes'] = ['visual_input_invalid']
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(args.run_dir, args.plan)
    try:
        with args.output.open('x') as out:
            json.dump(result, out, indent=2, allow_nan=False)
            out.write('\n')
    except OSError:
        print(json.dumps({'status': 'fail', 'codes': ['output_unavailable']}))
        return 1
    print(json.dumps({'status': result['status'], 'codes': result['codes']}))
    return 0 if result['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
