const ARXIV_MIN_INTERVAL_MS = 3500;

const DEFAULT_RETRY_POLICY = {
  retries: 2,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  jitterMs: 250,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

const DEFAULT_POLICY = {
  name: 'default',
  bucket: 'default',
  bucketMinIntervalMs: 0,
  timeoutMs: 10000,
  transport: 'http',
  allowFallback: false,
  fallback: null,
  headers: {
    'User-Agent': 'ModelLookerBot/1.0 (+https://github.com/github/copilot)',
    Accept: '*/*',
  },
  retry: DEFAULT_RETRY_POLICY,
};

const SOURCE_TYPE_POLICIES = {
  rss: {
    name: 'rss',
    bucket: 'rss',
    timeoutMs: 12000,
  },
  github: {
    name: 'github-api',
    bucket: 'api',
    timeoutMs: 15000,
  },
  huggingface: {
    name: 'huggingface-api',
    bucket: 'api',
    timeoutMs: 15000,
  },
  reddit: {
    name: 'reddit-api',
    bucket: 'api',
    timeoutMs: 15000,
  },
  scrape: {
    name: 'html-scrape',
    bucket: 'scrape',
    timeoutMs: 15000,
    allowFallback: true,
    fallback: {
      timeoutMs: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    },
  },
  changelog: {
    name: 'changelog-html',
    bucket: 'changelog',
    timeoutMs: 18000,
    allowFallback: true,
    fallback: {
      timeoutMs: 22000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    },
  },
  leaderboard: {
    name: 'leaderboard-html',
    bucket: 'html',
    timeoutMs: 15000,
  },
  'playground-leak': {
    name: 'playground-html',
    bucket: 'playground',
    timeoutMs: 20000,
    allowFallback: true,
    fallback: {
      transport: 'browser',
      timeoutMs: 25000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    },
  },
  arxiv: {
    name: 'arxiv-api',
    bucket: 'arxiv',
    bucketMinIntervalMs: ARXIV_MIN_INTERVAL_MS,
    timeoutMs: 15000,
    retry: {
      retries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
    },
  },
};

const SOURCE_NAME_OVERRIDES = {
  'API Changelog Monitor': {
    name: 'official-changelog-monitor',
    bucket: 'changelog',
    timeoutMs: 20000,
    allowFallback: true,
  },
  'Playground Scraper': {
    name: 'playground-monitor',
    bucket: 'playground',
    timeoutMs: 20000,
    allowFallback: true,
    fallback: {
      transport: 'browser',
      timeoutMs: 25000,
    },
  },
};

function mergePolicy(basePolicy, policy) {
  return {
    ...basePolicy,
    ...policy,
    headers: {
      ...(basePolicy.headers || {}),
      ...(policy.headers || {}),
    },
    retry: {
      ...(basePolicy.retry || {}),
      ...(policy.retry || {}),
    },
    fallback: {
      ...(basePolicy.fallback || {}),
      ...(policy.fallback || {}),
      headers: {
        ...((basePolicy.fallback && basePolicy.fallback.headers) || {}),
        ...((policy.fallback && policy.fallback.headers) || {}),
      },
    },
  };
}

function getFetchPolicy(metadata = {}, overrides = {}) {
  const sourceTypePolicy = SOURCE_TYPE_POLICIES[metadata.sourceType] || {};
  const sourceNamePolicy = SOURCE_NAME_OVERRIDES[metadata.sourceName] || {};

  const merged = mergePolicy(
    mergePolicy(DEFAULT_POLICY, sourceTypePolicy),
    sourceNamePolicy
  );

  return mergePolicy(merged, {
    name: overrides.policyName || merged.name,
    bucket: overrides.bucket || merged.bucket,
    bucketMinIntervalMs: overrides.bucketMinIntervalMs ?? merged.bucketMinIntervalMs,
    timeoutMs: overrides.timeout ?? overrides.timeoutMs ?? merged.timeoutMs,
    transport: overrides.transport || merged.transport,
    allowFallback: overrides.allowFallback ?? merged.allowFallback,
    headers: overrides.headers || {},
    retry: overrides.retry || {},
  });
}

module.exports = {
  ARXIV_MIN_INTERVAL_MS,
  DEFAULT_RETRY_POLICY,
  DEFAULT_POLICY,
  getFetchPolicy,
};