const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');

const articleFixture = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'html', 'enrichment-article.html'),
  'utf8'
);

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('enrichment extracts canonical metadata, summary, and facts for high-value items', async () => {
  const temp = createTempDbPath('enrichment');
  db.init({ dbPath: temp.dbPath });

  const httpModulePath = require.resolve('../../src/services/http');
  const enrichmentModulePath = require.resolve('../../src/services/intelligence/enrichment');
  const originalHttpModule = require.cache[httpModulePath];

  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      get: async () => ({ data: articleFixture }),
    },
  };
  delete require.cache[enrichmentModulePath];

  const { maybeEnrichItem } = require('../../src/services/intelligence/enrichment');

  try {
    const observation = db.recordObservation({
      contentHash: 'obs-enrichment-1',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      title: 'Anthropic launches Claude 4.1',
      description: 'Launch summary',
      url: 'https://example.com/articles/claude-4-1?ref=feed',
      classificationLabel: 'official_release',
      classificationConfidence: 0.95,
      entities: { provider: 'anthropic', modelFamily: 'Claude 4.1' },
      item: { title: 'Anthropic launches Claude 4.1' },
    });

    const enriched = await maybeEnrichItem({
      title: 'Anthropic launches Claude 4.1',
      description: 'Launch summary',
      url: 'https://example.com/articles/claude-4-1?ref=feed',
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
      observationId: observation.id,
      classification: { entities: { provider: 'anthropic', modelFamily: 'Claude 4.1' } },
    });

    assert.equal(enriched.enrichment.canonical_url, 'https://example.com/articles/claude-4-1');
    assert.equal(enriched.enrichment.facts.length >= 2, true);
    assert.equal(typeof enriched.enrichment.summary, 'string');
    assert.equal(db.getArticleEnrichment(observation.id) !== null, true);
  } finally {
    if (originalHttpModule) {
      require.cache[httpModulePath] = originalHttpModule;
    } else {
      delete require.cache[httpModulePath];
    }
    delete require.cache[enrichmentModulePath];
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
