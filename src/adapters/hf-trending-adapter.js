const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

class HFTrendingAdapter extends BaseAdapter {
  constructor() {
    // Priority P1 since it's model-updates
    super('HuggingFace Trending', 'huggingface', 1);
    this.url = 'https://huggingface.co/api/trending?type=model';
  }

  async check() {
    try {
      const response = await axios.get(this.url, { timeout: 10000 });
      // The API returns { recentlyTrending: [ { repoData: { id: "..." } } ] }
      const data = response.data;
      const trendingModels = data.recentlyTrending || data.models || data;

      if (!trendingModels || !Array.isArray(trendingModels)) {
        logger.warn('[HF Trending] Unexpected API format');
        return [];
      }

      const items = [];
      // Grab top 5 trending models
      for (const model of trendingModels.slice(0, 5)) {
        const repoData = model.repoData || model;
        const repoId = repoData.id;
        if (!repoId) continue;

        const url = `https://huggingface.co/${repoId}`;
        
        items.push({
          title: `🔥 Trending Top 5: ${repoId}`,
          description: `This model is currently trending on HuggingFace!\n\nLikes: ${repoData.likes || 'N/A'} | Downloads: ${repoData.downloads || 'N/A'}`,
          url: url,
          sourceName: this.name,
          sourceType: this.sourceType,
          priority: this.priority,
          tags: ['trending', 'huggingface', 'model'],
          publishedAt: new Date(), // Trending doesn't have a single timestamp, treat as 'now'
          needsTranslation: false,
        });
      }

      return items;
    } catch (error) {
      logger.error(`[HF Trending] Failed to fetch: ${error.message}`);
      throw error;
    }
  }
}

module.exports = HFTrendingAdapter;
