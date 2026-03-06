const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const db = require('../db/database');
const logger = require('../services/logger');
const { isMysteryModel } = require('../utils/mystery-detector');

/**
 * Arena Model Monitor — extracts model data from LM Arena's React Server
 * Component (RSC) payload embedded in the leaderboard HTML.
 *
 * The Arena leaderboard page at lmarena.ai/leaderboard contains inline
 * `self.__next_f.push(...)` chunks that encode full model metadata as RSC
 * payloads. One of these chunks (typically ~268 KB) holds the complete list
 * of all models competing in the Arena — currently 600+ entries.
 *
 * This adapter:
 *  1. Fetches the leaderboard HTML
 *  2. Extracts all RSC payload chunks
 *  3. Finds the large chunk containing model data
 *  4. Parses model names + organizations via regex
 *  5. Diffs against known set → new models = alerts
 *
 * This replaces the broken GCS ELO JSON endpoint (403'd) and provides far
 * richer data (organization names, model categories, etc.).
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

class ArenaMonitorAdapter extends BaseAdapter {
  constructor() {
    super('Arena Model Monitor', 'arena-models', 1); // P1 — new Arena models are significant
    this.knownModels = new Map(); // modelName → { organization, firstSeen }
    this.initialized = false;
    this._dbLoaded = false;
  }

  /**
   * Load persisted arena models from database (survives bot restarts).
   */
  _loadFromDb() {
    if (this._dbLoaded) return;
    try {
      const rows = db.getKnownArenaModels();
      for (const row of rows) {
        this.knownModels.set(row.name, { organization: row.organization, firstSeen: new Date(row.first_seen) });
      }
      if (this.knownModels.size > 0) {
        this.initialized = true;
        logger.info(`[Arena Monitor] Loaded ${this.knownModels.size} known models from database`);
      }
      this._dbLoaded = true;
    } catch (e) {
      logger.debug(`[Arena Monitor] Could not load from DB: ${e.message}`);
    }
  }

  async check() {
    const items = [];

    // Load persisted models from database on first check
    if (!this._dbLoaded) {
      this._loadFromDb();
    }

    try {
      // Extract models from both leaderboard AND battle mode pages
      const [leaderboardResult, battleResult] = await Promise.allSettled([
        this._extractArenaModels(),
        this._extractBattleModeModels(),
      ]);
      const allModels = [
        ...(leaderboardResult.status === 'fulfilled' ? leaderboardResult.value : []),
        ...(battleResult.status === 'fulfilled' ? battleResult.value : []),
      ];
      // Deduplicate by name
      const seenNames = new Set();
      const models = allModels.filter(m => {
        if (seenNames.has(m.name)) return false;
        seenNames.add(m.name);
        return true;
      });

      if (models.length === 0) {
        logger.debug('[Arena Monitor] No models extracted from RSC payload');
        return items;
      }

      // First run: seed silently
      if (!this.initialized) {
        for (const m of models) {
          this.knownModels.set(m.name, { organization: m.organization, firstSeen: new Date() });
          db.addArenaModel(m.name, m.organization, 'leaderboard');
        }
        this.initialized = true;
        logger.info(`[Arena Monitor] Seeded ${models.length} models from ${new Set(models.map(m => m.organization)).size} organizations`);
        return items;
      }

      // Detect NEW models
      for (const m of models) {
        if (this.knownModels.has(m.name)) continue;
        if (db.isArenaModelKnown(m.name)) { this.knownModels.set(m.name, { organization: m.organization, firstSeen: new Date() }); continue; }

        // New model found!
        this.knownModels.set(m.name, { organization: m.organization, firstSeen: new Date() });
        db.addArenaModel(m.name, m.organization, 'leaderboard');

        const mystery = isMysteryModel(m.name);
        const emoji = mystery ? '🔮' : '🏟️';
        const sourceType = mystery ? 'arena-mystery' : 'arena-models';

        logger.info(`[Arena Monitor] ${emoji} NEW model on Arena: ${m.name} (${m.organization})`);

        items.push({
          title: `${emoji} New Arena Model: ${m.name}`,
          description: [
            `A new model has appeared on **LM Arena** (formerly LMSYS Chatbot Arena).`,
            '',
            `**Model**: \`${m.name}\``,
            `**Organization**: ${m.organization || 'Unknown'}`,
            mystery ? '\n⚠️ This appears to be an **anonymous/mystery model** — likely an unreleased model being blind-tested.' : '',
            '',
            'This model is now available for head-to-head comparison voting on Arena.',
          ].filter(Boolean).join('\n'),
          url: 'https://lmarena.ai/leaderboard',
          sourceName: 'LM Arena',
          sourceType,
          priority: mystery ? 0 : 1, // Mystery models get P0
          tags: [
            'arena', 'leaderboard',
            m.organization ? m.organization.toLowerCase().replace(/\s+/g, '-') : 'unknown',
            m.name.toLowerCase(),
            ...(mystery ? ['mystery-model', 'unreleased', 'rumor'] : ['new-model']),
          ],
          publishedAt: new Date(),
          needsTranslation: false,
        });
      }

      // Also detect REMOVED models (can indicate deprecation)
      const currentNames = new Set(models.map(m => m.name));
      const removed = [];
      for (const [name] of this.knownModels) {
        if (!currentNames.has(name)) {
          removed.push(name);
        }
      }
      // Clean up — don't alert on removals, just log + purge stale entries
      if (removed.length > 0 && removed.length < 50) { // sanity: don't purge on partial fetch
        for (const name of removed) {
          this.knownModels.delete(name);
        }
        logger.debug(`[Arena Monitor] ${removed.length} model(s) removed from Arena`);
      }

    } catch (error) {
      logger.warn(`[Arena Monitor] Failed to check Arena: ${error.message}`);
    }

    return items;
  }

  /**
   * Extract all model entries from Arena's leaderboard HTML RSC payload.
   * Returns array of { name, organization }.
   */
  async _extractArenaModels() {
    const response = await http.get('https://lmarena.ai/leaderboard', {
      timeout: 30000,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      maxRedirects: 5,
    });

    const html = response.data;
    if (typeof html !== 'string') return [];

    // ── Strategy 1: Extract from RSC payload chunks ──────────────────────
    // Next.js RSC payloads are in script tags as: self.__next_f.push([1,"..."])
    const rscChunks = [];
    const rscPattern = /self\.__next_f\.push\(\[1,"(.+?)"\]\)/gs;
    let match;
    while ((match = rscPattern.exec(html)) !== null) {
      try {
        // Unescape the JSON string
        const raw = match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .replace(/\\t/g, '\t')
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        rscChunks.push(raw);
      } catch {
        // Skip malformed chunks
      }
    }

    // Find the large chunk containing model data
    const models = [];
    const seenNames = new Set();

    for (const chunk of rscChunks) {
      if (chunk.length < 1000) continue; // Skip tiny chunks

      // Extract name-organization pairs
      // RSC format includes JSON-like structures: "name":"model-name","organization":"Org"
      const nameOrgPattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"organization"\s*:\s*"([^"]+)"/g;
      let m;
      while ((m = nameOrgPattern.exec(chunk)) !== null) {
        const name = m[1].trim();
        const organization = m[2].trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          models.push({ name, organization });
        }
      }

      // Also try standalone name patterns in different JSON shapes
      // Some entries may have organization before name
      const orgNamePattern = /"organization"\s*:\s*"([^"]+)"\s*,\s*"name"\s*:\s*"([^"]+)"/g;
      while ((m = orgNamePattern.exec(chunk)) !== null) {
        const name = m[2].trim();
        const organization = m[1].trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          models.push({ name, organization });
        }
      }
    }

    // ── Strategy 2: Fallback — regex scan entire HTML for model-like IDs ─
    // If RSC extraction failed, try to find model IDs in the raw HTML
    if (models.length === 0) {
      logger.debug('[Arena Monitor] RSC extraction found 0 models, trying HTML regex fallback');
      const modelPatterns = [
        /\b(gpt-[345][a-z0-9._-]+)\b/gi,
        /\b(claude-(?:opus|sonnet|haiku|instant)[a-z0-9._-]*)\b/gi,
        /\b(gemini-[0-9][a-z0-9._-]+)\b/gi,
        /\b(llama-[0-9][a-z0-9._-]+)\b/gi,
        /\b(deepseek-[a-z0-9._-]+)\b/gi,
        /\b(grok-[0-9][a-z0-9._-]+)\b/gi,
        /\b(qwen[0-9][a-z0-9._-]*)\b/gi,
        /\b(mistral-[a-z0-9._-]+)\b/gi,
        /\b(glm-[0-9][a-z0-9._-]+)\b/gi,
        /\b(step-[0-9][a-z0-9._-]+)\b/gi,
        /\b(o[134]-[a-z0-9._-]+)\b/gi,
      ];

      for (const pattern of modelPatterns) {
        pattern.lastIndex = 0;
        while ((m = pattern.exec(html)) !== null) {
          const name = m[1].trim();
          if (name.length >= 5 && !seenNames.has(name)) {
            seenNames.add(name);
            models.push({ name, organization: 'Unknown' });
          }
        }
      }
    }

    logger.debug(`[Arena Monitor] Extracted ${models.length} models from Arena leaderboard`);
    return models;
  }

  /**
   * Extract model names from Arena's Battle Mode / main page.
   * Battle mode may list models not yet on the leaderboard.
   */
  async _extractBattleModeModels() {
    try {
      const response = await http.get('https://lmarena.ai/', {
        timeout: 30000,
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        maxRedirects: 5,
      });

      const html = response.data;
      if (typeof html !== 'string') return [];

      const models = [];
      const seenNames = new Set();

      // Extract from RSC payload chunks (same technique as leaderboard)
      const rscPattern = /self\.__next_f\.push\(\[1,"(.+?)"\]\)/gs;
      let match;
      while ((match = rscPattern.exec(html)) !== null) {
        try {
          const raw = match[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .replace(/\\t/g, '\t')
            .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

          // Look for model name-organization pairs
          const nameOrgPattern = /"name"\s*:\s*"([^"]+)"\s*,\s*"organization"\s*:\s*"([^"]+)"/g;
          let m;
          while ((m = nameOrgPattern.exec(raw)) !== null) {
            const name = m[1].trim();
            const organization = m[2].trim();
            if (name && !seenNames.has(name)) {
              seenNames.add(name);
              models.push({ name, organization });
            }
          }
          const orgNamePattern = /"organization"\s*:\s*"([^"]+)"\s*,\s*"name"\s*:\s*"([^"]+)"/g;
          while ((m = orgNamePattern.exec(raw)) !== null) {
            const name = m[2].trim();
            const organization = m[1].trim();
            if (name && !seenNames.has(name)) {
              seenNames.add(name);
              models.push({ name, organization });
            }
          }

          // Also look for model IDs in dropdown/selector-like structures
          const modelListPattern = /"model(?:_name|Id|_id)?"\s*:\s*"([^"]{3,60})"/g;
          while ((m = modelListPattern.exec(raw)) !== null) {
            const name = m[1].trim();
            if (name && !seenNames.has(name) && !name.includes('/') && !name.includes('\\')) {
              seenNames.add(name);
              models.push({ name, organization: 'Unknown' });
            }
          }
        } catch {
          // Skip malformed chunks
        }
      }

      logger.debug(`[Arena Monitor] Extracted ${models.length} models from battle mode page`);
      return models;
    } catch (error) {
      logger.debug(`[Arena Monitor] Battle mode scrape failed: ${error.message}`);
      return [];
    }
  }
}

module.exports = ArenaMonitorAdapter;
