const RSSParser = require('rss-parser');
const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

const parser = new RSSParser({
  timeout: 15000,
  headers: {
    'User-Agent': 'ModelLookerBot/1.0 (+https://github.com/model-looker-bot)',
    Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
  },
});

class RSSAdapter extends BaseAdapter {
  /**
   * @param {Object} source - Source config from sources.js
   * @param {string} source.name - Display name
   * @param {string} source.url - RSS feed URL
   * @param {number} source.priority - Priority level
   * @param {boolean} source.translate - Whether to translate content
   */
  constructor(source) {
    super(source.name, source.sourceType || 'rss', source.priority);
    this.url = source.url;
    this.translate = source.translate || false;
    this.channelOverride = source.channels || null;
  }

  async check() {
    try {
      // Fetch feed manually so we can sanitize invalid XML before parsing
      const response = await http.get(this.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'ModelLookerBot/1.0 (+https://github.com/model-looker-bot)',
          Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
        },
      });

      // Fix unescaped ampersands which break the SAX parser
      let xml = response.data;
      if (typeof xml === 'string') {
        xml = xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#x?[0-9a-fA-F]+;)/g, '&amp;');
      }

      const feed = await parser.parseString(xml);
      const items = (feed.items || []).slice(0, 10); // Only check latest 10

      return items.map((item) => ({
        title: item.title || 'Untitled',
        description: stripHtml(item.contentSnippet || item.content || item.summary || ''),
        url: item.link || item.guid || '',
        sourceName: this.name,
        sourceType: this.sourceType,
        priority: this.priority,
        tags: ['blog', 'official'],
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        needsTranslation: this.translate,
      }));
    } catch (error) {
      logger.error(`[RSS] ${this.name} error: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = RSSAdapter;
