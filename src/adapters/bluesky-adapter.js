const RSSAdapter = require('./rss-adapter');
const logger = require('../services/logger');

/**
 * Bluesky adapter using native RSS feeds (bsky.app/profile/{handle}/rss).
 * No API key or authentication required.
 * Each public Bluesky profile has a built-in RSS feed.
 */
class BlueskyAdapter extends RSSAdapter {
  constructor(source) {
    // Bluesky provides native RSS at this URL pattern
    const rssUrl = `https://bsky.app/profile/${source.handle}/rss`;
    super({
      name: `Bluesky: ${source.name}`,
      url: rssUrl,
      priority: source.priority ?? 3,
      translate: false,
    });
    this.handle = source.handle;
    this.displayName = source.name;
    // Override sourceType so channel routing maps to community-buzz
    this._sourceType = 'bluesky';
  }

  getSourceType() {
    return 'bluesky';
  }

  async check() {
    try {
      const items = await super.check();
      // Override sourceType on each item (parent RSS adapter sets 'rss')
      return items.map((item) => ({ ...item, sourceType: 'bluesky' }));
    } catch (error) {
      logger.error(`[Bluesky] ${this.handle}: ${error.message}`);
      throw error;
    }
  }
}

// Known active AI accounts on Bluesky (verified working RSS feeds)
const BLUESKY_SOURCES = [
  { handle: 'anthropic.com',              name: 'Anthropic',        priority: 0 },
  { handle: 'yann-lecun.bsky.social',     name: 'Yann LeCun',       priority: 1 }, // fixed handle
  { handle: 'karpathy.bsky.social',       name: 'Andrej Karpathy',  priority: 1 }, // confirmed ✅
  { handle: 'huggingface.bsky.social',    name: 'HuggingFace',      priority: 1 }, // fixed handle
  { handle: 'aibreakfast.bsky.social',    name: 'AI Breakfast',     priority: 2 },
];

module.exports = BlueskyAdapter;
module.exports.BLUESKY_SOURCES = BLUESKY_SOURCES;
