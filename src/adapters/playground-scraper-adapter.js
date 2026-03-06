const http = require('../services/http');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

/**
 * Playground Scraper Adapter — scrapes AI playground/chat frontends for model IDs.
 *
 * This replicates the technique shown in the screenshots where people find
 * unreleased model names (e.g., "gpt-5-1-thinking") embedded in the minified
 * JavaScript bundles of ChatGPT, Gemini, Claude, etc.
 *
 * Strategy:
 *  1. Fetch the main HTML of each playground URL
 *  2. Extract model-like strings via regex from HTML + inline scripts
 *  3. Optionally fetch linked JS bundles and scan those too
 *  4. Diff against known models → new IDs = potential leaks/previews
 *
 * Works for: Gemini (confirmed), DeepSeek chat
 * Blocked by Cloudflare: ChatGPT, Claude.ai (we rely on API polling for those)
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ─── Model ID patterns to search for in HTML/JS ─────────────────────────────
const MODEL_PATTERNS = [
  // OpenAI family
  /\b(gpt-[345][a-z0-9._-]*(?:thinking|codex|chat|mini|turbo|preview|latest|high|low)?[a-z0-9._-]*)\b/gi,
  /\b(o[134]-[a-z0-9._-]+)\b/gi,
  /\b(chatgpt-[a-z0-9._-]+)\b/gi,
  // Anthropic family
  /\b(claude-(?:opus|sonnet|haiku|instant)[a-z0-9._-]*)\b/gi,
  // Google family
  /\b(gemini-[0-9][a-z0-9._-]*)\b/gi,
  // DeepSeek family
  /\b(deepseek-(?:r1|v[23]|coder|chat|reasoner)[a-z0-9._-]*)\b/gi,
  // xAI family
  /\b(grok-[0-9][a-z0-9._-]*)\b/gi,
  // Mistral family
  /\b(mistral-[a-z0-9._-]+)\b/gi,
  /\b(codestral-[a-z0-9._-]+)\b/gi,
  // Meta family
  /\b(llama-[0-9][a-z0-9._-]*)\b/gi,
  // Chinese models
  /\b(qwen[0-9][a-z0-9._-]*)\b/gi,
  /\b(glm-[0-9][a-z0-9._-]*)\b/gi,
  /\b(ernie-[0-9][a-z0-9._-]*)\b/gi,
  /\b(kimi-[a-z0-9._-]+)\b/gi,
  /\b(seed-[0-9][a-z0-9._-]*)\b/gi,
];

// Noise filter — skip these common false positives
const NOISE_PATTERNS = [
  /^gpt-neo/i, /^gpt-j/i,            // open-source, not from OpenAI
  /\.js$/i, /\.css$/i, /\.html$/i,    // file extensions
  /^gemini-advanced$/i,               // UI label, not a model ID
  /^gemini-models$/i,                 // CSS class / route name
];

// ─── Playground targets ──────────────────────────────────────────────────────

const PLAYGROUND_TARGETS = [
  {
    name: 'Gemini Web App',
    url: 'https://gemini.google.com',
    provider: 'Google',
    scanBundles: false, // HTML already contains model refs
  },
  {
    name: 'DeepSeek Chat',
    url: 'https://chat.deepseek.com',
    provider: 'DeepSeek',
    scanBundles: true,
  },
  {
    name: 'HuggingChat',
    url: 'https://huggingface.co/chat/',
    provider: 'HuggingFace',
    scanBundles: false,
  },
  // Poe.com removed - returns 403 (Cloudflare protection)
];

class PlaygroundScraperAdapter extends BaseAdapter {
  constructor() {
    super('Playground Scraper', 'playground-leak', 1); // P1 — potential unreleased models
    this.knownModels = {};   // { targetName: Set<modelId> }
    this.initialized = {};
    this._stateLoaded = false;
  }

  async check() {
    this._ensureStateLoaded();

    const items = [];

    const promises = PLAYGROUND_TARGETS.map(async (target) => {
      try {
        return await this._scrapeTarget(target);
      } catch (error) {
        logger.debug(`[Playground] ${target.name} scrape failed: ${error.message}`);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'fulfilled') items.push(...r.value);
    }

    return items;
  }

  async _scrapeTarget(target) {
    const items = [];
    const response = await http.get(target.url, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      maxRedirects: 5,
    });

    const html = response.data;
    if (typeof html !== 'string') return items;

    // Extract model IDs from the main HTML (includes inline scripts)
    let allText = html;

    // If configured, also fetch linked JS bundles
    if (target.scanBundles) {
      const $ = cheerio.load(html);
      const scriptUrls = [];
      $('script[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src && src.endsWith('.js')) {
          const fullUrl = src.startsWith('http') ? src : new URL(src, target.url).href;
          scriptUrls.push(fullUrl);
        }
      });

      // Fetch up to 10 bundles in parallel (with timeout)
      const bundlePromises = scriptUrls.slice(0, 10).map(async (url) => {
        try {
          const r = await http.get(url, { timeout: 10000, headers: { 'User-Agent': UA } });
          return typeof r.data === 'string' ? r.data : '';
        } catch {
          return '';
        }
      });
      const bundles = await Promise.all(bundlePromises);
      allText += '\n' + bundles.join('\n');
    }

    // Run all model patterns against the combined text
    const foundModels = new Set();
    for (const pattern of MODEL_PATTERNS) {
      pattern.lastIndex = 0; // reset global regex
      let match;
      while ((match = pattern.exec(allText)) !== null) {
        const id = match[1].toLowerCase();
        if (id.length < 5 || id.length > 60) continue;
        if (NOISE_PATTERNS.some((np) => np.test(id))) continue;
        foundModels.add(id);
      }
    }

    if (foundModels.size === 0) return items;

    const currentSet = foundModels;

    // First run: seed silently
    if (!this.initialized[target.name]) {
      this.knownModels[target.name] = new Set(currentSet);
      this.initialized[target.name] = true;
      this._persistKnownModels();
      logger.info(`[Playground] ${target.name}: seeded ${currentSet.size} model IDs`);
      return items;
    }

    const previousSet = this.knownModels[target.name] || new Set();

    // Detect new model IDs
    for (const modelId of currentSet) {
      if (previousSet.has(modelId)) continue;

      logger.info(`[Playground] 🔍 NEW model ID found in ${target.name}: ${modelId}`);

      items.push({
        title: `🔍 Potential Unreleased Model: ${modelId}`,
        description: [
          `A new model identifier \`${modelId}\` was found in the **${target.name}** frontend code.`,
          '',
          'This model ID appeared in the HTML/JavaScript of the web application,',
          'which often indicates an upcoming or unreleased model.',
          '',
          `**Source**: ${target.url}`,
          `**Provider**: ${target.provider}`,
          '',
          '⚠️ This is a *leak/preview detection* — the model may not be publicly available yet.',
        ].join('\n'),
        url: target.url,
        sourceName: `Playground: ${target.name}`,
        sourceType: 'playground-leak',
        priority: 1, // P1 — these are significant rumors
        tags: ['leak', 'playground', 'unreleased', target.provider.toLowerCase(), modelId],
        publishedAt: new Date(),
        needsTranslation: false,
      });
    }

    // Update known set
    this.knownModels[target.name] = new Set(currentSet);
    this._persistKnownModels();
    return items;
  }

  _ensureStateLoaded() {
    if (this._stateLoaded) return;

    const persisted = this.loadState('known-models', {});
    if (persisted && typeof persisted === 'object') {
      for (const [targetName, modelIds] of Object.entries(persisted)) {
        const ids = Array.isArray(modelIds) ? modelIds.filter(Boolean) : [];
        this.knownModels[targetName] = new Set(ids);
        this.initialized[targetName] = ids.length > 0;
      }
    }

    this._stateLoaded = true;
  }

  _persistKnownModels() {
    const serialized = Object.fromEntries(
      Object.entries(this.knownModels).map(([targetName, modelIds]) => [targetName, [...modelIds]])
    );
    this.saveState('known-models', serialized);
  }
}

module.exports = PlaygroundScraperAdapter;
