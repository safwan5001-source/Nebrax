#!/usr/bin/env bash
# usage: run-matrix.sh FIXTURE_DIR [single|multi|all]   → appends one JSON line per run to results.jsonl (headless Chromium; see memory.mjs)
# Fixtures come from gen.sh: every size once (single) and three byte-different variants (-v1, -v2) for the multi-image scenarios.
set -u; FX=$1; PART=${2:-all}; HERE=$(cd "$(dirname "$0")" && pwd); R=$HERE/results.jsonl
[ "$PART" = all ] && : > "$R"
run() { # file[,file2…] scenario profile [seconds]
  local f; f=$(echo "$1" | sed "s#\([^,]*\)#$FX/\1#g")
  node "$HERE/memory.mjs" "$f" "$2" "$3" "${4:-8}" >> "$R" 2>>"$HERE/results.err" || echo "{\"file\":\"$1\",\"scenario\":\"$2\",\"profile\":\"$3\",\"error\":true}" >> "$R"; }
if [ "$PART" != multi ]; then
  for c in 480x270x60 800x450x100 1280x720x30 1280x720x60 1920x1080x60 2560x976x30 2560x976x60 800x600x300 640x360x300; do
    for e in webp gif; do run "$c.$e" single desktop; done
  done
  for c in 480x270x60 1280x720x60 2560x976x60 800x600x300; do run "$c.webp" single mobile; done
fi
if [ "$PART" != single ]; then
  three() { echo "$1.webp,$1-v1.webp,$1-v2.webp"; }
  for s in stack3 visible3 offscreen3 hidden3; do run "$(three 2560x976x60)" $s desktop 12; done
  for c in 1280x720x60 1280x720x30; do for s in stack3 visible3; do run "$(three $c)" $s desktop 12; done; done
  run "$(three 1280x720x60)" stack3 mobile 12
  run "$(three 1280x720x60)" visible3 mobile 12
  run "$(three 2560x976x60)" visible3 mobile 12
fi
echo DONE >> "$HERE/results.done"
