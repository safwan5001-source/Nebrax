#!/usr/bin/env bash
# usage: run-matrix.sh <container> <base-url> <path> <KiBps> <hold> <N...>  -> one JSON line per N (+ container memory peak)
C=$1; BASE=$2; P=$3; KB=$4; HOLD=$5; shift 5
for N in "$@"; do
  : > /tmp/dstats.txt
  ( while true; do docker stats --no-stream --format '{{.MemUsage}}|{{.CPUPerc}}' $C >> /tmp/dstats.txt 2>/dev/null; sleep 1; done ) & SP=$!
  RES=$(node "$(dirname "$0")/loadgen.js" "$BASE" "$P" "$N" "$KB" "$HOLD")
  kill $SP 2>/dev/null; wait $SP 2>/dev/null
  PEAK=$(python3 - <<'PY'
import re
mem=0;cpu=0
for l in open('/tmp/dstats.txt'):
    m=re.match(r'([\d.]+)(MiB|GiB|KiB)\s*/.*\|([\d.]+)%',l.strip())
    if m:
        v=float(m.group(1))*{'KiB':1/1024,'MiB':1,'GiB':1024}[m.group(2)]; mem=max(mem,v); cpu=max(cpu,float(m.group(3)))
print(f'"container_mem_peak_mib":{mem:.0f},"container_cpu_peak_pct":{cpu:.0f}')
PY
)
  echo "${RES%\}},$PEAK}"; sleep 6
done
