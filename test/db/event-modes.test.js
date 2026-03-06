const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('event mode helpers create, match, boost, and stop active events', () => {
  const temp = createTempDbPath('event-modes');
  db.init({ dbPath: temp.dbPath });

  try {
    const eventMode = db.createEventMode({
      slug: 'neurips-2026',
      title: 'NeurIPS 2026',
      keywords: ['neurips', 'conference keynote'],
      sourceBoosts: ['type:rss', 'OpenAI Blog'],
      startsAt: new Date(Date.now() - 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    assert.equal(eventMode.slug, 'neurips-2026');
    assert.equal(db.getActiveEventModes().length, 1);
    assert.equal(db.getActiveEventBoostForSource('OpenAI Blog', 'rss'), 2);
    assert.equal(db.getActiveEventBoostForSource('Other Source', 'reddit'), 1);

    const matched = db.findMatchingActiveEventMode({
      title: 'NeurIPS conference keynote announces new model',
      description: 'Big launch news',
      tags: ['conference'],
    });
    assert.ok(matched);
    assert.equal(matched.slug, 'neurips-2026');

    const stopped = db.stopEventMode('neurips-2026');
    assert.equal(stopped.status, 'finished');
    assert.equal(db.getActiveEventModes().length, 0);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
