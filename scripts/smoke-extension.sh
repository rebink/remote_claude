#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# 1. build everything
( cd "$REPO" && pnpm -r build )

# 2. typecheck both packages
( cd "$REPO" && pnpm -r typecheck )

# 3. unit tests
( cd "$REPO" && pnpm -r test )

# 4. extension integration tests (vscode-test-electron) if available
if [ -d "$REPO/extension/.vscode-test" ] || [ -n "${RC_E2E:-}" ]; then
  ( cd "$REPO/extension" && pnpm exec vscode-test || true )
fi

echo "OK"
