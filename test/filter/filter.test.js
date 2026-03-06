const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { filterItems } = require('../../src/services/filter');
const db = require('../../src/db/database');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('filterItems auto-passes high priority sources', async () => {
  const temp = createTempDbPath('filter-high-priority');
  db.init({ dbPath: temp.dbPath });

  try {
    const items = await filterItems([
      {
        title: 'Totally unrelated but from an official feed',
        description: 'No model keywords here',
        priority: 0,
        sourceType: 'rss',
        sourceName: 'Official Feed',
      },
    ]);

    assert.equal(items.length, 1);
    assert.equal(items[0].relevanceScore, 1);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('filterItems keeps relevant lower-priority AI release signals', async () => {
  const temp = createTempDbPath('filter-relevant');
  db.init({ dbPath: temp.dbPath });

  try {
    const items = await filterItems([
      {
        title: 'Anthropic announces Claude 4 model release',
        description: 'New multimodal model now available via API access',
        priority: 3,
        sourceType: 'reddit',
        sourceName: 'Community',
      },
    ]);

    assert.equal(items.length, 1);
    assert.ok(items[0].relevanceScore >= 0.3);
    assert.equal(items[0].classification.label !== 'irrelevant', true);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test('filterItems drops irrelevant lower-priority chatter', async () => {
  const temp = createTempDbPath('filter-irrelevant');
  db.init({ dbPath: temp.dbPath });

  try {
    const items = await filterItems([
      {
        title: 'We are hiring an engineering manager',
        description: 'Join our infrastructure team this quarter',
        priority: 3,
        sourceType: 'reddit',
        sourceName: 'Community',
      },
    ]);

    assert.equal(items.length, 0);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
