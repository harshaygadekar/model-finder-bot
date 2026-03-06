const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const { RESEARCHERS, AFFILIATION_PATTERNS } = require('../config/researchers');

/**
 * Talent Movement Adapter — monitors top AI researchers for affiliation changes.
 *
 * Detection flow:
 * 1. For each researcher, query ArXiv for their most recent papers
 * 2. Parse the affiliation field from the ArXiv Atom response
 * 3. Compare against the known currentAffil in researchers.js
 * 4. On mismatch: alert to #talent-moves channel
 * 5. Optionally check GitHub org membership changes
 */
class TalentAdapter extends BaseAdapter {
  constructor() {
    super('Talent Movement Tracker', 'talent', 2); // P2
    this.lastKnownAffils = {}; // Runtime cache of detected affiliations
  }

  async check() {
    const items = [];

    for (const researcher of RESEARCHERS) {
      try {
        // ArXiv check
        if (researcher.arxivQuery) {
          const arxivItems = await this._checkArxiv(researcher);
          items.push(...arxivItems);
        }

        // GitHub org check
        if (researcher.github) {
          const githubItems = await this._checkGitHubOrgs(researcher);
          items.push(...githubItems);
        }

        // Small spacing between researchers; ArXiv requests themselves are centrally paced.
        await sleep(250);
      } catch (error) {
        logger.warn(`[Talent] Failed to check ${researcher.name}: ${error.message}`);
      }
    }

    return items;
  }

  /**
   * Check ArXiv for a researcher's recent papers and detect affiliation changes.
   */
  async _checkArxiv(researcher) {
    const items = [];

    try {
      const response = await http.getArxiv('https://export.arxiv.org/api/query', {
        params: {
          search_query: researcher.arxivQuery,
          sortBy: 'submittedDate',
          sortOrder: 'descending',
          max_results: 3,
        },
        timeout: 15000,
        headers: { 'User-Agent': 'ModelLookerBot/1.0' },
      });

      const xml = response.data;
      if (!xml || typeof xml !== 'string') return items;

      // Parse affiliations from ArXiv Atom response
      const affiliations = this._parseAffiliations(xml);
      const paperTitles = this._parseTitles(xml);

      if (affiliations.length === 0) return items;

      // Detect the lab affiliation from parsed strings
      const detectedLab = this._matchAffiliation(affiliations);
      const cacheKey = `arxiv-${researcher.name}`;

      if (!detectedLab) return items;

      // Compare against known affiliation
      const knownAffil = this.lastKnownAffils[cacheKey] || researcher.currentAffil;

      if (detectedLab !== knownAffil) {
        // Affiliation change detected!
        this.lastKnownAffils[cacheKey] = detectedLab;

        const latestPaper = paperTitles[0] || 'Unknown paper';
        items.push({
          title: `🔄 Talent Move: ${researcher.name} — ${knownAffil} → ${detectedLab}`,
          description: `**${researcher.name}** appears to have moved from **${knownAffil}** to **${detectedLab}**.\n\nDetected via recent ArXiv paper: "${latestPaper}"\n\nAffiliation strings found: ${affiliations.join(', ')}`,
          url: `https://arxiv.org/search/?query=${encodeURIComponent(researcher.arxivQuery)}&searchtype=author`,
          sourceName: 'Talent Tracker (ArXiv)',
          sourceType: 'talent',
          priority: 1, // P1 — significant signal
          tags: ['talent-move', 'researcher', researcher.name.toLowerCase().replace(/\s/g, '-'), knownAffil.toLowerCase(), detectedLab.toLowerCase()],
          publishedAt: new Date(),
          needsTranslation: false,
        });

        logger.info(`[Talent] 🔄 ${researcher.name}: ${knownAffil} → ${detectedLab}`);
      } else {
        // Update cache to confirm current affiliation
        this.lastKnownAffils[cacheKey] = detectedLab;
      }
    } catch (error) {
      if (error.response?.status === 429) {
        logger.warn(`[Talent] ArXiv rate limited, will retry next cycle`);
      } else {
        throw error;
      }
    }

    return items;
  }

