const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

const TRENDING_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TRENDING_STATE_RETENTION_MS = 7 * TRENDING_COOLDOWN_MS;

class HFTrendingAdapter extends BaseAdapter {
  constructor() {
    // Priority P1 since it's model-updates
    super('HuggingFace Trending', 'huggingface', 1);
    this.url = 'https://huggingface.co/api/trending?type=model';
    this.lastAlertedAt = {};
    this._stateLoaded = false;
  }

  async check() {
    try {
      this._ensureStateLoaded();

      const response = await http.get(this.url, { timeout: 10000 });
      // The API returns { recentlyTrending: [ { repoData: { id: "..." } } ] }
      const data = response.data;
      const trendingModels = data.recentlyTrending || data.models || data;

      if (!trendingModels || !Array.isArray(trendingModels)) {
        logger.warn('[HF Trending] Unexpected API format');
        return [];
      }

      const items = [];
      const now = Date.now();
      // Grab top 5 trending models
      for (const [index, model] of trendingModels.slice(0, 5).entries()) {
        const repoData = model.repoData || model;
        const repoId = repoData.id;
        if (!repoId) continue;

        const lastAlertedAt = this.lastAlertedAt[repoId];
        if (lastAlertedAt) {
          const elapsed = now - new Date(lastAlertedAt).getTime();
          if (elapsed < TRENDING_COOLDOWN_MS) continue;
        }

        const url = `https://huggingface.co/${repoId}`;
        this.lastAlertedAt[repoId] = new Date(now).toISOString();

        items.push({
          title: `🔥 HF Trending: ${repoId}`,
          description: `This model is currently trending on Hugging Face.\n\nRank: #${index + 1}\nLikes: ${repoData.likes || 'N/A'} | Downloads: ${repoData.downloads || 'N/A'}`,
          url: url,
          sourceName: this.name,
          sourceType: this.sourceType,
          priority: this.priority,
          tags: ['trending', 'huggingface', 'model'],
          publishedAt: new Date(), // Trending doesn't have a single timestamp, treat as 'now'
          needsTranslation: false,
        });
      }

      this._pruneState(now);
      this._persistState();

      return items;
    } catch (error) {
      logger.error(`[HF Trending] Failed to fetch: ${error.message}`);
      throw error;
    }
  }

  _ensureStateLoaded() {
    if (this._stateLoaded) return;

    const persisted = this.loadState('trending-cooldowns', {});
    if (persisted && typeof persisted === 'object') {
      this.lastAlertedAt = persisted;
    }

    this._stateLoaded = true;
  }

  _persistState() {
    this.saveState('trending-cooldowns', this.lastAlertedAt);
  }

  _pruneState(now) {
    for (const [repoId, lastAlertedAt] of Object.entries(this.lastAlertedAt)) {
      if (now - new Date(lastAlertedAt).getTime() > TRENDING_STATE_RETENTION_MS) {
        delete this.lastAlertedAt[repoId];
      }
    }
  }
}

module.exports = HFTrendingAdapter;
