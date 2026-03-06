const db = require('../../db/database');
const { buildClassificationHash } = require('../classification/cache');
const { refreshSourceReliabilityScore } = require('./reliability');

const NON_EVENT_LABELS = new Set(['irrelevant']);
const CORROBORATION_CONFIRMABLE_LABELS = new Set([
  'official_release',
  'api_availability',
  'model_update',
  'research_paper',
  'benchmark_update',
  'sdk_signal',
  'general_ai_news',
]);

function canonicalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|and|or|for|with|from|new)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 8)
    .join('-');
}

function buildEventKey(item, classification) {
  const provider = classification.entities?.provider || 'unknown-provider';
  const modelFamily = classification.entities?.modelFamily || canonicalizeTitle(item.title);
  return [classification.label, provider, modelFamily].filter(Boolean).join('::');
}

function isOfficialObservation(item) {
  return Number(item.priority) <= 1 || ['rss', 'github', 'scrape', 'changelog'].includes(item.sourceType);
}

function shouldCreateEvent(classification) {
  return Boolean(classification?.label) && !NON_EVENT_LABELS.has(classification.label);
}

function canOfficiallyConfirm(item, classification) {
  return shouldCreateEvent(classification)
    && classification.label !== 'rumor_or_leak'
    && isOfficialObservation(item);
}

function canConfirmByCorroboration(classification, stats, confidenceScore) {
  if (!shouldCreateEvent(classification)) return false;
  if (!CORROBORATION_CONFIRMABLE_LABELS.has(classification.label)) return false;
  if ((stats?.distinctSources || 0) < 2) return false;
  return Number(confidenceScore || 0) >= 0.65;
}

function computeEventConfidence(classification, distinctSources, officialConfirmed) {
  const base = Number(classification.confidence || 0) * 0.6;
  const sourceBoost = Math.min(0.25, distinctSources * 0.1);
  const officialBoost = officialConfirmed ? 0.15 : 0;
  return Math.max(0, Math.min(1, base + sourceBoost + officialBoost));
}

function recordObservationAndEvent(item, classification) {
  const contentHash = buildClassificationHash(item);
  const observation = db.recordObservation({
    contentHash,
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    title: item.title,
    description: item.description,
    url: item.url,
    classificationLabel: classification.label,
    classificationConfidence: classification.confidence,
    entities: classification.entities,
    item,
  });

  const reliability = refreshSourceReliabilityScore(item.sourceName, item.sourceType);

  if (!shouldCreateEvent(classification)) {
    return {
      observation,
      event: null,
      stats: {
        observationCount: 0,
        distinctSources: 0,
      },
      reliability,
    };
  }

  const eventKey = buildEventKey(item, classification);
  const officialConfirmed = canOfficiallyConfirm(item, classification);
  const existingEvent = db.getEventByKey(eventKey);
  const provisionalEvent = db.upsertEvent({
    eventKey,
    title: item.title,
    eventType: classification.label,
    confidenceScore: classification.confidence,
    firstSeenAt: existingEvent?.first_seen_at || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    officialConfirmationAt: officialConfirmed ? new Date().toISOString() : existingEvent?.official_confirmation_at,
    status: officialConfirmed ? 'confirmed' : 'provisional',
  });

  db.linkObservationToEvent(provisionalEvent.id, observation.id, item.sourceName, classification.confidence);

  const stats = db.getEventObservationStats(provisionalEvent.id);
  const nextConfidenceScore = computeEventConfidence(
    classification,
    stats.distinctSources,
    Boolean(provisionalEvent.official_confirmation_at || officialConfirmed)
  );
  const corroboratedConfirmation = canConfirmByCorroboration(classification, stats, nextConfidenceScore);
  const updatedEvent = db.upsertEvent({
    eventKey,
    title: provisionalEvent.title,
    eventType: provisionalEvent.event_type,
    confidenceScore: nextConfidenceScore,
    firstSeenAt: provisionalEvent.first_seen_at,
    lastSeenAt: new Date().toISOString(),
    officialConfirmationAt: provisionalEvent.official_confirmation_at || (officialConfirmed ? new Date().toISOString() : null),
    status: (officialConfirmed || corroboratedConfirmation) ? 'confirmed' : 'provisional',
  });

  return {
    observation,
    event: updatedEvent,
    stats,
    reliability,
  };
}

module.exports = {
  canonicalizeTitle,
  buildEventKey,
  shouldCreateEvent,
  canOfficiallyConfirm,
  canConfirmByCorroboration,
  recordObservationAndEvent,
};
