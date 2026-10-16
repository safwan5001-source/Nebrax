#!/usr/bin/env python3
"""Mutation fuzzer + Pillow differential driving worker.php.
usage: fuzz.py FMT(gif|webp) SEED ITERS OUTDIR
"""
import sys, os, json, struct, random, subprocess, time, base64, io, glob, warnings, resource, hashlib, collections
warnings.filterwarnings('ignore')
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
fmt, seed, iters, outdir = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
rng = random.Random(seed)
os.makedirs(outdir + '/bugs', exist_ok=True)
os.makedirs(outdir + '/diff', exist_ok=True)
os.makedirs(outdir + '/accepted', exist_ok=True)
EXT = fmt
FB = b'G' if fmt == 'gif' else b'W'
resource.setrlimit(resource.RLIMIT_AS, (6 << 30, 6 << 30))

seeds = [open(p, 'rb').read() for p in sorted(glob.glob(HERE + '/seeds/*.' + fmt))]
BOUND = [0, 1, 2, 3, 0x7f, 0x80, 0x81, 0xff, 0x100, 0x7fff, 0x8000, 0xffff, 0x10000, 0xfffe, 0xffffff, 0xfffffe, 0x1000000,
         0x7fffffff, 0x80000000, 0xfffffffe, 0xffffffff]

