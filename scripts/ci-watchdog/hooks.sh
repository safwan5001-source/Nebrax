# AWJ-BACKEND-CI-04 — start/stop hooks for the PostgreSQL test-stall watchdog.
# Sourced by the pgsql branch of CI's test step:
#
#   source scripts/ci-watchdog/hooks.sh
#   trap awj_watchdog_stop EXIT
#   awj_watchdog_start --out-dir … --paratest-tmp-dir … --stall-seconds …
#   php artisan test … | tee …
#
# Contract: nothing here may change the step's exit status. GitHub runs the step
# with `bash -e -o pipefail`, and under errexit a failing command inside an EXIT
# trap replaces the exit status (verified: `exit 0` + failing trap -> 1). So the
# stop hook turns errexit off first and never calls `exit`: bash then keeps the
# status the step already had (verified for 0/1/3/137). test_watchdog.py forbids
# `exit` and shell-option changes other than that `set +e` in this file.

AWJ_WATCHDOG_PID=""
AWJ_WATCHDOG_PY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/watchdog.py"

awj_watchdog_start() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "::warning::AWJ watchdog: python3 not found; tests run unobserved"
    return 0
  fi
  python3 "$AWJ_WATCHDOG_PY" "$@" &
  AWJ_WATCHDOG_PID=$!
  return 0
}

# EXIT trap. Leaves the step's exit status untouched.
awj_watchdog_stop() {
  set +e
  if [ -n "$AWJ_WATCHDOG_PID" ]; then
    kill -TERM "$AWJ_WATCHDOG_PID" 2>/dev/null
    local i
    for i in $(seq 1 50); do
      kill -0 "$AWJ_WATCHDOG_PID" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "$AWJ_WATCHDOG_PID" 2>/dev/null; then
      echo "::warning::AWJ watchdog did not stop within 10s; killing it (the watchdog only)"
      kill -KILL "$AWJ_WATCHDOG_PID" 2>/dev/null
    fi
    wait "$AWJ_WATCHDOG_PID" 2>/dev/null
    local wd=$?
    [ "$wd" -eq 0 ] || echo "::warning::AWJ watchdog exited with status $wd (ignored; the test result is unchanged)"
    AWJ_WATCHDOG_PID=""
  fi
}
