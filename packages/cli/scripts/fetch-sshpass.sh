#!/usr/bin/env bash
set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/sshpass"
mkdir -p "$VENDOR_DIR"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) PLATFORM=darwin-x64 ;;
  Linux-x86_64)  PLATFORM=linux-x64 ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 0 ;;
esac

BIN="$VENDOR_DIR/sshpass-$PLATFORM"
if [ -x "$BIN" ]; then
  echo "sshpass already vendored at $BIN"
  exit 0
fi

if command -v sshpass >/dev/null 2>&1; then
  cp "$(command -v sshpass)" "$BIN"
  chmod +x "$BIN"
  echo "Copied system sshpass → $BIN"
else
  echo "sshpass not installed locally; setup wizard will prompt at first run." >&2
fi
