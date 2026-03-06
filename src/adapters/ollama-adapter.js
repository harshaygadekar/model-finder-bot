const http = require('../services/http');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

class OllamaAdapter extends BaseAdapter {
  constructor(config) {
    super('Ollama Library', 'ollama', config.priority);
    this.url = config.url;
  }

  async check() {
    try {
      const response = await http.get(this.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ModelLookerBot/1.0)',
        },
        timeout: 20000,
      });

      const $ = cheerio.load(response.data);
      const models = [];

      // Parse the Ollama library page for model entries
      // Ollama lists models in a structured layout
      $('a[href^="/library/"]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const name = href ? href.replace('/library/', '').split('/')[0] : '';

        if (!name) return;

        // Try to get description from sibling or child elements
        const description = $el.find('p, span').first().text().trim() ||
                           $el.text().trim().replace(name, '').trim() ||
                           '';

        models.push({
          title: `🦙 Ollama: ${name}`,
          description: description || `Model "${name}" available on Ollama`,
          url: `https://ollama.com/library/${name}`,
          sourceName: 'Ollama Library',
          sourceType: 'ollama',
          priority: this.priority,
          tags: ['ollama', 'local-llm'],
          publishedAt: new Date(),
        });
      });

      logger.debug(`[Ollama] Found ${models.length} models on library page`);
      return models;
    } catch (error) {
      logger.error(`[Ollama] Error scraping library: ${error.message}`);
      throw error;
    }
  }
}

module.exports = OllamaAdapter;
