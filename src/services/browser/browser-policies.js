const DEFAULT_BROWSER_POLICY = {
  timeoutMs: 30000,
  waitUntil: 'networkidle',
  snapshotOnFailure: false,
  contentSelector: null,
  headers: {},
};

const SOURCE_BROWSER_POLICIES = {
  scrape: {
    timeoutMs: 25000,
    waitUntil: 'domcontentloaded',
    snapshotOnFailure: false,
  },
  changelog: {
    timeoutMs: 28000,
    waitUntil: 'domcontentloaded',
    snapshotOnFailure: true,
    contentSelector: 'main, article, body',
  },
  'playground-leak': {
    timeoutMs: 35000,
    waitUntil: 'networkidle',
    snapshotOnFailure: true,
    contentSelector: 'main, body',
  },
};

function getBrowserPolicy(metadata = {}, overrides = {}) {
  const sourcePolicy = SOURCE_BROWSER_POLICIES[metadata.sourceType] || {};
  return {
    ...DEFAULT_BROWSER_POLICY,
    ...sourcePolicy,
    ...overrides,
    headers: {
      ...DEFAULT_BROWSER_POLICY.headers,
      ...(sourcePolicy.headers || {}),
      ...(overrides.headers || {}),
    },
  };
}

module.exports = {
  DEFAULT_BROWSER_POLICY,
  SOURCE_BROWSER_POLICIES,
  getBrowserPolicy,
};
