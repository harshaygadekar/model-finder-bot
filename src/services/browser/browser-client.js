const logger = require('../logger');
const { writeBrowserSnapshot } = require('./browser-snapshots');

function getBrowserMode() {
  return (process.env.BROWSER_MODE || 'disabled').toLowerCase();
}

function isBrowserEnabled() {
  return getBrowserMode() !== 'disabled';
}

async function loadPlaywrightChromium() {
  try {
    const playwright = require('playwright');
    return playwright.chromium;
  } catch (error) {
    const wrapped = new Error('Playwright is not installed. Set BROWSER_MODE=disabled or install playwright.');
    wrapped.cause = error;
    wrapped.code = 'BROWSER_UNAVAILABLE';
    throw wrapped;
  }
}

async function fetchPage(url, policy = {}) {
  if (!isBrowserEnabled()) {
    const error = new Error('Browser transport is disabled. Set BROWSER_MODE=local to enable it.');
    error.code = 'BROWSER_DISABLED';
    throw error;
  }

  const chromium = await loadPlaywrightChromium();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: policy.headers?.['User-Agent'],
    extraHTTPHeaders: policy.headers,
  });
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: policy.waitUntil || 'networkidle',
      timeout: policy.timeoutMs || 30000,
    });

    if (policy.contentSelector) {
      await page.waitForSelector(policy.contentSelector, {
        timeout: Math.min(policy.timeoutMs || 30000, 10000),
      }).catch(() => null);
    }

    const html = await page.content();
    return {
      status: 200,
      html,
      finalUrl: page.url(),
      title: await page.title(),
      snapshotPath: null,
    };
  } catch (error) {
    const html = await page.content().catch(() => null);
    const snapshotPath = policy.snapshotOnFailure
      ? writeBrowserSnapshot({
          sourceName: policy.sourceName || 'browser-source',
          label: policy.label || 'failure',
          html,
        })
      : null;

    if (snapshotPath) {
      logger.warn(`[Browser] Saved failure snapshot to ${snapshotPath}`);
    }

    throw error;
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

module.exports = {
  getBrowserMode,
  isBrowserEnabled,
  fetchPage,
};