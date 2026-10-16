#!/usr/bin/env bash
# S0-A: deterministic AVIF / AVIS corpus (needs: imagemagick `convert`, libavif-bin `avifenc`). Output: ./corpus/
set -euo pipefail
cd "$(dirname "$0")"; rm -rf corpus; mkdir corpus; cd corpus
mk() { convert -size "$1" "$2" "$3"; }
# --- frames
mk 400x400 xc:red a.png; mk 400x400 xc:blue b.png; mk 400x400 xc:lime c.png
for c in "255,0,0" "0,0,255" "0,255,0"; do convert -size 400x400 xc:"rgba($c,0.5)" "ap-${c//,/_}.png"; done   # half-transparent r/b/g
mk 1920x600 gradient:red-blue big0.png; for i in $(seq 1 59); do convert big0.png -modulate 100,100,$((i*3)) big$i.png; done
mk 800x400 gradient:yellow-green still.png
# --- still
avifenc -q 60 -s 8 still.png still.avif >/dev/null
# --- animated sequences (avis). --timescale 5 => 5 fps => 200 ms per frame (matches the GIF/WebP fixtures)
avifenc -q 60 -s 8 --timescale 5 --duration 1 a.png b.png c.png anim3.avif >/dev/null
avifenc -q 60 -s 8 --timescale 5 --duration 1 ap-255_0_0.png ap-0_0_255.png ap-0_255_0.png anim3-alpha.avif >/dev/null
avifenc -q 40 -s 9 --timescale 10 --duration 1 $(for i in $(seq 0 59); do echo big$i.png; done) anim60-big.avif >/dev/null
# --- metadata: Exif + XMP items (should be detected/rejected by a validator)
printf 'Exif\0\0MM\0*\0\0\0\10\0\0' > exif.bin; printf '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>' > xmp.xml
avifenc -q 60 -s 8 --exif exif.bin --xmp xmp.xml still.png still-meta.avif >/dev/null
# --- hostile: truncated at several offsets, bogus box size
head -c 400 anim3.avif > trunc-400.avif; head -c 800 anim3.avif > trunc-800.avif
python3 - <<'PY'
import struct
b=bytearray(open('anim3.avif','rb').read())
# first box after ftyp: lie about its size (0xFFFFFFF0)
ftyp=struct.unpack('>I',b[0:4])[0]
b[ftyp:ftyp+4]=struct.pack('>I',0xFFFFFFF0)
open('hostile-boxsize.avif','wb').write(b)
PY
ls -l *.avif
