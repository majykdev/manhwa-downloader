#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

on_exit() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo "Update failed with exit code $status."
    read -r -p "Press Enter to close..." || true
  fi
  exit "$status"
}
trap on_exit EXIT

if [ -x "$HOME/.local/node/bin/node" ]; then
  export PATH="$HOME/.local/node/bin:$PATH"
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git not found. Install Git, then run this again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Run setup.command once, then run this again."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This folder is not a Git checkout. Replace it with a clone from GitHub."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "No GitHub remote found. Replace this folder with a clone from GitHub."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Local changes detected. Commit, stash, or discard them before updating."
  exit 1
fi

branch="$(git symbolic-ref --quiet --short HEAD || true)"
if [ -z "$branch" ]; then
  echo "Detached HEAD detected. Check out a branch before updating."
  exit 1
fi

lock_before="$(git hash-object package-lock.json 2>/dev/null || true)"

echo "Updating manhwa-downloader from GitHub..."
echo "Project root: $(pwd)"
echo "Branch: $branch"
git fetch --prune origin
git pull --ff-only origin "$branch"

lock_after="$(git hash-object package-lock.json 2>/dev/null || true)"
if [ ! -d node_modules ] || [ "$lock_before" != "$lock_after" ]; then
  echo "Dependencies changed. Refreshing node_modules..."
  npm ci --no-audit --no-fund
fi

echo "Update complete: $(git rev-parse --short HEAD)"
read -r -p "Press Enter to close this window..." || true
