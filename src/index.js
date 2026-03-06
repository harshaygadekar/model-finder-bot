require('dotenv').config();

const { Events } = require('discord.js');
const { createClient, login } = require('./bot/client');
const { ensureChannels } = require('./bot/channels');
const { registerCommands, handleInteraction } = require('./bot/commands');
const { scheduleAll } = require('./services/scheduler');
const { sendStatusMessage, startDeliveryWorker, stopDeliveryWorker } = require('./services/notifier');
const { startWebhookReceiver, stopWebhookReceiver } = require('./services/webhooks/receiver');
const db = require('./db/database');
const logger = require('./services/logger');

let webhookServer = null;

// ─── Adapter Imports ─────────────────────────────────────────────────────────
const RSSAdapter = require('./adapters/rss-adapter');
const GitHubAdapter = require('./adapters/github-adapter');
const HuggingFaceAdapter = require('./adapters/huggingface-adapter');
const RedditAdapter = require('./adapters/reddit-adapter');
const OllamaAdapter = require('./adapters/ollama-adapter');
const BlueskyAdapter = require('./adapters/bluesky-adapter');
const ArxivAdapter = require('./adapters/arxiv-adapter');
const HFPapersAdapter = require('./adapters/hf-papers-adapter');
const ScrapeAdapter = require('./adapters/scrape-adapter');
const HFTrendingAdapter = require('./adapters/hf-trending-adapter');
const SDKTrackerAdapter = require('./adapters/sdk-tracker-adapter');
const TalentAdapter = require('./adapters/talent-adapter');
const APIModelsAdapter = require('./adapters/api-models-adapter');
const ArenaMonitorAdapter = require('./adapters/arena-monitor-adapter');
const ChangelogAdapter = require('./adapters/changelog-adapter');
const PlaygroundScraperAdapter = require('./adapters/playground-scraper-adapter');

// ─── Config Imports ──────────────────────────────────────────────────────────
const {
  RSS_SOURCES,
  SCRAPE_SOURCES,
  GITHUB_SOURCES,
  HUGGINGFACE_SOURCES,
  REDDIT_SOURCES,
  OLLAMA_CONFIG,
  SDK_SOURCES,
  ARENA_SOURCES,
  INTERVALS,
} = require('./config/sources');
const { BLUESKY_SOURCES, NEWSLETTER_RSS_SOURCES } = require('./config/social-accounts');
const { scheduleDigests } = require('./services/digest');

// ─── Validation ──────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  // Warnings for optional but recommended vars
  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    logger.warn('Reddit API credentials not set. Reddit monitoring will be disabled.');
  }

  if (!process.env.GITHUB_TOKEN) {
    logger.warn('GitHub token not set. Using unauthenticated API (60 req/hr limit).');
  }

  if (String(process.env.CLASSIFIER_ENABLED || '').toLowerCase() === 'true' && !process.env.GROQ_API_KEY) {
    logger.warn('CLASSIFIER_ENABLED is true but GROQ_API_KEY is missing. Falling back to keyword-only classification.');
  }

  if (String(process.env.WEBHOOK_ENABLED || '').toLowerCase() === 'true' && !process.env.GITHUB_WEBHOOK_SECRET) {
    logger.error('WEBHOOK_ENABLED is true but GITHUB_WEBHOOK_SECRET is missing.');
    process.exit(1);
  }

  // Informational: which API model sources are active
  const allDirectProviders = [
    // Western
    ['OPENAI_API_KEY', 'OpenAI'], ['ANTHROPIC_API_KEY', 'Anthropic'],
    ['GOOGLE_AI_API_KEY', 'Google Gemini'], ['MISTRAL_API_KEY', 'Mistral'],
    ['COHERE_API_KEY', 'Cohere'], ['XAI_API_KEY', 'xAI'],
    ['GROQ_API_KEY', 'Groq'], ['TOGETHER_API_KEY', 'Together'],
    ['FIREWORKS_API_KEY', 'Fireworks'], ['PERPLEXITY_API_KEY', 'Perplexity'],
    ['CEREBRAS_API_KEY', 'Cerebras'],
    // Chinese
    ['DEEPSEEK_API_KEY', 'DeepSeek'], ['MOONSHOT_API_KEY', 'Moonshot'],
    ['YI_API_KEY', '01.AI/Yi'], ['SILICONFLOW_API_KEY', 'SiliconFlow'],
    ['ZHIPU_API_KEY', 'Zhipu/GLM'], ['STEPFUN_API_KEY', 'Stepfun'],
    ['BAICHUAN_API_KEY', 'Baichuan'], ['MINIMAX_API_KEY', 'MiniMax'],
    ['DASHSCOPE_API_KEY', 'Alibaba/DashScope'],
  ];
  const activeDirect = allDirectProviders.filter(([k]) => !!process.env[k]).map(([, n]) => n);
  const hasORKey = !!process.env.OPENROUTER_API_KEY;

  logger.info(`API Model Registry: Free aggregators always active — OpenRouter${hasORKey ? ' (authenticated)' : ''}, NovitaAI, Sambanova, AI21`);
  if (activeDirect.length > 0) {
    logger.info(`API Model Registry: direct provider polling enabled for: ${activeDirect.join(', ')}`);
  } else {
    logger.info('API Model Registry: no direct provider API keys set — relying on free aggregators only');
  }
}