# ───────────── worker ─────────────
proc = None
def start():
    global proc
    if proc:
        try: proc.kill()
        except Exception: pass
    proc = subprocess.Popen(['php', HERE + '/worker.php'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
start()
def call(data):
    global proc
    try:
        proc.stdin.write(FB + struct.pack('<I', len(data)) + data); proc.stdin.flush()
        line = proc.stdout.readline()
        if not line: raise EOFError
        return json.loads(line)
    except (EOFError, BrokenPipeError, ValueError):
        err = b''
        try: err = proc.stderr.read(2000)
        except Exception: pass
        start()
        return {'crash': err.decode('latin1')[-300:], 'bugs': ['WORKER_CRASH'], 'ok': False}

# ───────────── Pillow ─────────────
def pil(data):
    try:
        im = Image.open(io.BytesIO(data))
        size = im.size
        n = getattr(im, 'n_frames', 1)
        return size, n, None
    except Exception as e:
        return None, None, type(e).__name__ + ':' + str(e)[:50]

# ───────────── helpers ─────────────
def u16(x): return struct.pack('<H', x & 0xffff)
def u32(x): return struct.pack('<I', x & 0xffffffff)
def u24(x): return struct.pack('<I', x & 0xffffff)[:3]
def bval():
    v = rng.choice(BOUND); return max(0, v + rng.choice([0, 0, 0, -1, 1]))

def gen_mut(d):
    d = bytearray(d)
    if not d: return bytes(d)
    op = rng.randrange(14)
    n = len(d)
    if op == 0:
        for _ in range(rng.randint(1, 8)): d[rng.randrange(n)] ^= 1 << rng.randrange(8)
    elif op == 1:
        for _ in range(rng.randint(1, 4)): d[rng.randrange(n)] = rng.randrange(256)
    elif op == 2:
        for _ in range(rng.randint(1, 4)): d[rng.randrange(n)] = rng.choice([0, 1, 0x7f, 0x80, 0xff, 0x21, 0x2c, 0x3b, 0xf9, 0xff, 0xfe])
    elif op == 3: d = d[:rng.randrange(n + 1)]
    elif op == 4:
        a = rng.randrange(n); b = min(n, a + rng.randint(1, 64)); del d[a:b]
    elif op == 5:
        a = rng.randrange(n); b = min(n, a + rng.randint(1, 128)); d[b:b] = d[a:b] * rng.randint(1, 3)
    elif op == 6:
        a = rng.randrange(n + 1); d[a:a] = bytes(rng.randrange(256) for _ in range(rng.randint(1, 16)))
    elif op == 7 and n > 8:
        k = rng.choice([2, 4]); a = rng.randrange(n - k); v = bval()
        d[a:a + k] = (u16(v) if k == 2 else u32(v)) if rng.random() < .5 else (u16(v)[::-1] if k == 2 else u32(v)[::-1])
    elif op == 8 and n > 16:
        a = rng.randrange(n - 8); b = rng.randrange(n - 8); L = rng.randint(1, 8); x = d[a:a + L]; d[a:a + L] = d[b:b + L]; d[b:b + L] = x
    elif op == 9:
        o = rng.choice(seeds); a = rng.randrange(len(o)); b = min(len(o), a + rng.randint(1, 200)); p = rng.randrange(n + 1); d[p:p] = o[a:b]
    elif op == 10:
        d = d[:max(0, n - rng.randint(1, 4))]
    elif op == 11:
        d += bytes(rng.randrange(256) for _ in range(rng.randint(1, 16)))
    elif op == 12:
        a = rng.randrange(n); d[a] = (d[a] + rng.choice([-1, 1])) & 0xff
    else:
        a = rng.randrange(n); L = rng.randint(1, 32); d[a:a + L] = bytes([rng.choice([0, 0xff, d[a]])]) * min(L, n - a)
    return bytes(d)

# ───────────── GIF structure ─────────────
def gif_parse(d):
    """tolerant: returns (head, [blocks], tail)"""
    n = len(d)
    if n < 13: return None
    pk = d[10]; p = 13
    if pk & 0x80: p += 3 * (1 << ((pk & 7) + 1))
    head = d[:p]; blocks = []
    def skipsub(p):
        while p < n:
            s = d[p]; p += 1 + s
            if s == 0: return p
        return n
    while p < n:
        c = d[p]
        if c == 0x3b: return head, blocks, d[p:]
        s = p
        if c == 0x21 and p + 2 <= n:
            l = d[p + 1]
            if l == 0xf9: p = min(n, p + 8)
            else: p = skipsub(p + 2)
            blocks.append((('ext', l), d[s:p]))
        elif c == 0x2c and p + 10 <= n:
            lp = d[p + 9]; q = p + 10
            if lp & 0x80: q += 3 * (1 << ((lp & 7) + 1))
            q = skipsub(q + 1); p = min(q, n)
            blocks.append((('img', 0), d[s:p]))
        else:
            return head, blocks, d[p:]
    return head, blocks, b''

def sub(*bs): return b''.join(bytes([len(x)]) + x for x in bs) + b'\0'
def rnd_gce():
    return b'\x21\xf9' + bytes([rng.choice([4, 4, 4, 0, 3, 5, 255])]) + bytes([rng.randrange(256) if rng.random() < .5 else 0x08]) + u16(bval()) + bytes([rng.randrange(256)]) + bytes([rng.choice([0, 0, 0, 1, 0x21, 0x2c, 0x3b])])
def rnd_ext():
    l = rng.choice([0x01, 0xfe, 0xff, 0xf9, 0x00, 0x21, 0x2c, 0x3b, 0x80, 0xfd, rng.randrange(256)])
    k = rng.choice([0, 1, 2, 5, 100])
    subs = [bytes(rng.randrange(256) for _ in range(rng.choice([0, 1, 2, 11, 3, 255, 128]))) for _ in range(k)]
    body = b''
    for x in subs: body += bytes([len(x)]) + x
    body += b'\0'
    return b'\x21' + bytes([l]) + body
def rnd_netscape():
    m = rng.choice([b'NETSCAPE2.0', b'NETSCAPE2.0', b'ANIMEXTS1.0', b'NETSCAPE2.1', b'XMP DataXMP'])
    ln = rng.choice([11, 11, 11, 10, 12, 0])
    inner = rng.choice([b'\x01' + u16(bval()), b'\x02' + u16(bval()), b'\x01\x00', b'\x01' + u16(bval()) + b'\x00\x00'])
    body = bytes([ln]) + m[:ln].ljust(ln, b'A') + bytes([len(inner)]) + inner + (b'\x03\x01\x07\x00' if rng.random() < .2 else b'') + b'\0'
    return b'\x21\xff' + body
def rnd_img(w, h):
    l = rng.choice([0, 0, 0, bval(), rng.randrange(w + 2)]); t = rng.choice([0, 0, bval(), rng.randrange(h + 2)])
    fw = rng.choice([w, w, rng.randrange(1, w + 2), bval()]); fh = rng.choice([h, h, rng.randrange(1, h + 2), bval()])
    lp = rng.choice([0, 0, 0x80, 0x87, 0x40, 0xc3, rng.randrange(256)])
    ct = b''
    if lp & 0x80: ct = bytes(rng.randrange(256) for _ in range(3 * (1 << ((lp & 7) + 1))))
    cs = rng.choice([2, 8, 8, 0, 1, 9, 12, 255])
    nb = rng.choice([0, 1, 1, 2, 5, 30])
    sb = b''
    for _ in range(nb): sb += bytes([rng.choice([1, 2, 255, 10, 0 if rng.random() < .05 else 3])])
    # build subblocks properly (sizes honest) but sometimes a lying size byte
    body = b''
    for _ in range(nb):
        L = rng.choice([1, 2, 7, 255, 128]); body += bytes([L]) + bytes(rng.randrange(256) for _ in range(L))
    body += b'\0'
    return b'\x2c' + u16(l) + u16(t) + u16(fw) + u16(fh) + bytes([lp]) + ct + bytes([cs]) + body

def gif_struct_mut(d):
    p = gif_parse(d)
    if not p: return gen_mut(d)
    head, blocks, tail = p
    blocks = list(blocks)
    w, h = struct.unpack('<HH', head[6:10]); w = max(w, 1); h = max(h, 1)
    for _ in range(rng.randint(1, 3)):
        op = rng.randrange(16)
        i = rng.randrange(len(blocks) + 1)
        if op == 0 and blocks: blocks.insert(i, blocks[rng.randrange(len(blocks))])
        elif op == 1 and blocks: del blocks[rng.randrange(len(blocks))]
        elif op == 2 and len(blocks) > 1:
            a, b = rng.randrange(len(blocks)), rng.randrange(len(blocks)); blocks[a], blocks[b] = blocks[b], blocks[a]
        elif op == 3: blocks.insert(i, (('x', 0), rnd_gce()))
        elif op == 4: blocks.insert(i, (('x', 0), rnd_ext()))
        elif op == 5: blocks.insert(i, (('x', 0), rnd_netscape()))
        elif op == 6: blocks.insert(i, (('x', 0), rnd_img(w, h)))
        elif op == 7 and blocks:
            j = rng.randrange(len(blocks)); k, bb = blocks[j]; bb = bytearray(bb)
            if bb: bb[rng.randrange(len(bb))] = rng.randrange(256) if rng.random() < .5 else rng.choice([0, 1, 0xff, 0x80, 4, 11, 3])
            blocks[j] = (k, bytes(bb))
        elif op == 8:
            head = bytearray(head); head[6:8] = u16(bval() if rng.random() < .5 else rng.randint(0, 100)); head[8:10] = u16(bval() if rng.random() < .5 else rng.randint(0, 100)); head = bytes(head)
        elif op == 9:
            head = bytearray(head); head[10] = rng.randrange(256) if rng.random() < .5 else head[10] ^ (1 << rng.randrange(8)); head = bytes(head)
        elif op == 10:
            head = bytearray(head)
            head[:6] = rng.choice([b'GIF87a', b'GIF89a', b'GIF89a', b'GIF88a'])
            head = bytes(head)
        elif op == 11 and blocks:  # truncate a block in the middle
            j = rng.randrange(len(blocks)); k, bb = blocks[j]; blocks[j] = (k, bb[:rng.randrange(len(bb) + 1)])
        elif op == 12 and blocks:  # lots of tiny sub-blocks in an ext
            blocks.insert(i, (('x', 0), b'\x21' + bytes([rng.choice([0xfe, 0xff, 0x01, 0xab])]) + b'\x01\x41' * rng.randint(1, 3000) + b'\0'))
        elif op == 13 and blocks:  # image with LCT flag lying
            j = rng.randrange(len(blocks)); k, bb = blocks[j]
            if k[0] == 'img' and len(bb) > 10:
                bb = bytearray(bb); bb[9] = rng.randrange(256); blocks[j] = (k, bytes(bb))
        elif op == 14 and blocks:  # frame x/y/w/h boundary
            j = rng.randrange(len(blocks)); k, bb = blocks[j]
            if k[0] == 'img' and len(bb) > 10:
                bb = bytearray(bb); o = rng.choice([1, 3, 5, 7]); bb[o:o + 2] = u16(bval() if rng.random() < .6 else rng.randint(0, 64)); blocks[j] = (k, bytes(bb))
        elif op == 15 and blocks:  # GCE field tweaks
            j = rng.randrange(len(blocks)); k, bb = blocks[j]
            if k == ('ext', 0xf9) and len(bb) == 8:
                bb = bytearray(bb); o = rng.choice([2, 3, 4, 5, 6, 7]); bb[o] = rng.choice([0, 1, 4, 5, 0xff, 0x21, 0x2c, 0x3b, rng.randrange(256)]); blocks[j] = (k, bytes(bb))
    out = head + b''.join(b for _, b in blocks) + (tail if rng.random() < .85 else b'')
    if rng.random() < .1: out += b'\x3b'
    return out

# ───────────── WebP structure ─────────────
def riff_parse(d, s=12, e=None):
    e = len(d) if e is None else e
    out = []; p = s
    while p + 8 <= e:
        sz = struct.unpack('<I', d[p + 4:p + 8])[0]
        end = min(e, p + 8 + sz + (sz & 1))
        out.append([d[p:p + 4], d[p + 8:min(e, p + 8 + sz)]])
        if p + 8 + sz + (sz & 1) > e: break
        p = end
    return out
def mk_chunk(cid, data, lie=None):
    sz = len(data) if lie is None else lie
    return cid + u32(sz) + data + (b'\0' if len(data) & 1 else b'')
def riff_build(chunks, lies=None, fix_riff=True):
    body = b'WEBP'
    for i, (cid, data) in enumerate(chunks):
        body += mk_chunk(cid, data, lies.get(i) if lies else None)
    size = len(body) if fix_riff else bval()
    return b'RIFF' + u32(size) + body
IDS = [b'VP8X', b'ANIM', b'ANMF', b'ICCP', b'EXIF', b'XMP ', b'ALPH', b'VP8 ', b'VP8L', b'JUNK', b'ANMF', b'ANMF', b'RIFF', b'WEBP']
def rnd_anmf_hdr():
    return u24(rng.choice([0, 0, 0, bval(), rng.randrange(5)])) + u24(rng.choice([0, 0, bval(), rng.randrange(5)])) + u24(rng.choice([0, 0, bval(), 10])) + u24(rng.choice([0, 0, bval(), 10])) + u24(rng.choice([0, 1, 10, 100, bval()])) + bytes([rng.randrange(256) if rng.random() < .3 else rng.choice([0, 1, 2, 3])])

def webp_struct_mut(d):
    if len(d) < 20 or d[:4] != b'RIFF': return gen_mut(d)
    chunks = riff_parse(d)
    lies = {}
    fix = True
    for _ in range(rng.randint(1, 3)):
        op = rng.randrange(20)
        n = len(chunks)
        i = rng.randrange(n + 1)
        if op == 0 and n: chunks.insert(i, list(chunks[rng.randrange(n)]))
        elif op == 1 and n: del chunks[rng.randrange(n)]
        elif op == 2 and n > 1:
            a, b = rng.randrange(n), rng.randrange(n); chunks[a], chunks[b] = chunks[b], chunks[a]
        elif op == 3:
            chunks.insert(i, [rng.choice(IDS), bytes(rng.randrange(256) for _ in range(rng.choice([0, 1, 5, 6, 10, 16, 24, 30])))])
        elif op == 4 and n:
            j = rng.randrange(n); lies[j] = bval() if rng.random() < .6 else max(0, len(chunks[j][1]) + rng.choice([-2, -1, 1, 2]))
        elif op == 5 and n:
            j = rng.randrange(n); cid, dd = chunks[j]; dd = bytearray(dd)
            if dd: dd[rng.randrange(len(dd))] = rng.choice([0, 1, 0xff, 0x80, rng.randrange(256)])
            chunks[j][1] = bytes(dd)
        elif op == 6 and n:  # VP8X flags/dims
            for c in chunks:
                if c[0] == b'VP8X' and len(c[1]) >= 10:
                    dd = bytearray(c[1])
                    k = rng.randrange(4)
                    if k == 0: dd[0] = rng.randrange(256)
                    elif k == 1: dd[0] ^= rng.choice([2, 4, 8, 0x10, 0x20, 1, 0x80])
                    elif k == 2: dd[4:7] = u24(rng.choice([bval(), rng.randrange(0, 200)]))
                    else: dd[7:10] = u24(rng.choice([bval(), rng.randrange(0, 200)]))
                    if rng.random() < .1: dd[1:4] = bytes(rng.randrange(256) for _ in range(3))
                    c[1] = bytes(dd); break
        elif op == 7:  # ANMF header
            idx = [k for k, c in enumerate(chunks) if c[0] == b'ANMF' and len(c[1]) >= 16]
            if idx:
                c = chunks[rng.choice(idx)]; dd = bytearray(c[1]); o = rng.choice([0, 3, 6, 9, 12, 15]); L = 1 if o == 15 else 3
                v = rng.choice([bval(), rng.randrange(0, 100)]); dd[o:o + L] = (u24(v) if L == 3 else bytes([v & 255])); c[1] = bytes(dd)
        elif op == 8:  # ANIM
            for c in chunks:
                if c[0] == b'ANIM' and len(c[1]) >= 6:
                    dd = bytearray(c[1]); o = rng.choice([0, 4]); dd[o:o + 2] = u16(bval()); c[1] = bytes(dd); break
        elif op == 9:  # nest ANMF inside ANMF
            idx = [k for k, c in enumerate(chunks) if c[0] == b'ANMF' and len(c[1]) >= 16]
            if idx:
                k = rng.choice(idx); c = chunks[k]
                inner = mk_chunk(b'ANMF', c[1]) if rng.random() < .5 else b''.join(mk_chunk(i[0], i[1]) for i in riff_parse(c[1], 16, len(c[1])))
                c[1] = c[1][:16] + inner + (c[1][16:] if rng.random() < .5 else b'')
        elif op == 10:  # inject unknown/extra chunk into ANMF
            idx = [k for k, c in enumerate(chunks) if c[0] == b'ANMF' and len(c[1]) >= 16]
            if idx:
                c = chunks[rng.choice(idx)]; ins = mk_chunk(rng.choice(IDS), bytes(rng.randrange(256) for _ in range(rng.choice([0, 1, 3, 8]))), lie=None if rng.random() < .8 else bval())
                pos = rng.choice([16, len(c[1])]); c[1] = c[1][:pos] + ins + c[1][pos:]
        elif op == 11:  # dup frame many times
            idx = [k for k, c in enumerate(chunks) if c[0] == b'ANMF']
            if idx:
                c = chunks[rng.choice(idx)]; r = rng.choice([2, 5, 50, 300, 301, 1999, 2000, 2001])
                chunks[i:i] = [list(c) for _ in range(r)]
        elif op == 12: fix = False
        elif op == 13 and n:  # sub-chunk size lie inside ANMF
            idx = [k for k, c in enumerate(chunks) if c[0] == b'ANMF' and len(c[1]) >= 24]
            if idx:
                c = chunks[rng.choice(idx)]; dd = bytearray(c[1]); dd[20:24] = u32(bval()); c[1] = bytes(dd)
        elif op == 14 and n:  # truncate chunk payload (pad parity flips)
            j = rng.randrange(n); chunks[j][1] = chunks[j][1][:rng.randrange(len(chunks[j][1]) + 1)]
        elif op == 15 and n:  # odd-size pad byte nonzero
            j = rng.randrange(n); chunks[j][1] = chunks[j][1] + b'\x41' * rng.choice([1, 3])
        elif op == 16:
            o = rng.choice(seeds); oc = riff_parse(o) if o[:4] == b'RIFF' else []
            if oc: chunks.insert(i, list(rng.choice(oc)))
        elif op == 17 and n:
            j = rng.randrange(n); chunks[j][0] = rng.choice(IDS)
        elif op == 18:
            chunks.insert(i, [b'ANMF', rnd_anmf_hdr() + mk_chunk(rng.choice([b'VP8L', b'VP8 ', b'ALPH']), bytes(rng.randrange(256) for _ in range(rng.choice([0, 5, 10]))))])
        elif op == 19 and n:
            j = rng.randrange(n); chunks[j][1] = chunks[j][1] + bytes(rng.randrange(256) for _ in range(rng.choice([1, 2, 4, 100])))
    out = riff_build(chunks, lies, fix_riff=fix and rng.random() < .97)
    if rng.random() < .05: out += bytes(rng.randrange(256) for _ in range(rng.randint(1, 20)))
    if rng.random() < .04: out = out[:rng.randrange(len(out) + 1)]
    return out

def mutate(d):
    steps = rng.choice([1, 1, 1, 2, 2, 3])
    for _ in range(steps):
        r = rng.random()
        if r < .45 or os.environ.get('FUZZ_MODE')=='struct': d = (gif_struct_mut if fmt == 'gif' else webp_struct_mut)(d)
        else:
            d = gen_mut(d)
            if fmt == 'webp' and rng.random() < .5 and d[:4] == b'RIFF' and len(d) >= 8:  # keep RIFF size honest
                d = d[:4] + u32(len(d) - 8) + d[8:]
    return d[:5 * 1024 * 1024]

# ───────────── main loop ─────────────
stats = collections.Counter(); maxes = {'t': (0, None), 'mem': (0, None)}
bugs_seen = collections.Counter(); diff_seen = collections.Counter(); notes = collections.Counter(); codes = collections.Counter()
acc_saved = 0
t0 = time.time()
def save(kind, sig, data, extra=''):
    sigc = ''.join(ch if ch.isalnum() else '_' for ch in sig)[:60]
    key = (kind, sigc)
    cnt = (bugs_seen if kind == 'bugs' else diff_seen)
    cnt[key] += 1
    if cnt[key] <= 4:
        h = hashlib.md5(data).hexdigest()[:8]
        open(f'{outdir}/{kind}/{sigc}_{h}.{EXT}', 'wb').write(data)
        if extra: open(f'{outdir}/{kind}/{sigc}_{h}.txt', 'w').write(extra)

def check(data, tag):
    global acc_saved
    r = call(data)
    stats['inputs'] += 1
    st = r.get('st', {})
    tt = sum(v for k, v in st.items() if k.endswith('_ms'))
    mm = max([v for k, v in st.items() if k.endswith('_mem')] or [0])
    if tt > maxes['t'][0]: maxes['t'] = (tt, hashlib.md5(data).hexdigest()[:8]); open(outdir + '/slowest.' + EXT, 'wb').write(data)
    if mm > maxes['mem'][0]: maxes['mem'] = (mm, hashlib.md5(data).hexdigest()[:8]); open(outdir + '/hungriest.' + EXT, 'wb').write(data)
    for b in r.get('bugs', []): save('bugs', b.split(':')[0][:40] + (':' + b.split(':')[1][:20] if b.startswith('grammar') else ''), data, b)
    for n in r.get('note', []): notes[n.split(':')[0]] += 1
    if not r.get('ok'):
        codes[r.get('code', 'crash')] += 1
        return r
    stats['accepted'] += 1
    meta = r['meta']; san = base64.b64decode(r['san'])
    # Pillow differential on input and sanitised
    for name, blob in (('in', data), ('san', san)):
        size, n, err = pil(blob)
        if err:
            c = 'pilrej_' + name
            diff_seen[('stat', c)] += 1
            save('diff', c + '_' + err.split(':')[0] + '_' + ('anim' if meta['animated'] else 'still'), data, json.dumps(meta) + ' ' + err)
            continue
        want = meta['frames']
        if n > want: save('diff', f'MORE_{name}', data, f'{meta} pillow n={n} size={size}')
        elif n < want and meta['animated']: save('diff', f'fewer_{name}', data, f'{meta} pillow n={n} size={size}')
        if meta['width'] and tuple(size) != (meta['width'], meta['height']): save('diff', f'size_{name}', data, f'{meta} pillow n={n} size={size}')
        diff_seen[('stat', 'compared_' + name)] += 1
    if acc_saved < 1500 and (rng.random() < 0.05 or stats['accepted'] < 200):
        h = hashlib.md5(data).hexdigest()[:10]
        open(f'{outdir}/accepted/{h}.{EXT}', 'wb').write(data); acc_saved += 1
    return r

# seeds first
for s in seeds: check(s, 'seed')
seed_ok = stats['accepted']
corpus = list(seeds)
def exhaustive():
    for sd in seeds:
        if len(sd) > int(os.environ.get('EXH_MAX', 2500)): continue
        n = len(sd)
        for k in range(n): yield sd[:k]                       # every truncation
        for k in range(n):
            for v in (0, 1, 0x7f, 0x80, 0xff, (sd[k] + 1) & 255, (sd[k] - 1) & 255):
                if v != sd[k]: yield sd[:k] + bytes([v]) + sd[k+1:]
            for b in range(8): yield sd[:k] + bytes([sd[k] ^ (1 << b)]) + sd[k+1:]
if os.environ.get('FUZZ_MODE') == 'exhaustive':
    for m in exhaustive():
        check(m, 'exh')
    iters = 0
for it in range(iters):
    base = rng.choice(corpus)
    m = mutate(base)
    r = check(m, 'mut')
    if r.get('ok') and len(corpus) < 600 and rng.random() < 0.15 and len(m) < 200000: corpus.append(m)
    if it % 20000 == 0 and it: print(f'[{fmt}/{seed}] {it} {time.time()-t0:.0f}s acc={stats["accepted"]}', flush=True)

summary = {'fmt': fmt, 'seed': seed, 'seeds_accepted': seed_ok, 'stats': dict(stats), 'max_time_ms': maxes['t'], 'max_mem_bytes': maxes['mem'],
           'bugs': {f'{k[1]}': v for k, v in bugs_seen.items()}, 'diff': {f'{k[0]}:{k[1]}' if k[0] != 'diff' else k[1]: v for k, v in diff_seen.items()},
           'notes': dict(notes), 'reject_codes': dict(codes), 'secs': round(time.time() - t0)}
json.dump(summary, open(outdir + '/summary.json', 'w'), indent=1)
print(json.dumps(summary))
