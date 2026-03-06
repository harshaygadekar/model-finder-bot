const db = require('../../db/database');

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function computeSourceReliabilitySnapshot(sourceName, sourceType) {
  const inputs = db.getSourceReliabilityInputs(sourceName);
  const totalObservations = Math.max(1, inputs.totalObservations || 0);
  const precisionScore = inputs.totalEventLinks > 0
    ? clamp((inputs.confirmedEventLinks || 0) / inputs.totalEventLinks)
    : clamp(1 - ((inputs.irrelevantObservations || 0) / totalObservations));
  const noiseScore = clamp(1 - ((inputs.irrelevantObservations || 0) / totalObservations));

  let stabilityScore = 0.6;
  if (inputs.latestHealthMetric?.success_rate != null) {
    stabilityScore = clamp(Number(inputs.latestHealthMetric.success_rate || 0));
  } else if (inputs.sourceStatus?.health_state === 'healthy') {
    stabilityScore = 0.9;
  } else if (inputs.sourceStatus?.health_state === 'warning') {
    stabilityScore = 0.7;
  } else if (inputs.sourceStatus?.health_state === 'degraded') {
    stabilityScore = 0.4;
  }

  const lastSuccessAt = inputs.sourceStatus?.last_success ? new Date(inputs.sourceStatus.last_success).getTime() : null;
  const freshnessScore = lastSuccessAt && (Date.now() - lastSuccessAt) <= (24 * 60 * 60 * 1000)
    ? 0.9
    : (inputs.confirmedEventLinks > 0 ? 0.75 : 0.5);

  const overallScore = clamp(
    (precisionScore * 0.35)
    + (freshnessScore * 0.25)
    + (stabilityScore * 0.25)
    + (noiseScore * 0.15)
  );

  return {
    sourceName,
    sourceType,
    overallScore,
    freshnessScore,
    precisionScore,
    stabilityScore,
    noiseScore,
    segment: sourceType,
    asOf: new Date().toISOString(),
  };
}

function refreshSourceReliabilityScore(sourceName, sourceType) {
  const snapshot = computeSourceReliabilitySnapshot(sourceName, sourceType);
  db.recordSourceReliabilityScore(snapshot);
  return snapshot;
}

function listLatestSourceReliabilityScores() {
  return db.getLatestSourceReliabilityScores();
}

module.exports = {
  computeSourceReliabilitySnapshot,
  refreshSourceReliabilityScore,
  listLatestSourceReliabilityScores,
};