#!/usr/bin/env bash
# تجربة exp/ci-pg-diagnostics: قياسات بيئية فقط حول تشغيل الاختبارات على PostgreSQL بإعداده الحالي. لا تغيّر أي إعداد خادم.
# الاستعمال: source collect.sh ثم diag_start <out_dir> <container_id> ... diag_stop

_psql() { docker exec "$DIAG_CID" psql -U nibras -d postgres -At -F $'\t' -c "$1"; }

diag_snapshot() {   # diag_snapshot <label>: عدّادات تراكمية (لا تحتاج track_io_timing)
  local l="$1"
  {
    echo "## pg_stat_wal"; _psql "SELECT wal_records, wal_fpi, wal_bytes, wal_buffers_full, wal_write, wal_sync FROM pg_stat_wal" || true
    echo "## pg_stat_database"; _psql "SELECT coalesce(sum(xact_commit),0), coalesce(sum(xact_rollback),0), coalesce(sum(blks_read),0), coalesce(sum(blks_hit),0), coalesce(sum(tup_inserted),0), coalesce(sum(tup_updated),0) FROM pg_stat_database" || true
    echo "## pg_stat_io"; _psql "SELECT backend_type, object, context, coalesce(reads,0), coalesce(writes,0), coalesce(extends,0), coalesce(fsyncs,0) FROM pg_stat_io WHERE coalesce(reads,0)+coalesce(writes,0)+coalesce(extends,0)+coalesce(fsyncs,0) > 0" || true
  } > "$DIAG_OUT/pgstats_$l.txt" 2>&1
  grep -E ' (sd[a-z]+[0-9]*|vd[a-z]+[0-9]*|nvme[0-9]+n[0-9]+(p[0-9]+)?|dm-[0-9]+) ' /proc/diskstats > "$DIAG_OUT/diskstats_$l.txt" 2>/dev/null || true
  cat /proc/loadavg > "$DIAG_OUT/loadavg_$l.txt"
}

diag_start() {
  DIAG_OUT="$1"; DIAG_CID="$2"; mkdir -p "$DIAG_OUT"
  {
    echo "nproc=$(nproc)"; lscpu | grep -E 'Model name|^CPU\(s\)|MHz|L2|L3'; free -m | sed -n 1,2p
    echo "--- docker root mount"; findmnt -T /var/lib/docker -no SOURCE,FSTYPE,OPTIONS 2>&1 || true
    echo "--- block devices"; lsblk -o NAME,ROTA,SIZE,TYPE,MOUNTPOINT 2>&1 || true
    for q in /sys/block/*/queue/scheduler; do echo "$q: $(cat "$q" 2>/dev/null)"; done
    echo "--- PSI"; for f in cpu io memory; do echo "$f: $(cat /proc/pressure/$f 2>/dev/null | tr '\n' ' ')"; done
    echo "--- postgres settings (read-only)"; for s in fsync synchronous_commit full_page_writes wal_sync_method shared_buffers max_wal_size checkpoint_timeout max_locks_per_transaction track_io_timing; do echo "$s=$(_psql "SHOW $s" 2>/dev/null)"; done
  } > "$DIAG_OUT/env.txt" 2>&1
  # زمن fsync الفعلي لجهاز بيانات PostgreSQL (يكتب ملفاً مؤقتاً داخل PGDATA ثم يحذفه؛ لا يغيّر أي إعداد)
  docker exec "$DIAG_CID" sh -c 'B=$(command -v pg_test_fsync || echo /usr/lib/postgresql/16/bin/pg_test_fsync); $B -s 1 -f /var/lib/postgresql/data/pg_test_fsync.tmp; rm -f /var/lib/postgresql/data/pg_test_fsync.tmp' > "$DIAG_OUT/pg_test_fsync.txt" 2>&1 || true
  diag_snapshot before
  ( while true; do ts=$(date +%s.%N); _psql "SELECT coalesce(wait_event_type,'none'), coalesce(wait_event,'none'), count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND state='active' AND pid<>pg_backend_pid() AND datname LIKE 'nibras%' GROUP BY 1,2" 2>/dev/null | sed "s/^/$ts\t/" >> "$DIAG_OUT/wait_samples.tsv" || true; echo "$ts" >> "$DIAG_OUT/ticks.txt"; sleep 2; done ) &
  echo $! > "$DIAG_OUT/sampler.pid"
  vmstat -t 5 > "$DIAG_OUT/vmstat.txt" 2>&1 &
  echo $! > "$DIAG_OUT/vmstat.pid"
  ( while true; do echo "$(date +%s) io: $(head -1 /proc/pressure/io 2>/dev/null) | cpu: $(head -1 /proc/pressure/cpu 2>/dev/null)" >> "$DIAG_OUT/psi.txt"; sleep 5; done ) &
  echo $! > "$DIAG_OUT/psi.pid"
}

diag_stop() {
  for p in sampler vmstat psi; do [ -f "$DIAG_OUT/$p.pid" ] && kill "$(cat "$DIAG_OUT/$p.pid")" 2>/dev/null || true; done
  diag_snapshot after
}
