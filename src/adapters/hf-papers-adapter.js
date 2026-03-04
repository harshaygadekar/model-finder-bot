const axios = require('axios');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const db = require('../db/database');

/**
 * HuggingFace Daily Papers adapter.
 * Scrapes https://huggingface.co/papers — community-curated top papers daily.
 * These are human-selected, high-quality papers with engagement signal (likes/upvotes).
 */

class HFPapersAdapter extends BaseAdapter {
  constructor() {
    super('HuggingFace Daily Papers', 'hf-papers', 2);
    this.url = 'https://huggingface.co/papers';
  }

  async check() {
    try {
      const response = await axios.get(this.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ModelLookerBot/1.0)',
          'Accept': 'text/html',
        },
        timeout: 20000,
      });

      const $ = cheerio.load(response.data);
      const papers = [];

      // Each paper card on HF Daily Papers
      $('article').each((_, el) => {
        try {
          const $el = $(el);

          // Title & URL
          const titleEl = $el.find('h3 a, h2 a').first();
          const title = titleEl.text().trim();
          const href = titleEl.attr('href');
          if (!title || !href) return;

          const url = href.startsWith('http') ? href : `https://huggingface.co${href}`;

          // ArXiv ID from URL
          const arxivMatch = url.match(/papers\/(\d{4}\.\d+)/);
          const arxivId = arxivMatch ? arxivMatch[1] : null;

          // Likes / upvotes
          const likesText = $el.find('[class*="like"], [class*="vote"], [class*="upvote"]').first().text().trim();
          const hfLikes = parseInt(likesText.replace(/[^0-9]/g, '')) || 0;

          // Abstract (may not always be present on list page)
          const abstract = $el.find('p').first().text().trim();

          const paper = {
            arxivId,
            title,
            authors: '',
            abstract: abstract.substring(0, 500),
            url,
            category: 'AI',
            source: 'hf-papers',
            publishedAt: new Date().toISOString(),
            hfLikes,
            // Notifiable item format
            description: abstract.substring(0, 200) || 'Community-curated paper on HuggingFace',
            sourceName: 'HuggingFace Daily Papers',
            sourceType: 'hf-papers',
            priority: 2,
            tags: ['research', 'huggingface', 'daily-papers'],
          };

          try {
            db.savePaper(paper);
          } catch (e) {
            // Ignore duplicate saves
          }
          papers.push(paper);
        } catch (e) {
          // Skip malformed entries
        }
      });

      logger.info(`[HF Papers] Found ${papers.length} papers`);
      return papers;
    } catch (error) {
      logger.error(`[HF Papers] Error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = HFPapersAdapter;
