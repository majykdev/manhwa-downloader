#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Setting up manhwa-downloader..."
echo "Project root: $(pwd)"

on_exit() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo "Setup failed with exit code $status."
    read -r -p "Press Enter to close..." || true
  fi
  exit "$status"
}
trap on_exit EXIT

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return
  fi
  if [ -x "/opt/homebrew/bin/brew" ]; then
    echo "/opt/homebrew/bin/brew"
    return
  fi
  if [ -x "/usr/local/bin/brew" ]; then
    echo "/usr/local/bin/brew"
    return
  fi
}

brew_writable() {
  local prefix
  prefix="$("$1" --prefix 2>/dev/null || true)"
  [ -n "$prefix" ] && [ -w "$prefix" ]
}

BREW="$(find_brew || true)"
if [ -n "$BREW" ] && ! brew_writable "$BREW"; then
  echo "Existing Homebrew is not writable; Node will be installed locally instead."
  BREW=""
fi

if [ -n "$BREW" ]; then
  eval "$("$BREW" shellenv)"
fi

NODE_VERSION="v22.23.1"
LOCAL_NODE_DIR="$HOME/.local/node"

install_local_node() {
  local arch
  case "$(uname -m)" in
    arm64|aarch64)
      arch="arm64"
      ;;
    x86_64)
      arch="x64"
      ;;
    *)
      echo "Unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac

  echo "Installing Node $NODE_VERSION locally..."
  rm -rf "$LOCAL_NODE_DIR"
  mkdir -p "$LOCAL_NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$arch.tar.gz" | tar xz --strip-components=1 -C "$LOCAL_NODE_DIR"
  export PATH="$LOCAL_NODE_DIR/bin:$PATH"
  hash -r
}

ensure_node() {
  if [ -n "$BREW" ]; then
    if ! command -v node >/dev/null 2>&1; then
      echo "Node not found. Installing Node with Homebrew..."
      "$BREW" install node
    else
      node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
      if [ "$node_major" -lt 20 ]; then
        echo "Node $node_major found. Upgrading Node with Homebrew..."
        "$BREW" upgrade node || "$BREW" install node
      fi
    fi

    hash -r

    if ! command -v npm >/dev/null 2>&1; then
      echo "npm not found. Installing Node with Homebrew..."
      "$BREW" install node
      hash -r
    fi
    return
  fi

  needs_node=false
  if ! command -v node >/dev/null 2>&1; then
    needs_node=true
  else
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$node_major" -lt 20 ]; then
      needs_node=true
    fi
  fi
  if ! command -v npm >/dev/null 2>&1; then
    needs_node=true
  fi

  if [ "$needs_node" = true ]; then
    install_local_node
  fi
}

ensure_node

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  echo "Node 20 or newer is required; found $(node --version)."
  exit 1
fi

echo "Using Node $(node --version) and npm $(npm --version)"

echo "Installing npm dependencies..."
npm ci

echo "Installing Playwright Chromium..."
npx playwright install chromium

echo "Running tests..."
npm test
echo "Tests passed."

echo "Setup complete."
read -r -p "Press Enter to close..." || true
