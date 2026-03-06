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

test('corroboration groups similar observations into a shared event and upgrades confidence', () => {
  const temp = createTempDbPath('corroboration');
  db.init({ dbPath: temp.dbPath });

  try {
    const classification = {
      label: 'official_release',
      confidence: 0.82,
      entities: {
        provider: 'anthropic',
        modelFamily: 'Claude 4',
      },
    };

    const first = recordObservationAndEvent({
      title: 'Anthropic launches Claude 4',
      description: 'Official launch post',
      url: 'https://example.com/claude-4',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
    }, classification);

    const second = recordObservationAndEvent({
      title: 'Claude 4 launch covered by developer news',
      description: 'Independent confirmation',
      url: 'https://example.com/claude-4-news',
      sourceName: 'Developer News',
      sourceType: 'reddit',
      priority: 3,
    }, classification);

    assert.equal(first.event.event_key, second.event.event_key);
    assert.equal(second.stats.distinctSources, 2);
    assert.equal(second.event.status, 'confirmed');
    assert.ok(Number(second.event.confidence_score) >= Number(first.event.confidence_score));
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('corroboration keeps multi-source rumors provisional until an official confirmation arrives', () => {
  const temp = createTempDbPath('corroboration-rumors');
  db.init({ dbPath: temp.dbPath });

  try {
    const classification = {
      label: 'rumor_or_leak',
      confidence: 0.72,
      entities: {
        provider: 'openai',
        modelFamily: 'GPT-5',
      },
    };

    const first = recordObservationAndEvent({
      title: 'GPT-5 leak surfaces on a forum',
      description: 'Unverified chatter',
      url: 'https://example.com/gpt5-rumor-1',
      sourceName: 'Forum A',
      sourceType: 'reddit',
      priority: 3,
    }, classification);

    const second = recordObservationAndEvent({
      title: 'Another GPT-5 leak report',
      description: 'Still unverified',
      url: 'https://example.com/gpt5-rumor-2',
      sourceName: 'Forum B',
      sourceType: 'reddit',
      priority: 3,
    }, classification);

    assert.equal(first.event.status, 'provisional');
    assert.equal(second.stats.distinctSources, 2);
    assert.equal(second.event.status, 'provisional');
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
