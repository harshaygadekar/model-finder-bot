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

test('timeline queries expose recent events and top reliable sources', () => {
  const temp = createTempDbPath('timeline');
  db.init({ dbPath: temp.dbPath });

  try {
    recordObservationAndEvent({
      title: 'Anthropic launches Claude 4.1',
      description: 'Official release post',
      url: 'https://example.com/claude-4-1',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
    }, {
      label: 'official_release',
      confidence: 0.94,
      entities: { provider: 'anthropic', modelFamily: 'Claude 4.1' },
    });

    recordObservationAndEvent({
      title: 'GPT-5 leak chatter on community forums',
      description: 'Still unverified',
      url: 'https://example.com/gpt5-rumor',
      sourceName: 'Forum A',
      sourceType: 'reddit',
      priority: 3,
    }, {
      label: 'rumor_or_leak',
      confidence: 0.72,
      entities: { provider: 'openai', modelFamily: 'GPT-5' },
    });

    recordObservationAndEvent({
      title: 'Anthropic is hiring a finance manager',
      description: 'Careers update and company news',
      url: 'https://example.com/careers',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
    }, {
      label: 'irrelevant',
      confidence: 1,
      entities: { provider: 'anthropic', modelFamily: null },
    });

    const timeline = db.getRecentEventTimeline(5, 24 * 7);
    const topSources = db.getTopReliableSources(5);

    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].title, 'Anthropic launches Claude 4.1');
    assert.equal(topSources.length >= 1, true);
    assert.equal(topSources.some((source) => source.source_name === 'Anthropic Blog'), true);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
