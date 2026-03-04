/**
 * Source configuration for all monitored feeds and APIs.
 * Priority levels: P0 (critical) → P4 (informational)
 */

const PRIORITY = {
  P0: 0, // Official lab announcements
  P1: 1, // Model platforms (HuggingFace, GitHub, Ollama)
  P2: 2, // Tech news sites
  P3: 3, // Communities (Reddit)
  P4: 4, // Leaderboards & benchmarks
};

// Route by source type for better channel separation
const CHANNEL_MAP = {
  rss:         'major-releases',
  github:      'model-updates',
  huggingface: 'model-updates',
  ollama:      'model-updates',
  reddit:      'community-buzz',
  bluesky:     'community-buzz',
  'hf-papers': 'research-papers',
  arxiv:       'research-papers',
  scrape:      'major-releases', // Direct AI lab blog scraping
  newsletter:  'tech-news',      // Newsletter/aggregator RSS feeds
  leaderboard: 'leaderboard-updates',
  hackernews:  'community-buzz',
  'china-ai':  'china-ai',
  'sdk-tracker': 'rumors-leaks',
  'arena-mystery': 'rumors-leaks',
  'talent':    'talent-moves',
  'api-models': 'model-updates',
  'arena-models': 'rumors-leaks',
  'changelog': 'major-releases',
  'playground-leak': 'rumors-leaks',
};

// Freshness gate: only notify items newer than this on first run
const MAX_AGE_HOURS = 24;

// ─── RSS Feeds (AI Lab Blogs) ────────────────────────────────────────────────

