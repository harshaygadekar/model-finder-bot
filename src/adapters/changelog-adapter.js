const axios = require('axios');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

/**
 * API Changelog Scraper — monitors official API changelog/updates pages
 * for model announcements, deprecations, and new feature launches.
 *
 * This replicates the approach shown in the screenshots where @legit_api
 * monitors the Gemini API updates page (ai.google.dev/gemini-api/docs/changelog)
 * and OpenAI model retirement pages to catch new model IDs early.
 *
 * Strategy:
 *  1. Fetch each changelog URL
 *  2. Extract text entries (based on CSS selectors or text patterns)
 *  3. Scan for model-related keywords and model IDs
 *  4. Diff against seen entries → new entries = alerts
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ─── Model ID regex patterns ─────────────────────────────────────────────────
const MODEL_ID_PATTERNS = [
  /\b(gpt-[345][a-z0-9._-]*)\b/gi,
  /\b(o[134]-[a-z0-9._-]+)\b/gi,
  /\b(claude-[a-z0-9._-]+)\b/gi,
  /\b(gemini-[0-9][a-z0-9._-]+)\b/gi,
  /\b(deepseek-[a-z0-9._-]+)\b/gi,
  /\b(grok-[0-9][a-z0-9._-]+)\b/gi,
  /\b(mistral-[a-z0-9._-]+)\b/gi,
  /\b(codestral-[a-z0-9._-]+)\b/gi,
  /\b(llama-[0-9][a-z0-9._-]+)\b/gi,
  /\b(command-[a-z0-9._-]+)\b/gi,
  /\b(qwen[0-9][a-z0-9._-]*)\b/gi,
  /\b(glm-[0-9][a-z0-9._-]+)\b/gi,
  /\b(ernie-[0-9][a-z0-9._-]+)\b/gi,
  /\b(phi-[0-9][a-z0-9._-]+)\b/gi,
  /\b(gemma-[0-9][a-z0-9._-]+)\b/gi,
];

// ─── Keywords that indicate a model-relevant changelog entry ────────────────
const RELEVANCE_KEYWORDS = [
  'new model', 'model available', 'released', 'launch',
  'deprecat', 'retir', 'sunset', 'end of life', 'eol',
  'preview', 'experimental', 'beta', 'ga ', 'general availability',
  'added support', 'now supports', 'new version',
  'context window', 'token limit', 'rate limit',
  'vision', 'multimodal', 'code generation', 'function calling',
  'json mode', 'structured output', 'tool use',
  'price', 'pricing', 'cost',
];

// ─── Changelog Targets ──────────────────────────────────────────────────────

const CHANGELOG_TARGETS = [
  {
    name: 'Google Gemini API Changelog',
    url: 'https://ai.google.dev/gemini-api/docs/changelog',
    provider: 'Google',
    // Each entry is typically in a section with a date heading
    entrySelector: 'article section, article h2, article h3, .devsite-article-body section, main section',
    fallbackSelector: 'main, article, .content, body',
    datePattern: /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
  },
  {
    name: 'Anthropic API Changelog',
    url: 'https://docs.anthropic.com/en/docs/about-claude/models',
    provider: 'Anthropic',
    entrySelector: 'table tr, .model-card, article section, main section',
    fallbackSelector: 'main, article, body',
    datePattern: /\d{4}-\d{2}-\d{2}/g,
  },
  // OpenAI Model Deprecations removed - returns 403 (requires authentication)
  {
    name: 'Mistral Changelog',
    url: 'https://docs.mistral.ai/getting-started/changelog/',
    provider: 'Mistral',
    entrySelector: 'article section, main section, h2, h3',
    fallbackSelector: 'main, article, body',
    datePattern: /\d{4}-\d{2}-\d{2}/g,
  },
  {
    name: 'Cohere Model Changelog',
    url: 'https://docs.cohere.com/changelog',
    provider: 'Cohere',
    entrySelector: 'article section, main section, .changelog-entry',
    fallbackSelector: 'main, article, body',
    datePattern: /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}/gi,
  },
];

class ChangelogAdapter extends BaseAdapter {
  constructor() {
    super('API Changelog Monitor', 'changelog', 0); // P0 — official API changelogs are authoritative
    this.knownEntries = {};   // { targetName: Set<hash> }
    this.initialized = {};
  }

  async check() {
    const items = [];

    const promises = CHANGELOG_TARGETS.map(async (target) => {
      try {
        return await this._scrapeChangelog(target);
      } catch (error) {
        logger.debug(`[Changelog] ${target.name} failed: ${error.message}`);
        return [];
      }
    });

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      if (r.status === 'fulfilled') items.push(...r.value);
    }

    return items;
  }

  async _scrapeChangelog(target) {
    const items = [];

    const response = await axios.get(target.url, {
      timeout: 15000,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      maxRedirects: 3,
      validateStatus: (s) => s < 400,
    });

    const html = response.data;
    if (typeof html !== 'string') return items;

    const $ = cheerio.load(html);

    // Try to extract individual entries
    let entries = [];
    const seen = $(target.entrySelector);
    if (seen.length > 0) {
      seen.each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 20 && text.length < 5000) {
          entries.push(text);
        }
      });
    }

    // Fallback: grab all text from the main content
    if (entries.length === 0) {
      const fallbackEl = $(target.fallbackSelector).first();
      if (fallbackEl.length > 0) {
        const fullText = fallbackEl.text();
        // Split by date patterns to create pseudo-entries
        const dateMatches = [...fullText.matchAll(target.datePattern)];
        if (dateMatches.length > 0) {
          for (let i = 0; i < dateMatches.length; i++) {
            const start = dateMatches[i].index;
            const end = i + 1 < dateMatches.length ? dateMatches[i + 1].index : start + 2000;
            entries.push(fullText.substring(start, Math.min(end, start + 2000)));
          }
        } else {
          // Last resort: chunk the text
          entries.push(fullText.substring(0, 3000));
        }
      }
    }

    if (entries.length === 0) return items;

    // Filter entries to only those containing model-relevant content
    const relevantEntries = [];
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      const hasKeyword = RELEVANCE_KEYWORDS.some(kw => lower.includes(kw));
      const hasModelId = MODEL_ID_PATTERNS.some(p => { p.lastIndex = 0; return p.test(entry); });
      if (hasKeyword || hasModelId) {
        relevantEntries.push(entry);
      }
    }

    // Hash relevant entries for dedup
    const currentHashes = new Set(relevantEntries.map(e => this._hashEntry(e)));

    // First run: seed silently
    if (!this.initialized[target.name]) {
      this.knownEntries[target.name] = currentHashes;
      this.initialized[target.name] = true;
      logger.info(`[Changelog] ${target.name}: seeded ${currentHashes.size} relevant entries`);
      return items;
    }

    const previousHashes = this.knownEntries[target.name] || new Set();

    // Detect new entries
    for (const entry of relevantEntries) {
      const hash = this._hashEntry(entry);
      if (previousHashes.has(hash)) continue;

      // Extract any model IDs from this entry
      const modelIds = new Set();
      for (const pattern of MODEL_ID_PATTERNS) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(entry)) !== null) {
          modelIds.add(m[1].toLowerCase());
        }
      }

      // Determine if this is a deprecation or release
      const lower = entry.toLowerCase();
      const isDeprecation = ['deprecat', 'retir', 'sunset', 'end of life', 'eol', 'shut down']
        .some(kw => lower.includes(kw));
      const emoji = isDeprecation ? '⚠️' : '📋';
      const typeLabel = isDeprecation ? 'Deprecation Notice' : 'API Update';

      // Truncate entry for description
      const truncatedEntry = entry.length > 500 ? entry.substring(0, 500) + '…' : entry;

      logger.info(`[Changelog] ${emoji} New ${typeLabel} from ${target.provider}: ${entry.substring(0, 80)}...`);

      items.push({
        title: `${emoji} ${target.provider} ${typeLabel}${modelIds.size > 0 ? ': ' + [...modelIds].join(', ') : ''}`,
        description: [
          `New entry detected on **${target.name}**:`,
          '',
          `> ${truncatedEntry.replace(/\n/g, '\n> ')}`,
          '',
          modelIds.size > 0 ? `**Models mentioned**: ${[...modelIds].map(id => `\`${id}\``).join(', ')}` : '',
          '',
          `[View full changelog](${target.url})`,
        ].filter(Boolean).join('\n'),
        url: target.url,
        sourceName: target.name,
        sourceType: 'changelog',
        priority: isDeprecation ? 1 : 0, // Releases = P0, deprecations = P1
        tags: [
          'changelog', 'official', target.provider.toLowerCase(),
          ...(isDeprecation ? ['deprecation'] : ['release']),
          ...[...modelIds],
        ],
        publishedAt: new Date(),
        needsTranslation: false,
      });
    }

    // Update known set
    this.knownEntries[target.name] = currentHashes;
    return items;
  }

  /**
   * Simple hash of an entry for change detection.
   * Uses first 200 chars + length to avoid false positives from minor edits.
   */
  _hashEntry(text) {
    const normalized = text.replace(/\s+/g, ' ').trim().substring(0, 200);
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return `${hash}_${text.length}`;
  }
}

module.exports = ChangelogAdapter;
