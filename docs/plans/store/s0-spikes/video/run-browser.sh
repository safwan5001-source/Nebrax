#!/usr/bin/env bash
# usage: run-browser.sh <name> <results-dir> <url> -- <browser command and flags...>   (the harness server must already be running)
# Launches the browser, waits for the page to POST its result (a line containing "done":true), then stops the browser by PID.
set -u
NAME=$1; DIR=$2; URL=$3; shift 4
RES=$DIR/results.jsonl; before=$(grep -c "\"done\":true" "$RES" 2>/dev/null || true); before=${before:-0}
"$@" "$URL" >"$DIR/$NAME.browser.log" 2>&1 &
PID=$!
for i in $(seq 1 200); do
  sleep 2; now=$(grep -c "\"done\":true" "$RES" 2>/dev/null || true); now=${now:-0}
  [ "$now" -gt "$before" ] && { echo "$NAME: result received after ~$((i*2))s"; break; }
  kill -0 $PID 2>/dev/null || { echo "$NAME: browser exited early"; break; }
done
kill $PID 2>/dev/null; sleep 1; kill -9 $PID 2>/dev/null; wait $PID 2>/dev/null; exit 0
