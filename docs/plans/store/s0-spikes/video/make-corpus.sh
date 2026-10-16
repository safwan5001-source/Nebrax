#!/usr/bin/env bash
# S0-C/D: deterministic video corpus (needs ffmpeg with libx264/libx265/libvpx/libaom). Output ./corpus/. 640x360, 3 s, 30 fps.
set -euo pipefail
cd "$(dirname "$0")"; rm -rf corpus; mkdir corpus; cd corpus
SRC="-f lavfi -i testsrc2=size=640x360:rate=30:duration=3"
Q="ffmpeg -hide_banner -loglevel error -y"
$Q $SRC -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -movflags +faststart -an h264-baseline-faststart.mp4
$Q $SRC -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p -movflags +faststart -an h264-high-faststart.mp4
$Q $SRC -c:v libx264 -profile:v main -pix_fmt yuv420p -an h264-nofaststart.mp4                                  # moov AFTER mdat
$Q $SRC -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k -shortest -movflags +faststart h264-aac-audio.mp4
$Q $SRC -c:v libx264 -pix_fmt yuv420p -an -movflags +frag_keyframe+empty_moov+default_base_moof h264-fragmented.mp4
$Q $SRC -c:v libx264 -pix_fmt yuv420p -an -movflags +faststart -metadata title="gps-test" h264-title-meta.mp4
$Q $SRC -c:v libx264 -pix_fmt yuv420p -an -f mov -movflags +faststart -metadata location="+37.7749-122.4194/" h264-gps-quicktime.mov   # iPhone-style: moov/udta/©xyz, brand "qt  "
$Q -display_rotation 90 -i h264-high-faststart.mp4 -c copy h264-rotated90.mp4   # display_rotation is an INPUT option
$Q $SRC -c:v libx265 -tag:v hvc1 -pix_fmt yuv420p -an -movflags +faststart -x265-params log-level=none hevc.mp4
$Q $SRC -c:v libsvtav1 -preset 10 -pix_fmt yuv420p -an -movflags +faststart av1.mp4
$Q $SRC -c:v libvpx-vp9 -b:v 0 -crf 40 -an vp9.webm
$Q $SRC -c:v libvpx -b:v 500k -an vp8.webm
$Q $SRC -c:v libsvtav1 -preset 10 -an av1.webm
# a 15 MB / ~1080p-class file for streaming tests (high bitrate noise)
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=15" -vf "noise=alls=20:allf=t" -c:v libx264 -b:v 8M -maxrate 8M -bufsize 16M -pix_fmt yuv420p -an -movflags +faststart big-1080p-8mbps.mp4
# hostile
head -c 3000 h264-baseline-faststart.mp4 > trunc.mp4
python3 - <<'PY'
b=bytearray(open('h264-baseline-faststart.mp4','rb').read()); import struct
# lie about the size of the 2nd top-level box (moov)
ftyp=struct.unpack('>I',b[0:4])[0]; b[ftyp:ftyp+4]=struct.pack('>I',0xFFFFFFF0); open('hostile-boxsize.mp4','wb').write(b)
PY
# animated GIF / WebP controls (the exact sanitised bytes the PHP pipeline serves) for the animation-advances check
FX=../../../../../../storefront/e2e/support/animated-fixtures; cp $FX/control-original.gif control.gif; cp $FX/animated.gif animated.gif; cp $FX/animated.webp animated.webp
ls -l | awk 'NR>1{printf "%-34s %9d\n",$9,$5}'
