const { CHANNEL_MAP } = require('../../config/sources');
const {
  CHANNEL_POLICIES,
  OFFICIAL_SOURCE_TYPES,
  PLATFORM_SOURCE_TYPES,
  COMMUNITY_SOURCE_TYPES,
  BENCHMARK_SOURCE_TYPES,
  RESEARCH_SOURCE_TYPES,
  TALENT_SOURCE_TYPES,
  RUMOR_SOURCE_TYPES,
  CHINA_SOURCE_TYPES,
  RELEASE_SIGNAL_PATTERN,
  MAJOR_TECH_PRODUCT_PATTERN,
  MODEL_FAMILY_PATTERN,
  OPEN_SOURCE_SIGNAL_PATTERN,
  COMMUNITY_SIGNAL_PATTERN,
  RUMOR_SIGNAL_PATTERN,
  EVENT_SIGNAL_PATTERN,
  EVENT_PLANNED_PATTERN,
  EVENT_RECAP_PATTERN,
  CHINA_SIGNAL_PATTERN,
} = require('../../config/channel-policies');
const db = require('../../db/database');

function getTextBlob(item) {
  return [
    item.title,
    item.description,
    item.sourceName,
    item.sourceType,
    Array.isArray(item.tags) ? item.tags.join(' ') : '',
    item.classification?.entities?.provider,
    item.classification?.entities?.modelFamily,
    item.classification?.entities?.modelId,
  ].filter(Boolean).join(' ');
}

function hasTag(item, value) {
  return Array.isArray(item.tags)
    && item.tags.some((tag) => String(tag || '').toLowerCase() === String(value || '').toLowerCase());
}

function hasAnyTag(item, values) {
  return Array.isArray(values) && values.some((value) => hasTag(item, value));
}

function determineSourceKind({ sourceType, priority, isOfficialSource, isCommunitySource, isPlatformSource, isBenchmarkSource, isResearchSource }) {
  if (isResearchSource) return 'paper';
  if (isBenchmarkSource) return 'benchmark';
  if (isCommunitySource) return 'community';
  if (isPlatformSource) return 'platform';
  if (isOfficialSource) return 'official';
  if (sourceType === 'newsletter' || (sourceType === 'rss' && priority >= 2)) return 'newsroom';
  return 'mixed';
}

function isChinaRelated(item, text) {
  if (CHINA_SOURCE_TYPES.has(item.sourceType)) {
    return true;
  }

  return CHINA_SIGNAL_PATTERN.test(text);
}

function determineImpactTier(signals) {
  if (signals.isPlannedEvent || signals.isRecapEvent) {
    return 'major';
  }

  if (signals.sourceType === 'api-models') {
    return 'standard';
  }

  if (
    !signals.isCommunitySource
    && signals.hasReleaseSignal
    && (signals.hasModelSignal || signals.hasMajorTechProductSignal)
    && (signals.isOfficialSource || signals.reliabilityScore >= 0.7 || signals.priority <= 2)
  ) {
    return 'major';
  }

  if (
    (signals.label === 'official_release' || signals.label === 'api_availability')
    && !signals.isCommunitySource
    && (signals.hasModelSignal || signals.hasMajorTechProductSignal)
    && (signals.isOfficialSource || signals.reliabilityScore >= 0.7 || signals.priority <= 2)
  ) {
    return 'major';
  }

  if (
    (signals.label === 'model_update' || signals.isPlatformSource)
    && signals.hasModelSignal
    && signals.isOfficialSource
    && signals.eventConfidence >= 0.85
  ) {
    return 'major';
  }

  if (signals.priority <= 1 || signals.eventConfidence >= 0.75) {
    return 'standard';
  }

  return 'minor';
}

