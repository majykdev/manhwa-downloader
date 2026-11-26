#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

PORT=3001
export PORT

if [ -x "$HOME/.local/node/bin/node" ]; then
  export PATH="$HOME/.local/node/bin:$PATH"
fi

on_exit() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo "Deploy failed with exit code $status."
    read -r -p "Press Enter to close..." || true
  fi
  exit "$status"
}
trap on_exit EXIT

echo "Deploying manhwa-downloader to http://localhost:$PORT..."
echo "Project root: $(pwd)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node/npm not found. Run setup.command once, then run this again."
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 20 ]; then
  echo "Node 20 or newer is required; found $(node --version)."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Dependencies not found. Run setup.command once, then run this again."
  exit 1
fi

PIDS="$(lsof -ti tcp:$PORT -sTCP:LISTEN || true)"
if [ -n "$PIDS" ]; then
  echo "Stopping existing process on port $PORT..."
  kill -TERM $PIDS 2>/dev/null || true
  sleep 1
  PIDS="$(lsof -ti tcp:$PORT -sTCP:LISTEN || true)"
  if [ -n "$PIDS" ]; then
    kill -KILL $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

echo "Starting server..."
nohup env PORT="$PORT" npm start > /tmp/manhwa-downloader-3001.log 2>&1 &
printf '%s\n' "$!" > /tmp/manhwa-downloader-3001.pid

healthy=false
attempts=0
while [ "$attempts" -lt 40 ]; do
  if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
    healthy=true
    break
  fi
  attempts=$((attempts + 1))
  sleep 0.5
done

if [ "$healthy" != true ]; then
  echo "Server did not become healthy. Last log output:"
  tail -n 40 /tmp/manhwa-downloader-3001.log 2>/dev/null || true
  exit 1
fi

echo "Server is running at http://localhost:$PORT"

if [ "${NO_OPEN:-0}" != "1" ] && command -v open >/dev/null 2>&1; then
  open "http://localhost:$PORT"
fi

read -r -p "Press Enter to close this window..." || true
