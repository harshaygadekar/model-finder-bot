const DEFAULT_BUCKET_INTERVALS_MS = {
  default: 0,
  rss: 250,
  api: 250,
  html: 500,
  scrape: 750,
  changelog: 1000,
  playground: 1000,
  arxiv: 3500,
};

const bucketState = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBucketState(bucketName) {
  if (!bucketState.has(bucketName)) {
    bucketState.set(bucketName, {
      queue: Promise.resolve(),
      lastRunAt: 0,
    });
  }

  return bucketState.get(bucketName);
}

async function withRateLimit(bucketName = 'default', minIntervalMs, task) {
  const resolvedInterval = Number.isFinite(minIntervalMs)
    ? Math.max(0, minIntervalMs)
    : (DEFAULT_BUCKET_INTERVALS_MS[bucketName] ?? DEFAULT_BUCKET_INTERVALS_MS.default);

  if (resolvedInterval === 0) {
    return task();
  }

  const state = getBucketState(bucketName);
  const previous = state.queue;
  let release;
  state.queue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;

  const waitMs = Math.max(0, resolvedInterval - (Date.now() - state.lastRunAt));
  if (waitMs > 0) {
    await sleep(waitMs);
  }

  state.lastRunAt = Date.now();

  try {
    return await task();
  } finally {
    release();
  }
}

module.exports = {
  DEFAULT_BUCKET_INTERVALS_MS,
  withRateLimit,
};