// ─── Build Adapters ──────────────────────────────────────────────────────────

function buildAdapterConfigs() {
  const configs = [];

  // RSS adapters
  for (const source of RSS_SOURCES) {
    configs.push({
      adapter: new RSSAdapter(source),
      interval: INTERVALS.RSS,
    });
  }

  // GitHub adapters
  for (const source of GITHUB_SOURCES) {
    configs.push({
      adapter: new GitHubAdapter(source),
      interval: INTERVALS.GITHUB,
    });
  }

  // HuggingFace adapters
  for (const source of HUGGINGFACE_SOURCES) {
    configs.push({
      adapter: new HuggingFaceAdapter(source),
      interval: INTERVALS.HUGGINGFACE,
    });
  }

  // Reddit adapters (only if credentials are set)
  if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
    for (const source of REDDIT_SOURCES) {
      configs.push({
        adapter: new RedditAdapter(source),
        interval: INTERVALS.REDDIT,
      });
    }
  }

  // Ollama adapter
  configs.push({
    adapter: new OllamaAdapter(OLLAMA_CONFIG),
    interval: INTERVALS.OLLAMA,
  });

  // Bluesky adapters (free, no auth)
  for (const source of BLUESKY_SOURCES) {
    configs.push({
      adapter: new BlueskyAdapter(source),
      interval: INTERVALS.BLUESKY,
    });
  }

  // Newsletter RSS feeds (curated AI news from social)
  for (const source of NEWSLETTER_RSS_SOURCES) {
    configs.push({
      adapter: new RSSAdapter({ ...source, sourceType: 'newsletter' }),
      interval: INTERVALS.NEWSLETTER || INTERVALS.RSS,
    });
  }

  // Scraped lab blogs (direct HTML)
  for (const source of SCRAPE_SOURCES) {
    configs.push({
      adapter: new ScrapeAdapter(source),
      interval: INTERVALS.SCRAPE || '*/15 * * * *',
    });
  }

  // ArXiv paper collection (daily silent collection for weekly digest)
  configs.push({
    adapter: new ArxivAdapter(),
    interval: '0 */6 * * *', // Every 6 hours
  });

  // HuggingFace Daily Papers
  configs.push({
    adapter: new HFPapersAdapter(),
    interval: '0 */4 * * *', // Every 4 hours
  });

  // HuggingFace Trending Models
  configs.push({
    adapter: new HFTrendingAdapter(),
    interval: '0 * * * *', // Every hour
  });

  // Leaderboard + Mystery Model tracking (pass checkMystery: true)
  const LeaderboardAdapter = require('./adapters/leaderboard-adapter');
  configs.push({
    adapter: new LeaderboardAdapter({ checkMystery: true }),
    interval: INTERVALS.ARENA || '0 */4 * * *',
  });

  // SDK Supply Chain Tracker (NPM + PyPI)
  configs.push({
    adapter: new SDKTrackerAdapter(),
    interval: INTERVALS.SDK || '0 */6 * * *',
  });

  // Talent Movement Tracker (ArXiv + GitHub orgs)
  configs.push({
    adapter: new TalentAdapter(),
    interval: INTERVALS.TALENT || '0 8 * * *',
  });

  // API Model Registry Poller
  // Primary: OpenRouter (free, no key) — always active
  // Optional: direct provider APIs (faster, but requires keys) — handled inside the adapter
  configs.push({
    adapter: new APIModelsAdapter(),
    interval: INTERVALS.API_MODELS || '*/2 * * * *',
  });

  // Arena Model Monitor — extracts 600+ models from LM Arena RSC payload
  configs.push({
    adapter: new ArenaMonitorAdapter(),
    interval: INTERVALS.ARENA_MONITOR || '0 */2 * * *',
  });

  // API Changelog Monitor — scrapes official changelogs for model announcements
  configs.push({
    adapter: new ChangelogAdapter(),
    interval: INTERVALS.CHANGELOG || '0 */3 * * *',
  });

  // Playground Scraper — finds unreleased model IDs in web app frontends
  configs.push({
    adapter: new PlaygroundScraperAdapter(),
    interval: INTERVALS.PLAYGROUND || '0 */4 * * *',
  });

  return configs;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  logger.info('🚀 Starting AI Model Tracker Bot...');

  // Validate environment
  validateEnv();

  // Initialize database
  logger.info('📁 Initializing database...');
  db.init();

  // Optionally start webhook receiver before the Discord client becomes ready
  webhookServer = startWebhookReceiver();

  // Create Discord client
  const client = createClient();

  // Setup interaction handler
  client.on(Events.InteractionCreate, handleInteraction);

  // Wait for client to be ready
  client.once(Events.ClientReady, async (c) => {
    try {
      // Find the target guild
      const guild = c.guilds.cache.get(process.env.DISCORD_GUILD_ID);
      if (!guild) {
        logger.error(`Guild ${process.env.DISCORD_GUILD_ID} not found. Is the bot invited to the server?`);
        process.exit(1);
      }

      logger.info(`📍 Connected to guild: ${guild.name}`);

      // Ensure channels exist
      logger.info('📺 Setting up channels...');
      await ensureChannels(guild);

      // Start background delivery worker now that channels are ready
      startDeliveryWorker();

      // Register slash commands
      await registerCommands(process.env.DISCORD_TOKEN, c.user.id, process.env.DISCORD_GUILD_ID);

      // Build and schedule all adapters
      const adapterConfigs = buildAdapterConfigs();

      // Send startup message
      await sendStatusMessage(
        `Bot started! Monitoring ${adapterConfigs.length} source(s) across RSS, GitHub, HuggingFace, Reddit, and Ollama.`
      );
      logger.info(`📡 Starting ${adapterConfigs.length} adapter(s)...`);
      scheduleAll(adapterConfigs);

      // Schedule weekly digests (paper digest + news roundup)
      scheduleDigests();

      logger.info('✅ Bot is fully operational!');
    } catch (error) {
      logger.error('Failed during bot initialization:', error);
      process.exit(1);
    }
  });

  // Login
  logger.info('🔑 Logging in to Discord...');
  await login(process.env.DISCORD_TOKEN);
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down...');
  stopDeliveryWorker();
  stopWebhookReceiver(webhookServer);
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down...');
  stopDeliveryWorker();
  stopWebhookReceiver(webhookServer);
  db.close();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled promise rejection:', error);
});

// Run
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
