#!/usr/bin/env python3
"""S0 spike: score the pure-PHP MP4 probe prototype against ffprobe, field by field, over the corpus."""
import json, subprocess, glob, os, sys
rows=[]; fields=['codec','profile','level','width','height','duration','fps','bitrate','audio','faststart','fragmented','rotation','gps']
agree={f:[0,0] for f in fields}
CODEC={'avc1':'h264','avc3':'h264','hvc1':'hevc','hev1':'hevc','av01':'av1'}
PROF={66:'Baseline',77:'Main',100:'High'}
for f in sorted(glob.glob('corpus/*.mp4')+glob.glob('corpus/*.mov')):
    n=os.path.basename(f)
    if n in('trunc.mp4','hostile-boxsize.mp4'): continue
    php=json.loads(subprocess.check_output(['php','mp4-probe.php',f]))
    fp=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-show_entries','stream_side_data','-of','json',f]))
    v=[s for s in fp['streams'] if s['codec_type']=='video'][0]; a=any(s['codec_type']=='audio' for s in fp['streams'])
    pv=php.get('video') or {}
    rot=0
    for sd in v.get('side_data_list',[]) or []:
        if 'rotation' in sd: rot=int(sd['rotation'])
    num,den=(v['avg_frame_rate'].split('/')+['1'])[:2]; fps=float(num)/float(den) if float(den) else 0
    dur=float(fp['format'].get('duration') or 0)
    tests={
     'codec': CODEC.get(pv.get('codec'),pv.get('codec'))==v['codec_name'],
     'profile': (v['codec_name']!='h264') or PROF.get(pv.get('avc_profile_idc'))==v.get('profile') or (v.get('profile')=='Constrained Baseline' and pv.get('avc_profile_idc')==66),
     'level': (v['codec_name']!='h264') or pv.get('avc_level_idc')==v.get('level'),
     'width': pv.get('entry_w')==v['width'], 'height': pv.get('entry_h')==v['height'],
     'duration': php.get('duration_s') is not None and abs((php['duration_s'] or 0)-dur)<0.06 if not php['fragmented'] else None,
     'fps': abs((php.get('fps') or 0)-fps)<0.2 if not php['fragmented'] else None,
     'bitrate': (abs((php.get('video_bitrate_bps') or 0)-int(v.get('bit_rate') or 0))/max(1,int(v.get('bit_rate') or 1))<0.1) if v.get('bit_rate') and not php['fragmented'] else None,
     'audio': php['has_audio']==a,
     'faststart': None if php['fragmented'] else True,   # ffprobe has no direct field; verified by file layout below
     'fragmented': php['fragmented']==(n=='h264-fragmented.mp4'),
     'rotation': ((pv.get('rotation') or 0)%360 in (rot%360,(-rot)%360)),
     'gps': php['gps']==(n=='h264-gps-quicktime.mov'),
    }
    # faststart ground truth from file layout using ffprobe -v trace is noisy; use mdat/moov order via python
    b=open(f,'rb').read(); pos=0; order=[]
    while pos+8<=len(b):
        sz=int.from_bytes(b[pos:pos+4],'big'); t=b[pos+4:pos+8]; order.append(t); pos+= sz if sz>=8 else len(b)
    gt= (order.index(b'moov')<order.index(b'mdat')) if b'moov' in order and b'mdat' in order else None
    if not php['fragmented']: tests['faststart']= php['faststart']==gt
    rows.append((n,tests))
    for k,t in tests.items():
        if t is None: continue
        agree[k][1]+=1; agree[k][0]+= 1 if t else 0
print(f"{'file':30}"+''.join(f"{k[:6]:>8}" for k in fields))
for n,t in rows: print(f"{n:30}"+''.join(f"{('ok' if x else '—' if x is None else 'FAIL'):>8}" for x in (t[k] for k in fields)))
print('\nagreement with ffprobe: '+', '.join(f"{k} {a}/{b}" for k,(a,b) in agree.items()))
json.dump({'agreement':agree,'files':len(rows)},open('results-mp4-compare.json','w'))