  /**
   * Check GitHub for org membership changes.
   */
  async _checkGitHubOrgs(researcher) {
    const items = [];

    try {
      const headers = { 'User-Agent': 'ModelLookerBot/1.0' };
      if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
      }

      const response = await http.get(`https://api.github.com/users/${researcher.github}/orgs`, {
        headers,
        timeout: 10000,
      });

      const orgs = (response.data || []).map(o => o.login.toLowerCase());
      const cacheKey = `github-${researcher.github}`;

      // First run: just store the orgs
      if (!this.lastKnownAffils[cacheKey]) {
        this.lastKnownAffils[cacheKey] = orgs;
        return items;
      }

      const previousOrgs = this.lastKnownAffils[cacheKey];
      const newOrgs = orgs.filter(o => !previousOrgs.includes(o));
      const leftOrgs = previousOrgs.filter(o => !orgs.includes(o));

      // Notable AI lab org names on GitHub
      const notableOrgs = [
        'openai', 'anthropics', 'google', 'google-deepmind', 'meta-llama',
        'facebookresearch', 'mistralai', 'deepseek-ai', 'qwenlm', 'thudm',
        'stability-ai', 'cohere-ai', 'nvidia', 'microsoft', 'apple',
        'xai-org', 'together-ai',
      ];

      for (const org of newOrgs) {
        if (notableOrgs.includes(org)) {
          items.push({
            title: `🏢 GitHub Org Join: ${researcher.name} joined ${org}`,
            description: `**${researcher.name}** (@${researcher.github}) has joined the **${org}** GitHub organization.\n\nThis may indicate a move to ${org}.`,
            url: `https://github.com/${researcher.github}`,
            sourceName: 'Talent Tracker (GitHub)',
            sourceType: 'talent',
            priority: 1,
            tags: ['talent-move', 'github-org', researcher.name.toLowerCase().replace(/\s/g, '-'), org],
            publishedAt: new Date(),
            needsTranslation: false,
          });
        }
      }

      for (const org of leftOrgs) {
        if (notableOrgs.includes(org)) {
          items.push({
            title: `🚪 GitHub Org Leave: ${researcher.name} left ${org}`,
            description: `**${researcher.name}** (@${researcher.github}) has left the **${org}** GitHub organization.\n\nThis may indicate a departure from ${org}.`,
            url: `https://github.com/${researcher.github}`,
            sourceName: 'Talent Tracker (GitHub)',
            sourceType: 'talent',
            priority: 1,
            tags: ['talent-move', 'github-org', researcher.name.toLowerCase().replace(/\s/g, '-'), org],
            publishedAt: new Date(),
            needsTranslation: false,
          });
        }
      }

      this.lastKnownAffils[cacheKey] = orgs;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.debug(`[Talent] GitHub user ${researcher.github} not found`);
      } else {
        throw error;
      }
    }

    return items;
  }

  /**
   * Parse affiliation strings from ArXiv Atom XML.
   * ArXiv uses <arxiv:affiliation> tags within <author> entries.
   */
  _parseAffiliations(xml) {
    const affiliations = [];
    // Match <arxiv:affiliation> tags
    const affilRegex = /<arxiv:affiliation[^>]*>([^<]+)<\/arxiv:affiliation>/gi;
    let match;
    while ((match = affilRegex.exec(xml)) !== null) {
      affiliations.push(match[1].trim());
    }

    // Also check for affiliation in author comments/names
    // Some authors include affiliation in the <name> tag or <summary>
    if (affiliations.length === 0) {
      const summaryRegex = /<summary[^>]*>([\s\S]*?)<\/summary>/gi;
      while ((match = summaryRegex.exec(xml)) !== null) {
        affiliations.push(match[1].trim());
      }
    }

    return affiliations;
  }

  /**
   * Parse paper titles from ArXiv Atom XML.
   */
  _parseTitles(xml) {
    const titles = [];
    const titleRegex = /<entry>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/gi;
    let match;
    while ((match = titleRegex.exec(xml)) !== null) {
      titles.push(match[1].replace(/\s+/g, ' ').trim());
    }
    return titles;
  }

  /**
   * Match affiliation strings against known lab patterns.
   */
  _matchAffiliation(affiliations) {
    const combined = affiliations.join(' ');
    for (const [lab, pattern] of Object.entries(AFFILIATION_PATTERNS)) {
      if (pattern.test(combined)) {
        return lab;
      }
    }
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = TalentAdapter;
