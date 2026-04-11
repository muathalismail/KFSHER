#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
URL="${1:-http://127.0.0.1:8000/on_call_look_up%206/}"
if [[ "$URL" != *"?"* ]]; then
  URL="${URL}?v=$(date +%s)"
fi

mkdir -p /tmp/swift-module-cache
export SWIFT_MODULECACHE_PATH=/tmp/swift-module-cache

swift "$ROOT_DIR/tools/webview_regression_tests.swift" "$URL"
