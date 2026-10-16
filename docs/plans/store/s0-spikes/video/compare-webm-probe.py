#!/usr/bin/env python3
"""S0 spike: score the pure-PHP WebM probe against ffprobe."""
import json, subprocess, glob, os
CODEC={'V_VP9':'vp9','V_VP8':'vp8','V_AV1':'av1'}; ok=0; tot=0
print(f"{'file':14} codec  size  dur   audio doctype cues")
for f in sorted(glob.glob('corpus/*.webm')):
    php=json.loads(subprocess.check_output(['php','webm-probe.php',f]))
    fp=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',f]))
    v=[s for s in fp['streams'] if s['codec_type']=='video'][0]; pv=php['video']
    t=[CODEC.get(pv['codec'])==v['codec_name'], (pv['w'],pv['h'])==(v['width'],v['height']), abs(php['duration_s']-float(fp['format']['duration']))<0.06,
       php['has_audio']==any(s['codec_type']=='audio' for s in fp['streams']), php['doctype']=='webm', php['cues'] is True]
    print(f"{os.path.basename(f):14}"+''.join(f"{('ok' if x else 'FAIL'):>6}" for x in t)); ok+=sum(t); tot+=len(t)
print(f"\nagreement with ffprobe: {ok}/{tot} checks")
json.dump({'agree':ok,'total':tot},open('results-webm-compare.json','w'))
