#!/usr/bin/env bash
# Simulated low-RAM-device behaviour (Chromium --enable-low-end-device-mode). NOT a physical device. usage: run-lowend.sh FIXTURE_DIR
HERE=$(cd "$(dirname "$0")" && pwd); FX=$1
for f in 480x270x60 1280x720x60 2560x976x60 800x600x300; do
  CHROME_ARGS="--enable-low-end-device-mode" node "$HERE/memory.mjs" "$FX/$f.webp" single mobile 10 >> "$HERE/results-lowend.jsonl" 2>>"$HERE/results.err"
done
v() { echo "$FX/$1.webp,$FX/$1-v1.webp,$FX/$1-v2.webp"; }
CHROME_ARGS="--enable-low-end-device-mode" node "$HERE/memory.mjs" "$(v 1280x720x60)" visible3 mobile 10 >> "$HERE/results-lowend.jsonl" 2>>"$HERE/results.err"
echo DONE > "$HERE/results-lowend.done"
