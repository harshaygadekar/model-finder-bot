const db = require('../../db/database');
const logger = require('../logger');
const { getCachedClassification } = require('./cache');
const { classifyWithKeywords } = require('./keyword-classifier');
const { classifyWithGroq, isGroqAvailable, DEFAULT_MODEL } = require('./groq-classifier');
const { normalizeClassificationResult } = require('./schema');

let cooldownUntil = 0;

function isClassifierEnabled() {
  return String(process.env.CLASSIFIER_ENABLED || '').toLowerCase() === 'true';
}

function shouldUseGroq(item, keywordResult) {
  if (!isClassifierEnabled() || !isGroqAvailable()) return false;
  if (Date.now() < cooldownUntil) return false;

  const ambiguityMin = Number(process.env.CLASSIFIER_AMBIGUITY_MIN || 0.3);
  const ambiguityMax = Number(process.env.CLASSIFIER_AMBIGUITY_MAX || 0.7);
  const inAmbiguityBand = keywordResult.confidence >= ambiguityMin && keywordResult.confidence <= ambiguityMax;
  const isHighValue = item.priority <= 1;
  const isRumor = keywordResult.label === 'rumor_or_leak';
  return inAmbiguityBand || isHighValue || isRumor;
}

async function classifyItem(item) {
  const startedAt = Date.now();
  const keywordResult = classifyWithKeywords(item);
  const { contentHash, cached } = getCachedClassification(item, Number(process.env.CLASSIFIER_CACHE_TTL_SECONDS || 3600));

  if (cached) {
    return cached;
  }

  if (!shouldUseGroq(item, keywordResult)) {
    db.recordClassifierRun({
      contentHash,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      providerUsed: 'keyword',
      modelName: null,
      status: 'success',
      fallbackUsed: false,
      label: keywordResult.label,
      confidence: keywordResult.confidence,
      latencyMs: Date.now() - startedAt,
      result: keywordResult,
    });
    return keywordResult;
  }

  try {
    const groqResult = await classifyWithGroq(item, keywordResult);
    db.recordClassifierRun({
      contentHash,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      providerUsed: groqResult.providerUsed,
      modelName: DEFAULT_MODEL,
      status: 'success',
      fallbackUsed: false,
      label: groqResult.label,
      confidence: groqResult.confidence,
      latencyMs: Date.now() - startedAt,
      result: groqResult,
    });
    return groqResult;
  } catch (error) {
    if (/rate limit|429/i.test(error.message)) {
      cooldownUntil = Date.now() + (5 * 60 * 1000);
    }

    const fallbackResult = normalizeClassificationResult({
      ...keywordResult,
      fallbackUsed: true,
      providerUsed: 'keyword',
      reasonCodes: [...keywordResult.reasonCodes, 'groq_fallback'],
    });

    db.recordClassifierRun({
      contentHash,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      providerUsed: `groq:${DEFAULT_MODEL}`,
      modelName: DEFAULT_MODEL,
      status: 'failed',
      fallbackUsed: true,
      label: fallbackResult.label,
      confidence: fallbackResult.confidence,
      latencyMs: Date.now() - startedAt,
      result: fallbackResult,
      errorMessage: error.message,
    });
    logger.warn(`[Classifier] Falling back to keyword classification for "${item.title}": ${error.message}`);
    return fallbackResult;
  }
}

module.exports = {
  classifyItem,
  isClassifierEnabled,
  shouldUseGroq,
};
