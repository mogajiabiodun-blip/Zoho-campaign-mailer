#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/backend"
if [ ! -d node_modules ]; then
  npm install
fi
node src/index.js &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

cd "$ROOT/frontend"
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev
