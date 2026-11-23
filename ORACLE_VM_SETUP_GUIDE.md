# Oracle Cloud Always Free VM Setup Guide

This guide walks you through creating a **free, always-on Oracle Cloud VM** to host the Asura Scans PDF scraper, then exposing it via a free HTTPS URL using Cloudflare Tunnel.

Total time: **~25-35 minutes** once you have your card ready.

---

## 📋 Prerequisites

- A **credit card** (for Oracle signup verification only; not charged if you stay within free limits)
- A **public SSH key** (`~/.ssh/id_rsa.pub` or `~/.ssh/id_ed25519.pub`)
- A **terminal** (macOS Terminal, iTerm, or Windows Terminal with SSH)
- A **GitHub account** (optional, for easy updates)
- A **Cloudflare account** (free, for HTTPS)

---

## 🔐 Step 1: Sign up for Oracle Cloud

1. Go to: [https://signup.cloud.oracle.com](https://signup.cloud.oracle.com)
2. Fill in your details (name, email, phone).
3. **Add a credit card** for identity verification. **You will NOT be charged** as long as you stay within Always Free limits.
4. Verify your email and phone.
5. Choose a **Home Region** (permanent choice). Pick the one closest to you:
   - Phoenix (US West)
   - Ashburn (US East)
   - Frankfurt (Germany)
   - Toronto (Canada)
   - London (UK)
   - etc.
6. Click **Create Account** and wait for confirmation.

> ⚠️ **Important**: The Home Region is permanent. You can only create Always Free compute instances in your Home Region.

---

## 🌐 Step 2: Create a Virtual Cloud Network (VCN)

1. Log in to the [Oracle Cloud Console](https://cloud.oracle.com)
2. From the hamburger menu (☰) → **Networking** → **Virtual Cloud Networks**
3. Click **Start VCN Wizard** → **Create VCN with Internet Connectivity**
4. Fill in:
   - **VCN Name**: `asura-vcn`
   - **Compartment**: (leave as default)
   - **VCN CIDR Block**: `10.0.0.0/16`
   - **Public Subnet CIDR**: `10.0.0.0/24`
   - **Private Subnet CIDR**: `10.0.1.0/24`
   - **DNS Hostnames**: ✅ Enabled
   - **IPv6**: ❌ Disabled
5. Click **Create** and wait for the VCN to be ready.

---

## 🔓 Step 3: Add Security Rule for Port 80

By default, the VCN only allows SSH (port 22). We need to allow HTTP (port 80).

1. In the VCN details page, go to **Security Lists** → click the security list name (e.g., `Default Security List for asura-vcn`)
2. Click **Add Ingress Rule**
3. Fill in:
   - **Stateless**: No
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: TCP
   - **Source Port Range**: All
   - **Destination Port Range**: 80
   - **Description**: Allow HTTP for web app
4. Click **Add Ingress Rule**

> ✅ Now port 80 is open to the internet.

---

## 🖥️ Step 4: Create the Compute Instance

1. From the hamburger menu → **Compute** → **Instances** → **Create Instance**
2. **Name**: `asura-downloader`
3. **Image and Shape** → **Change Shape** → **VM.Standard.A1.Flex** (ARM Ampere)
   - **OCPU**: 1
   - **Memory (GB)**: 6
   - *Total within free cap: 2 OCPU / 12GB* (you can use up to 2 OCPU/12GB total across instances)
4. **Image**: Ubuntu 24.04 (or Oracle Linux 9)
5. **Networking**:
   - **VCN**: `asura-vcn`
   - **Subnet**: Public subnet (`10.0.0.0/24`)
   - **Public IP**: ✅ Auto-assign
6. **Add SSH Keys**:
   - Paste the contents of your **public key** file (e.g., `cat ~/.ssh/id_rsa.pub`)
   - Or let Oracle generate a key pair and download the private key (store it safely!)
7. Click **Create**

> ⏳ Wait for the instance to show **Running** status (2–5 minutes).

---

## ⚠️ If "Out of Capacity" for A1.Flex

If you see "Out of host capacity" for A1.Flex:

1. Try a different **Availability Domain** (click **Change Availability Domain** in the Create Instance form)
2. Wait a while and retry
3. Fall back to **VM.Standard.E2.1.Micro** (AMD, 1GB RAM) — still works, just slower

---

## 🔑 Step 5: SSH into the VM

Once the instance is **Running**, note its **Public IP** from the console.

```bash
# Replace with your actual IP and key file
ssh -i ~/.ssh/id_rsa ubuntu@<PUBLIC_IP>
```

> If you used Oracle-generated keys, use the private key you downloaded:
> ```bash
> chmod 600 /path/to/private_key
> ssh -i /path/to/private_key opc@<PUBLIC_IP>
> ```

---

## 🐳 Step 6: Install Docker

Inside the VM:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add ubuntu user to docker group
sudo usermod -aG docker $USER
newgrp docker  # or log out and back in

# Verify
docker --version
```

---

## 📦 Step 7: Clone the Project

Option A: **Clone from GitHub** (recommended for updates)
```bash
# Replace with your GitHub username
GITHUB_USER=yourusername

sudo apt update && sudo apt install -y git
cd /opt
sudo rm -rf asura-downloader || true
sudo git clone https://github.com/$GITHUB_USER/asura-downloader.git
cd asura-downloader
```

Option B: **Copy from your local machine** (if you don't want GitHub)
```bash
# On your local machine:
cd /path/to/asura-downloader
# Exclude node_modules and large files
rsync -avz --exclude='node_modules' --exclude='.git' ./ ubuntu@<PUBLIC_IP>:/opt/asura-downloader
# Then on the VM:
cd /opt/asura-downloader
```

---

## 🏗️ Step 8: Build and Run the Container

```bash
cd /opt/asura-downloader

# Build the image
docker build -t asura-downloader .

# Run the container
docker rm -f asura-dl || true
docker run -d \
  --name asura-dl \
  --restart unless-stopped \
  -p 80:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  asura-downloader

# Wait 3 seconds
sleep 3

# Health check
curl -sS http://localhost:3000/health
# Should return: {"ok":true}
```

> ✅ If health check fails, check logs:
> ```bash
> docker logs asura-dl
> ```

---

## ☁️ Step 9: Cloudflare Tunnel for HTTPS

### A. Install cloudflared

```bash
# Download cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared

# Make executable
chmod +x /usr/local/bin/cloudflared
```

### B. Authenticate and create tunnel

```bash
# Login to Cloudflare (opens browser)
cloudflared tunnel login

# Create a tunnel
cloudflared tunnel create asura-downloader
```

### C. Configure the tunnel

```bash
# Create config directory
sudo mkdir -p /root/.cloudflared

# Edit config (replace YOUR_SUBDOMAIN with your choice)
cat > /root/.cloudflared/config.yml <<EOF
# Cloudflare Tunnel config for asura-downloader
tunnel: asura-downloader
credentials-file: /root/.cloudflared/asura-downloader.json

ingress:
  # Replace with your desired subdomain
  - hostname: asura.yourname.trycloudflare.com
    service: http://localhost:3000
  # Required: catch-all rule
  - service: http_status:404
EOF
```

> 💡 Replace `asura.yourname.trycloudflare.com` with any subdomain you like (e.g., `asura.mysite.trycloudflare.com`).

### D. Start the tunnel

```bash
# Start tunnel in background
cloudflared tunnel run asura-downloader >/tmp/cloudflared.log 2>&1 &

# Check tunnel status
cloudflared tunnel info asura-downloader
```

> 🔍 If tunnel fails, check logs:
> ```bash
> tail -n 100 /tmp/cloudflared.log
> ```

---

## 🕒 Step 10: Keep-Alive Cron Job

Oracle may reclaim idle instances after 7 days with <20% CPU/network/memory. Add a cron job to prevent this:

```bash
# Edit crontab
sudo crontab -e
```

Paste this (replace any existing content):

```cron
# Keep-alive for Oracle idle-reclamation rule (every 5 min)
*/5 * * * * curl -sS http://localhost:3000/health >/dev/null
# Optional: small CPU/network load daily
0 12 * * * dd if=/dev/zero of=/dev/null bs=1M count=100 status=none
```

Save and exit. Verify:
```bash
sudo crontab -l
```

---

## ✅ Step 11: Test Your App

1. Visit your Cloudflare HTTPS URL:
   `https://asura.yourname.trycloudflare.com`
2. Paste a series URL (e.g., `https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a`)
3. Click **Start**
4. Wait for the job to complete (7–12 minutes for a 150-chapter comic)
5. Download the PDF

---

## 🔄 Step 12: Updating the App

To update to the latest code:

```bash
cd /opt/asura-downloader
git pull
docker build -t asura-downloader .
docker restart asura-dl
```

---

## 🛠️ Troubleshooting

### Port 80 blocked
- Double-check OCI **Security List** for the public subnet: allow TCP port 80 from `0.0.0.0/0`
- Check Ubuntu firewall:
  ```bash
  sudo ufw allow 80
  sudo ufw enable
  ```

### Tunnel not working
- Run cleanup and recreate:
  ```bash
  cloudflared tunnel cleanup
  cloudflared tunnel create asura-downloader
  ```
- Check logs:
  ```bash
  tail -n 100 /tmp/cloudflared.log
  ```

### Instance "out of capacity"
- Try a different **Availability Domain** in the Create Instance form
- Wait a few hours and retry
- Fall back to **VM.Standard.E2.1.Micro** (1GB RAM, x86)

### Health check fails
- Check container logs:
  ```bash
  docker logs asura-dl
  ```
- Verify container is running:
  ```bash
  docker ps
  ```

### Oracle idle-reclamation email
- Add the keep-alive cron as shown above
- Oracle emails before reclaiming; you have 14 days to add load

---

## 📊 Expected Times

| Task | Time |
|---|---|
| Oracle VM creation | 2–5 min |
| Docker install | 2–3 min |
| Clone/build/run | 3–5 min |
| Cloudflare Tunnel setup | 3–5 min |
| Cron setup | 2 min |
| **Total setup** | **~15–25 min** |
| **150-chapter comic** | **~7–12 min** |

---

## 💡 Tips

- **Use a custom domain**: Point a CNAME to your tunnel URL via Cloudflare DNS for a nicer address.
- **Monitor usage**: In Oracle Console → Governance → Limits, Monitor → Service Metrics → Compute → Instance CPU Utilization.
- **Backup**: The VM is ephemeral; keep your code in GitHub for easy redeploy.

---

## 📚 Resources

- [Oracle Cloud Free Tier Docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps)
- [Docker Install Docs](https://docs.docker.com/engine/install/ubuntu/)

---

🎉 **Your app is now running 24/7 on a free Oracle VM with free HTTPS!**
