const {
  calculateRelevance,
  RELEVANCE_THRESHOLD,
  LAB_NAMES,
  MODEL_NAME_PATTERNS,
  CHINESE_MODEL_PATTERNS,
} = require('../../config/keywords');
const { normalizeClassificationResult } = require('./schema');

function classifyWithKeywords(item) {
  const text = `${item.title || ''} ${item.description || ''}`.trim();
  const { score, matches } = calculateRelevance(text);
  const lower = text.toLowerCase();
  const reasonCodes = [...matches];
  const entities = extractEntities(text);

  let label = 'irrelevant';
  if (item.sourceType === 'arxiv' || item.sourceType === 'paper') {
    label = 'research_paper';
  } else if (item.sourceType === 'playground-leak' || /\b(leak|rumor|insider|unreleased)\b/i.test(text)) {
    label = 'rumor_or_leak';
  } else if (/\bbenchmark|arena|leaderboard\b/i.test(text)) {
    label = 'benchmark_update';
  } else if (/\bsdk|client|package|npm|pypi\b/i.test(text)) {
    label = 'sdk_signal';
  } else if (/\bapi\b/i.test(text) && /\bavailable|launch|released|general availability\b/i.test(text)) {
    label = 'api_availability';
  } else if (/\brelease|launch|announce|introduc|available\b/i.test(text)) {
    label = item.priority <= 1 ? 'official_release' : 'model_update';
  } else if (score >= RELEVANCE_THRESHOLD) {
    label = 'general_ai_news';
  }

  const priorityHint = item.priority <= 1 || score >= 0.75 ? 'high' : (score >= RELEVANCE_THRESHOLD ? 'normal' : 'low');
  const majorEventRelated = /\b(keynote|conference|summit|io|wwdc|neurips|iclr)\b/i.test(text);

  return normalizeClassificationResult({
    label,
    confidence: item.priority <= 1 ? 1 : score,
    reasonCodes,
    entities,
    priorityHint,
    fallbackUsed: false,
    providerUsed: 'keyword',
    majorEventRelated,
  });
}

function extractEntities(text) {
  const lower = text.toLowerCase();
  const provider = LAB_NAMES.find((lab) => lower.includes(lab)) || null;
  const modelFamily = findFirstMatch(text, MODEL_NAME_PATTERNS) || findFirstMatch(text, CHINESE_MODEL_PATTERNS) || null;
  const releaseSurface = /github/i.test(text)
    ? 'github'
    : (/api/i.test(text) ? 'api' : (/blog|news|changelog/i.test(text) ? 'blog' : null));

  return {
    provider,
    modelFamily,
    modelId: modelFamily,
    releaseSurface,
  };
}

function findFirstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

module.exports = {
  classifyWithKeywords,
};
