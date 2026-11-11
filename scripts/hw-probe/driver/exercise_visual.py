#!/usr/bin/env python3
"""Replay a reviewed capture with injected visual failures; preserve every result."""
import argparse
import json
from pathlib import Path
import shutil

from record import command, video_digest
from visual import evaluate


def save(path, value):
    with path.open('x') as out:
        json.dump(value, out, indent=2, allow_nan=False)
        out.write('\n')


def exercise(source, plan, destination):
    destination.mkdir()  # Never overwrite earlier evidence.
    original = json.loads((source/'capture.json').read_text())
    expected = json.loads(plan.read_text())
    # This corpus is explicitly for the checked-in 800x600 Xvfb scenario.
    if not any(c['name'] == 'green-subtitle' for c in expected['checks']):
        raise ValueError('exercise_requires_visual_scenario')
    cases = {
        'good': None,
        'black': 'drawbox=x=0:y=75:w=800:h=450:color=black:t=fill',
        'stale': 'drawbox=x=0:y=75:w=800:h=450:color=red:t=fill',
        'wrong': 'drawbox=x=0:y=75:w=800:h=450:color=yellow:t=fill',
        'subtitle': 'drawbox=x=305:y=548:w=190:h=36:color=black:t=fill',
        'chrome': 'drawbox=x=15:y=8:w=760:h=40:color=black:t=fill',
        'geometry': 'drawbox=x=0:y=75:w=800:h=20:color=black:t=fill',
        'delayed': None,
        'missing-marker': None,
        'missing-frame': "select='not(eq(n,100))'",
        'unexpected-skip': None,
    }
    events = [json.loads(line) for line in (source/'output/events.jsonl').read_text().splitlines()]
    begin = next(e for e in events if e.get('stepId') == 'seek-green' and e['event'] == 'step.begin')
    from visual import clock_bounds
    offset = clock_bounds(original, events, expected['calibration']['clockSlackMs'])
    start = begin['elapsedMs']/1000+offset[0]
    cases['delayed'] = f"drawbox=x=0:y=75:w=800:h=450:color=red:t=fill:enable='between(t,{start},{start+2})'"
    results=[]
    for name, mutation in cases.items():
        root=destination/name
        (root/'output').mkdir(parents=True)
        for filename in ('script.json','process.json','manifest.json','capture-environment.json','allocation.log'):
            if (source/filename).exists():shutil.copyfile(source/filename,root/filename)
        shutil.copyfile(source/'output/events.jsonl',root/'output/events.jsonl')
        capture=json.loads(json.dumps(original))
        if mutation:
            command(['ffmpeg','-v','error','-i',str(source/'desktop.mkv'),'-vf',mutation,
                     '-vsync','0','-c:v','ffv1',str(root/'desktop.mkv')],timeout=120)
        else:
            shutil.copyfile(source/'desktop.mkv',root/'desktop.mkv')
        capture['videoSha256']=video_digest(root/'desktop.mkv')
        if name=='missing-marker':
            (root/'output/events.jsonl').write_text('\n'.join(json.dumps(e) for e in events if e['seq']!=3)+'\n')
        selected_plan=plan
        if name=='unexpected-skip':
            changed=json.loads(json.dumps(expected));changed['checks']=[c for c in changed['checks'] if c['step']!='stop']
            # Keep reference files beside the immutable copied plan.
            for c in expected['checks']:
                if 'template' in c:shutil.copyfile(plan.parent/c['template'],root/c['template'])
            selected_plan=root/'plan.json';save(selected_plan,changed)
        save(root/'capture.json',capture)
        result=evaluate(root,selected_plan)
        save(root/'visual-verdict.json',result)
        failed=[c['name'] for c in result['checks'] if c['status']=='fail']
        targets={'black':'red','stale':'green','wrong':'red','subtitle':'green-subtitle',
                 'chrome':'paused-chrome','geometry':'red-geometry','delayed':'seek-green'}
        codes={'missing-marker':'visual_control_failed','missing-frame':'visual_frames_missing',
               'unexpected-skip':'visual_required_step_missing'}
        if name == 'good':
            matched = result['status'] == 'pass'
        elif name in targets:
            matched = result['codes'] == ['visual_assertion_failed'] and targets[name] in failed
        else:
            matched = result['codes'] == [codes[name]]
        results.append({'case':name,'expected':'pass' if name=='good' else 'fail',
                        'actual':result['status'],'codes':result['codes'],'failedChecks':failed,'matched':matched})
        print(json.dumps(results[-1]),flush=True)
    save(destination/'results.json',results)
    return all(r['matched'] for r in results)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-dir',required=True,type=Path)
    parser.add_argument('--plan',required=True,type=Path)
    parser.add_argument('--output-dir',required=True,type=Path)
    args=parser.parse_args()
    raise SystemExit(0 if exercise(args.run_dir,args.plan,args.output_dir) else 1)
