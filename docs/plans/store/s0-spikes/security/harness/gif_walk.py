import sys,struct
d=open(sys.argv[1],'rb').read(); n=len(d)
pk=d[10]; p=13+(3*(1<<((pk&7)+1)) if pk&0x80 else 0)
print('hdr',d[:6],'LSD',struct.unpack('<HH',d[6:10]),'packed',hex(pk),'len',n)
def skipsub(p):
    while True:
        s=d[p]; p+=1+s
        if s==0: return p
while p<n:
    c=d[p]
    if c==0x3b: print(f'{p:#06x} TRAILER (inspect stops; {n-p-1} bytes follow)'); break
    if c==0x21:
        l=d[p+1]
        if l==0xf9: print(f'{p:#06x} GCE {d[p+2:p+8].hex()}'); p+=8; continue
        q=skipsub(p+2); print(f'{p:#06x} EXT {l:#x} len={q-p} first-subblock={d[p+2]} {d[p+3:p+14]!r}'); p=q; continue
    if c==0x2c:
        l,t,w,h=struct.unpack('<HHHH',d[p+1:p+9]); lp=d[p+9]; q=p+10+(3*(1<<((lp&7)+1)) if lp&0x80 else 0)
        q=skipsub(q+1); print(f'{p:#06x} IMG {l},{t} {w}x{h} lp={lp:#x} end={q:#x}'); p=q; continue
    print(f'{p:#06x} UNKNOWN {c:#x}'); break
