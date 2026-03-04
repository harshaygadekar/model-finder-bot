const axios = require('axios');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const { ARENA_SOURCES } = require('../config/sources');

// ─── Mystery Model Detection ─────────────────────────────────────────────────
// Patterns that indicate a model is deliberately anonymized/mystery
const MYSTERY_PATTERNS = [
  /^[a-z]+-[a-z]+-[a-z]+$/,           // e.g., sus-column-r
  /^im-[a-z]+-[a-z]+/,                // e.g., im-mostly-a-good-chatbot
  /^anon[-_]/i,                        // anonymous models
  /^mystery/i,                         // explicit mystery
  /^model[-_]\d+$/i,                   // generic numbered models
  /^[a-f0-9]{8,}$/,                    // hash-named models
  /^chatbot[-_]\d/i,                   // chatbot-001 style
  /^test[-_]model/i,                   // test model names
  /^arena[-_]/i,                       // arena-specific test models
];

// Known model prefixes to EXCLUDE from mystery detection
const KNOWN_PREFIXES = [
  'gpt-', 'claude-', 'gemini-', 'llama-', 'mistral-', 'mixtral-',
  'deepseek-', 'qwen-', 'phi-', 'glm-', 'yi-', 'gemma-', 'command-',
  'grok-', 'palm-', 'o1-', 'o3-', 'o4-', 'cohere-', 'nvidia-',
  'meta-', 'google-', 'anthropic-',
];

function isMysteryModel(modelName) {
  if (!modelName) return false;
  const lower = modelName.toLowerCase().trim();
  
  // Skip known model families
  if (KNOWN_PREFIXES.some(prefix => lower.startsWith(prefix))) return false;
  
  // Check mystery patterns
  return MYSTERY_PATTERNS.some(pattern => pattern.test(lower));
}

class LeaderboardAdapter extends BaseAdapter {
  constructor(config = {}) {
    super('Leaderboard Tracker', 'leaderboard', 4); // P4 since it's just leaderboard data
    this.checkMystery = config.checkMystery || false;
    
    this.endpoints = [
      {
        name: 'HF Open LLM Leaderboard',
        url: 'https://datasets-server.huggingface.co/rows?dataset=open-llm-leaderboard%2Fcontents&config=default&split=train&offset=0&length=100',
        parser: (data) => {
          if (!data.rows) return [];
          const rows = data.rows.map(r => r.row);
          rows.sort((a, b) => (b['Average ⬆️'] || 0) - (a['Average ⬆️'] || 0));
          
          return rows.slice(0, 10).map((r, i) => ({
             title: `🏆 Open LLM Rank #${i + 1}: ${r.fullname}`,
             description: `Score: ${(r['Average ⬆️']||0).toFixed(2)}\nParams: ${r['#Params (B)']||'?'}B\nArchitecture: ${r.Architecture}`,
             url: `https://huggingface.co/${r.fullname}`,
          }));
        }
      },
      {
         name: 'MMLU-Pro Leaderboard',
         url: 'https://datasets-server.huggingface.co/rows?dataset=TIGER-Lab%2FMMLU-Pro&config=default&split=test&offset=0&length=100',
         parser: (data) => {
           if (!data.rows) return [];
           const rows = data.rows.map(r => r.row);
           // MMLU-Pro has question_id, question, answer, category fields
           // Extract unique categories as a benchmark summary
           const categories = [...new Set(rows.map(r => r.category).filter(Boolean))];
           if (categories.length === 0) return [];
           return [{
             title: `📈 MMLU-Pro: ${rows.length} questions across ${categories.length} categories`,
             description: `Categories: ${categories.slice(0, 8).join(', ')}${categories.length > 8 ? '...' : ''}`,
             url: 'https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro',
           }];
         }
      },
      // VoxelBench removed - site returns 404
    ];
  }

  async check() {
    const items = [];

    // Standard leaderboard checks
    for (const source of this.endpoints) {
      try {
        // VoxelBench (HTML) — special handling
        if (source.isHTML) {
          const htmlItems = await this._scrapeHTMLLeaderboard(source);
          items.push(...htmlItems);
          continue;
        }

        const response = await axios.get(source.url, { timeout: 10000 });
        const parsedItems = source.parser(response.data);
        
        parsedItems.forEach(item => {
          if (!item.title || !item.url) return;
          items.push({
            title: item.title,
            description: item.description,
            url: item.url,
            sourceName: source.name,
            sourceType: 'leaderboard',
            priority: this.priority,
            tags: ['leaderboard', 'benchmark'],
            publishedAt: new Date(),
            needsTranslation: false,
          });
        });
      } catch (error) {
         logger.warn(`[Leaderboards] Failed to fetch ${source.name}: ${error.message}`);
      }
    }

    // Mystery model detection from LMSYS Arena
    if (this.checkMystery) {
      const mysteryItems = await this._checkArena();
      items.push(...mysteryItems);
    }

    return items;
  }

