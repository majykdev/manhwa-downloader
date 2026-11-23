# Quick Start: Oracle VM + Cloudflare Tunnel

## 1. Create Oracle VM
- Sign up at [oracle.com/cloud/free](https://signup.cloud.oracle.com) (card for verification only)
- Create VCN via "Start VCN Wizard"
- Add security rule: TCP port 80 from `0.0.0.0/0`
- Create instance: **A1.Flex 1 OCPU/6GB Ubuntu 24.04**, auto public IP, paste SSH public key
- SSH in: `ssh -i ~/.ssh/id_rsa ubuntu@<PUBLIC_IP>`

## 2. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Clone & Run
```bash
cd /opt
sudo git clone https://github.com/yourusername/asura-downloader.git
cd asura-downloader

# Build and run
docker build -t asura-downloader .
docker run -d --name asura-dl --restart unless-stopped -p 80:3000 -e PORT=3000 asura-downloader
curl -sS http://localhost:3000/health  # should return {"ok":true}
```

## 4. Cloudflare Tunnel
```bash
# Install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Authenticate and create
cloudflared tunnel login
cloudflared tunnel create asura-downloader

# Configure
sudo mkdir -p /root/.cloudflared
cat > /root/.cloudflared/config.yml <<EOF
tunnel: asura-downloader
credentials-file: /root/.cloudflared/asura-downloader.json

ingress:
  - hostname: asura.yourname.trycloudflare.com
    service: http://localhost:3000
  - service: http_status:404
EOF

# Start
cloudflared tunnel run asura-downloader >/tmp/cloudflared.log 2>&1 &
```

## 5. Keep-Alive
```bash
sudo crontab -e
# Paste:
*/5 * * * * curl -sS http://localhost:3000/health >/dev/null
0 12 * * * dd if=/dev/zero of=/dev/null bs=1M count=100 status=none
```

## 6. Done
Visit: `https://asura.yourname.trycloudflare.com`

Update: `cd /opt/asura-downloader && git pull && docker build -t asura-downloader . && docker restart asura-dl`
