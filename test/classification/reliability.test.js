const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');
const { recordObservationAndEvent } = require('../../src/services/intelligence/corroboration');
const { refreshSourceReliabilityScore } = require('../../src/services/intelligence/reliability');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('reliability scoring produces reusable source snapshots', () => {
  const temp = createTempDbPath('reliability');
  db.init({ dbPath: temp.dbPath });

  try {
    db.updateSourceStatus('Anthropic Blog', 'rss', true, null, 2, { latencyMs: 1200 });
    recordObservationAndEvent({
      title: 'Anthropic launches Claude 4',
      description: 'Official launch',
      url: 'https://example.com/claude-4',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
    }, {
      label: 'official_release',
      confidence: 0.9,
      entities: { provider: 'anthropic', modelFamily: 'Claude 4' },
    });

    const snapshot = refreshSourceReliabilityScore('Anthropic Blog', 'rss');
    assert.equal(snapshot.sourceName, 'Anthropic Blog');
    assert.ok(snapshot.overallScore > 0.5);
    assert.ok(db.getLatestSourceReliabilityScore('Anthropic Blog'));
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
