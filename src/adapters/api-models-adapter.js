const http = require('../services/http');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const { API_MODEL_SOURCES, FREE_MODEL_AGGREGATORS } = require('../config/sources');

/**
 * API Models Adapter — detects new models the moment they go live.
 *
 * THREE-TIER DETECTION STRATEGY:
 *
 * TIER 1 — Free Aggregators (no key / optional key):
 *   OpenRouter, NovitaAI, Sambanova, AI21
 *   These aggregate models from many providers in a single call.
 *   OpenRouter uses OPENROUTER_API_KEY if set (better rate limits).
 *
 * TIER 2 — Direct Provider APIs (requires API key):
 *   Western: OpenAI, Anthropic, Google, Mistral, Cohere, xAI, Groq,
 *            Together, Fireworks, Perplexity, Cerebras
 *   Chinese: DeepSeek, Moonshot/Kimi, 01.AI/Yi, SiliconFlow, Stepfun, Zhipu/GLM
 *   Fastest detection per-provider (seconds vs minutes via aggregators).
 *
 * TIER 3 — Cross-reference dedup:
 *   If a model is already reported by one source, subsequent sources skip it.
 *
 * Detection flow:
 *  1. Poll all active sources every 2 minutes
 *  2. Diff model IDs against last-known set per source
 *  3. Dedup across sources within same cycle
 *  4. New model → instant P0 alert to #model-updates + #rumors-leaks
 */

// ─── Provider prefix → human-readable name mapping ──────────────────────────
const PROVIDER_PREFIXES = [
  { prefix: 'openai/',         name: 'OpenAI' },
  { prefix: 'anthropic/',      name: 'Anthropic' },
  { prefix: 'google/',         name: 'Google' },
  { prefix: 'mistralai/',      name: 'Mistral' },
  { prefix: 'meta-llama/',     name: 'Meta' },
  { prefix: 'meta/',           name: 'Meta' },
  { prefix: 'deepseek/',       name: 'DeepSeek' },
  { prefix: 'cohere/',         name: 'Cohere' },
  { prefix: 'nvidia/',         name: 'NVIDIA' },
  { prefix: 'microsoft/',      name: 'Microsoft' },
  { prefix: 'qwen/',           name: 'Qwen' },
  { prefix: 'x-ai/',           name: 'xAI' },
  { prefix: 'z-ai/',           name: 'Z.ai' },
  { prefix: 'zai-org/',        name: 'Zhipu GLM' },
  { prefix: 'bytedance/',      name: 'ByteDance' },
  { prefix: 'bytedance-seed/', name: 'ByteDance' },
  { prefix: 'ai21/',           name: 'AI21' },
  { prefix: 'amazon/',         name: 'Amazon' },
  { prefix: 'perplexity/',     name: 'Perplexity' },
  { prefix: 'together/',       name: 'Together' },
  { prefix: 'fireworks/',      name: 'Fireworks' },
  { prefix: 'minimax/',        name: 'MiniMax' },
  { prefix: '01-ai/',          name: '01.AI' },
  { prefix: 'moonshot/',       name: 'Moonshot' },
  { prefix: 'baichuan/',       name: 'Baichuan' },
  { prefix: 'stepfun/',        name: 'Stepfun' },
  { prefix: 'zhipu/',          name: 'Zhipu GLM' },
  { prefix: 'siliconflow/',    name: 'SiliconFlow' },
  { prefix: 'cerebras/',       name: 'Cerebras' },
  { prefix: 'sambanova/',      name: 'Sambanova' },
  { prefix: 'groq/',           name: 'Groq' },
  { prefix: 'alibaba/',        name: 'Alibaba' },
  { prefix: 'tencent/',        name: 'Tencent' },
  { prefix: 'amd/',            name: 'AMD' },
  { prefix: 'inflection/',     name: 'Inflection' },
  { prefix: 'databricks/',     name: 'Databricks' },
  { prefix: 'snowflake/',      name: 'Snowflake' },
  { prefix: 'nous/',           name: 'Nous Research' },
  { prefix: 'mancer/',         name: 'Mancer' },
  { prefix: 'neversleep/',     name: 'NeverSleep' },
];

function identifyProvider(modelId) {
  const lower = modelId.toLowerCase();
  for (const { prefix, name } of PROVIDER_PREFIXES) {
    if (lower.startsWith(prefix)) return name;
  }
  const slashIdx = modelId.indexOf('/');
  if (slashIdx > 0) return modelId.substring(0, slashIdx);
  return 'Unknown';
}

