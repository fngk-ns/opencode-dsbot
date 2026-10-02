#!/usr/bin/env bash
# Supervisor for the Discord bot.
#  - restarts the bot whenever it exits (a self-modification restart exits 0 on purpose)
#  - if a new version crashes right after starting, restores the last healthy snapshot written by the bot
#    (git ref refs/opencode-discord/last-good) and starts that instead
# Exit code 3 means "could not log in to Discord" (token, intents, network); that is never blamed on the code.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="${BUN:-$(command -v bun || true)}"
REF="refs/opencode-discord/last-good"
MIN_UPTIME="${MIN_UPTIME:-25}"
MAX_FAST_FAILS="${MAX_FAST_FAILS:-3}"
EXIT_LOGIN_FAILED=3

if [ -z "$BUN" ]; then
  echo "[supervisor] bun not found in PATH" >&2
  exit 127
fi
cd "$HERE" || exit 1

child=""
stop() {
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null
  wait "$child" 2>/dev/null
  exit 0
}
trap stop TERM INT

rollback() {
  local root
  root="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null)" || return 1
  git -C "$root" rev-parse -q --verify "$REF" >/dev/null || return 1
  echo "[supervisor] new version keeps crashing; restoring $REF"
  # Remove files added since the snapshot (ignored files such as .env, data/ and node_modules are kept), then restore.
  git -C "$root" clean -fdq -- "$HERE" && git -C "$root" restore --source="$REF" --worktree -- "$HERE"
}

fast_fails=0
while true; do
  started="$(date +%s)"
  "$BUN" run src/index.ts &
  child=$!
  wait "$child"
  code=$?
  child=""
  uptime=$(( $(date +%s) - started ))
  echo "[supervisor] bot exited with code $code after ${uptime}s"

  if [ "$code" -eq "$EXIT_LOGIN_FAILED" ]; then
    fast_fails=0
    sleep 30
    continue
  fi

  if [ "$code" -ne 0 ] && [ "$uptime" -lt "$MIN_UPTIME" ]; then
    fast_fails=$((fast_fails + 1))
  else
    fast_fails=0
  fi

  if [ "$fast_fails" -ge "$MAX_FAST_FAILS" ]; then
    if rollback; then fast_fails=0; else echo "[supervisor] no snapshot to roll back to; backing off"; sleep 30; fi
  fi
  sleep "${RESTART_DELAY:-2}"
done
