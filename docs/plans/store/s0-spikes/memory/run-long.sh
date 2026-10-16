#!/usr/bin/env bash
# 300-frame fixtures need a long window (30 s loop at 100 ms/frame). usage: run-long.sh FIXTURE_DIR
HERE=$(cd "$(dirname "$0")" && pwd); FX=$1
for c in 800x600x300 640x360x300; do
  for e in webp gif; do node "$HERE/memory.mjs" "$FX/$c.$e" single desktop 45 >> "$HERE/results.jsonl" 2>>"$HERE/results.err"; done
  CHROME_ARGS="--enable-low-end-device-mode" node "$HERE/memory.mjs" "$FX/$c.webp" single mobile 45 >> "$HERE/results-lowend.jsonl" 2>>"$HERE/results.err"
done
node "$HERE/memory.mjs" "$FX/800x600x300.webp" single mobile 45 >> "$HERE/results.jsonl" 2>>"$HERE/results.err"
echo DONE > "$HERE/results-long.done"
