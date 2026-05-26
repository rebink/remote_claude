#!/usr/bin/env bash
# Localhost end-to-end smoke test for remote-claude.
#
# Spins up the built `dist/agent.js` on 127.0.0.1, drives /health and /ask
# over HTTP against a temp git project, and asserts a diff comes back.
#
# Usage:
#   scripts/smoke.sh                      # uses a fake `claude` (fast, deterministic)
#   RC_USE_REAL_CLAUDE=1 scripts/smoke.sh # uses your real `claude` binary (costs API tokens)
#   RC_KEEP_TMP=1 scripts/smoke.sh        # don't delete tmp dir on exit (for debugging)

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\033[36m▸ %s\033[0m\n' "$*"; }

TMP="$(mktemp -d -t remote-claude-smoke-XXXXXX)"
AGENT_PID=""
EXIT_CODE=0

cleanup() {
  local code=$?
  if [[ -n "$AGENT_PID" ]] && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
  fi
  if [[ "${RC_KEEP_TMP:-0}" == "1" ]]; then
    yellow "Kept tmp dir: $TMP"
  else
    rm -rf "$TMP"
  fi
  if [[ $code -ne 0 ]]; then
    red "✗ smoke test FAILED (exit $code)"
  fi
  exit $code
}
trap cleanup EXIT INT TERM

# ── 0. preflight ──────────────────────────────────────────────────────────────
step "Preflight"
command -v node >/dev/null  || { red "node not in PATH"; exit 1; }
command -v git >/dev/null   || { red "git not in PATH"; exit 1; }
command -v curl >/dev/null  || { red "curl not in PATH"; exit 1; }

if [[ ! -f dist/agent.js || ! -f dist/cli.js ]]; then
  step "Building (dist missing)"
  pnpm build >/dev/null
fi

PORT="${RC_AGENT_PORT:-7878}"
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  red "Port $PORT already in use. Set RC_AGENT_PORT=<free-port> and retry."
  exit 1
fi

TOKEN="smoke-$(date +%s)-$RANDOM"
PROJECTS_ROOT="$TMP/projects"
PROJECT_DIR="$PROJECTS_ROOT/sample"
mkdir -p "$PROJECT_DIR"

# ── 1. seed a clean git project ───────────────────────────────────────────────
step "Seeding git project at $PROJECT_DIR"
(
  cd "$PROJECT_DIR"
  git init -q -b main
  git config user.email "smoke@example.com"
  git config user.name  "smoke"
  git config commit.gpgsign false
  printf 'one\ntwo\nthree\n' > a.txt
  printf 'hello\n'           > b.txt
  git add .
  git -c init.defaultBranch=main commit -q -m "init"
)

# ── 2. fake claude (or real) ──────────────────────────────────────────────────
if [[ "${RC_USE_REAL_CLAUDE:-0}" == "1" ]]; then
  CLAUDE_BIN="${RC_CLAUDE_BIN:-claude}"
  command -v "$CLAUDE_BIN" >/dev/null || { red "RC_USE_REAL_CLAUDE=1 but '$CLAUDE_BIN' not on PATH"; exit 1; }
  yellow "Using REAL claude: $CLAUDE_BIN (this will hit the API)"
else
  CLAUDE_BIN="$TMP/fake-claude.sh"
  cat > "$CLAUDE_BIN" <<'EOF'
#!/bin/sh
# Fake claude: edits a.txt and creates c.txt so the agent has a diff to capture.
set -eu
printf 'one\ntwo\nthree-edited\n' > a.txt
printf 'brand new file\n'         > c.txt
echo "fake-claude: done"
EOF
  chmod +x "$CLAUDE_BIN"
fi

# ── 3. launch agent ───────────────────────────────────────────────────────────
step "Starting agent on 127.0.0.1:$PORT"
AGENT_LOG="$TMP/agent.log"
(
  RC_AGENT_TOKEN="$TOKEN" \
  RC_PROJECTS_ROOT="$PROJECTS_ROOT" \
  RC_AGENT_HOST="127.0.0.1" \
  RC_AGENT_PORT="$PORT" \
  RC_CLAUDE_BIN="$CLAUDE_BIN" \
  RC_CLAUDE_ARGS="--print" \
  RC_TIMEOUT_SEC="60" \
  node "$ROOT/dist/agent.js" >"$AGENT_LOG" 2>&1 &
  echo $! > "$TMP/agent.pid"
)
AGENT_PID="$(cat "$TMP/agent.pid")"

# Wait up to 10s for /health to come up.
for i in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    red "Agent died during startup. Logs:"
    cat "$AGENT_LOG"
    exit 1
  fi
done

# ── 4. /health ────────────────────────────────────────────────────────────────
step "GET /health"
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/health")"
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || { red "health did not return ok:true"; exit 1; }

# ── 5. /ask without token → 401 ───────────────────────────────────────────────
step "POST /ask without token → expect 401"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/ask" \
  -H 'content-type: application/json' \
  -d '{"prompt":"x","project":"sample"}')"
[[ "$CODE" == "401" ]] || { red "expected 401, got $CODE"; exit 1; }
green "  → $CODE"

# ── 6. /ask malicious project name → 400 ──────────────────────────────────────
step "POST /ask with '../etc/passwd' → expect 400"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/ask" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"prompt":"x","project":"../etc/passwd"}')"
[[ "$CODE" == "400" ]] || { red "expected 400, got $CODE"; exit 1; }
green "  → $CODE"

# ── 7. /ask happy path → 200 with diff ────────────────────────────────────────
step "POST /ask with valid token → expect 200 + diff"
RESP_FILE="$TMP/ask.json"
HTTP_CODE="$(curl -s -o "$RESP_FILE" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/ask" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  --max-time 90 \
  -d '{"prompt":"please edit","project":"sample"}')"
[[ "$HTTP_CODE" == "200" ]] || { red "expected 200, got $HTTP_CODE. body:"; cat "$RESP_FILE"; exit 1; }

# Validate JSON shape via node (no jq dependency).
node - "$RESP_FILE" <<'JS'
import { readFileSync } from 'node:fs';
const body = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const must = ['diff', 'files', 'durationMs', 'stdout', 'stderr', 'exitCode'];
for (const k of must) if (!(k in body)) { console.error('missing key:', k); process.exit(1); }
if (typeof body.diff !== 'string' || body.diff.length === 0) {
  console.error('diff was empty');
  process.exit(1);
}
if (process.env.RC_USE_REAL_CLAUDE !== '1') {
  if (!body.diff.includes('a.txt')) { console.error('diff missing a.txt'); process.exit(1); }
  if (!body.diff.includes('three-edited')) { console.error('diff missing edit'); process.exit(1); }
  if (!body.diff.includes('c.txt')) { console.error('diff missing new file'); process.exit(1); }
}
console.log(`  diff bytes=${body.diff.length} files=[${body.files.join(', ')}] exitCode=${body.exitCode} durationMs=${body.durationMs}`);
JS
green "  → 200 (diff captured)"

# ── 8. working tree must be clean afterward ───────────────────────────────────
step "Remote checkout clean after run"
DIRTY="$(cd "$PROJECT_DIR" && git status --porcelain)"
[[ -z "$DIRTY" ]] || { red "working tree dirty after /ask:"; echo "$DIRTY"; exit 1; }
green "  → clean"

# ── 9. summary ────────────────────────────────────────────────────────────────
green "✓ smoke test PASSED"
green "  agent: pid=$AGENT_PID port=$PORT log=$AGENT_LOG"
