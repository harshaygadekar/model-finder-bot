const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');
const { recordObservationAndEvent } = require('../../src/services/intelligence/corroboration');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('breaking digest candidates return recent confirmed events and honor dispatch tracking', () => {
  const temp = createTempDbPath('breaking-digest');
  db.init({ dbPath: temp.dbPath });

  try {
    const classification = {
      label: 'official_release',
      confidence: 0.92,
      entities: {
        provider: 'anthropic',
        modelFamily: 'Claude 4.1',
      },
    };

    const first = recordObservationAndEvent({
      title: 'Anthropic launches Claude 4.1',
      description: 'Official release post',
      url: 'https://example.com/claude-4-1',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
    }, classification);

    recordObservationAndEvent({
      title: 'Claude 4.1 launch confirmed by SDK update',
      description: 'Independent confirmation',
      url: 'https://example.com/claude-4-1-sdk',
      sourceName: 'SDK Watch',
      sourceType: 'sdk-tracker',
      priority: 2,
    }, classification);

    const candidates = db.getRecentDigestCandidateEvents({ hours: 6, minConfidence: 0.7, limit: 5, digestType: 'breaking' });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, first.event.id);

    db.markEventDigestDispatched([first.event.id], 'breaking');
    const afterDispatch = db.getRecentDigestCandidateEvents({ hours: 6, minConfidence: 0.7, limit: 5, digestType: 'breaking' });
    assert.equal(afterDispatch.length, 0);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