function analyzeRoutingSignals(item, reliabilityScore) {
  const label = item.classification?.label || null;
  const text = getTextBlob(item);
  const sourceType = item.sourceType || 'unknown';
  const priority = Number(item.priority ?? 100);
  const eventConfidence = Number(item.eventConfidence || item.classification?.confidence || 0);
  const isOfficialSource = OFFICIAL_SOURCE_TYPES.has(sourceType);
  const isPlatformSource = PLATFORM_SOURCE_TYPES.has(sourceType);
  const isCommunitySource = COMMUNITY_SOURCE_TYPES.has(sourceType);
  const isBenchmarkSource = BENCHMARK_SOURCE_TYPES.has(sourceType);
  const isResearchSource = RESEARCH_SOURCE_TYPES.has(sourceType);
  const isTalentSource = TALENT_SOURCE_TYPES.has(sourceType);
  const isRumorSource = RUMOR_SOURCE_TYPES.has(sourceType);
  const hasReleaseSignal = RELEASE_SIGNAL_PATTERN.test(text);
  const hasMajorTechProductSignal = MAJOR_TECH_PRODUCT_PATTERN.test(text);
  const hasModelSignal = Boolean(
    item.classification?.entities?.modelFamily
    || item.classification?.entities?.modelId
    || MODEL_FAMILY_PATTERN.test(text)
    || hasAnyTag(item, ['new-model', 'model-removed', 'api-live'])
  );
  const hasEventSignal = Boolean(item.classification?.majorEventRelated) || EVENT_SIGNAL_PATTERN.test(text);
  const isPlannedEvent = hasEventSignal && EVENT_PLANNED_PATTERN.test(text);
  const isRecapEvent = hasEventSignal && EVENT_RECAP_PATTERN.test(text);
  const isLiveEvent = hasEventSignal && !isPlannedEvent && !isRecapEvent;
  const looksLikeOfficialAnnouncement = hasReleaseSignal && (hasModelSignal || hasMajorTechProductSignal || priority <= 1);
  const hasRumorSignal = RUMOR_SIGNAL_PATTERN.test(text);
  const isRumor = label === 'rumor_or_leak'
    || isRumorSource
    || (hasRumorSignal && !looksLikeOfficialAnnouncement && !isOfficialSource);
  const isResearch = label === 'research_paper' || isResearchSource;
  const isBenchmark = label === 'benchmark_update'
    || isBenchmarkSource
    || (sourceType === 'arena-models' && !isRumor);
  const isTalent = isTalentSource;
  const sourceKind = determineSourceKind({
    sourceType,
    priority,
    isOfficialSource,
    isCommunitySource,
    isPlatformSource,
    isBenchmarkSource,
    isResearchSource,
  });
  const chinaRelated = isChinaRelated(item, text);

  const isMajorReleaseCandidate = !isRumor
    && !isCommunitySource
    && !isBenchmark
    && !isResearch
    && !isTalent
    && !isPlannedEvent
    && !isRecapEvent
    && sourceType !== 'api-models'
    && (
      (label === 'official_release' || label === 'api_availability')
      || (hasReleaseSignal && (hasModelSignal || hasMajorTechProductSignal))
    )
    && (isOfficialSource || reliabilityScore >= 0.7 || priority <= 2);

  const isModelUpdateCandidate = !isRumor
    && !isCommunitySource
    && !isBenchmark
    && !isResearch
    && !isTalent
    && !isPlannedEvent
    && !isRecapEvent
    && (
      sourceType === 'api-models'
      || label === 'model_update'
      || label === 'sdk_signal'
      || (label === 'api_availability' && isPlatformSource)
      || isPlatformSource
      || (hasModelSignal && (hasReleaseSignal || sourceType === 'changelog'))
    );

  const isCommunityBuzzCandidate = isCommunitySource
    || (!isOfficialSource && !isPlatformSource && !CHINA_SOURCE_TYPES.has(sourceType) && (COMMUNITY_SIGNAL_PATTERN.test(text) || OPEN_SOURCE_SIGNAL_PATTERN.test(text)));

  const impactTier = determineImpactTier({
    label,
    sourceType,
    priority,
    eventConfidence,
    reliabilityScore,
    isOfficialSource,
    isCommunitySource,
    isPlatformSource,
    isPlannedEvent,
    isRecapEvent,
    hasReleaseSignal,
    hasModelSignal,
    hasMajorTechProductSignal,
  });

  return {
    label,
    sourceType,
    priority,
    text,
    eventConfidence,
    reliabilityScore,
    sourceKind,
    chinaRelated,
    isOfficialSource,
    isPlatformSource,
    isCommunitySource,
    isBenchmark,
    isResearch,
    isRumor,
    isTalent,
    hasModelSignal,
    hasReleaseSignal,
    hasMajorTechProductSignal,
    hasEventSignal,
    isPlannedEvent,
    isRecapEvent,
    isLiveEvent,
    isMajorReleaseCandidate,
    isModelUpdateCandidate,
    isCommunityBuzzCandidate,
    impactTier,
  };
}