  /**
   * Scrape an HTML-based leaderboard (e.g., VoxelBench) for model names.
   */
  async _scrapeHTMLLeaderboard(source) {
    const items = [];
    try {
      const response = await axios.get(source.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      const $ = cheerio.load(response.data);

      // VoxelBench: look for model names in tables, headings, or JSON data
      const modelNames = new Set();
      const modelPatterns = [
        /\b(gpt-[345][a-z0-9._-]+)\b/gi,
        /\b(claude-[a-z0-9._-]+)\b/gi,
        /\b(gemini-[0-9][a-z0-9._-]+)\b/gi,
        /\b(deepseek-[a-z0-9._-]+)\b/gi,
        /\b(grok-[0-9][a-z0-9._-]+)\b/gi,
        /\b(llama-[0-9][a-z0-9._-]+)\b/gi,
        /\b(qwen[0-9][a-z0-9._-]*)\b/gi,
        /\b(o[134]-[a-z0-9._-]+)\b/gi,
        /\b(kimi-[a-z0-9._-]+)\b/gi,
      ];

      const text = $('body').text();
      for (const pattern of modelPatterns) {
        pattern.lastIndex = 0;
        let m;
        while ((m = pattern.exec(text)) !== null) {
          modelNames.add(m[1]);
        }
      }

      if (modelNames.size > 0) {
        items.push({
          title: `🧊 VoxelBench: ${modelNames.size} models tracked`,
          description: `Top models on VoxelBench 3D benchmark:\n${[...modelNames].slice(0, 10).join(', ')}`,
          url: source.url,
          sourceName: source.name,
          sourceType: 'leaderboard',
          priority: this.priority,
          tags: ['leaderboard', 'benchmark', 'voxelbench', '3d'],
          publishedAt: new Date(),
          needsTranslation: false,
        });
      }
    } catch (error) {
      logger.warn(`[Leaderboards] Failed to scrape ${source.name}: ${error.message}`);
    }
    return items;
  }

  /**
   * Check LMSYS Chatbot Arena for mystery/anonymous models.
   */
  async _checkArena() {
    const items = [];

    for (const arena of ARENA_SOURCES) {
      try {
        // Use HF space API (primary method) since GCS datasetUrl returns 403
        let models = [];
        try {
          const hfResponse = await axios.get(arena.url, { timeout: 15000 });
          const hfData = hfResponse.data;
          if (hfData && hfData.models) {
            models = hfData.models;
          } else if (hfData && typeof hfData === 'object') {
            if (Array.isArray(hfData)) {
              models = hfData.map(entry => entry.model || entry.Model || entry.name || '').filter(Boolean);
            } else {
              models = Object.keys(hfData);
            }
          }
        } catch (err) {
          logger.warn(`[Arena] Failed to fetch ${arena.name}: ${err.message}`);
          continue;
        }

        // Filter for mystery/anonymous models
        const mysteryModels = models.filter(isMysteryModel);
        
        for (const modelName of mysteryModels) {
          items.push({
            title: `🔮 Mystery Model Detected: ${modelName}`,
            description: `An unidentified model "${modelName}" has appeared on the ${arena.name}.\n\nThis may be an unreleased model from a major lab being blind-tested.`,
            url: arena.fallbackUrl || arena.url,
            sourceName: arena.name,
            sourceType: 'arena-mystery',
            priority: 1, // P1 — these are significant signals
            tags: ['mystery-model', 'arena', 'lmsys', 'rumor'],
            publishedAt: new Date(),
            needsTranslation: false,
          });
        }

        if (mysteryModels.length > 0) {
          logger.info(`[Arena] Found ${mysteryModels.length} mystery model(s): ${mysteryModels.join(', ')}`);
        }
      } catch (error) {
        logger.warn(`[Arena] Failed to check ${arena.name}: ${error.message}`);
      }
    }

    return items;
  }
}

module.exports = LeaderboardAdapter;
