# 🛠️ Complete Setup Guide — AI Model Tracker Bot

This guide walks you through **every step** to get the bot running, from creating accounts to deploying on AWS.

---

## Table of Contents

1. [Discord Bot Setup](#1-discord-bot-setup)
2. [Reddit API Setup](#2-reddit-api-setup)
3. [GitHub Token (Optional)](#3-github-token-optional)
4. [Local Configuration](#4-local-configuration)
5. [Local Testing](#5-local-testing)
6. [AWS EC2 Deployment](#6-aws-ec2-deployment)
7. [Keeping the Bot Running 24/7](#7-keeping-the-bot-running-247)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Discord Bot Setup

### 1.1 — Create a Discord Application

1. Go to **[discord.com/developers/applications](https://discord.com/developers/applications)**
2. Log in with your Discord account
3. Click the **"New Application"** button (top-right)
4. Name it: `AI Model Tracker` (or whatever you like)
5. Click **"Create"**

### 1.2 — Get the Bot Token

1. In the left sidebar, click **"Bot"**
2. Click **"Reset Token"** → confirm → **copy the token immediately**
   > ⚠️ **IMPORTANT**: You can only see the token ONCE. If you lose it, you'll have to reset it again. Never share this token publicly.
3. Store the token somewhere safe (you'll put it in `.env` later)

### 1.3 — Enable Required Intents

Still on the **Bot** page, scroll down to **"Privileged Gateway Intents"** and enable:

- ✅ **Message Content Intent** (toggle ON)

Click **"Save Changes"** at the bottom.

### 1.4 — Generate Invite Link & Add Bot to Server

1. In the left sidebar, click **"OAuth2"**
2. Click **"URL Generator"**
3. Under **Scopes**, check:
   - ✅ `bot`
   - ✅ `applications.commands`
4. Under **Bot Permissions**, check:
   - ✅ `Manage Channels`
   - ✅ `Send Messages`
   - ✅ `Send Messages in Threads`
   - ✅ `Embed Links`
   - ✅ `Attach Files`
   - ✅ `Read Message History`
   - ✅ `Use Slash Commands`
   - ✅ `View Channels`
5. Copy the **Generated URL** at the bottom
6. Open it in your browser
7. Select your Discord server → click **"Authorize"**
8. Complete the CAPTCHA

The bot should now appear in your server's member list (it'll be offline until we start it).

### 1.5 — Get Your Server (Guild) ID

1. Open Discord (desktop app or browser)
2. Go to **User Settings** (⚙️ gear icon at bottom-left)
3. Navigate to **App Settings → Advanced**
4. Toggle ON **"Developer Mode"**
5. Close settings
6. **Right-click your server name** in the left sidebar
7. Click **"Copy Server ID"**
8. Save this ID (you'll put it in `.env` later)

---

## 2. Reddit API Setup

### 2.1 — Create a Reddit App

1. Go to **[reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)**
2. Log in with your Reddit account (create one if needed)
3. Scroll to the bottom and click **"create another app..."**
4. Fill in the form:
   - **Name**: `ModelLookerBot`
   - **App type**: Select **"script"** (⚫ radio button)
   - **Description**: `AI model release tracker`
   - **About URL**: leave blank
   - **Redirect URI**: `http://localhost`
5. Click **"create app"**

### 2.2 — Get Your Credentials

After creating the app, you'll see it listed. Grab these two values:

```
┌──────────────────────────────────────┐
│ ModelLookerBot                       │
│ personal use script                  │
│                                      │
│ ← This string under the app name    │
│    is your CLIENT_ID                 │
│    (looks like: a1B2c3D4e5F6gH)     │
│                                      │
│ secret: ← This is your              │
│    CLIENT_SECRET                     │
│    (looks like: xYz123AbC456...)     │
└──────────────────────────────────────┘
```

- **Client ID**: The short string directly under your app name (under "personal use script")
- **Client Secret**: The value next to "secret"

Save both values.

---

## 3. GitHub Token (Optional)

A GitHub token increases rate limits from 60 requests/hour to 5,000/hour. **Recommended but not required.**

### 3.1 — Create a Personal Access Token

1. Go to **[github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)**
2. Click **"Generate new token"**
3. Fill in:
   - **Token name**: `model-tracker-bot`
   - **Expiration**: 90 days (or "No expiration" — your choice)
   - **Repository access**: Select **"Public repositories (read-only)"**
   - **No additional permissions needed** — read-only is fine
4. Click **"Generate token"**
5. **Copy the token** (starts with `github_pat_...`)

---

## 4. Local Configuration

### 4.1 — Create Your `.env` File

```bash
cd /home/hrsh/side-projects/model_looker_bot
cp .env.example .env
```

### 4.2 — Fill In Your Credentials

Open `.env` in your editor and fill in the values:

```env
# Discord Bot
DISCORD_TOKEN=paste_your_discord_bot_token_here
DISCORD_GUILD_ID=paste_your_server_id_here

# Reddit API
REDDIT_CLIENT_ID=paste_your_reddit_client_id_here
REDDIT_CLIENT_SECRET=paste_your_reddit_client_secret_here
REDDIT_USER_AGENT=ModelLookerBot/1.0

# GitHub (optional but recommended)
GITHUB_TOKEN=paste_your_github_token_here

# Logging
LOG_LEVEL=info
```

Optional feature flags you can add later:

```env
# Hybrid classifier (uses GROQ_API_KEY when enabled)
CLASSIFIER_ENABLED=false
CLASSIFIER_MODEL=llama-3.1-8b-instant

# GitHub webhooks (requires public HTTPS ingress in production)
WEBHOOK_ENABLED=false
WEBHOOK_PORT=8787
GITHUB_WEBHOOK_SECRET=
WEBHOOK_MAX_BODY_BYTES=1048576
WEBHOOK_REQUEST_TIMEOUT_MS=10000

# Browser fallback scraping
BROWSER_MODE=disabled
```

> ⚠️ No spaces around the `=` sign. No quotes around the values.

---

## 5. Local Testing

### 5.1 — Install Dependencies (if not done already)

```bash
cd /home/hrsh/side-projects/model_looker_bot
npm install
```

### 5.2 — Start the Bot

```bash
npm start
```

### 5.3 — What You Should See

```
2026-03-04 11:00:00 [INFO ] 🚀 Starting AI Model Tracker Bot...
2026-03-04 11:00:00 [INFO ] 📁 Initializing database...
2026-03-04 11:00:00 [INFO ] 🔑 Logging in to Discord...
2026-03-04 11:00:01 [INFO ] ✅ Discord bot logged in as AI Model Tracker#1234
2026-03-04 11:00:01 [INFO ] 📡 Connected to 1 server(s)
2026-03-04 11:00:01 [INFO ] 📍 Connected to guild: YourServerName
2026-03-04 11:00:01 [INFO ] 📺 Setting up channels...
2026-03-04 11:00:02 [INFO ] Created category: 🤖 AI Tracker
2026-03-04 11:00:02 [INFO ] Created channel: #🔴-major-releases
... (more channels)
2026-03-04 11:00:03 [INFO ] ✅ Slash commands registered
2026-03-04 11:00:03 [INFO ] 📡 Starting 30 adapter(s)...
2026-03-04 11:00:03 [INFO ] ✅ Bot is fully operational!
```

### 5.4 — Verify in Discord

1. Check your server — you should see a new **"🤖 AI Tracker"** category with 12 channels (including health, event mode, rumors, and bot status channels)
2. Check `#🤖-bot-status` for the startup message
3. Try slash commands: type `/status`, `/sources`, or `/latest`
4. Within 5 minutes, you should start seeing notifications appear in the channels

### 5.5 — Stop the Bot

Press **`Ctrl+C`** in the terminal to stop.

---

## 6. AWS EC2 Deployment

### 6.1 — Launch an EC2 Instance

1. Go to **[AWS Console → EC2](https://console.aws.amazon.com/ec2)**
2. Click **"Launch Instance"**
3. Configure:
   - **Name**: `ai-model-tracker`
   - **AMI**: Select **Ubuntu Server 24.04 LTS** (Free tier eligible)
   - **Instance type**: `t2.micro` (Free tier eligible — 1 vCPU, 1GB RAM)
   - **Key pair**: Create a new key pair or use existing
     - If creating new: name it `ai-tracker-key`, type `RSA`, format `.pem`
     - **Download and save the `.pem` file** — you need it to SSH in
   - **Network settings**: Click "Edit"
     - ✅ Allow SSH traffic from: **My IP** (more secure) or **Anywhere** (if your IP changes)
     - No need to allow HTTP/HTTPS (bot doesn't serve web traffic)
   - **Storage**: 8 GB gp3 (default is fine)
4. Click **"Launch Instance"**

### 6.2 — Connect to Your Instance

Wait 1-2 minutes for the instance to start, then:

```bash
# Make the key file secure (required)
chmod 400 ~/Downloads/ai-tracker-key.pem

# Connect via SSH (replace <PUBLIC_IP> with your EC2 instance's public IP)
ssh -i ~/Downloads/ai-tracker-key.pem ubuntu@<PUBLIC_IP>
```

Find your Public IP: EC2 Dashboard → click on your instance → look for **"Public IPv4 address"**

### 6.3 — Install Node.js on EC2

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # Should show v22.x.x
npm --version    # Should show 10.x.x

# Install build tools (needed for better-sqlite3)
sudo apt install -y build-essential python3
```

### 6.4 — Clone and Setup the Bot

```bash
# Clone your repo (if you've pushed it to GitHub)
git clone https://github.com/YOUR_USERNAME/model_looker_bot.git
cd model_looker_bot

# --- OR if not on GitHub, copy files from your local machine ---
# (Run this from your LOCAL machine, not EC2)
# scp -i ~/Downloads/ai-tracker-key.pem -r /home/hrsh/side-projects/model_looker_bot ubuntu@<PUBLIC_IP>:~/
# Then SSH back to EC2 and cd into the folder

# Install dependencies
npm install

# Create .env file
cp .env.example .env
nano .env   # Paste in your credentials (same as local)
```

### 6.5 — Test on EC2

```bash
# Quick test — should see the bot come online
node src/index.js
# Press Ctrl+C to stop after verifying it works
```

---

## 7. Keeping the Bot Running 24/7

### 7.1 — Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

### 7.2 — Start the Bot with PM2

```bash
cd ~/model_looker_bot

# Start the bot as a daemon
pm2 start src/index.js --name "ai-tracker"

# Verify it's running
pm2 status

# View logs
pm2 logs ai-tracker

# View logs (last 100 lines)
pm2 logs ai-tracker --lines 100
```

### 7.3 — Auto-Start on Server Reboot

```bash
# Generate startup script
pm2 startup

# It will output a command like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Copy and run that command

# Save the current process list
pm2 save
```

Now the bot will automatically restart if the EC2 instance reboots.

### 7.4 — Useful PM2 Commands

```bash
pm2 status              # Check status
pm2 logs ai-tracker     # View live logs
pm2 restart ai-tracker  # Restart the bot
pm2 stop ai-tracker     # Stop the bot
pm2 delete ai-tracker   # Remove from PM2
pm2 monit               # Real-time monitoring dashboard
```

---

## 8. Troubleshooting

### Bot doesn't come online

```
Error: TOKEN_INVALID
```

→ Your Discord token is wrong. Go to Discord Developer Portal → Bot → Reset Token → copy again.

### Channels not created

```
Error: Missing Permissions
```

→ The bot doesn't have `Manage Channels` permission. Re-invite with correct permissions (see step 1.4).

### Reddit errors

```
Error: Reddit API credentials not configured
```

→ Check your `.env` — make sure `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set and correct (no extra spaces or quotes).

### GitHub rate limit

```
[GitHub] warning: rate limit approaching
```

→ Add a `GITHUB_TOKEN` to your `.env` to increase from 60 to 5000 requests/hour.

### EC2 SSH connection refused

```
ssh: connect to host ... port 22: Connection refused
```

→ Check EC2 Security Group — ensure inbound SSH (port 22) is allowed from your IP.

### Bot crashes on EC2

```bash
# Check PM2 logs for the error
pm2 logs ai-tracker --lines 50

# Common fix: rebuild native modules
cd ~/model_looker_bot
npm rebuild
pm2 restart ai-tracker
```

### EC2 runs out of memory

```bash
# Check memory usage
free -m

# If needed, create a swap file (gives you virtual memory)
sudo fallocate -l 1G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## ✅ Setup Checklist

Use this to track your progress:

- [ ] Created Discord Application
- [ ] Got Discord Bot Token
- [ ] Enabled Message Content Intent
- [ ] Invited bot to Discord server
- [ ] Got Discord Server (Guild) ID
- [ ] Created Reddit API app (script type)
- [ ] Got Reddit Client ID & Secret
- [ ] (Optional) Created GitHub Personal Access Token
- [ ] Created `.env` file with all credentials
- [ ] Tested bot locally (`npm start`)
- [ ] Launched EC2 instance (`t2.micro`, Ubuntu)
- [ ] Installed Node.js on EC2
- [ ] Deployed bot code to EC2
- [ ] Installed PM2 and started bot
- [ ] Configured PM2 auto-start on reboot
- [ ] Verified bot is running 24/7