function choosePrimaryChannel(signals) {
  if (signals.isTalent) {
    return { channelKey: 'talent-moves', matchedPolicy: 'hard:talent_moves' };
  }

  if (signals.isResearch) {
    return { channelKey: 'research-papers', matchedPolicy: 'hard:research_papers' };
  }

  if (signals.isBenchmark) {
    return { channelKey: 'leaderboard-updates', matchedPolicy: 'hard:leaderboard_updates' };
  }

  if (signals.isRumor) {
    return { channelKey: 'rumors-leaks', matchedPolicy: 'hard:rumors_leaks' };
  }

  if (signals.isPlannedEvent || signals.isRecapEvent) {
    return { channelKey: 'major-events', matchedPolicy: 'event:planned_or_recap' };
  }

  if (signals.isCommunitySource) {
    return { channelKey: 'community-buzz', matchedPolicy: 'community:source_surface' };
  }

  if (signals.sourceType === 'api-models') {
    return { channelKey: 'model-updates', matchedPolicy: 'model_updates:api_registry' };
  }

  if (signals.label === 'sdk_signal') {
    if (signals.eventConfidence >= 0.7 || signals.reliabilityScore >= 0.7) {
      return { channelKey: 'model-updates', matchedPolicy: 'model_updates:sdk_signal_confirmed' };
    }
    return { channelKey: 'rumors-leaks', matchedPolicy: 'rumors:sdk_signal_weak' };
  }

  if (signals.isMajorReleaseCandidate && signals.impactTier === 'major') {
    return { channelKey: 'major-releases', matchedPolicy: 'major_releases:major_release_candidate' };
  }

  if (signals.isModelUpdateCandidate) {
    return { channelKey: 'model-updates', matchedPolicy: 'model_updates:model_signal' };
  }

  if (signals.chinaRelated && (signals.sourceType === 'china-ai' || signals.sourceKind !== 'community')) {
    return { channelKey: 'china-ai', matchedPolicy: 'china_ai:regional_primary' };
  }

  if (signals.isCommunityBuzzCandidate) {
    return { channelKey: 'community-buzz', matchedPolicy: 'community:open_source_or_social' };
  }

  return {
    channelKey: CHANNEL_MAP[signals.sourceType] || 'tech-news',
    matchedPolicy: 'fallback:source_type',
  };
}

function chooseSecondaryChannels(primaryChannelKey, signals) {
  const secondaryChannelKeys = [];

  if (
    primaryChannelKey !== 'major-events'
    && !signals.isRumor
    && signals.hasEventSignal
    && (signals.isPlannedEvent || signals.isRecapEvent || signals.isLiveEvent)
  ) {
    secondaryChannelKeys.push('major-events');
  }

  return secondaryChannelKeys;
}

function computeDeliveryDecision(item) {
  const label = item.classification?.label || null;
  const eventConfidence = Number(item.eventConfidence || item.classification?.confidence || 0);
  const reliabilityScore = Number(db.getLatestSourceReliabilityScore(item.sourceName)?.overall_score || 0.5);
  const signals = analyzeRoutingSignals(item, reliabilityScore);
  const primaryDecision = choosePrimaryChannel(signals);
  const secondaryChannelKeys = chooseSecondaryChannels(primaryDecision.channelKey, signals);
  const channelKey = CHANNEL_POLICIES[primaryDecision.channelKey]
    ? primaryDecision.channelKey
    : (CHANNEL_MAP[item.sourceType] || 'tech-news');
  const breakingCandidate = channelKey === 'major-releases'
    || channelKey === 'rumors-leaks'
    || channelKey === 'major-events'
    || (channelKey === 'model-updates' && signals.impactTier === 'major' && eventConfidence >= 0.85);
  const aggregateCandidate = ['tech-news', 'community-buzz', 'leaderboard-updates', 'research-papers', 'china-ai'].includes(channelKey);

  return {
    channelKey,
    secondaryChannelKeys,
    matchedPolicy: primaryDecision.matchedPolicy,
    label,
    eventConfidence,
    reliabilityScore,
    sourceKind: signals.sourceKind,
    impactTier: signals.impactTier,
    breakingCandidate,
    aggregateCandidate,
    immediate: !aggregateCandidate || item.priority <= 1 || secondaryChannelKeys.length > 0,
  };
}

module.exports = {
  analyzeRoutingSignals,
  computeDeliveryDecision,
};
