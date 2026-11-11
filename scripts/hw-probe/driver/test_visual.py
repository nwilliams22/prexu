"""Decoded-video negative controls. Synthetic clips are not desktop acceptance."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_contract import script_and_trace
from record import video_digest
from visual import evaluate


def save(path, value):
    path.write_text(json.dumps(value))


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'requires video tools')
class VisualTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'output').mkdir()
        self.script, self.events = script_and_trace()
        self.events[4]['observed']['positionMs'] = 6500
        self.script['steps'][1]['args']['positionMs'] = 6500
        save(self.root/'script.json', self.script)
        self.write_events()
        save(self.root/'process.json', {'exitCode': 0, 'timedOut': False})
        self.capture = {'status': 'pass', 'video': 'desktop.mkv', 'decodedFrames': 90,
                        'videoOriginBoundsSeconds': [0, .001], 'excludedRect': [80,0,16,16],
                        'markerReceipts': [{'seq': e['seq'], 'earliestSeconds': e['elapsedMs']/1000,
                                            'observedSeconds': e['elapsedMs']/1000+.001} for e in self.events],
                        'windowSamples': [{'seconds': i/30, 'x':0,'y':0,'width':96,'height':64} for i in range(90)]}
        self.render()
        subprocess.run(['ffmpeg','-v','error','-ss','0.5','-i',str(self.root/'desktop.mkv'),
                        '-frames:v','1',str(self.root/'reference.png')],check=True)
        self.plan = {'schema':'prexu.probe.visual-plan','version':1,
                     'calibration': {'profile':'debug','source':'synthetic 30fps unit fixture only',
                                     'reference':'prexu-xxct','maxClockUncertaintyMs':100,'clockSlackMs':0},
                     'allocationGapMs':None,'checks':[]}
        for name,step,rgb,within in [('red','play',[253,0,0],80),('green','seek',[0,127,0],120),('blue','stop',[0,0,254],250)]:
            self.plan['checks'].append({'name':name,'step':step,'anchor':'end','afterMs':0,
              'withinMs':within,'holdMs':100,'rect':[4,20,60,20], 'kind':'video','rgb':rgb,
              'pixelTolerance':10,'maxBadPixelFraction':.01})
        for name,rect in [('subtitle',[10,44,50,12]),('chrome',[4,4,40,10])]:
            self.plan['checks'].append({'name':name,'step':'seek','anchor':'end','afterMs':0,
              'withinMs':120,'holdMs':100,'rect':rect,'kind':name,'template':'reference.png',
              'templateSha256':video_digest(self.root/'reference.png'),
              'pixelTolerance':10,'maxBadPixelFraction':.01})
        self.plan['checks'][0].update(windowRect=[0,0,96,64],windowTolerancePx=1)

    def write_events(self):
        (self.root/'output/events.jsonl').write_text('\n'.join(json.dumps(e) for e in self.events))

    def render(self, mutation=None):
        frames=[]
        for i in range(90):
            rgb = [253,0,0] if i < 12 else [0,127,0] if i < 24 else [0,0,254]
            if mutation == 'stale': rgb=[253,0,0]
            if mutation == 'black': rgb=[0,0,0]
            if mutation == 'wrong': rgb=[200,80,100]
            if mutation == 'delayed' and 12 <= i < 21: rgb=[253,0,0]
            frame=bytearray(rgb*96*64)
            for y in range(4,14):
                for x in range(4,44):
                    value=255 if (x//4)%2 else 0
                    frame[(y*96+x)*3:(y*96+x)*3+3]=bytes([value]*3)
            if mutation != 'subtitle':
                shift=15 if mutation=='misplaced' else 0
                for y in range(44,56):
                    for x in range(10,60):
                        value=255 if (x//5)%2 else 0
                        frame[(y*96+x+shift)*3:(y*96+x+shift)*3+3]=bytes([value]*3)
            if mutation=='chrome':
                for y in range(4,14):
                    for x in range(4,44): frame[(y*96+x)*3:(y*96+x)*3+3]=bytes(rgb)
            frames.append(frame)
        subprocess.run(['ffmpeg','-v','error','-y','-f','rawvideo','-pixel_format','rgb24',
                        '-video_size','96x64','-framerate','30','-i','pipe:0','-c:v','ffv1',
                        '-threads','1',str(self.root/'desktop.mkv')],input=b''.join(frames),check=True)
        self.capture['videoSha256']=video_digest(self.root/'desktop.mkv')
        save(self.root/'capture.json',self.capture)

    def result(self):
        save(self.root/'plan.json',self.plan)
        return evaluate(self.root,self.root/'plan.json')

    def test_known_good(self):
        result=self.result()
        self.assertEqual(result['status'],'pass',result)
        self.assertEqual(len(result['checks']),5)
        self.assertIn('latencyBoundsMs',result['checks'][0])

    def test_video_faults_each_fail(self):
        for fault in ('black','stale','wrong','subtitle','misplaced','chrome','delayed'):
            with self.subTest(fault=fault):
                self.render(fault)
                result=self.result()
                self.assertEqual(result['status'],'fail',result)
                self.assertEqual(result['codes'],['visual_assertion_failed'],result)

    def test_geometry(self):
        self.capture['windowSamples'][8]['width']=80
        save(self.root/'capture.json',self.capture)
        self.assertEqual(self.result()['status'],'fail')

    def test_missing_markers_frames_and_unexpected_skips(self):
        self.events.pop(3);self.write_events()
        self.assertEqual(self.result()['codes'],['visual_control_failed'])
        self.events=script_and_trace()[1]
        self.events[4]['observed']['positionMs']=6500
        self.write_events()
        self.capture['decodedFrames']=89
        save(self.root/'capture.json',self.capture)
        self.assertEqual(self.result()['codes'],['visual_frames_missing'])
        self.capture['decodedFrames']=90
        save(self.root/'capture.json',self.capture)
        self.plan['checks']=[c for c in self.plan['checks'] if c['step']!='stop']
        self.assertEqual(self.result()['codes'],['visual_required_step_missing'])

    def test_uncertain_clock_and_missing_anchor_fail(self):
        self.capture['videoOriginBoundsSeconds']=[0,1]
        save(self.root/'capture.json',self.capture)
        self.assertEqual(self.result()['codes'],['visual_clock_uncertain'])
        del self.capture['videoOriginBoundsSeconds']
        save(self.root/'capture.json',self.capture)
        self.assertEqual(self.result()['status'],'fail')

    def test_invalid_plan_inputs(self):
        original=copy.deepcopy(self.plan)
        for field,value in [('withinMs',float('nan')),('holdMs',0),('pixelTolerance',True),
                            ('kind','skip'),('rect',[80,0,16,16])]:
            self.plan=copy.deepcopy(original);self.plan['checks'][0][field]=value
            self.assertEqual(self.result()['status'],'fail',(field,value))
        self.plan=copy.deepcopy(original)
        self.plan['checks'][3]['template']='../escape.png'
        self.assertEqual(self.result()['codes'],['visual_invalid_filename'])

    def test_tampered_video_and_template_fail(self):
        with (self.root/'desktop.mkv').open('ab') as out:out.write(b'changed')
        self.assertEqual(self.result()['codes'],['visual_video_hash_mismatch'])
        self.render()
        self.plan['checks'][3]['templateSha256']='0'*64
        self.assertEqual(self.result()['codes'],['visual_template_hash_mismatch'])


@unittest.skipUnless(shutil.which('nu'), 'requires nushell')
class AllocationTests(unittest.TestCase):
    def test_existing_invariant_is_required_and_skips_fail(self):
        from visual import allocation_result
        from contract import Invalid
        with tempfile.TemporaryDirectory() as directory:
            log=Path(directory)/'allocation.log'
            log.write_text('exit geometry applied t=1000\nwebview allocated t=1014\n')
            self.assertEqual(allocation_result(log,1,50)['status'],'pass')
            with self.assertRaisesRegex(Invalid,'visual_allocation_failed'):
                allocation_result(log,1,10)
            with self.assertRaisesRegex(Invalid,'visual_allocation_markers_missing'):
                allocation_result(log,2,50)
            log.write_text('')
            with self.assertRaisesRegex(Invalid,'visual_allocation_failed'):
                allocation_result(log,0,50)
            log.write_text('exit geometry applied t=1000\n')
            with self.assertRaisesRegex(Invalid,'visual_allocation_failed'):
                allocation_result(log,1,50)