class APIModelsAdapter extends BaseAdapter {
  constructor() {
    super('API Model Registry', 'api-models', 0);
    this.knownModels = {};    // { sourceName: Set<modelId> }
    this.initialized = {};    // { sourceName: boolean }
    this.reportedThisCycle = null; // Set<normalizedId> — cross-source dedup per check()
    this._stateLoaded = false;
  }

  async check() {
    this._ensureStateLoaded();

    const items = [];
    this.reportedThisCycle = new Set();

    // ── TIER 1: Free Aggregators ────────────────────────────────────────
    const aggregatorPromises = FREE_MODEL_AGGREGATORS.map(async (agg) => {
      try {
        return await this._checkAggregator(agg);
      } catch (error) {
        logger.warn(`[API Models] ${agg.name} aggregator failed: ${error.message}`);
        return [];
      }
    });

    const aggResults = await Promise.allSettled(aggregatorPromises);
    for (const r of aggResults) {
      if (r.status === 'fulfilled') items.push(...r.value);
    }

    // ── TIER 2: Direct Provider APIs (key required) ─────────────────────
    const directPromises = API_MODEL_SOURCES.map(async (provider) => {
      if (!provider.envKey || !process.env[provider.envKey]) return [];
      try {
        return await this._checkProvider(provider);
      } catch (error) {
        logger.warn(`[API Models] ${provider.name} direct check failed: ${error.message}`);
        return [];
      }
    });

    const directResults = await Promise.allSettled(directPromises);
    for (const r of directResults) {
      if (r.status === 'fulfilled') items.push(...r.value);
    }

    this.reportedThisCycle = null;
    return items;
  }

  // ─── TIER 1: Aggregator check (OpenRouter, NovitaAI, Sambanova, etc) ───

