const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');
const { classifyItem } = require('../../src/services/classification/classifier');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('classifier falls back to structured keyword output and reuses cache', async () => {
  const temp = createTempDbPath('classifier');
  const previousEnabled = process.env.CLASSIFIER_ENABLED;
  db.init({ dbPath: temp.dbPath });
  process.env.CLASSIFIER_ENABLED = 'false';

  try {
    const item = {
      title: 'Anthropic announces Claude 4 model release',
      description: 'New multimodal model now available through the API',
      sourceName: 'Community',
      sourceType: 'reddit',
      priority: 3,
      url: 'https://example.com/claude-4',
    };

    const first = await classifyItem(item);
    assert.equal(first.providerUsed, 'keyword');
    assert.equal(first.label === 'irrelevant', false);

    const second = await classifyItem(item);
    assert.equal(second.cacheHit, true);
    assert.equal(second.providerUsed, 'keyword');
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.CLASSIFIER_ENABLED;
    } else {
      process.env.CLASSIFIER_ENABLED = previousEnabled;
    }
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
