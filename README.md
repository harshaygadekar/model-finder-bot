# Model Looker Bot

`Model Looker Bot` is a Discord bot that watches AI labs, model registries, code hosts, social feeds, research sources, and rumor surfaces for new model activity — then routes the good stuff into organized Discord channels.

It is built as a Node.js CommonJS app with:

- adaptive multi-source polling
- SQLite-backed state and observability
- optional hybrid classification with Groq
- event corroboration and source reliability scoring
- digest generation for breaking signals, papers, and weekly summaries
- optional GitHub webhook ingestion
- health/readiness endpoints for deployment monitoring

If you want a bot that acts less like a noisy RSS firehose and more like an AI release desk, this is the one.

## What it monitors

The bot pulls signals from multiple source families, including:

- official lab/blog RSS feeds
- lab websites that need HTML scraping
- GitHub repositories and org activity
- Hugging Face organizations, trending models, and daily papers
- Reddit communities
- Bluesky accounts and newsletter feeds
- Ollama library updates
- ArXiv papers for weekly research digests
- LM Arena / leaderboard signals
- SDK registry changes
- API model registries and provider model catalogs
- changelogs and playground frontends that can leak new model IDs
- optional GitHub webhooks for near-real-time ingestion

## Highlights

- **Organized Discord delivery**: auto-creates an `🤖 AI Tracker` category with dedicated channels for releases, rumors, papers, leaderboards, health, and more.
- **Adaptive scheduling**: sources speed up when they are hot and back off when they are quiet or unhealthy.
- **Noise control**: first-run seeding, URL/title similarity dedup, freshness gates, and relevance filtering keep alerts sane.
- **Intelligence layer**: observations are classified, linked into events, corroborated across sources, and scored for confidence.
- **Source health tracking**: failures, empty checks, latency, and backlog are recorded and surfaced.
- **Operational readiness**: `/live`, `/ready`, and `/health` endpoints make it deployable behind PM2 or Docker.
- **Weekly summaries**: generates breaking signal digests, research paper digests, and weekly AI roundups.

## How it works

At a high level, the runtime pipeline is:

1. `src/index.js` builds adapter instances from the configured source lists.
2. `src/services/scheduler.js` runs them with adaptive timing and health-aware backoff.
3. Each adapter emits normalized items.
4. `src/services/filter.js` classifies items and records observations/events.
5. `src/services/notifier.js` enqueues delivery jobs, enriches/translates items when needed, and posts them to Discord.
6. `src/db/database.js` persists seen items, queue state, papers, events, health metrics, reliability scores, and webhook receipts.

The result: new signals land in Discord, not duplicate soup.

## Discord channels

On startup, the bot ensures these text channels exist under an `🤖 AI Tracker` category:

| Channel | Purpose |
|---|---|
| `🔴-major-releases` | flagship launches, official releases, major upgrades |
| `📦-model-updates` | model/API/catalog changes that matter but are not top-tier launch alerts |
| `📰-tech-news` | broader AI and tech news |
| `💬-community-buzz` | forums, social chatter, open-source discussion |
| `📊-leaderboard-updates` | arena, benchmarks, leaderboard movement |
| `📄-research-papers` | weekly paper digest output |
| `📋-weekly-digest` | weekly news roundup |
| `🎪-major-events` | event monitoring threads and recap signals |
| `🔮-rumors-leaks` | lower-confidence or unverified early signals |
| `🐉-china-ai` | China-focused AI coverage |
| `🧠-talent-moves` | researcher and affiliation movement |
| `🤖-bot-status` | operational updates and source health alerts |

## Slash commands

| Command | What it does |
|---|---|
| `/status` | show uptime, bot status, and aggregate stats |
| `/sources` | list monitored sources and their status |
| `/health` | show source health and delivery queue backlog |
| `/latest` | show the most recent tracked items |
| `/timeline` | show recent confirmed events and top reliable sources |
| `/digest` | manually trigger digests |
| `/event start` | start an event monitoring mode |
| `/event stop` | stop an event monitoring mode |
| `/event list` | list active/recent event modes |

## Quick start

### Prerequisites

- Node.js 22+
- npm
- a Discord bot token and target guild/server ID
- optional: Reddit credentials, GitHub token, Groq key, provider API keys, webhook secret

If you are on Linux and building native modules locally, you may also need standard build tools for `better-sqlite3`.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

This repository includes both `.env.example` and a placeholder `.env`.

Update `.env` with your real values before starting the bot.

Minimum required variables:

```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_GUILD_ID=your_discord_server_id_here
```

Recommended additions:

- `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` to enable Reddit monitoring
- `GITHUB_TOKEN` to avoid the low unauthenticated GitHub rate limit
- `GROQ_API_KEY` if you enable the hybrid classifier

### 3. Start the bot

```bash
npm start
```

For local development with automatic restarts:

```bash
npm run dev
```

### 4. Verify startup

You should see logs indicating that the bot:

- initialized the SQLite database
- logged into Discord
- created or resolved the tracker channels
- registered slash commands
- started the health server
- scheduled adapters and digests

## Important startup behavior

### First run seeds old content silently