  async _checkAggregator(agg) {
    const items = [];
    const sourceName = agg.name;
    const headers = { 'User-Agent': 'ModelLookerBot/1.0', ...(agg.headers || {}) };

    // Inject optional auth (e.g. OpenRouter key for better rate limits)
    if (agg.envKey && process.env[agg.envKey]) {
      const key = process.env[agg.envKey];
      if (agg.authStyle === 'x-api-key') {
        headers['x-api-key'] = key;
      } else {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }

    const response = await http.get(agg.url, {
      headers,
      params: agg.params || {},
      timeout: 20000,
    });

    const models = agg.parseResponse(response.data);
    if (!Array.isArray(models) || models.length === 0) {
      logger.warn(`[API Models] ${sourceName} returned empty response`);
      return items;
    }

    const currentSet = new Set(models.map((m) => m.id));
    const currentNormalized = this._mapIdSet(currentSet, (id) => this._normalizeId(id));
    const currentFamilies = this._mapIdSet(currentSet, (id) => this._getCanonicalFamilyId(id));

    // First run: seed silently
    if (!this.initialized[sourceName]) {
      this.knownModels[sourceName] = currentSet;
      this.initialized[sourceName] = true;
      this._persistKnownModels();
      logger.info(`[API Models] ${sourceName}: seeded ${currentSet.size} models`);
      return items;
    }

    const previousSet = this.knownModels[sourceName] || new Set();
    const previousNormalized = this._mapIdSet(previousSet, (id) => this._normalizeId(id));
    const previousFamilies = this._mapIdSet(previousSet, (id) => this._getCanonicalFamilyId(id));

    // Detect new models
    for (const model of models) {
      const normalizedId = this._normalizeId(model.id);
      const canonicalFamilyId = this._getCanonicalFamilyId(model.id);

      if (previousSet.has(model.id) || previousNormalized.has(normalizedId)) continue;
      if (this._isDateVariant(model.id, previousFamilies)) {
        previousSet.add(model.id);
        previousNormalized.add(normalizedId);
        previousFamilies.add(canonicalFamilyId);
        continue;
      }

      // Cross-source dedup
      const dedupId = canonicalFamilyId || normalizedId;
      if (this.reportedThisCycle?.has(dedupId)) {
        previousSet.add(model.id);
        previousNormalized.add(normalizedId);
        previousFamilies.add(canonicalFamilyId);
        continue;
      }
      this.reportedThisCycle?.add(dedupId);

      const provider = model.provider || identifyProvider(model.id);
      const shortId = model.id.includes('/') ? model.id.split('/').pop() : model.id;
      const displayName = model.name || shortId;

      logger.info(`[API Models] 🆕 NEW via ${sourceName}: ${model.id} (${provider})`);

      items.push({
        title: `🆕 New ${provider} Model: ${displayName}`,
        description: this._buildDescription(model, provider, sourceName),
        url: model.url || agg.modelUrl?.(model.id) || `https://openrouter.ai/models/${model.id}`,
        sourceName: `API Models: ${provider}`,
        sourceType: 'api-models',
        priority: 0,
        tags: ['new-model', 'api-live', provider.toLowerCase(), shortId],
        publishedAt: model.created ? new Date(model.created * 1000) : new Date(),
        needsTranslation: false,
      });
    }

    // Detect removals
    for (const modelId of previousSet) {
      const normalizedId = this._normalizeId(modelId);
      const canonicalFamilyId = this._getCanonicalFamilyId(modelId);

      if (!currentSet.has(modelId) && !currentNormalized.has(normalizedId) && !currentFamilies.has(canonicalFamilyId)) {
        const provider = identifyProvider(modelId);
        const shortId = modelId.includes('/') ? modelId.split('/').pop() : modelId;

        items.push({
          title: `❌ Model Removed: ${provider} - ${shortId}`,
          description: `Model \`${modelId}\` has been **removed** from ${sourceName}.\n\nThis may indicate deprecation or replacement.`,
          url: agg.modelUrl?.(modelId) || `https://openrouter.ai/models/${modelId}`,
          sourceName: `API Models: ${provider}`,
          sourceType: 'api-models',
          priority: 2,
          tags: ['model-removed', 'api-deprecation', provider.toLowerCase(), shortId],
          publishedAt: new Date(),
          needsTranslation: false,
        });
      }
    }

    this.knownModels[sourceName] = currentSet;
    this._persistKnownModels();
    return items;
  }

  // ─── TIER 2: Direct provider check (key required, fastest) ─────────────

  async _checkProvider(provider) {
    const items = [];
    const headers = { 'User-Agent': 'ModelLookerBot/1.0', ...(provider.headers || {}) };
    const params = { ...(provider.params || {}) };

    const key = process.env[provider.envKey];
    if (provider.authStyle === 'x-api-key') {
      headers['x-api-key'] = key;
    } else if (provider.authStyle === 'query') {
      params.key = key;
    } else {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const response = await http.get(provider.url, { headers, timeout: 15000, params });
    const currentModels = provider.parseModels(response.data);
    if (!currentModels || currentModels.length === 0) return items;

    const currentSet = new Set(currentModels);
    const currentNormalized = this._mapIdSet(currentSet, (id) => this._normalizeId(id));
    const currentFamilies = this._mapIdSet(currentSet, (id) => this._getCanonicalFamilyId(id));
    const sourceName = `direct-${provider.name}`;

    if (!this.initialized[sourceName]) {
      this.knownModels[sourceName] = currentSet;
      this.initialized[sourceName] = true;
      this._persistKnownModels();
      logger.info(`[API Models] ${provider.name} (direct): seeded ${currentSet.size} models`);
      return items;
    }

    const previousSet = this.knownModels[sourceName] || new Set();
    const previousNormalized = this._mapIdSet(previousSet, (id) => this._normalizeId(id));
    const previousFamilies = this._mapIdSet(previousSet, (id) => this._getCanonicalFamilyId(id));

    for (const modelId of currentModels) {
      const normalizedId = this._normalizeId(modelId);
      const canonicalFamilyId = this._getCanonicalFamilyId(modelId);

      if (previousSet.has(modelId) || previousNormalized.has(normalizedId)) continue;
      if (this._isDateVariant(modelId, previousFamilies)) {
        previousSet.add(modelId);
        previousNormalized.add(normalizedId);
        previousFamilies.add(canonicalFamilyId);
        continue;
      }

      // Cross-source dedup
      const dedupId = canonicalFamilyId || normalizedId;
      if (this.reportedThisCycle?.has(dedupId)) {
        previousSet.add(modelId);
        previousNormalized.add(normalizedId);
        previousFamilies.add(canonicalFamilyId);
        continue;
      }
      this.reportedThisCycle?.add(dedupId);

      logger.info(`[API Models] 🆕 NEW via ${provider.name} (direct): ${modelId}`);

      items.push({
        title: `🆕 New ${provider.name} Model: ${modelId}`,
        description: `A new model \`${modelId}\` has just appeared in the **${provider.name} API** (direct detection).\n\nThis model is now live and callable. It may not yet be officially announced.`,
        url: provider.modelUrl(modelId),
        sourceName: `API Models: ${provider.name}`,
        sourceType: 'api-models',
        priority: 0,
        tags: ['new-model', 'api-live', provider.name.toLowerCase(), modelId],
        publishedAt: new Date(),
        needsTranslation: false,
      });
    }

    // Detect removals
    for (const modelId of previousSet) {
      const normalizedId = this._normalizeId(modelId);
      const canonicalFamilyId = this._getCanonicalFamilyId(modelId);

      if (!currentSet.has(modelId) && !currentNormalized.has(normalizedId) && !currentFamilies.has(canonicalFamilyId)) {
        logger.info(`[API Models] ❌ REMOVED from ${provider.name}: ${modelId}`);
        items.push({
          title: `❌ Model Removed: ${provider.name} - ${modelId}`,
          description: `Model \`${modelId}\` has been **removed** from the ${provider.name} API.\n\nThis may indicate deprecation or replacement.`,
          url: provider.docsUrl || provider.modelUrl(modelId),
          sourceName: `API Models: ${provider.name}`,
          sourceType: 'api-models',
          priority: 2,
          tags: ['model-removed', 'api-deprecation', provider.name.toLowerCase(), modelId],
          publishedAt: new Date(),
          needsTranslation: false,
        });
      }
    }

    this.knownModels[sourceName] = currentSet;
    this._persistKnownModels();
    return items;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  _buildDescription(model, provider, sourceName) {
    const parts = [`A new model has just appeared on **${provider}** (detected via ${sourceName}).`];

    if (model.context_length) {
      parts.push(`Context: ${(model.context_length / 1000).toFixed(0)}K tokens`);
    }
    if (model.pricing) {
      const prompt = model.pricing.prompt
        ? `$${(parseFloat(model.pricing.prompt) * 1_000_000).toFixed(2)}/M`
        : '?';
      const completion = model.pricing.completion
        ? `$${(parseFloat(model.pricing.completion) * 1_000_000).toFixed(2)}/M`
        : '?';
      parts.push(`Pricing: ${prompt} input / ${completion} output`);
    }
    if (model.description) {
      parts.push(`\n> ${model.description.slice(0, 200)}`);
    }

    parts.push('\nThis model is now live and callable via the API. It may not yet be officially announced.');
    return parts.join('\n');
  }

  _ensureStateLoaded() {
    if (this._stateLoaded) return;

    const persisted = this.loadState('known-models', {});
    if (persisted && typeof persisted === 'object') {
      for (const [sourceName, modelIds] of Object.entries(persisted)) {
        const ids = Array.isArray(modelIds) ? modelIds.filter(Boolean) : [];
        this.knownModels[sourceName] = new Set(ids);
        this.initialized[sourceName] = ids.length > 0;
      }
    }

    this._stateLoaded = true;
  }

  _persistKnownModels() {
    const serialized = Object.fromEntries(
      Object.entries(this.knownModels).map(([sourceName, modelIds]) => [sourceName, [...modelIds]])
    );
    this.saveState('known-models', serialized);
  }

  /** Normalize model ID for cross-source dedup (strip provider prefix, lowercase) */
  _normalizeId(modelId) {
    const segments = String(modelId || '').toLowerCase().trim().split('/');
    const base = segments[segments.length - 1] || '';
    return base.replace(/[^a-z0-9._-]/g, '');
  }

  _getCanonicalFamilyId(modelId) {
    const normalizedId = this._normalizeId(modelId);
    return normalizedId.replace(/(?:-|_)?20\d{2}(?:-?\d{2}){2}$/, '');
  }

  _mapIdSet(ids, mapper) {
    const mapped = new Set();
    for (const id of ids) {
      const value = mapper(id);
      if (value) mapped.add(value);
    }
    return mapped;
  }

  /**
   * Check if a model ID is just a date-suffixed variant of an already-known model.
   * e.g., "gpt-4o-2025-03-01" when "gpt-4o" or "gpt-4o-2024-11-20" is known.
   */
  _isDateVariant(modelId, knownFamilies) {
    const normalizedId = this._normalizeId(modelId);
    const canonicalFamilyId = this._getCanonicalFamilyId(modelId);
    return canonicalFamilyId !== normalizedId && knownFamilies.has(canonicalFamilyId);
  }
}

module.exports = APIModelsAdapter;
