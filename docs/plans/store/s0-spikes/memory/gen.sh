#!/usr/bin/env bash
# F3 memory assessment — builds animated GIF + WebP fixtures of a given (W H FRAMES) into $OUT (default ./out).
# Content is a two-frame gradient loop: decoded memory does not depend on content, only on W x H x frames.
# usage: gen.sh OUT W H FRAMES [VARIANT=0]   (VARIANT changes the colours so files are byte-different)
set -euo pipefail
OUT=$1; W=$2; H=$3; N=$4; V=${5:-0}; NAME="${W}x${H}x${N}"; ((V)) && NAME="$NAME-v$V"; mkdir -p "$OUT"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
convert -size "${W}x${H}" gradient:'#d02020-#2020d0' -modulate 100,100,$((100 + V * 17)) "$T/a.png"
convert -size "${W}x${H}" gradient:'#20d020-#d0d020' -modulate 100,100,$((100 + V * 17)) "$T/b.png"
args=(); for ((i = 0; i < N; i++)); do if ((i % 2)); then args+=("$T/b.png"); else args+=("$T/a.png"); fi; done
convert -delay 10 -loop 0 "${args[@]}" "$OUT/$NAME.gif"
img2webp -loop 0 -d 100 -lossy -q 70 "${args[@]}" -o "$OUT/$NAME.webp" >/dev/null 2>&1
echo "$NAME $(stat -c%s "$OUT/$NAME.gif") $(stat -c%s "$OUT/$NAME.webp")"
