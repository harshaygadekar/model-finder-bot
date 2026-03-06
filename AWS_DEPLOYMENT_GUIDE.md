# 🚀 AWS EC2 Deployment Guide — AI Model Tracker Bot

This guide provides **step-by-step instructions** to deploy your Discord bot on an AWS EC2 instance. Choose between:

- **Option A**: Direct Node.js deployment with PM2 (simpler)
- **Option B**: Docker deployment (more isolated, easier updates)

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [AWS EC2 Instance Setup](#2-aws-ec2-instance-setup)
3. [Connect to Your Instance](#3-connect-to-your-instance)
4. [Option A: Node.js + PM2 Deployment](#4-option-a-nodejs--pm2-deployment)
5. [Option B: Docker Deployment](#5-option-b-docker-deployment)
6. [Post-Deployment Verification](#6-post-deployment-verification)
7. [Maintenance & Operations](#7-maintenance--operations)
8. [Troubleshooting](#8-troubleshooting)
9. [Security Best Practices](#9-security-best-practices)
10. [Cost Optimization](#10-cost-optimization)

---

## 1. Prerequisites

Before starting, ensure you have:

### 1.1 Required API Credentials
- [ ] **Discord Bot Token** and **Guild ID** (see [SETUP.md](./SETUP.md) sections 1.1-1.5)
- [ ] **Reddit API credentials** (see [SETUP.md](./SETUP.md) section 2)
- [ ] **GitHub Token** (optional but recommended)
- [ ] Any additional AI provider API keys (optional)

### 1.2 Local Testing Complete
- [ ] `.env` file configured with all credentials
- [ ] Bot runs locally without errors (`npm start`)
- [ ] Bot appears online in Discord server

### 1.3 AWS Account
- [ ] AWS account created at [aws.amazon.com](https://aws.amazon.com)
- [ ] Payment method configured (Free tier available for 12 months)

---

## 2. AWS EC2 Instance Setup

### 2.1 Launch Instance

1. Go to **[AWS Console → EC2 Dashboard](https://console.aws.amazon.com/ec2)**
2. Click **"Launch Instance"** (orange button)

### 2.2 Configure Instance

| Setting | Value |
|---------|-------|
| **Name** | `ai-model-tracker` |
| **AMI** | Ubuntu Server 24.04 LTS (64-bit x86) - Free tier eligible |
| **Instance type** | `t2.micro` (1 vCPU, 1GB RAM) - Free tier eligible |
| **Key pair** | Create new → Name: `ai-tracker-key` → Type: RSA → Format: `.pem` → **DOWNLOAD IT** |

### 2.3 Network Settings

Click **"Edit"** in Network settings:

| Setting | Value |
|---------|-------|
| **VPC** | Use default |
| **Auto-assign public IP** | Enable |
| **Security group** | Create new: `ai-tracker-sg` |

**Inbound rules** (add these):

| Type | Port | Source | Description |
|------|------|--------|-------------|
| SSH | 22 | My IP (or `0.0.0.0/0` if dynamic IP) | SSH access |

> ⚠️ By default the bot only needs outbound connections. If you enable `WEBHOOK_ENABLED=true`, you must also provide public HTTPS ingress (typically via a reverse proxy or load balancer) and allow the corresponding inbound web ports.

### 2.4 Storage

- **Size**: 12 GB (recommended for logs and updates)
- **Type**: gp3 (General Purpose SSD)
- Delete on termination: ✅ Yes

### 2.5 Launch

Click **"Launch Instance"** → Wait 1-2 minutes for initialization.

---

## 3. Connect to Your Instance

### 3.1 Get Public IP

1. Go to EC2 Dashboard → Instances
2. Click your instance → Copy **"Public IPv4 address"**

### 3.2 SSH Connection

**From Linux/Mac:**
```bash
# Make key file secure (required once)
chmod 400 ~/Downloads/ai-tracker-key.pem

# Connect (replace <PUBLIC_IP>)
ssh -i ~/Downloads/ai-tracker-key.pem ubuntu@<PUBLIC_IP>
```

**From Windows (PowerShell):**
```powershell
# Connect (replace <PUBLIC_IP>)
ssh -i "$env:USERPROFILE\Downloads\ai-tracker-key.pem" ubuntu@<PUBLIC_IP>
```

**From Windows (PuTTY):**
1. Convert `.pem` to `.ppk` using PuTTYgen
2. In PuTTY: Host = `ubuntu@<PUBLIC_IP>`, Connection → SSH → Auth → Private key file = your `.ppk`

### 3.3 Initial Server Setup

Once connected, run:
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Set timezone (optional - choose your timezone)
sudo timedatectl set-timezone Asia/Kolkata

# Install essential tools
sudo apt install -y git htop curl wget unzip
```

---

## 4. Option A: Node.js + PM2 Deployment

### 4.1 Install Node.js 22

```bash
# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version   # Should show v22.x.x
npm --version    # Should show 10.x.x
```

### 4.2 Install Build Tools

Required for `better-sqlite3` native module compilation:
```bash
sudo apt install -y build-essential python3
```

### 4.3 Get the Bot Code

**Method 1: Clone from Git (Recommended)**
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/model_looker_bot.git
cd model_looker_bot
```

**Method 2: Upload via SCP**
From your LOCAL machine:
```bash
# Create tarball (run locally)
cd /home/hrsh/side-projects
tar -czvf model_looker_bot.tar.gz model_looker_bot --exclude='node_modules' --exclude='.env' --exclude='data/*.db*'

# Upload to EC2
scp -i ~/Downloads/ai-tracker-key.pem model_looker_bot.tar.gz ubuntu@<PUBLIC_IP>:~/

# SSH to EC2 and extract
ssh -i ~/Downloads/ai-tracker-key.pem ubuntu@<PUBLIC_IP>
cd ~
tar -xzvf model_looker_bot.tar.gz
cd model_looker_bot
```

### 4.4 Install Dependencies

```bash
cd ~/model_looker_bot
npm ci --omit=dev
```

> `npm ci` is faster and more reliable than `npm install` for deployment.

### 4.5 Configure Environment

```bash
# Create .env from example
cp .env.example .env

# Edit with your credentials
nano .env
```

**Inside nano:**
1. Paste all your credentials (same values as your local `.env`)
2. Save: `Ctrl+O` → `Enter`
3. Exit: `Ctrl+X`

### 4.6 Test the Bot

```bash
# Quick test - verify bot comes online
node src/index.js
# Watch for "✅ Bot is fully operational!" message
# Press Ctrl+C to stop after verification
```

### 4.7 Install PM2

```bash
sudo npm install -g pm2
```

### 4.8 Start Bot with PM2

```bash
cd ~/model_looker_bot

# Start as daemon
pm2 start src/index.js --name "ai-tracker"

# Verify running
pm2 status
pm2 logs ai-tracker --lines 20
```

### 4.9 Configure Auto-Start on Reboot

```bash
# Generate startup script
pm2 startup

# The command above will output something like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
# COPY AND RUN THAT EXACT COMMAND

# Save current process list
pm2 save
```

**Verify auto-start works:**
```bash
sudo reboot
# Wait 60 seconds, then SSH back in
pm2 status  # Bot should be running
```

---

## 5. Option B: Docker Deployment

### 5.1 Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh

# Add your user to docker group (avoids using sudo)
sudo usermod -aG docker ubuntu

# Apply group changes (log out and back in, or run:)
newgrp docker

# Verify
docker --version   # Should show Docker version 24+
```

### 5.2 Install Docker Compose

```bash
# Install Docker Compose plugin
sudo apt install -y docker-compose-plugin

# Verify
docker compose version
```

### 5.3 Get the Bot Code

Same as Option A - use Git clone or SCP upload:
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/model_looker_bot.git
cd model_looker_bot
```

### 5.4 Configure Environment

```bash
cp .env.example .env
nano .env
# Paste all credentials, save with Ctrl+O, exit with Ctrl+X
```

### 5.5 Create Data Directory

```bash
mkdir -p ~/model_looker_bot/data
chmod 755 ~/model_looker_bot/data
```

### 5.6 Build and Start

```bash
cd ~/model_looker_bot

# Build the Docker image
docker compose build

# Start in detached mode
docker compose up -d

# Verify running
docker compose ps
docker compose logs -f  # Follow logs (Ctrl+C to exit)
```

### 5.7 Configure Auto-Start on Reboot

Docker containers with `restart: unless-stopped` automatically restart on boot when Docker starts. Enable Docker to start on boot:

```bash
sudo systemctl enable docker
```

**Verify:**
```bash
sudo reboot
# Wait 60 seconds, SSH back in
docker compose ps  # Should show container running
```

---

## 6. Post-Deployment Verification

### 6.1 Discord Verification

1. Open your Discord server
2. Check **"🤖 AI Tracker"** category exists with 6 channels
3. Check **#🤖-bot-status** for startup message
4. Try slash commands: `/status`, `/sources`, `/latest`
5. Wait 5-10 minutes and verify notifications appear

### 6.2 Health Check Commands

**For PM2 deployment:**
```bash
pm2 status
pm2 logs ai-tracker --lines 50
pm2 monit  # Real-time dashboard
```

**For Docker deployment:**
```bash
docker compose ps
docker compose logs --tail 50
docker stats ai-model-tracker  # Resource usage
```

### 6.3 Verify Database

```bash
# Check database exists and has data
ls -la ~/model_looker_bot/data/
# Should show: tracker.db, tracker.db-shm, tracker.db-wal
```

---

## 7. Maintenance & Operations

### 7.1 Viewing Logs

**PM2:**
```bash
pm2 logs ai-tracker           # Live logs
pm2 logs ai-tracker --lines 100  # Last 100 lines
pm2 flush                     # Clear old logs
```

**Docker:**
```bash
docker compose logs -f        # Live logs
docker compose logs --tail 100  # Last 100 lines
```

### 7.2 Updating the Bot

**PM2 Deployment:**
```bash
cd ~/model_looker_bot
git pull                      # Get latest code
npm ci --omit=dev            # Update dependencies
pm2 restart ai-tracker        # Restart with new code
```

**Docker Deployment:**
```bash
cd ~/model_looker_bot
git pull
docker compose down           # Stop container
docker compose build --no-cache  # Rebuild image
docker compose up -d          # Start with new code
```

### 7.3 Stopping the Bot

**PM2:**
```bash
pm2 stop ai-tracker           # Stop (keeps in PM2)
pm2 delete ai-tracker         # Remove from PM2 completely
```

**Docker:**
```bash
docker compose stop           # Stop (keeps container)
docker compose down           # Stop and remove container
```

### 7.4 Backup Database

```bash
# Create backup
cp ~/model_looker_bot/data/tracker.db ~/tracker-backup-$(date +%Y%m%d).db

# Download to local machine (from LOCAL terminal)
scp -i ~/Downloads/ai-tracker-key.pem ubuntu@<PUBLIC_IP>:~/model_looker_bot/data/tracker.db ./
```

### 7.5 Updating Environment Variables

```bash
nano ~/model_looker_bot/.env
# Make changes, save

# Restart to apply
pm2 restart ai-tracker        # PM2
docker compose restart        # Docker
```

---

## 8. Troubleshooting

### 8.1 Bot Not Coming Online

**Check Discord token:**
```bash
grep DISCORD_TOKEN ~/model_looker_bot/.env
# Verify token is correct (no extra spaces)
```

**Check logs for errors:**
```bash
pm2 logs ai-tracker --err --lines 30  # PM2
docker compose logs | tail -30        # Docker
```

**Common issues:**
- `TOKEN_INVALID` → Reset token in Discord Developer Portal
- `Missing Permissions` → Re-invite bot with correct permissions

### 8.2 SSH Connection Issues

```
ssh: connect to host ... port 22: Connection refused
```

**Fix:**
1. EC2 Console → Select instance → Actions → Security → Change security groups
2. Ensure security group allows inbound SSH (port 22) from your IP

### 8.3 Memory Issues (OOM Kills)

```bash
# Check current memory
free -m

# Add swap file (virtual memory)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 8.4 Native Module Build Failures

```
Error: Could not find module ... better-sqlite3
```

**Fix:**
```bash
# Ensure build tools are installed
sudo apt install -y build-essential python3

# Rebuild native modules
cd ~/model_looker_bot
npm rebuild
pm2 restart ai-tracker
```

### 8.5 Docker Issues

**Container keeps restarting:**
```bash
docker compose logs --tail 50  # Check for errors
```

**Permission denied on volume:**
```bash
sudo chown -R 1000:1000 ~/model_looker_bot/data
docker compose restart
```

### 8.6 Reddit API Errors

```
Error: Reddit API credentials not configured
```

**Fix:**
```bash
# Check credentials are set
grep REDDIT ~/model_looker_bot/.env
# Ensure no extra spaces or quotes
```

---

## 9. Security Best Practices

### 9.1 SSH Security

```bash
# Change default SSH port (optional but recommended)
sudo nano /etc/ssh/sshd_config
# Change: Port 22  →  Port 2222 (or any unused port)
sudo systemctl restart sshd

# Update security group to allow new port
```

### 9.2 Firewall Setup

```bash
# Enable UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh  # Or your custom port
sudo ufw enable
```

### 9.3 Keep System Updated

```bash
# Setup automatic security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 9.4 Protect Credentials

```bash
# Ensure .env has restricted permissions
chmod 600 ~/model_looker_bot/.env
```

---

## 10. Cost Optimization

### 10.1 Free Tier Usage

| Resource | Free Tier Limit | Our Usage |
|----------|----------------|-----------|
| EC2 t2.micro | 750 hrs/month | ~730 hrs (1 instance 24/7) |
| EBS Storage | 30 GB/month | 12 GB |
| Data Transfer | 15 GB/month | ~1-2 GB |

**Result**: Should stay within free tier for first 12 months.

### 10.2 After Free Tier Expires

Estimated monthly cost for `t2.micro`:
- On-demand: ~$8-10/month
- Reserved (1 year): ~$4-5/month
- Spot Instance: ~$2-3/month (may be interrupted)

### 10.3 Alternative: Use a Smaller Instance

For this bot, `t3.nano` (2 vCPU, 0.5GB RAM) may work after adding swap:
- Cost: ~$3-4/month

---

## ✅ Deployment Checklist

### Pre-Deployment
- [ ] All API credentials ready (Discord, Reddit, GitHub)
- [ ] Bot tested locally
- [ ] `.env` file prepared

### EC2 Setup
- [ ] EC2 instance launched (t2.micro, Ubuntu 24.04)
- [ ] Key pair downloaded
- [ ] Security group configured (SSH access)
- [ ] Connected via SSH

### Deployment (Choose One)
**Option A - PM2:**
- [ ] Node.js 22 installed
- [ ] Build tools installed
- [ ] Code deployed
- [ ] Dependencies installed (`npm ci`)
- [ ] `.env` configured
- [ ] PM2 installed and bot started
- [ ] Auto-start configured

**Option B - Docker:**
- [ ] Docker installed
- [ ] Docker Compose installed
- [ ] Code deployed
- [ ] `.env` configured
- [ ] Container built and running
- [ ] Docker auto-start enabled

### Verification
- [ ] Bot appears online in Discord
- [ ] Channels created in server
- [ ] Slash commands work
- [ ] Notifications appear within 10 minutes
- [ ] Bot survives server reboot

---

## 📚 Quick Reference Commands

| Task | PM2 Command | Docker Command |
|------|-------------|----------------|
| View status | `pm2 status` | `docker compose ps` |
| View logs | `pm2 logs ai-tracker` | `docker compose logs -f` |
| Restart | `pm2 restart ai-tracker` | `docker compose restart` |
| Stop | `pm2 stop ai-tracker` | `docker compose stop` |
| Start | `pm2 start ai-tracker` | `docker compose up -d` |
| Resource usage | `pm2 monit` | `docker stats` |

---

## 🆘 Getting Help

If you encounter issues not covered here:

1. Check Discord Developer Portal for bot status
2. Check EC2 instance health in AWS Console
3. Review bot logs for specific error messages
4. Ensure all environment variables are correctly set

---

*Last updated: March 2026*