const RSS_SOURCES = [
  // Western Labs — only sources with confirmed working RSS feeds
  { name: 'OpenAI Blog',               url: 'https://openai.com/blog/rss.xml',                                                                                                                         priority: PRIORITY.P0, translate: false },
  // Anthropic has no official RSS — community-generated feed
  { name: 'Anthropic News',            url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/refs/heads/main/feeds/feed_anthropic_news.xml',        priority: PRIORITY.P0, translate: false },
  { name: 'Anthropic Engineering',     url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/refs/heads/main/feeds/feed_anthropic_engineering.xml', priority: PRIORITY.P0, translate: false },
  { name: 'Google DeepMind Blog',      url: 'https://deepmind.google/blog/rss.xml',                                                                                                                   priority: PRIORITY.P0, translate: false },
  // Meta AI blog RSS URL changed — using research blog instead
  { name: 'Meta Research Blog',        url: 'https://research.facebook.com/feed/',                                                                                                                     priority: PRIORITY.P0, translate: false },

  // Chinese Labs
  // DeepSeek blog has no public RSS — monitored via GitHub releases instead

  // ─── China AI Coverage (English-language feeds) ──────────────────────────
  { name: 'SyncedReview',       url: 'https://syncedreview.com/feed/',              priority: PRIORITY.P1, translate: false, sourceType: 'china-ai' },
  { name: 'TheDecoder',         url: 'https://the-decoder.com/feed/',               priority: PRIORITY.P2, translate: false, sourceType: 'china-ai' },
  { name: 'Pandaily',           url: 'https://pandaily.com/feed/',                  priority: PRIORITY.P2, translate: false, sourceType: 'china-ai' },

  // ─── China AI Coverage (Native Chinese feeds, auto-translated) ───────────
  { name: 'ITHome',             url: 'https://www.ithome.com/rss/',                 priority: PRIORITY.P2, translate: true, sourceType: 'china-ai' },
  { name: '36Kr Tech',          url: 'https://36kr.com/feed',                       priority: PRIORITY.P2, translate: true, sourceType: 'china-ai' },

  // ─── Western Community & Aggregators ─────────────────────────────────────
  { name: 'Hacker News AI',     url: 'https://hnrss.org/newest?q=LLM+OR+%22language+model%22+OR+%22AI+model%22+OR+OpenAI+OR+Anthropic+OR+DeepSeek&points=100', priority: PRIORITY.P3, translate: false, sourceType: 'hackernews' },
];

// ─── Scraped Blogs (AI Labs without RSS) ─────────────────────────────────────

const SCRAPE_SOURCES = [
  // NOTE: OpenAI News (openai.com/news/) removed — returns 403 (Cloudflare).
  // OpenAI is covered by RSS feed (openai.com/blog/rss.xml) instead.
  {
    name: 'Anthropic Blog',
    url: 'https://www.anthropic.com/news',
    baseUrl: 'https://www.anthropic.com',
    linkSelectors: ['a'],
    linkPattern: /\/news\//,
    priority: PRIORITY.P0,
  },
  {
    name: 'Mistral Announcements',
    url: 'https://mistral.ai/news/',
    baseUrl: 'https://mistral.ai',
    linkSelectors: ['a'],
    linkPattern: /\/news\//,
    priority: PRIORITY.P0,
  },
  {
    name: 'Cohere Research',
    url: 'https://cohere.com/blog',
    baseUrl: 'https://cohere.com',
    linkSelectors: ['a'],
    linkPattern: /\/blog\/|\/research\//,
    priority: PRIORITY.P0,
  },

  // ─── Chinese Lab Blogs (Direct Scraping) ─────────────────────────────────
  {
    name: 'DeepSeek Blog',
    url: 'https://api-docs.deepseek.com/updates',
    baseUrl: 'https://api-docs.deepseek.com',
    linkSelectors: ['a'],
    linkPattern: /\/news\//,
    priority: PRIORITY.P0,
    sourceTypeOverride: 'china-ai',
  },
  {
    name: 'Zhipu AI (THUDM GitHub)',
    url: 'https://github.com/THUDM',
    baseUrl: 'https://github.com',
    linkSelectors: ['a[itemprop="name codeRepository"]', 'a[data-hovercard-type="repository"]'],
    linkPattern: /\/THUDM\//,
    priority: PRIORITY.P1,
    sourceTypeOverride: 'china-ai',
  },

  // ─── Chinese Lab Official Blogs (Direct Scraping) ────────────────────────
  {
    name: 'Alibaba Qwen Blog',
    url: 'https://qwenlm.github.io/blog/',
    baseUrl: 'https://qwenlm.github.io',
    linkSelectors: ['a[href*="/blog/"]', 'article a', 'h2 a'],
    linkPattern: /\/blog\//,
    priority: PRIORITY.P0,
    sourceTypeOverride: 'china-ai',
  },
  {
    name: 'Kimi AI (Moonshot)',
    url: 'https://kimi.ai/blog',
    baseUrl: 'https://kimi.ai',
    linkSelectors: ['a'],
    linkPattern: /\/blog\//,
    priority: PRIORITY.P1,
    sourceTypeOverride: 'china-ai',
  },
  {
    name: 'MiniMax AI',
    url: 'https://www.minimaxi.com/news',
    baseUrl: 'https://www.minimaxi.com',
    linkSelectors: ['a'],
    linkPattern: /\/news\//,
    priority: PRIORITY.P1,
    sourceTypeOverride: 'china-ai',
  },
  {
    name: 'ByteDance Doubao',
    url: 'https://team.doubao.com/en/special/model',
    baseUrl: 'https://team.doubao.com',
    linkSelectors: ['a'],
    linkPattern: /\/special\/|\/model/,
    priority: PRIORITY.P1,
    sourceTypeOverride: 'china-ai',
  },
  {
    name: 'StepFun (Z.AI)',
    url: 'https://www.stepfun.com/',
    baseUrl: 'https://www.stepfun.com',
    linkSelectors: ['a'],
    linkPattern: /\/blog\/|\/news\/|\/model/,
    priority: PRIORITY.P1,
    translate: true,
    sourceTypeOverride: 'china-ai',
  },
  // Zhihu removed - returns 403 due to bot protection
  {
    name: 'Juejin AI',
    url: 'https://juejin.cn/tag/AI',
    baseUrl: 'https://juejin.cn',
    linkSelectors: ['a.title-row', 'a[href*="/post/"]'],
    linkPattern: /\/post\//,
    ignorePattern: /\/tag\/|\/user\//,
    priority: PRIORITY.P3,
    translate: true,
    sourceTypeOverride: 'china-ai',
  },
  // PaperWeekly removed - site is down (ECONNREFUSED)
];



// ─── GitHub Repos ────────────────────────────────────────────────────────────

const GITHUB_SOURCES = [
  // OpenAI
  { org: 'openai', repos: ['openai-python', 'whisper', 'CLIP', 'triton', 'tiktoken'], priority: PRIORITY.P1 },
  // Meta
  { org: 'meta-llama', repos: ['llama', 'llama-models', 'llama-stack', 'codellama', 'PurpleLlama'], priority: PRIORITY.P1 },
  { org: 'facebookresearch', repos: ['segment-anything', 'seamless_communication', 'audiocraft'], priority: PRIORITY.P1 },
  // Mistral
  { org: 'mistralai', repos: ['mistral-inference', 'mistral-common'], priority: PRIORITY.P1 },
  // Google
  { org: 'google-deepmind', repos: ['gemma', 'alphafold'], priority: PRIORITY.P1 },
  { org: 'google', repos: ['gemma_pytorch', 'gemma.cpp'], priority: PRIORITY.P1 },
  // DeepSeek
  { org: 'deepseek-ai', repos: ['DeepSeek-LLM', 'DeepSeek-Coder', 'DeepSeek-V2', 'DeepSeek-V3', 'DeepSeek-R1'], priority: PRIORITY.P1 },
  // Chinese Labs
  { org: 'QwenLM', repos: ['Qwen', 'Qwen2', 'Qwen2.5', 'Qwen-Agent'], priority: PRIORITY.P1 },
  { org: 'THUDM', repos: ['ChatGLM-6B', 'GLM-4', 'CogVLM', 'CogVideo'], priority: PRIORITY.P1 },
  { org: '01-ai', repos: ['Yi'], priority: PRIORITY.P1 },
  // ByteDance (seed-tts repo doesn't exist - using real repos)
  { org: 'bytedance', repos: ['UI-TARS-desktop', 'deer-flow', 'monolith'], priority: PRIORITY.P1 },
  // Moonshot / Kimi
  { org: 'MoonshotAI', repos: ['Kimi-k1.5', 'Moonlight'], priority: PRIORITY.P1 },
  // MiniMax (org name is MiniMax-AI with hyphen)
  { org: 'MiniMax-AI', repos: ['MiniMax-01', 'MiniMax-M1', 'MiniMax-M2'], priority: PRIORITY.P1 },
  // Stability AI (stablediffusion repo doesn't exist - correct repos used)
  { org: 'Stability-AI', repos: ['generative-models', 'StableLM', 'stable-audio-tools'], priority: PRIORITY.P1 },
  // Cohere
  { org: 'cohere-ai', repos: ['cohere-toolkit'], priority: PRIORITY.P1 },
];

// ─── HuggingFace Organizations ───────────────────────────────────────────────

const HUGGINGFACE_SOURCES = [
  { org: 'openai', name: 'OpenAI', priority: PRIORITY.P1 },
  { org: 'meta-llama', name: 'Meta Llama', priority: PRIORITY.P1 },
  { org: 'mistralai', name: 'Mistral AI', priority: PRIORITY.P1 },
  { org: 'google', name: 'Google', priority: PRIORITY.P1 },
  { org: 'deepseek-ai', name: 'DeepSeek', priority: PRIORITY.P1 },
  { org: 'Qwen', name: 'Qwen', priority: PRIORITY.P1 },
  { org: 'THUDM', name: 'Zhipu/GLM', priority: PRIORITY.P1 },
  { org: '01-ai', name: '01.AI / Yi', priority: PRIORITY.P1 },
  { org: 'stabilityai', name: 'Stability AI', priority: PRIORITY.P1 },
  { org: 'CohereForAI', name: 'Cohere', priority: PRIORITY.P1 },
  { org: 'microsoft', name: 'Microsoft', priority: PRIORITY.P1 },
  { org: 'nvidia', name: 'NVIDIA', priority: PRIORITY.P1 },
  { org: 'ByteDance', name: 'ByteDance', priority: PRIORITY.P1 },
  { org: 'MoonshotAI', name: 'Moonshot/Kimi', priority: PRIORITY.P1 },
  { org: 'MiniMax-AI', name: 'MiniMax', priority: PRIORITY.P1 },
];

// ─── Reddit Subreddits ───────────────────────────────────────────────────────

const REDDIT_SOURCES = [
  { subreddit: 'MachineLearning', priority: PRIORITY.P3 },
  { subreddit: 'LocalLLaMA', priority: PRIORITY.P3 },
  { subreddit: 'OpenAI', priority: PRIORITY.P3 },
  { subreddit: 'artificial', priority: PRIORITY.P3 },
];

// ─── Ollama ──────────────────────────────────────────────────────────────────

const OLLAMA_CONFIG = {
  url: 'https://ollama.com/library',
  priority: PRIORITY.P1,
};

// ─── SDK Sources for Supply Chain Monitoring ─────────────────────────────────

const SDK_SOURCES = {
  npm: [
    { name: 'openai', package: 'openai', url: 'https://registry.npmjs.org/openai/latest' },
    { name: 'anthropic', package: '@anthropic-ai/sdk', url: 'https://registry.npmjs.org/@anthropic-ai/sdk/latest' },
  ],
  pypi: [
    { name: 'openai-python', package: 'openai', url: 'https://pypi.org/pypi/openai/json' },
    { name: 'anthropic-python', package: 'anthropic', url: 'https://pypi.org/pypi/anthropic/json' },
  ],
};

// ─── LMSYS Arena Sources ─────────────────────────────────────────────────────

const ARENA_SOURCES = [
  {
    name: 'LMSYS Chatbot Arena',
    url: 'https://huggingface.co/api/spaces/lmarena-ai/chatbot-arena-leaderboard',
    // datasetUrl removed - GCS endpoint returns 403
    fallbackUrl: 'https://huggingface.co/spaces/lmarena-ai/chatbot-arena-leaderboard',
  },
];

// ─── FREE Model Aggregators (no key required, or optional key for rate limits) ─
//
// These endpoints aggregate models from MANY providers in a single call.
// They are polled as TIER 1 — always active regardless of configuration.

const FREE_MODEL_AGGREGATORS = [
  // ── OpenRouter — 340+ models, all major Western + Chinese providers ──────
  {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/models',
    envKey: 'OPENROUTER_API_KEY', // optional: better rate limits when set
    authStyle: 'bearer',
    params: {},
    headers: {},
    modelUrl: (id) => `https://openrouter.ai/models/${id}`,
    parseResponse: (data) =>
      (data.data || []).map((m) => ({
        id: m.id,
        name: m.name,
        context_length: m.context_length,
        pricing: m.pricing,
        description: m.description,
        created: m.created,
      })),
  },

  // ── NovitaAI — 90+ models, strong Chinese coverage (GLM, Qwen, etc) ─────
  {
    name: 'NovitaAI',
    url: 'https://api.novita.ai/v3/openai/models',
    envKey: null,
    params: {},
    headers: {},
    modelUrl: (id) => `https://novita.ai/model-api/product/${id}`,
    parseResponse: (data) =>
      (data.data || []).map((m) => ({
        id: m.id,
        name: m.title || m.id,
        description: m.description,
        created: m.created,
        pricing: m.input_token_price_per_m
          ? {
              prompt: String(m.input_token_price_per_m / 1_000_000),
              completion: String(m.output_token_price_per_m / 1_000_000),
            }
          : null,
      })),
  },

  // ── Sambanova — 18+ models, fast inference (DeepSeek, Llama, etc) ────────
  {
    name: 'Sambanova',
    url: 'https://api.sambanova.ai/v1/models',
    envKey: null,
    params: {},
    headers: {},
    modelUrl: (id) => `https://community.sambanova.ai/docs`,
    parseResponse: (data) =>
      (data.data || []).map((m) => ({
        id: m.id,
        name: m.id,
        context_length: m.context_length,
        pricing: m.pricing,
        created: m.created,
      })),
  },

  // ── AI21 Labs — Jamba family models (free endpoint, no key) ──────────────
  {
    name: 'AI21',
    url: 'https://api.ai21.com/studio/v1/models',
    envKey: null,
    params: {},
    headers: {},
    modelUrl: (id) => `https://docs.ai21.com/reference/jamba-models-api`,
    parseResponse: (data) =>
      (data.data || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        context_length: m.context_length,
        pricing: m.pricing,
        created: m.created,
      })),
  },
];

