#!/usr/bin/env bash
# Localhost end-to-end smoke test for the Patchwire agent (v0.2 multi-user).
#
# Spins up the built `dist/agent.js` on 127.0.0.1, registers a user, drives
# /health and /ask over HTTP against a temp git project, asserts a diff comes
# back, the working tree is left clean, and a JSONL audit line was recorded.
#
# Usage:
#   pnpm smoke                         # uses a fake `claude` (fast, deterministic)
#   PW_USE_REAL_CLAUDE=1 pnpm smoke    # uses your real `claude` binary (costs API tokens)
#   PW_KEEP_TMP=1 pnpm smoke           # don't delete tmp dir on exit (for debugging)

set -euo pipefail

# Run from the package root (packages/cli), regardless of caller CWD.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\033[36m▸ %s\033[0m\n' "$*"; }

TMP="$(mktemp -d -t patchwire-smoke-XXXXXX)"
AGENT_PID=""

cleanup() {
  local code=$?
  if [[ -n "$AGENT_PID" ]] && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
  fi
  if [[ "${PW_KEEP_TMP:-0}" == "1" ]]; then
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
command -v node >/dev/null || { red "node not in PATH"; exit 1; }
command -v git  >/dev/null || { red "git not in PATH"; exit 1; }
command -v curl >/dev/null || { red "curl not in PATH"; exit 1; }

if [[ ! -f dist/agent.js || ! -f dist/cli.js ]]; then
  step "Building (dist missing)"
  pnpm build >/dev/null
fi

PORT="${PW_AGENT_PORT:-7878}"
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  red "Port $PORT already in use. Set PW_AGENT_PORT=<free-port> and retry."
  exit 1
fi

USER_NAME="smoke"
TOKEN="smoke-$(date +%s)-$RANDOM"
USERS_FILE="$TMP/users.json"
PROJECTS_ROOT="$TMP/projects"
PROJECT_DIR="$PROJECTS_ROOT/$USER_NAME/sample"   # v0.2 layout: <root>/<user>/<project>
AUDIT_LOG="$TMP/audit.log"
mkdir -p "$PROJECT_DIR"

# ── 1. register a user (writes the shared users.json) ─────────────────────────
step "Registering user '$USER_NAME'"
PW_USERS_FILE="$USERS_FILE" node "$ROOT/dist/agent.js" user add "$USER_NAME" --token "$TOKEN" >/dev/null
[[ -f "$USERS_FILE" ]] || { red "users.json was not created"; exit 1; }

# ── 2. seed a clean git project ───────────────────────────────────────────────
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
  git commit -q -m "init"
)

# ── 3. fake claude (or real) ──────────────────────────────────────────────────
if [[ "${PW_USE_REAL_CLAUDE:-0}" == "1" ]]; then
  CLAUDE_BIN="${PW_CLAUDE_BIN:-claude}"
  command -v "$CLAUDE_BIN" >/dev/null || { red "PW_USE_REAL_CLAUDE=1 but '$CLAUDE_BIN' not on PATH"; exit 1; }
  yellow "Using REAL claude: $CLAUDE_BIN (this will hit the API)"
  AI_ARGS="--print"
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
  AI_ARGS=""
fi

# ── 4. launch agent ───────────────────────────────────────────────────────────
step "Starting agent on 127.0.0.1:$PORT"
AGENT_LOG="$TMP/agent-server.log"
(
  PW_PROJECTS_ROOT="$PROJECTS_ROOT" \
  PW_USERS_FILE="$USERS_FILE" \
  PW_AGENT_HOST="127.0.0.1" \
  PW_AGENT_PORT="$PORT" \
  PW_AI_BIN="$CLAUDE_BIN" \
  PW_AI_ARGS="$AI_ARGS" \
  PW_TIMEOUT_SEC="60" \
  PW_AUDIT_LOG="$AUDIT_LOG" \
  node "$ROOT/dist/agent.js" >"$AGENT_LOG" 2>&1 &
  echo $! > "$TMP/agent.pid"
)
AGENT_PID="$(cat "$TMP/agent.pid")"

# Wait up to 10s for /health to come up.
for _ in $(seq 1 50); do
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

# ── 5. /health ────────────────────────────────────────────────────────────────
step "GET /health"
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/health")"
echo "  $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || { red "health did not return ok:true"; exit 1; }

