const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');
const { computeDeliveryDecision } = require('../../src/services/intelligence/delivery-policy');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('delivery policy routes structured classifier outputs to the right channels', () => {
  const temp = createTempDbPath('delivery-policy');
  db.init({ dbPath: temp.dbPath });

  try {
    db.recordSourceReliabilityScore({
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      overallScore: 0.9,
      freshnessScore: 0.9,
      precisionScore: 0.9,
      stabilityScore: 0.9,
      noiseScore: 0.9,
      asOf: new Date().toISOString(),
    });

    const decision = computeDeliveryDecision({
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
      eventConfidence: 0.92,
      classification: {
        label: 'official_release',
        confidence: 0.95,
      },
    });

    assert.equal(decision.channelKey, 'major-releases');
    assert.equal(decision.breakingCandidate, true);

    const rumorDecision = computeDeliveryDecision({
      sourceName: 'SDK Watch',
      sourceType: 'sdk-tracker',
      priority: 2,
      eventConfidence: 0.55,
      classification: {
        label: 'rumor_or_leak',
        confidence: 0.7,
      },
    });

    assert.equal(rumorDecision.channelKey, 'rumors-leaks');
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