// ─── Direct API Model Registry Polling (TIER 2 — requires API keys) ───────────
//
// These poll provider APIs directly for the FASTEST possible detection.
// Only active when the corresponding API key is set in .env.
//
// Covers: Western (OpenAI, Anthropic, Mistral, Google, Cohere, xAI, Groq,
//         Together, Fireworks, Perplexity, Cerebras)
//         Chinese  (DeepSeek, Moonshot/Kimi, 01.AI/Yi, SiliconFlow,
//                   Stepfun, Zhipu/GLM, Baichuan, MiniMax)

const API_MODEL_SOURCES = [
  // ════════════════════════════════════════════════════════════════════════════
  // WESTERN PROVIDERS
  // ════════════════════════════════════════════════════════════════════════════

  {
    name: 'OpenAI',
    url: 'https://api.openai.com/v1/models',
    envKey: 'OPENAI_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.openai.com/docs/models',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.openai.com/docs/models/${id}`,
  },
  {
    name: 'Anthropic',
    url: 'https://api.anthropic.com/v1/models',
    envKey: 'ANTHROPIC_API_KEY',
    authStyle: 'x-api-key',
    params: { limit: 100 },
    headers: { 'anthropic-version': '2023-06-01' },
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://docs.anthropic.com/en/docs/about-claude/models#${id}`,
  },
  {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    envKey: 'GOOGLE_AI_API_KEY',
    authStyle: 'query', // key goes as ?key= param
    params: {},
    headers: {},
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models/gemini',
    parseModels: (data) => (data.models || []).map((m) => m.name.replace('models/', '')),
    modelUrl: (id) => `https://ai.google.dev/gemini-api/docs/models/${id}`,
  },
  {
    name: 'Mistral',
    url: 'https://api.mistral.ai/v1/models',
    envKey: 'MISTRAL_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://docs.mistral.ai/getting-started/models/#${id}`,
  },
  {
    name: 'Cohere',
    url: 'https://api.cohere.com/v2/models',
    envKey: 'COHERE_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.cohere.com/docs/models',
    parseModels: (data) => (data.models || []).map((m) => m.name || m.id),
    modelUrl: (id) => `https://docs.cohere.com/docs/models#${id}`,
  },
  {
    name: 'xAI',
    url: 'https://api.x.ai/v1/models',
    envKey: 'XAI_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.x.ai/docs/models',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://docs.x.ai/docs/models#${id}`,
  },
  {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/models',
    envKey: 'GROQ_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://console.groq.com/docs/models',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://console.groq.com/docs/models#${id}`,
  },
  {
    name: 'Together',
    url: 'https://api.together.xyz/v1/models',
    envKey: 'TOGETHER_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.together.ai/docs/inference-models',
    parseModels: (data) => (data.data || data || []).map((m) => m.id),
    modelUrl: (id) => `https://api.together.xyz/models/${id}`,
  },
  {
    name: 'Fireworks',
    url: 'https://api.fireworks.ai/inference/v1/models',
    envKey: 'FIREWORKS_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.fireworks.ai/getting-started/quickstart',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://fireworks.ai/models/${id}`,
  },
  {
    name: 'Perplexity',
    url: 'https://api.perplexity.ai/models',
    envKey: 'PERPLEXITY_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.perplexity.ai/docs/model-cards',
    parseModels: (data) => (data.data || data || []).map((m) => m.id || m.model),
    modelUrl: (id) => `https://docs.perplexity.ai/docs/model-cards#${id}`,
  },
  {
    name: 'Cerebras',
    url: 'https://api.cerebras.ai/v1/models',
    envKey: 'CEREBRAS_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.cerebras.ai/api-reference/models',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://docs.cerebras.ai/api-reference/models#${id}`,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CHINESE PROVIDERS
  // ════════════════════════════════════════════════════════════════════════════

  {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/models',
    envKey: 'DEEPSEEK_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.deepseek.com/api-docs',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.deepseek.com/api-docs#${id}`,
  },
  {
    name: 'Moonshot (Kimi)',
    url: 'https://api.moonshot.cn/v1/models',
    envKey: 'MOONSHOT_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.moonshot.cn/docs',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.moonshot.cn/docs#${id}`,
  },
  {
    name: '01.AI (Yi)',
    url: 'https://api.lingyiwanwu.com/v1/models',
    envKey: 'YI_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.01.ai/docs',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.01.ai/docs#${id}`,
  },
  {
    name: 'SiliconFlow',
    url: 'https://api.siliconflow.cn/v1/models',
    envKey: 'SILICONFLOW_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://docs.siliconflow.cn',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://cloud.siliconflow.cn/models/${id}`,
  },
  {
    name: 'Zhipu (GLM)',
    url: 'https://open.bigmodel.cn/api/paas/v4/models',
    envKey: 'ZHIPU_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://open.bigmodel.cn/dev/howuse/model',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://open.bigmodel.cn/dev/howuse/model#${id}`,
  },
  {
    name: 'Stepfun',
    url: 'https://api.stepfun.com/v1/models',
    envKey: 'STEPFUN_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.stepfun.com/docs/llm/text',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.stepfun.com/docs/llm/text#${id}`,
  },
  {
    name: 'Baichuan',
    url: 'https://api.baichuan-ai.com/v1/models',
    envKey: 'BAICHUAN_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.baichuan-ai.com/docs/api',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.baichuan-ai.com/docs/api#${id}`,
  },
  {
    name: 'MiniMax',
    url: 'https://api.minimax.chat/v1/models',
    envKey: 'MINIMAX_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://platform.minimaxi.com/document/Models',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://platform.minimaxi.com/document/Models#${id}`,
  },
  {
    name: 'Alibaba (DashScope)',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    envKey: 'DASHSCOPE_API_KEY',
    authStyle: 'bearer',
    params: {},
    headers: {},
    docsUrl: 'https://help.aliyun.com/zh/dashscope/developer-reference/api-details',
    parseModels: (data) => (data.data || []).map((m) => m.id),
    modelUrl: (id) => `https://help.aliyun.com/zh/dashscope/developer-reference/api-details#${id}`,
  },
];

// ─── Polling Intervals (cron expressions) ────────────────────────────────────

const INTERVALS = {
  RSS: '*/5 * * * *',        // Every 5 minutes
  GITHUB: '*/5 * * * *',     // Every 5 minutes
  HUGGINGFACE: '*/5 * * * *',// Every 5 minutes
  REDDIT: '*/3 * * * *',     // Every 3 minutes
  OLLAMA: '*/10 * * * *',    // Every 10 minutes
  BLUESKY: '*/10 * * * *',   // Every 10 minutes for Bluesky feeds
  SCRAPE: '*/15 * * * *',    // Every 15 minutes to avoid rate limits
  NEWSLETTER: '*/10 * * * *',// Every 10 minutes for newsletter feeds
  LEADERBOARD: '0 * * * *',  // Every hour for benchmarks
  SDK: '0 */6 * * *',        // Every 6 hours for SDK version checks
  ARENA: '0 */4 * * *',      // Every 4 hours for mystery model checks
  TALENT: '0 8 * * *',       // Daily at 8 AM for talent movement
  API_MODELS: '*/2 * * * *',  // Every 2 minutes — fastest detection for live models
  ARENA_MONITOR: '0 */2 * * *', // Every 2 hours — Arena leaderboard RSC extraction
  CHANGELOG: '0 */3 * * *',   // Every 3 hours — API changelog monitoring
  PLAYGROUND: '0 */4 * * *',  // Every 4 hours — frontend/playground scraping
};

module.exports = {
  PRIORITY,
  CHANNEL_MAP,
  MAX_AGE_HOURS,
  RSS_SOURCES,
  SCRAPE_SOURCES,
  GITHUB_SOURCES,
  HUGGINGFACE_SOURCES,
  REDDIT_SOURCES,
  OLLAMA_CONFIG,
  SDK_SOURCES,
  ARENA_SOURCES,
  FREE_MODEL_AGGREGATORS,
  API_MODEL_SOURCES,
  INTERVALS,
};