The bot intentionally **does not blast historical backlog into Discord** on the first run for a source.

Instead, it seeds existing items into the database and only posts **new, fresh, unseen** items after startup. If the bot seems quiet for a while, that is probably it being polite rather than broken.

### Freshness gate

Items older than 24 hours are marked as seen without being sent as notifications.

## Environment variables

### Required

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_GUILD_ID` | Discord server/guild ID to manage |

### Core optional

| Variable | Purpose |
|---|---|
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | enable Reddit adapters |
| `REDDIT_USER_AGENT` | Reddit API user-agent string |
| `GITHUB_TOKEN` | higher GitHub API limits |
| `LOG_LEVEL` | runtime logging verbosity |
| `HEALTH_PORT` | port for `/live`, `/ready`, `/health` |

### Classification

| Variable | Purpose |
|---|---|
| `CLASSIFIER_ENABLED` | enable Groq-assisted hybrid classification |
| `GROQ_API_KEY` | key used when classifier is enabled |
| `CLASSIFIER_MODEL` | Groq model name |
| `CLASSIFIER_TIMEOUT_MS`, `CLASSIFIER_MAX_RETRIES`, `CLASSIFIER_CACHE_TTL_SECONDS` | classifier behavior controls |

When classification is disabled or unavailable, the bot falls back to keyword-based filtering.

### Webhooks

| Variable | Purpose |
|---|---|
| `WEBHOOK_ENABLED` | enable webhook receiver |
| `WEBHOOK_PORT` | webhook HTTP listener port |
| `GITHUB_WEBHOOK_SECRET` | required when webhooks are enabled |
| `WEBHOOK_MAX_BODY_BYTES` | max accepted payload size |
| `WEBHOOK_REQUEST_TIMEOUT_MS` | webhook request timeout |

### Browser fallback

| Variable | Purpose |
|---|---|
| `BROWSER_MODE` | set to `local` to enable Playwright-backed fallback scraping |
| `BROWSER_SNAPSHOTS_ENABLED` | enable browser snapshots for debugging/extraction workflows |

### Provider polling

The bot can poll model catalogs directly when provider keys are set, including keys such as:

- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_AI_API_KEY`
- `MISTRAL_API_KEY`
- `COHERE_API_KEY`
- `XAI_API_KEY`
- `TOGETHER_API_KEY`
- `FIREWORKS_API_KEY`
- `PERPLEXITY_API_KEY`
- `CEREBRAS_API_KEY`
- `DEEPSEEK_API_KEY`
- `MOONSHOT_API_KEY`
- `YI_API_KEY`
- `SILICONFLOW_API_KEY`
- `ZHIPU_API_KEY`
- `STEPFUN_API_KEY`
- `BAICHUAN_API_KEY`
- `MINIMAX_API_KEY`
- `DASHSCOPE_API_KEY`

Without these keys, the bot still works and falls back to free aggregators where possible.

## Health endpoints

The health server starts early during boot and exposes:

| Endpoint | Meaning |
|---|---|
| `/live` | process is up |
| `/ready` | bot is actually operational and startup checks passed |
| `/health` | full diagnostic snapshot |

By default the health server uses port `8788`.

## Digests and summaries

The digest service currently schedules:

- **hourly breaking digest** for recently confirmed signals
- **weekly paper digest** on Sundays at 10:00 AM (`Asia/Kolkata`)
- **weekly major-events recap** on Sundays at 10:10 AM (`Asia/Kolkata`)
- **weekly roundup** on Sundays at 10:15 AM (`Asia/Kolkata`)

You can also trigger digests manually with `/digest`.

## Data storage

Persistent data lives in SQLite at:

- `data/tracker.db`

The database stores, among other things:

- seen items and notification state
- source health and crawl attempts
- delivery queue and attempts
- papers and digests
- observations, corroborated events, and reliability scores
- event modes and webhook receipts

## Running with Docker

This repository includes `Dockerfile` and `docker-compose.yml`.

### Build and run

```bash
docker compose up --build -d
```

### Notes

- the SQLite data directory is mounted from `./data`
- the health endpoint is bound to loopback by default: `127.0.0.1:${HEALTH_PORT:-8788}`
- the container uses `restart: unless-stopped`

## Testing

Available scripts:

| Script | Purpose |
|---|---|
| `npm test` | run the automated test suite via Node’s built-in test runner |
| `npm run test:groq` | Groq smoke test |
| `npm run test:groq:eval` | Groq evaluation script |

## Practical notes

- This project is written in **CommonJS**, not ESM.
- A GitHub token is optional, but strongly recommended for rate limits.
- Reddit monitoring is automatically disabled if Reddit credentials are missing.
- Webhook mode requires `WEBHOOK_ENABLED=true` **and** a `GITHUB_WEBHOOK_SECRET`.
- Browser-backed scraping is optional and off by default.

## Typical development loop

1. Update `.env`
2. Run `npm install`
3. Start with `npm run dev`
4. Use `/status`, `/sources`, and `/health` in Discord to inspect runtime behavior
5. Watch `#🤖-bot-status` for health transitions and startup notices

## License

This repository currently uses the license declared in `package.json`:

- `ISC`