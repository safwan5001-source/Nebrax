import sys,glob,json,struct,base64,subprocess,io,collections,warnings
warnings.filterwarnings('ignore')
from PIL import Image
Image.MAX_IMAGE_PIXELS=None
w=subprocess.Popen(['php','worker.php'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,env={'FUZZ_NO_GD':'1','PATH':'/usr/bin:/bin'})
def call(d):
    w.stdin.write(b'W'+struct.pack('<I',len(d))+d); w.stdin.flush(); return json.loads(w.stdout.readline())
def u32(d,o): return struct.unpack('<I',d[o:o+4])[0]
def u24(d,o): return d[o]|d[o+1]<<8|d[o+2]<<16
def chunks(d,s,e):
    out=[];p=s
    while p+8<=e:
        sz=u32(d,p+4); out.append((d[p:p+4],p+8,sz)); p+=8+sz+(sz&1)
    return out
def causes(d):
    c=set()
    top=chunks(d,12,u32(d,4)+8)
    for cid,o,sz in top:
        if cid==b'ANMF':
            fw=u24(d,o+6)+1; fh=u24(d,o+9)+1
            inner=chunks(d,o+16,o+sz)
            ids=[i[0] for i in inner]
            for i,(ic,io_,isz) in enumerate(inner):
                if ic==b'VP8L' and isz>=5:
                    v=struct.unpack('<I',d[io_+1:io_+5])[0]
                    if ((v&0x3fff)+1,((v>>14)&0x3fff)+1)!=(fw,fh): c.add('vp8l_dims_ne_anmf')
                    if d[io_]!=0x2f: c.add('vp8l_bad_sig')
                elif ic==b'VP8L': c.add('vp8l_short')
                if ic==b'VP8 ' and isz>=10:
                    w_,h_=struct.unpack('<HH',d[io_+6:io_+10]); 
                    if (w_&0x3fff,h_&0x3fff)!=(fw,fh): c.add('vp8_dims_ne_anmf')
                    if d[io_+3:io_+6]!=b'\x9d\x01\x2a': c.add('vp8_bad_sig')
            if b'ALPH' in ids and b'VP8L' in ids: c.add('ALPH+VP8L')
            if ids.count(b'ALPH')>1: c.add('multi_ALPH')
            bi=[k for k,x in enumerate(ids) if x in (b'VP8 ',b'VP8L')]
            if bi and any(x==b'ALPH' and k>bi[0] for k,x in enumerate(ids)): c.add('ALPH_after_image')
            if ids and ids[0] not in (b'ALPH',b'VP8 ',b'VP8L'): c.add('first_inner_unknown')
    return c or {'unknown'}
cnt=collections.Counter(); ex={}
for p in sorted(glob.glob(sys.argv[1]+'/accepted/*.webp')):
    d=open(p,'rb').read(); r=call(d)
    if not r.get('ok') or not r['meta']['animated']: continue
    san=base64.b64decode(r['san'])
    try: Image.open(io.BytesIO(san)).n_frames; cnt['pillow_ok']+=1; continue
    except Exception as e: pass
    cs=tuple(sorted(causes(san))); cnt[cs]+=1; ex.setdefault(cs,p)
for k,v in cnt.most_common(): print(v,k,ex.get(k))
