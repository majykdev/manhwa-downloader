#!/bin/bash
# setup-oracle-vm.sh - Automated setup for Oracle Cloud VM after creation
# Run this script on the VM after SSH login as the ubuntu user

set -euo pipefail

# --- 0. Prerequisites check ---
echo "[1/6] Checking prerequisites..."
if ! command -v docker &> /dev/null; then
  echo "❌ Docker not found. Please install Docker first."
  echo "Run: curl -fsSL https://get.docker.com | sh"
  exit 1
fi
if ! command -v cloudflared &> /dev/null; then
  echo "❌ cloudflared not found. Please install cloudflared first."
  echo "Run: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared"
  exit 1
fi

# --- 1. Clone or copy the project ---
REPO_DIR="/opt/asura-downloader"
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "[2/6] Cloning project from GitHub..."
  sudo rm -rf "$REPO_DIR" || true
  git clone https://github.com/$(whoami)/asura-downloader.git "$REPO_DIR"
  cd "$REPO_DIR"
else
  echo "[2/6] Project already cloned. Pulling latest..."
  cd "$REPO_DIR"
  git pull
fi

# --- 2. Build Docker image ---
echo "[3/6] Building Docker image..."
cd "$REPO_DIR"
docker build -t asura-downloader .

# --- 3. Run container ---
echo "[4/6] Starting container..."
docker rm -f asura-dl || true
docker run -d \
  --name asura-dl \
  --restart unless-stopped \
  -p 80:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  asura-downloader

# Wait for health check
sleep 3
if ! curl -sS http://localhost:3000/health >/dev/null; then
  echo "❌ Health check failed. Check logs: docker logs asura-dl"
  exit 1
fi
echo "✅ Container running and healthy"

# --- 4. Cloudflare Tunnel ---
echo "[5/6] Setting up Cloudflare Tunnel..."
TUNNEL_NAME="asura-downloader"
if ! cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
  echo "Creating tunnel..."
  cloudflared tunnel login --hostname asura-downloader
  cloudflared tunnel create "$TUNNEL_NAME"
fi

# Create config
CONFIG_DIR="/root/.cloudflared"
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_DIR/config.yml" <<EOF
# Cloudflare Tunnel config for asura-downloader
tunnel: $TUNNEL_NAME
credentials-file: $CONFIG_DIR/$TUNNEL_NAME.json

ingress:
  # Replace with your desired subdomain
  - hostname: asura.$(whoami).trycloudflare.com
    service: http://localhost:3000
  # Required: catch-all rule
  - service: http_status:404
EOF

# Start tunnel
cloudflared tunnel run "$TUNNEL_NAME" >/tmp/cloudflared.log 2>&1 &
TUNNEL_PID=$!
echo "Tunnel PID: $TUNNEL_PID"

# Wait a moment for tunnel to register
sleep 5

# Show tunnel info
cloudflared tunnel info "$TUNNEL_NAME" || true
echo "✅ Tunnel started. Check /tmp/cloudflared.log for errors."

# --- 5. Keep-alive cron ---
echo "[6/6] Adding keep-alive cron..."
(crontab -l 2>/dev/null || true) | \
  grep -v "asura-downloader" | \
  cat >> /tmp/crontab.tmp
cat >> /tmp/crontab.tmp <<'EOF'
# Keep-alive for Oracle idle-reclamation rule (every 5 min)
*/5 * * * * curl -sS http://localhost:3000/health >/dev/null
# Optional: small CPU/network load daily
0 12 * * * dd if=/dev/zero of=/dev/null bs=1M count=100 status=none
EOF
crontab /tmp/crontab.tmp
rm -f /tmp/crontab.tmp

# Done
cat <<'EOF'
🎉 Oracle VM setup complete!

Access your app at:
  HTTPS: https://asura.$(whoami).trycloudflare.com

Next steps:
1. Visit the URL and test scraping a comic.
2. If tunnel fails, check /tmp/cloudflared.log
3. To update later: cd /opt/asura-downloader && git pull && docker build -t asura-downloader . && docker restart asura-dl

Troubleshooting:
- Port 80 blocked? Check OCI security list and Ubuntu firewall (sudo ufw allow 80).
- Tunnel not working? Run: cloudflared tunnel cleanup && cloudflared tunnel create asura-downloader
EOF
