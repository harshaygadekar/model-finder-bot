const { calculateRelevance, RELEVANCE_THRESHOLD } = require('../config/keywords');
const logger = require('./logger');

/**
 * Filter items based on source type and relevance scoring.
 *
 * - P0 (official lab blogs): Auto-pass — everything from an official blog is relevant.
 * - P1 (platforms): Auto-pass — a new model on HuggingFace/GitHub is inherently relevant.
 * - P2+ (news, reddit, etc.): Apply keyword relevance filtering.
 *
 * @param {Array} items - Items from an adapter
 * @returns {Array} - Filtered items with relevanceScore added
 */
function filterItems(items) {
  return items
    .map((item) => {
      // Auto-pass for high-priority direct sources
      if (item.priority <= 1) {
        return { ...item, relevanceScore: 1.0 };
      }

      // Apply keyword relevance filter for lower-priority sources
      const text = `${item.title} ${item.description}`;
      const { score, matches } = calculateRelevance(text);

      if (score >= RELEVANCE_THRESHOLD) {
        logger.debug(
          `[Filter] PASS (${score.toFixed(2)}): "${item.title.substring(0, 60)}..." [${matches.join(', ')}]`
        );
        return { ...item, relevanceScore: score, matchedKeywords: matches };
      } else {
        logger.debug(
          `[Filter] SKIP (${score.toFixed(2)}): "${item.title.substring(0, 60)}..."`
        );
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { filterItems };
