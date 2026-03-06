const { CHANNEL_MAP } = require('../../config/sources');
const db = require('../../db/database');

function computeDeliveryDecision(item) {
  const label = item.classification?.label || null;
  const eventConfidence = Number(item.eventConfidence || item.classification?.confidence || 0);
  const reliabilityScore = Number(db.getLatestSourceReliabilityScore(item.sourceName)?.overall_score || 0.5);

  let channelKey = CHANNEL_MAP[item.sourceType] || 'tech-news';
  if (label === 'rumor_or_leak') {
    channelKey = 'rumors-leaks';
  } else if (label === 'research_paper') {
    channelKey = 'research-papers';
  } else if (label === 'benchmark_update') {
    channelKey = 'leaderboard-updates';
  } else if (label === 'sdk_signal') {
    channelKey = eventConfidence >= 0.65 ? 'model-updates' : 'rumors-leaks';
  } else if (label === 'official_release' || label === 'api_availability') {
    channelKey = 'major-releases';
  } else if (label === 'model_update') {
    channelKey = (eventConfidence >= 0.75 || reliabilityScore >= 0.65) ? 'major-releases' : 'model-updates';
  } else if (label === 'general_ai_news') {
    channelKey = reliabilityScore >= 0.6 ? 'tech-news' : (CHANNEL_MAP[item.sourceType] || 'tech-news');
  }

  const breakingCandidate = ['official_release', 'api_availability', 'rumor_or_leak'].includes(label)
    || (label === 'model_update' && eventConfidence >= 0.85);
  const aggregateCandidate = ['general_ai_news', 'benchmark_update', 'research_paper'].includes(label);

  return {
    channelKey,
    label,
    eventConfidence,
    reliabilityScore,
    breakingCandidate,
    aggregateCandidate,
    immediate: !aggregateCandidate || item.priority <= 1,
  };
}

module.exports = {
  computeDeliveryDecision,
};
