const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const anthropicFixture = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'html', 'anthropic-news.html'),
  'utf8'
);

const httpModulePath = require.resolve('../../src/services/http');
const adapterModulePath = require.resolve('../../src/adapters/scrape-adapter');
const originalHttpModule = require.cache[httpModulePath];

test('scrape adapter uses domain recipe extraction for high-value sources', async () => {
  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      get: async () => ({ data: anthropicFixture }),
    },
  };
  delete require.cache[adapterModulePath];

  const ScrapeAdapter = require('../../src/adapters/scrape-adapter');

  try {
    const adapter = new ScrapeAdapter({
      name: 'Anthropic Blog',
      url: 'https://www.anthropic.com/news',
      baseUrl: 'https://www.anthropic.com',
      linkSelectors: ['a'],
      linkPattern: /\/news\//,
      recipeKey: 'anthropic-news',
      priority: 0,
      maxItems: 10,
    });

    const items = await adapter.check();

    assert.equal(items.length, 2);
    assert.equal(items[0].tags.includes('anthropic'), true);
    assert.equal(items[0].url, 'https://www.anthropic.com/news/claude-4-1');
    assert.equal(items[1].title, 'Constitutional Classifiers now available');
  } finally {
    if (originalHttpModule) {
      require.cache[httpModulePath] = originalHttpModule;
    } else {
      delete require.cache[httpModulePath];
    }
    delete require.cache[adapterModulePath];
  }
});
