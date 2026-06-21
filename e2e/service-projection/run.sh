#!/usr/bin/env bash
# Service Projection — real-ssh E2E with a local sshd container as the "remote".
#
# Proves the mocked seams for real: real `ssh -R` reverse tunnel, real
# `docker ps` discovery, the same-port mirror conflict/remap path, and
# supervised auto-heal. No real remote host required — a throwaway sshd
# container stands in, and the host's ssh client forwards a tunnelled
# Postgres back to the host's own published DB.
#
#   HOST                                   CONTAINER "remote agent"
#   Postgres :5432  ── ssh -R ──▶  127.0.0.1:5432 ──▶ (back to host DB)
#   patchwire CLI                  psql  = stands in for remote Claude
#
# Usage: bash e2e/service-projection/run.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/pw-e2e.XXXXXX")"
E2E_HOME="$WORK/home"                 # isolated HOME — never touch real ~/.patchwire
KEY="$E2E_HOME/.patchwire/keys/localhost-agent"
SSH_PORT=22122
PG_NAME=pw-e2e-pg
AGENT_NAME=pw-e2e-agent
IMG=pw-e2e-agent:latest
PG_PASS=pw
BIND_PID=""
PASS=0; FAIL=0

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32mPASS\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

cleanup() {
  say "Teardown"
  [ -n "$BIND_PID" ] && kill "$BIND_PID" 2>/dev/null
  pkill -f '127.0.0.1:5432:127.0.0.1' 2>/dev/null
  docker rm -f "$PG_NAME" "$AGENT_NAME" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

runcli() { ( cd "$WORK" && HOME="$E2E_HOME" PW_TOKEN=e2e-token node "$REPO/packages/cli/dist/cli.js" "$@" ); }
agent()  { docker exec "$AGENT_NAME" "$@"; }
remote_psql() { agent psql "postgresql://postgres:${PG_PASS}@127.0.0.1:${1}/postgres" -tA -c 'select 1' 2>/dev/null | tr -d '[:space:]'; }

# wait_for <desc> <timeout-s> <cmd...>  — poll until cmd succeeds
wait_for() { local d="$1" t="$2"; shift 2; local i=0; until "$@" >/dev/null 2>&1; do i=$((i+1)); [ "$i" -ge "$((t*2))" ] && { echo "timeout waiting for $d"; return 1; }; sleep 0.5; done; }

# wait_psql <port> <timeout-s> — retry a remote query until it returns 1 (the
# tunnel forward can need a beat to settle after the listener appears)
wait_psql() { local p="$1" t="${2:-25}" i=0; while [ "$i" -lt "$((t*2))" ]; do [ "$(remote_psql "$p")" = "1" ] && return 0; i=$((i+1)); sleep 0.5; done; return 1; }

manifest_field() { node -e "try{console.log(require('$WORK/.patchwire/services.json').services[0].$1)}catch(e){console.log('')}" 2>/dev/null; }
# wait_manifest <timeout-s> — poll until services.json has an entry with a remotePort
wait_manifest() { local t="${1:-25}" i=0; while [ "$i" -lt "$((t*2))" ]; do [ -n "$(manifest_field remotePort)" ] && return 0; i=$((i+1)); sleep 0.5; done; return 1; }

# ── prerequisites ───────────────────────────────────────────────────────────
docker ps >/dev/null 2>&1 || { echo "Docker daemon not running"; exit 2; }

say "Build CLI"
pnpm --filter @rebink/patchwire build >/dev/null 2>&1 || { echo "cli build failed"; exit 2; }

say "Generate throwaway SSH key + agent image"
mkdir -p "$E2E_HOME/.patchwire/keys"
ssh-keygen -t ed25519 -N '' -f "$KEY" -C pw-e2e >/dev/null
cp "$KEY.pub" "$HERE/build/authorized_keys"
docker build -q -t "$IMG" "$HERE/build" >/dev/null || { echo "image build failed"; exit 2; }

say "Start host Postgres + agent sshd container"
docker rm -f "$PG_NAME" "$AGENT_NAME" >/dev/null 2>&1
docker run -d --name "$PG_NAME" -e POSTGRES_PASSWORD="$PG_PASS" -p 127.0.0.1:5432:5432 postgres:16 >/dev/null
docker run -d --name "$AGENT_NAME" -p "127.0.0.1:${SSH_PORT}:22" "$IMG" >/dev/null
wait_for "sshd" 30 docker exec "$AGENT_NAME" bash -c 'nc -z 127.0.0.1 22' || exit 2
wait_for "postgres" 30 docker exec "$PG_NAME" pg_isready -h 127.0.0.1 -p 5432 || exit 2

cat > "$WORK/patchwire.yml" <<YML
project: e2e
remote:
  host: localhost
  user: agent
  path: /home/agent/e2e
  agentUrl: http://127.0.0.1:7878
  token: e2e-token
  sshPort: ${SSH_PORT}
YML

# ── Phase 1: discover + bind + reach the DB from the "remote" ────────────────
say "Phase 1 — discover, bind, reach Postgres from the remote"
DISC="$(runcli services discover 2>&1)"; echo "$DISC"
echo "$DISC" | grep -q ':5432' && ok "discover finds the local Postgres on :5432" || bad "discover did not list :5432"

rm -f "$WORK/.patchwire/services.json"
runcli services bind 5432 --yes >"$WORK/bind.log" 2>&1 &
BIND_PID=$!
if wait_for "tunnel listener in container" 30 docker exec "$AGENT_NAME" bash -c 'nc -z 127.0.0.1 5432'; then
  ok "ssh -R bound 127.0.0.1:5432 on the remote (real reverse tunnel)"
else
  bad "remote loopback :5432 never came up"; cat "$WORK/bind.log"
fi
if wait_psql 5432 25; then ok "remote psql through the tunnel returned 1 (end-to-end traffic)"; else bad "remote psql never returned 1"; fi

# ── Phase 2: same-port mirror conflict → remap ──────────────────────────────
say "Phase 2 — occupy the remote port, expect a remapped bind"
kill "$BIND_PID" 2>/dev/null; BIND_PID=""; pkill -f '127.0.0.1:5432:127.0.0.1' 2>/dev/null; sleep 2
docker exec -d "$AGENT_NAME" bash -c 'nc -lk 127.0.0.1 5432 >/dev/null 2>&1'   # squat on :5432
wait_for "squat on remote :5432" 10 docker exec "$AGENT_NAME" bash -c 'nc -z 127.0.0.1 5432'
rm -f "$WORK/.patchwire/services.json"
runcli services bind 5432 --yes >"$WORK/bind2.log" 2>&1 &
BIND_PID=$!
wait_manifest 25 || true
REMOTEPORT="$(manifest_field remotePort)"
MIRRORED="$(manifest_field mirrored)"
echo "manifest remotePort=$REMOTEPORT mirrored=$MIRRORED"
if [ -n "$REMOTEPORT" ] && [ "$REMOTEPORT" != "5432" ] && [ "$MIRRORED" = "false" ]; then
  ok "port conflict remapped to $REMOTEPORT (mirrored=false)"
  if wait_psql "$REMOTEPORT" 25; then ok "remote psql via remapped port $REMOTEPORT returned 1"; else bad "remapped psql never returned 1"; fi
else
  bad "expected a non-5432 remap with mirrored=false (got port='$REMOTEPORT' mirrored='$MIRRORED')"; cat "$WORK/bind2.log"
fi

# ── Phase 3: auto-heal after the ssh tunnel drops ───────────────────────────
say "Phase 3 — kill the ssh tunnel, expect supervised reconnect"
kill "$BIND_PID" 2>/dev/null; BIND_PID=""; pkill -f '127.0.0.1' 2>/dev/null
docker exec "$AGENT_NAME" pkill -f 'nc -lk' 2>/dev/null; sleep 1
runcli services bind 5432 --yes >"$WORK/bind3.log" 2>&1 &
BIND_PID=$!
wait_for "initial tunnel" 30 docker exec "$AGENT_NAME" bash -c 'nc -z 127.0.0.1 5432' || bad "phase3 initial bind failed"
pkill -f '127.0.0.1:5432:127.0.0.1' 2>/dev/null    # drop the ssh -R child; manager should heal
sleep 1
if wait_for "healed tunnel" 30 docker exec "$AGENT_NAME" bash -c 'nc -z 127.0.0.1 5432'; then
  if wait_psql 5432 25; then ok "tunnel auto-healed; remote psql returned 1 after the drop"; else bad "healed but psql never returned 1"; fi
else
  bad "tunnel did not auto-heal after the drop"; cat "$WORK/bind3.log"
fi

# ── summary ─────────────────────────────────────────────────────────────────
say "Result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
