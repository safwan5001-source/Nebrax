#!/usr/bin/env python3
"""Differential vs gifsicle / ImageMagick / ffprobe (GIF) and webpmux / anim_dump / Pillow (WebP) on inspect()-accepted files and their sanitised output."""
import sys, os, re, json, glob, subprocess, struct, base64, collections, tempfile, shutil, random, io, warnings, hashlib
warnings.filterwarnings('ignore')
from multiprocessing import Pool
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
HERE=os.path.dirname(os.path.abspath(__file__))
fmt=sys.argv[1]; outjson=sys.argv[2]; files=sys.argv[3:]
FB=b'G' if fmt=='gif' else b'W'
def run(cmd, timeout=20):
    try:
        p=subprocess.run(cmd,capture_output=True,timeout=timeout)
        return p.returncode,p.stdout.decode('latin1'),p.stderr.decode('latin1')
    except subprocess.TimeoutExpired: return 124,'','timeout'
def tool_results(path):
    R={}
    if fmt=='gif':
        rc,o,e=run(['gifsicle','--info',path])
        m=re.search(r'(\d+) images?',o); sz=re.search(r'logical screen (\d+)x(\d+)',o)
        R['gifsicle']=(int(m.group(1)),(int(sz.group(1)),int(sz.group(2)))) if rc==0 and m and sz else ('rej',e[:60].strip())
        rc,o,e=run(['identify','-ping','-format','%w %h\n',path])
        lines=[l for l in o.split('\n') if l.strip()]
        R['im_ping']=(len(lines),tuple(map(int,lines[0].split()))) if rc==0 and lines else ('rej',(e.strip()[:60]))
        rc,o,e=run(['identify','-format','%w %h\n',path])
        lines=[l for l in o.split('\n') if l.strip()]
        R['im_full']=(len(lines),tuple(map(int,lines[0].split()))) if lines else ('rej',(e.strip()[:60]))
        rc,o,e=run(['ffprobe','-v','error','-select_streams','v:0','-count_packets','-show_entries','stream=nb_read_packets,width,height','-of','csv=p=0',path])
        parts=o.strip().split(',')
        try: R['ffprobe']=(int(parts[2]),(int(parts[0]),int(parts[1])))
        except Exception: R['ffprobe']=('rej',e.strip()[:60])
    else:
        rc,o,e=run(['webpmux','-info',path])
        nf=re.search(r'Number of frames: (\d+)',o); cs=re.search(r'Canvas size: (\d+) x (\d+)',o)
        R['webpmux']=(int(nf.group(1)),(int(cs.group(1)),int(cs.group(2)))) if rc==0 and nf and cs else ('rej',(o+e)[:60].strip())
        d=tempfile.mkdtemp()
        rc,o,e=run(['anim_dump','-folder',d,'-prefix','f',path],timeout=30)
        n=len(os.listdir(d)); shutil.rmtree(d,ignore_errors=True)
        R['anim_dump']=(n,None) if rc==0 and n>0 else ('rej',(o+e)[:60].strip())
    try:
        im=Image.open(path); R['pillow']=(getattr(im,'n_frames',1),tuple(im.size))
    except Exception as ex: R['pillow']=('rej',type(ex).__name__)
    return R

def work(path):
    # ask the PHP worker
    import subprocess as sp
    w=sp.Popen(['php',HERE+'/worker.php'],stdin=sp.PIPE,stdout=sp.PIPE,env={**os.environ,'FUZZ_NO_GD':'1'})
    data=open(path,'rb').read()
    w.stdin.write(FB+struct.pack('<I',len(data))+data); w.stdin.flush()
    r=json.loads(w.stdout.readline()); w.kill()
    if not r.get('ok'): return None
    meta=r['meta']; san=base64.b64decode(r['san'])
    tmp=tempfile.mkdtemp(); out=[]
    for name,blob in (('in',data),('san',san)):
        p=f'{tmp}/x.{fmt}'; open(p,'wb').write(blob)
        out.append((name,tool_results(p)))
    shutil.rmtree(tmp,ignore_errors=True)
    return path,meta,out

if __name__=='__main__':
    with Pool(4) as pool: res=[x for x in pool.imap_unordered(work,files,chunksize=8) if x]
    agg=collections.defaultdict(collections.Counter); ex=collections.defaultdict(list)
    for path,meta,out in res:
        for name,R in out:
            for tool,v in R.items():
                if v[0]=='rej': cat='rejected'
                else:
                    n,size=v
                    want=meta['frames'] if meta['animated'] else None
                    if not meta['animated']: cat='n/a_single'; 
                    elif n>want: cat='MORE_frames'
                    elif n<want: cat='fewer_frames'
                    else: cat='same_frames'
                    if size and meta['width'] and tuple(size)!=(meta['width'],meta['height']): cat+='+SIZE_DIFF'
                agg[f'{tool}/{name}'][cat]+=1
                if cat not in ('same_frames','n/a_single') and len(ex[f'{tool}/{name}/{cat}'])<4: ex[f'{tool}/{name}/{cat}'].append((path,meta['frames'],str(v)[:90]))
    json.dump({'n':len(res),'agg':{k:dict(v) for k,v in agg.items()},'examples':ex},open(outjson,'w'),indent=1)
    print(json.dumps({'n':len(res),'agg':{k:dict(v) for k,v in sorted(agg.items())}},indent=0))
