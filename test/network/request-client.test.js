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

test('request client switches to fallback strategy for protected scrape sources', async () => {
  const temp = createTempDbPath('request-client');
  db.init({ dbPath: temp.dbPath });

  const axiosModulePath = require.resolve('axios');
  const requestClientModulePath = require.resolve('../../src/services/network/request-client');
  const originalAxiosModule = require.cache[axiosModulePath];

  let callCount = 0;
  require.cache[axiosModulePath] = {
    id: axiosModulePath,
    filename: axiosModulePath,
    loaded: true,
    exports: async (config) => {
      callCount += 1;
      if (callCount === 1) {
        const error = new Error('Blocked by Cloudflare');
        error.response = {
          status: 403,
          data: 'Cloudflare bot protection',
          headers: {},
        };
        throw error;
      }

      return {
        status: 200,
        data: '<html>ok</html>',
        config,
      };
    },
  };
  delete require.cache[requestClientModulePath];

  const { request } = require('../../src/services/network/request-client');

  try {
    const response = await runWithRequestContext(
      {
        sourceName: 'Fallback Source',
        sourceType: 'scrape',
        attemptKind: 'fetch',
      },
      () => request({ url: 'https://example.com/protected', method: 'get' })
    );

    assert.equal(response.status, 200);
    assert.equal(callCount, 2);
    assert.equal(response.config.headers['Cache-Control'], 'no-cache');
    assert.equal(response.config.transport, undefined);

    const attempts = db.getRecentCrawlAttempts(5, 'Fallback Source');
    assert.equal(attempts.length, 2);
    assert.equal(attempts.some((attempt) => attempt.success === 1 && attempt.fallback_used === 1), true);
    assert.equal(attempts.some((attempt) => attempt.error_type === 'bot_protection'), true);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });

    if (originalAxiosModule) {
      require.cache[axiosModulePath] = originalAxiosModule;
    } else {
      delete require.cache[axiosModulePath];
    }
    delete require.cache[requestClientModulePath];
  }
});
