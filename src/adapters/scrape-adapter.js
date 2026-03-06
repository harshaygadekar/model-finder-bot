const http = require('../services/http');
const cheerio = require('cheerio');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const { extractGenericItems } = require('../services/extractors/generic-recipe');
const { getRecipeForAdapter } = require('../services/extractors/recipe-registry');

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
    this.contentSelectors = source.contentSelectors || ['main', 'article', '[role="main"]'];
    this.allowedOrigins = source.allowedOrigins || [new URL(this.baseUrl).origin];
    this.minTitleLength = source.minTitleLength || 8;
    this.maxItems = source.maxItems || 10;
    this.allowTitlePattern = source.allowTitlePattern || null;
    this.denyTitlePattern = source.denyTitlePattern || /^(home|about|pricing|careers|contact|news|blog|docs|login|sign in|learn more|read more|view all|see all|menu|search|back|next)$/i;
    this.extractItems = typeof source.extractItems === 'function' ? source.extractItems : null;
    this.recipeKey = source.recipeKey || null;
  }

  async check() {
    try {
      const response = await http.get(this.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      const $ = cheerio.load(response.data);

      if (this.extractItems) {
        const extractedItems = this.extractItems($, this);
        if (Array.isArray(extractedItems) && extractedItems.length > 0) {
          return extractedItems.slice(0, this.maxItems);
        }
      }

      const recipe = getRecipeForAdapter(this);
      if (recipe) {
        const recipeItems = recipe.extract($, this);
        if (Array.isArray(recipeItems) && recipeItems.length > 0) {
          return recipeItems.slice(0, this.maxItems);
        }
      }

      return extractGenericItems($, this);

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
