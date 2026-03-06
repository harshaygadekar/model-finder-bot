const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');
const { runWithRequestContext } = require('../../src/services/network/request-context');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('request client escalates to browser fallback for playground sources', async () => {
  const temp = createTempDbPath('request-client-browser');
  db.init({ dbPath: temp.dbPath });

  const axiosModulePath = require.resolve('axios');
  const browserClientModulePath = require.resolve('../../src/services/browser/browser-client');
  const requestClientModulePath = require.resolve('../../src/services/network/request-client');
  const originalAxiosModule = require.cache[axiosModulePath];
  const originalBrowserClientModule = require.cache[browserClientModulePath];

  let axiosCalls = 0;
  require.cache[axiosModulePath] = {
    id: axiosModulePath,
    filename: axiosModulePath,
    loaded: true,
    exports: async () => {
      axiosCalls += 1;
      const error = new Error('Blocked by protection');
      error.response = {
        status: 403,
        data: 'Cloudflare challenge',
        headers: {},
      };
      throw error;
    },
  };
  require.cache[browserClientModulePath] = {
    id: browserClientModulePath,
    filename: browserClientModulePath,
    loaded: true,
    exports: {
      fetchPage: async () => ({
        status: 200,
        html: '<html><body>rendered</body></html>',
        finalUrl: 'https://example.com/playground',
        title: 'Rendered playground',
      }),
    },
  };
  delete require.cache[requestClientModulePath];

  const { request } = require('../../src/services/network/request-client');

  try {
    const response = await runWithRequestContext(
      {
        sourceName: 'Playground Scraper',
        sourceType: 'playground-leak',
        attemptKind: 'fetch',
      },
      () => request({ url: 'https://example.com/playground', method: 'get' })
    );

    assert.equal(response.status, 200);
    assert.equal(axiosCalls, 1);

    const attempts = db.getRecentCrawlAttempts(5, 'Playground Scraper');
    assert.equal(attempts.length, 2);
    assert.equal(attempts.some((attempt) => attempt.success === 1 && attempt.transport === 'browser'), true);
    assert.equal(attempts.some((attempt) => attempt.fallback_used === 1), true);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });

    if (originalAxiosModule) {
      require.cache[axiosModulePath] = originalAxiosModule;
    } else {
      delete require.cache[axiosModulePath];
    }
    if (originalBrowserClientModule) {
      require.cache[browserClientModulePath] = originalBrowserClientModule;
    } else {
      delete require.cache[browserClientModulePath];
    }
    delete require.cache[requestClientModulePath];
  }
});
