import sys,struct
def u32(d,o): return struct.unpack('<I',d[o:o+4])[0]
def u24(d,o): return d[o]|d[o+1]<<8|d[o+2]<<16
def walk(d,s,e,ind=0,out=None):
    p=s
    while p+8<=e:
        sz=u32(d,p+4); cid=d[p:p+4]; info=''
        body=d[p+8:p+8+sz]
        if cid==b'VP8X': info=f'flags={body[0]:#x} canvas={u24(body,4)+1}x{u24(body,7)+1}'
        elif cid==b'ANMF': info=f'x={u24(body,0)*2} y={u24(body,3)*2} {u24(body,6)+1}x{u24(body,9)+1} dur={u24(body,12)} fl={body[15]:#x}'
        elif cid==b'VP8L' and sz>5: v=struct.unpack('<I',body[1:5])[0]; info=f'sig={body[0]:#x} {(v&0x3fff)+1}x{((v>>14)&0x3fff)+1} alpha={(v>>28)&1}'
        elif cid==b'VP8 ' and sz>9: info=f'dims={struct.unpack("<HH",body[6:10])}'
        print(' '*ind+f'{p:5d} {cid} size={sz} {info}')
        if cid==b'ANMF': walk(d,p+8+16,p+8+sz,ind+3)
        p+=8+sz+(sz&1)
    if p<e: print(' '*ind+f'  trailing {e-p} bytes')
d=open(sys.argv[1],'rb').read(); print('len',len(d),'riff',u32(d,4)+8); walk(d,12,min(len(d),u32(d,4)+8))