# ── 6. /ask without token → 401 ───────────────────────────────────────────────
step "POST /ask without token → expect 401"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/ask" \
  -H 'content-type: application/json' \
  -d '{"prompt":"x","project":"sample"}')"
[[ "$CODE" == "401" ]] || { red "expected 401, got $CODE"; exit 1; }
green "  → $CODE"

# ── 7. /ask path traversal → 400 ──────────────────────────────────────────────
step "POST /ask with '../etc/passwd' → expect 400"
CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/ask" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"prompt":"x","project":"../etc/passwd"}')"
[[ "$CODE" == "400" ]] || { red "expected 400, got $CODE"; exit 1; }
green "  → $CODE"

# ── 8. /ask happy path → 200 with diff ────────────────────────────────────────
step "POST /ask with valid token → expect 200 + diff"
RESP_FILE="$TMP/ask.json"
HTTP_CODE="$(curl -s -o "$RESP_FILE" -w '%{http_code}' \
  -X POST "http://127.0.0.1:$PORT/ask" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  --max-time 90 \
  -d '{"prompt":"please edit","project":"sample"}')"
[[ "$HTTP_CODE" == "200" ]] || { red "expected 200, got $HTTP_CODE. body:"; cat "$RESP_FILE"; exit 1; }

# Validate JSON shape (CommonJS — no jq, no ESM ambiguity).
PW_USE_REAL_CLAUDE="${PW_USE_REAL_CLAUDE:-0}" node -e '
const { readFileSync } = require("fs");
const body = JSON.parse(readFileSync(process.argv[1], "utf8"));
const must = ["diff", "files", "durationMs", "stdout", "stderr", "exitCode"];
for (const k of must) if (!(k in body)) { console.error("missing key:", k); process.exit(1); }
if (typeof body.diff !== "string" || body.diff.length === 0) { console.error("diff was empty"); process.exit(1); }
if (process.env.PW_USE_REAL_CLAUDE !== "1") {
  if (!body.diff.includes("a.txt")) { console.error("diff missing a.txt"); process.exit(1); }
  if (!body.diff.includes("three-edited")) { console.error("diff missing edit"); process.exit(1); }
  if (!body.diff.includes("c.txt")) { console.error("diff missing new file"); process.exit(1); }
}
console.log(`  diff bytes=${body.diff.length} files=[${body.files.join(", ")}] exitCode=${body.exitCode} durationMs=${body.durationMs}`);
' "$RESP_FILE"
green "  → 200 (diff captured)"

# ── 9. working tree must be clean afterward ───────────────────────────────────
step "Remote checkout clean after run"
DIRTY="$(cd "$PROJECT_DIR" && git status --porcelain)"
[[ -z "$DIRTY" ]] || { red "working tree dirty after /ask:"; echo "$DIRTY"; exit 1; }
green "  → clean"

# ── 10. audit log recorded the turn (phase 4) ─────────────────────────────────
step "Audit log recorded the /ask turn"
[[ -f "$AUDIT_LOG" ]] || { red "audit log $AUDIT_LOG was not created"; exit 1; }
AUDIT_JSON="$(PW_AUDIT_LOG="$AUDIT_LOG" node "$ROOT/dist/agent.js" log --json)"
echo "$AUDIT_JSON" | PW_USER="$USER_NAME" node -e '
const fs = require("fs");
const lines = fs.readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
if (lines.length === 0) { console.error("no audit entries"); process.exit(1); }
const e = JSON.parse(lines[lines.length - 1]);
if (e.route !== "/ask") { console.error("expected route /ask, got", e.route); process.exit(1); }
if (e.user !== process.env.PW_USER) { console.error("expected user", process.env.PW_USER, "got", e.user); process.exit(1); }
if (e.project !== "sample") { console.error("expected project sample, got", e.project); process.exit(1); }
if (!/^[0-9a-f]{64}$/.test(e.prompt_sha256)) { console.error("bad prompt_sha256:", e.prompt_sha256); process.exit(1); }
if ("prompt" in e) { console.error("plaintext prompt leaked into audit log!"); process.exit(1); }
console.log(`  audit: route=${e.route} user=${e.user} project=${e.project} +${e.lines_added}/-${e.lines_removed} sha=${e.prompt_sha256.slice(0,8)}…`);
'
green "  → recorded (metadata only, no plaintext)"

# ── 11. summary ───────────────────────────────────────────────────────────────
green "✓ smoke test PASSED"
green "  agent: pid=$AGENT_PID port=$PORT log=$AGENT_LOG"
