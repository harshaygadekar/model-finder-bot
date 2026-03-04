const axios = require('axios');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

class ScrapeAdapter extends BaseAdapter {
  constructor(source) {
    super(source.name, source.sourceTypeOverride || 'scrape', source.priority);
    this.url = source.url;
    this.baseUrl = source.baseUrl || new URL(source.url).origin;
    this.linkSelectors = source.linkSelectors || ['a'];
    // regex pattern that the href must match to be considered an article
    this.linkPattern = source.linkPattern || /\/(news|blog|research|discover)\//;
    // regex to ignore specific links (e.g. pagination, categories)
    this.ignorePattern = source.ignorePattern || null;
    // Whether content needs CJK translation
    this.translate = source.translate || false;
  }

  async check() {
    try {
      const response = await axios.get(this.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      const $ = cheerio.load(response.data);
      const items = [];
      const seenLinks = new Set();

      this.linkSelectors.forEach((selector) => {
        $(selector).each((i, el) => {
          let href = $(el).attr('href');
          let title = $(el).text() || '';

          if (!href) return;

          // Resolve relative URLs
          if (href.startsWith('/')) {
            href = `${this.baseUrl}${href}`;
          } else if (!href.startsWith('http')) {
            return; // Skip anchor links or other malformed fragments
          }

          // Filter against patterns
          if (!this.linkPattern.test(href)) return;
          if (this.ignorePattern && this.ignorePattern.test(href)) return;

          // Normalize basic title text stripping tabs/newlines
          title = title.replace(/\s+/g, ' ').trim();
          
          // Deduplicate
          if (seenLinks.has(href)) {
             // If we already have this link, but this element has a better title, update it
             if (title.length > 10) {
               const existing = items.find(i => i.url === href);
               if (existing && existing.title.length < title.length) {
                 existing.title = title;
               }
             }
             return;
          }

          seenLinks.add(href);

          items.push({
            title: title || 'New Blog Post',
            description: `New article detected on ${this.name}`,
            url: href,
            sourceName: this.name,
            sourceType: this.sourceType,
            priority: this.priority,
            tags: ['blog', 'official'],
            publishedAt: new Date(), // Scraped items don't have perfect timestamps usually
            needsTranslation: this.translate,
          });
        });
      });

      // Sort by newest first? Scraping doesn't guarantee order, but usually top-down is chronological
      // Let's just return the top 10 unique links found on the page
      
      // Filter out items with very short/missing titles if possible, though some CMS use image links
      const validItems = items.filter(i => i.title && i.title.length > 3).slice(0, 10);
      return validItems;

    } catch (error) {
      if (error.response?.status === 403 || error.response?.status === 401) {
         logger.warn(`[Scrape] ${this.name} returned ${error.response.status} (likely bot protection)`);
         return []; // return empty so it doesn't crash the scheduler, some hostings like Cloudflare block generic scrapers
      }
      logger.error(`[Scrape] ${this.name} error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ScrapeAdapter;
