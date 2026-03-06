const test = require('node:test');
const assert = require('node:assert/strict');

const browserClient = require('../../src/services/browser/browser-client');

test('browser client stays disabled by default and fails clearly when invoked', async () => {
  const previousMode = process.env.BROWSER_MODE;
  delete process.env.BROWSER_MODE;

  try {
    assert.equal(browserClient.isBrowserEnabled(), false);
    await assert.rejects(
      () => browserClient.fetchPage('https://example.com'),
      /Browser transport is disabled/
    );
  } finally {
    if (previousMode === undefined) {
      delete process.env.BROWSER_MODE;
    } else {
      process.env.BROWSER_MODE = previousMode;
    }
  }
});
