const { classifyItem } = require('./classification/classifier');
const { recordObservationAndEvent } = require('./intelligence/corroboration');
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
async function filterItems(items) {
  const results = await Promise.all(items.map(async (item) => {
    const classification = await classifyItem(item);
    const intelligence = recordObservationAndEvent(item, classification);
    const shouldPass = item.priority <= 1 || classification.label !== 'irrelevant';

    if (shouldPass) {
      logger.debug(
        `[Filter] PASS (${classification.confidence.toFixed(2)}): "${item.title.substring(0, 60)}..." [${classification.label} via ${classification.providerUsed}]`
      );
      return {
        ...item,
        classification,
        observationId: intelligence.observation?.id || null,
        eventId: intelligence.event?.id || null,
        eventKey: intelligence.event?.event_key || null,
        eventStatus: intelligence.event?.status || null,
        eventConfidence: intelligence.event?.confidence_score ?? classification.confidence,
        relevanceScore: classification.confidence,
        matchedKeywords: classification.reasonCodes,
      };
    }

    logger.debug(
      `[Filter] SKIP (${classification.confidence.toFixed(2)}): "${item.title.substring(0, 60)}..." [${classification.label}]`
    );
    return null;
  }));

  return results.filter(Boolean);
}

module.exports = { filterItems };
