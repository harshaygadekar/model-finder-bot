const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');

const HF_API_BASE = 'https://huggingface.co/api';

class HuggingFaceAdapter extends BaseAdapter {
  /**
   * @param {Object} source - Source config
   * @param {string} source.org - HuggingFace org/username
   * @param {string} source.name - Display name
   * @param {number} source.priority - Priority level
   */
  constructor(source) {
    super(`HuggingFace: ${source.name}`, 'huggingface', source.priority);
    this.org = source.org;
    this.displayName = source.name;
  }

  async check() {
    try {
      const response = await axios.get(`${HF_API_BASE}/models`, {
        params: {
          author: this.org,
          sort: 'createdAt',
          direction: -1,
          limit: 10,
        },
        headers: {
          'User-Agent': 'ModelLookerBot/1.0',
        },
        timeout: 15000,
      });

      const models = response.data || [];

      return models.map((model) => ({
        title: `🤗 ${this.displayName}: ${model.modelId || model.id}`,
        description: buildDescription(model),
        url: `https://huggingface.co/${model.modelId || model.id}`,
        sourceName: `HuggingFace: ${this.displayName}`,
        sourceType: 'huggingface',
        priority: this.priority,
        tags: buildTags(model),
        publishedAt: new Date(model.createdAt || model.lastModified || Date.now()),
      }));
    } catch (error) {
      logger.error(`[HuggingFace] ${this.displayName} error: ${error.message}`);
      throw error;
    }
  }
}

function buildDescription(model) {
  const parts = [];
  if (model.pipeline_tag) parts.push(`Pipeline: ${model.pipeline_tag}`);
  if (model.downloads !== undefined) parts.push(`Downloads: ${formatNumber(model.downloads)}`);
  if (model.likes !== undefined) parts.push(`Likes: ${model.likes}`);
  if (model.library_name) parts.push(`Library: ${model.library_name}`);
  return parts.join(' • ') || 'New model uploaded';
}

function buildTags(model) {
  const tags = ['huggingface'];
  if (model.pipeline_tag) tags.push(model.pipeline_tag);
  if (model.library_name) tags.push(model.library_name);
  if (model.tags) {
    // Add select tags (limit to avoid noise)
    const interestingTags = model.tags.filter((t) =>
      ['gguf', 'transformers', 'pytorch', 'safetensors', 'llama', 'mistral', 'gpt'].some((k) => t.toLowerCase().includes(k))
    );
    tags.push(...interestingTags.slice(0, 3));
  }
  return tags;
}

function formatNumber(num) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return `${num}`;
}

module.exports = HuggingFaceAdapter;
