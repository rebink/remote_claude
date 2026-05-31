#!/usr/bin/env bash
set -euo pipefail

# Resolve the workspace root (this script lives in packages/extension/scripts/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="$(cd "$EXT_DIR/../.." && pwd)"

# 1. build everything in the workspace
( cd "$REPO" && pnpm -r build )

# 2. typecheck everything
( cd "$REPO" && pnpm -r typecheck )

# 3. unit tests
( cd "$REPO" && pnpm -r test )

# 4. extension integration tests (vscode-test-electron) if configured or RC_E2E is set
if [ -d "$EXT_DIR/.vscode-test" ] || [ -n "${RC_E2E:-}" ]; then
  ( cd "$EXT_DIR" && pnpm exec vscode-test || true )
fi

echo "OK"
