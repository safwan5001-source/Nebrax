#!/usr/bin/env python3
"""Chromium (WebCodecs ImageDecoder + <img>) differential. usage: phase3.py fmt out.json files..."""
import sys,os,json,struct,base64,subprocess,hashlib,collections,shutil
HERE=os.path.dirname(os.path.abspath(__file__))
fmt=sys.argv[1]; out=sys.argv[2]; files=sys.argv[3:]
FB=b'G' if fmt=='gif' else b'W'
w=subprocess.Popen(['php',HERE+'/worker.php'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env={'FUZZ_NO_GD':'1','PATH':'/usr/bin:/bin'})
def call(d):
    w.stdin.write(FB+struct.pack('<I',len(d))+d); w.stdin.flush(); return json.loads(w.stdout.readline())
tmp='/tmp/b3_'+hashlib.md5(out.encode()).hexdigest()[:6]; shutil.rmtree(tmp,ignore_errors=True); os.makedirs(tmp)
metas={}; paths=[]
for f in files:
    d=open(f,'rb').read(); r=call(d)
    if not r.get('ok') or not r['meta']['animated']: continue
    h=hashlib.md5(d).hexdigest()[:10]
    pi=f'{tmp}/{h}.in.{fmt}'; ps=f'{tmp}/{h}.san.{fmt}'
    shutil.copy(f,pi); open(ps,'wb').write(base64.b64decode(r['san']))
    metas[pi]=(r['meta'],f); metas[ps]=(r['meta'],f); paths+=[pi,ps]
print('files to run',len(paths),flush=True)
res={}
for i in range(0,len(paths),400):
    subprocess.run(['node',HERE+'/browser.mjs',tmp+'/res.json']+paths[i:i+400],check=True)
    res.update(json.load(open(tmp+'/res.json')))
agg=collections.defaultdict(collections.Counter); ex=collections.defaultdict(list)
for p,r in res.items():
    meta,orig=metas[p]; kind='san' if '.san.' in p else 'in'
    if 'err' in r or 'frames' not in r: cat='rejected'
    elif r['frames']>meta['frames']: cat='MORE_frames'
    elif r['frames']<meta['frames']: cat='fewer_frames'
    else: cat='same_frames'
    if 'frames' in r and 'w' in r and (r['w'],r['h'])!=(meta['width'],meta['height']): cat+='+SIZE_DIFF'
    if 'frames' in r and r.get('decodeErr'): cat+='+decodeErr'
    agg[kind][cat]+=1
    if cat not in ('same_frames',) and len(ex[kind+'/'+cat])<5: ex[kind+'/'+cat].append((orig,p,meta['frames'],meta['width'],meta['height'],r))
json.dump({'n':len(res),'agg':{k:dict(v) for k,v in agg.items()},'ex':ex},open(out,'w'),indent=1)
print(json.dumps({k:dict(v) for k,v in agg.items()}))
