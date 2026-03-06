const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixtureHtml = fs.readFileSync(
  path.join(__dirname, '..', 'fixtures', 'html', 'scrape-source.html'),
  'utf8'
);

const httpModulePath = require.resolve('../../src/services/http');
const adapterModulePath = require.resolve('../../src/adapters/scrape-adapter');
const originalHttpModule = require.cache[httpModulePath];

test('scrape adapter extracts article links and ignores navigation noise', async () => {
  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      get: async () => ({ data: fixtureHtml }),
    },
  };
  delete require.cache[adapterModulePath];

  const ScrapeAdapter = require('../../src/adapters/scrape-adapter');
  const adapter = new ScrapeAdapter({
    name: 'Fixture Blog',
    url: 'https://example.com/news',
    baseUrl: 'https://example.com',
    linkSelectors: ['a'],
    linkPattern: /\/news\//,
    priority: 0,
    maxItems: 10,
  });

  const items = await adapter.check();

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((item) => item.url),
    [
      'https://example.com/news/claude-4-launch',
      'https://example.com/news/gpt-5-preview',
    ]
  );
  assert.equal(items[0].title, 'Anthropic launches Claude 4');
  assert.equal(items[1].title, 'OpenAI previews GPT-5');
  assert.ok(items.every((item) => item.sourceType === 'scrape'));

  if (originalHttpModule) {
    require.cache[httpModulePath] = originalHttpModule;
  } else {
    delete require.cache[httpModulePath];
  }
  delete require.cache[adapterModulePath];
});
