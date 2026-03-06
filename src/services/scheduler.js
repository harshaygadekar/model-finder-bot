const { filterItems } = require('./filter');
const { notifyItems, sendStatusMessage } = require('./notifier');
const db = require('../db/database');
const logger = require('./logger');
const { classifyError } = require('./network/error-classifier');
const { runWithRequestContext } = require('./network/request-context');

const runtimeEntries = [];
const INITIAL_STARTUP_CONCURRENCY = 3;
const INITIAL_STARTUP_SPACING_MS = 5000;
const INITIAL_WORKER_STAGGER_MS = 2000;
const HEALTH_BACKOFF_WINDOWS_MS = {
  degraded: 30 * 60 * 1000,
  'disabled-temporarily': 2 * 60 * 60 * 1000,
};
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const SCHEDULER_TICK_MS = 30 * 1000;

let dispatcherTimer = null;

/**
 * Run a single adapter check cycle: fetch → filter → notify.
 */
async function runAdapterCheck(adapter) {
  const name = adapter.getName();
  const sourceType = adapter.getSourceType();
  const startedAt = Date.now();
  const targetUrl = adapter.url || adapter.baseUrl || null;
  const existingStatus = db.getSourceStatus(name);

  if (shouldSkipForHealthBackoff(existingStatus)) {
    logger.warn(`[Scheduler] Skipping ${name} due to ${existingStatus.health_state} backoff window`);
    return {
      status: 'skipped',
      reason: 'health-backoff',
      sourceName: name,
      sourceType,
      healthState: existingStatus.health_state,
    };
  }

  try {
    const rawItems = await runWithRequestContext(
      {
        sourceName: name,
        sourceType,
        transport: 'http',
        attemptKind: 'fetch',
      },
      () => adapter.check()
    );
    const normalizedItems = Array.isArray(rawItems) ? rawItems : [];
    const filteredItems = await filterItems(normalizedItems);
    const { notified, seeded, skippedOld } = await notifyItems(filteredItems, name);

    const latencyMs = Date.now() - startedAt;
    db.recordCrawlAttempt({
      sourceName: name,
      sourceType,
      attemptKind: 'adapter-check',
      targetUrl,
      transport: 'adapter',
      policyName: 'adapter-check',
      success: true,
      latencyMs,
      itemsFound: normalizedItems.length,
      metadata: {
        filteredCount: filteredItems.length,
        queuedCount: notified,
        seeded,
        skippedOld,
      },
    });

    const statusUpdate = db.updateSourceStatus(name, sourceType, true, null, normalizedItems.length, { latencyMs });
    const healthSnapshot = db.snapshotSourceHealth(name, sourceType);
    await maybeSendHealthAlert(name, sourceType, statusUpdate);

    if (notified > 0) {
      logger.info(`[Scheduler] ${name}: ${notified} new notification job(s) queued (${normalizedItems.length} checked)`);
    } else if (seeded > 0) {
      logger.info(`[Scheduler] ${name}: seeded ${seeded} item(s) on first run (no notifications)`);
    }

    return {
      status: 'success',
      sourceName: name,
      sourceType,
      rawCount: normalizedItems.length,
      filteredCount: filteredItems.length,
      queuedCount: notified,
      seededCount: seeded,
      skippedOld,
      latencyMs,
      statusUpdate,
      healthSnapshot,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    db.recordCrawlAttempt({
      sourceName: name,
      sourceType,
      attemptKind: 'adapter-check',
      targetUrl,
      transport: 'adapter',
      policyName: 'adapter-check',
      success: false,
      latencyMs,
      errorType: classifyError(error),
      errorMessage: error.message,
    });
    const statusUpdate = db.updateSourceStatus(name, sourceType, false, error.message, 0, { latencyMs });
    const healthSnapshot = db.snapshotSourceHealth(name, sourceType);
    await maybeSendHealthAlert(name, sourceType, statusUpdate, error);
    logger.error(`[Scheduler] ${name} failed: ${error.message}`);

    return {
      status: 'failed',
      sourceName: name,
      sourceType,
      error,
      latencyMs,
      statusUpdate,
      healthSnapshot,
    };
  }
}

function createRuntimeEntry(adapter, intervalExpression) {
  const baseIntervalMs = parseSimpleCronIntervalToMs(intervalExpression);
  const bounds = deriveAdaptiveBounds(adapter, baseIntervalMs);

  return {
    adapter,
    name: adapter.getName(),
    sourceType: adapter.getSourceType(),
    intervalExpression,
    baseIntervalMs,
    minIntervalMs: bounds.minIntervalMs,
    maxIntervalMs: bounds.maxIntervalMs,
    currentIntervalMs: bounds.initialIntervalMs,
    nextRunAt: Date.now() + baseIntervalMs,
    lastRunAt: null,
    inFlight: false,
  };
}

function deriveAdaptiveBounds(adapter, baseIntervalMs) {
  const priority = Number.isFinite(adapter.getPriority()) ? adapter.getPriority() : 3;

  if (priority <= 1) {
    return {
      minIntervalMs: Math.max(60 * 1000, Math.floor(baseIntervalMs * 0.5)),
      maxIntervalMs: Math.max(baseIntervalMs, Math.floor(baseIntervalMs * 2.5)),
      initialIntervalMs: baseIntervalMs,
    };
  }

  if (priority === 2) {
    return {
      minIntervalMs: Math.max(2 * 60 * 1000, Math.floor(baseIntervalMs * 0.75)),
      maxIntervalMs: Math.max(baseIntervalMs, Math.floor(baseIntervalMs * 3)),
      initialIntervalMs: baseIntervalMs,
    };
  }

  return {
    minIntervalMs: Math.max(3 * 60 * 1000, baseIntervalMs),
    maxIntervalMs: Math.max(baseIntervalMs, Math.floor(baseIntervalMs * 4)),
    initialIntervalMs: baseIntervalMs,
  };
}

function parseSimpleCronIntervalToMs(expression) {
  if (!expression || typeof expression !== 'string') {
    return DEFAULT_INTERVAL_MS;
  }

  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return DEFAULT_INTERVAL_MS;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return Number(minute.slice(2)) * 60 * 1000;
  }

  if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return Number(hour.slice(2)) * 60 * 60 * 1000;
  }

  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 60 * 60 * 1000;
  }

  if (minute === '0' && /^\d+$/.test(hour) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 24 * 60 * 60 * 1000;
  }

  return DEFAULT_INTERVAL_MS;
}

function computeNextIntervalMs(entry, runResult, sourceStatus, eventBoostMultiplier = 1) {
  if (!runResult || runResult.status === 'skipped') {
    return entry.currentIntervalMs;
  }

  const healthState = sourceStatus?.health_state || runResult.statusUpdate?.healthState || 'healthy';
  const baseIntervalMs = entry.baseIntervalMs;

  if (healthState === 'disabled-temporarily') {
    return Math.max(entry.maxIntervalMs, HEALTH_BACKOFF_WINDOWS_MS['disabled-temporarily']);
  }

  let candidate;
  if (healthState === 'degraded') {
    candidate = clampInterval(Math.max(baseIntervalMs * 2, Math.floor(entry.currentIntervalMs * 1.5)), entry);
  } else if (runResult.status === 'failed') {
    candidate = clampInterval(Math.max(baseIntervalMs, Math.floor(entry.currentIntervalMs * 1.5)), entry);
  } else if (runResult.queuedCount > 0) {
    candidate = clampInterval(Math.floor(entry.currentIntervalMs * 0.6), entry);
  } else if (runResult.filteredCount > 0 || runResult.rawCount > 0) {
    candidate = clampInterval(Math.floor(entry.currentIntervalMs * 0.8), entry);
  } else {
    candidate = clampInterval(Math.ceil(entry.currentIntervalMs * 1.2), entry);
  }

  if (eventBoostMultiplier > 1) {
    candidate = clampInterval(Math.floor(candidate / eventBoostMultiplier), entry);
  }

  return candidate;
}

function clampInterval(candidateMs, entry) {
  return Math.max(entry.minIntervalMs, Math.min(entry.maxIntervalMs, candidateMs));
}

async function executeRuntimeEntry(entry) {
  entry.inFlight = true;
  entry.lastRunAt = Date.now();

  try {
    const result = await runAdapterCheck(entry.adapter);
    const latestStatus = db.getSourceStatus(entry.name);
    const eventBoostMultiplier = db.getActiveEventBoostForSource(entry.name, entry.sourceType);
    entry.currentIntervalMs = computeNextIntervalMs(entry, result, latestStatus, eventBoostMultiplier);
    entry.nextRunAt = Date.now() + entry.currentIntervalMs;
    logger.info(
      `[Scheduler] Next run for ${entry.name} in ${Math.round(entry.currentIntervalMs / 60000)} minute(s)`
    );
  } catch (error) {
    entry.currentIntervalMs = clampInterval(Math.ceil(entry.currentIntervalMs * 1.5), entry);
    entry.nextRunAt = Date.now() + entry.currentIntervalMs;
    logger.error(`[Scheduler] Runtime dispatch failed for ${entry.name}: ${error.message}`);
  } finally {
    entry.inFlight = false;
  }
}

async function processDueRuntimeEntries() {
  const now = Date.now();
  const dueEntries = runtimeEntries.filter((entry) => !entry.inFlight && entry.nextRunAt <= now);

  for (const entry of dueEntries) {
    executeRuntimeEntry(entry).catch((error) => {
      logger.error(`[Scheduler] Unexpected runtime entry failure for ${entry.name}: ${error.message}`);
    });
  }
}

function startDispatcher() {
  if (dispatcherTimer) {
    return;
  }

  dispatcherTimer = setInterval(() => {
    processDueRuntimeEntries().catch((error) => {
      logger.error(`[Scheduler] Dispatcher tick failed: ${error.message}`);
    });
  }, SCHEDULER_TICK_MS);

  processDueRuntimeEntries().catch((error) => {
    logger.error(`[Scheduler] Initial dispatcher tick failed: ${error.message}`);
  });
}

/**
 * Schedule an adapter to run at the specified interval expression.
 */
function scheduleAdapter(adapter, intervalExpression) {
  const existing = runtimeEntries.find((entry) => entry.name === adapter.getName());
  if (existing) {
    return existing;
  }

  const entry = createRuntimeEntry(adapter, intervalExpression);
  runtimeEntries.push(entry);
  logger.info(
    `[Scheduler] Registered ${entry.name} with base ${Math.round(entry.baseIntervalMs / 60000)} minute interval (min ${Math.round(entry.minIntervalMs / 60000)}m / max ${Math.round(entry.maxIntervalMs / 60000)}m)`
  );
  startDispatcher();
  return entry;
}

/**
 * Schedule all adapters from the provided list.
 * @param {Array<{adapter: BaseAdapter, interval: string}>} adapterConfigs
 */
function scheduleAll(adapterConfigs) {
  logger.info(`[Scheduler] Scheduling ${adapterConfigs.length} adapter(s) with adaptive runtime...`);

  runtimeEntries.length = 0;
  adapterConfigs.forEach(({ adapter, interval }) => {
    scheduleAdapter(adapter, interval);
  });

  runInitialChecks(adapterConfigs).catch((error) => {
    logger.error(`[Scheduler] Startup queue failed: ${error.message}`);
  });
}

/**
 * Stop all scheduled tasks.
 */
function stopAll() {
  if (dispatcherTimer) {
    clearInterval(dispatcherTimer);
    dispatcherTimer = null;
  }

  runtimeEntries.length = 0;
  logger.info('[Scheduler] Stopped adaptive dispatcher');
}

async function runInitialChecks(adapterConfigs) {
  const queue = [...adapterConfigs];
  const workerCount = Math.min(INITIAL_STARTUP_CONCURRENCY, queue.length);
  const workers = Array.from({ length: workerCount }, (_, workerIndex) =>
    processStartupQueue(queue, workerIndex)
  );

  await Promise.allSettled(workers);
}

async function processStartupQueue(queue, workerIndex) {
  if (workerIndex > 0) {
    await sleep(workerIndex * INITIAL_WORKER_STAGGER_MS);
  }

  while (queue.length > 0) {
    const nextConfig = queue.shift();
    if (!nextConfig) return;

    const { adapter } = nextConfig;
    const entry = runtimeEntries.find((candidate) => candidate.name === adapter.getName());
    if (entry) {
      entry.inFlight = true;
    }

    logger.info(`[Scheduler] Startup queue running: ${adapter.getName()}`);
    const result = await runAdapterCheck(adapter);

    if (entry) {
      const latestStatus = db.getSourceStatus(entry.name);
      const eventBoostMultiplier = db.getActiveEventBoostForSource(entry.name, entry.sourceType);
      entry.currentIntervalMs = computeNextIntervalMs(entry, result, latestStatus, eventBoostMultiplier);
      entry.nextRunAt = Date.now() + entry.currentIntervalMs;
      entry.lastRunAt = Date.now();
      entry.inFlight = false;
      logger.info(
        `[Scheduler] Startup next run for ${entry.name} in ${Math.round(entry.currentIntervalMs / 60000)} minute(s)`
      );
    }

    if (queue.length > 0) {
      await sleep(INITIAL_STARTUP_SPACING_MS);
    }
  }
}

function shouldSkipForHealthBackoff(sourceStatus) {
  if (!sourceStatus?.health_state || !sourceStatus?.last_checked) {
    return false;
  }

  const backoffWindowMs = HEALTH_BACKOFF_WINDOWS_MS[sourceStatus.health_state];
  if (!backoffWindowMs) {
    return false;
  }

  const lastCheckedAt = new Date(sourceStatus.last_checked).getTime();
  if (!Number.isFinite(lastCheckedAt)) {
    return false;
  }

  return (Date.now() - lastCheckedAt) < backoffWindowMs;
}

async function maybeSendHealthAlert(sourceName, sourceType, statusUpdate, error = null) {
  if (!statusUpdate) {
    return;
  }

  const previous = statusUpdate.previousHealthState;
  const previousAlerted = statusUpdate.previousAlertedHealthState;
  const current = statusUpdate.healthState;

  if (previous === current) {
    return;
  }

  if (current === 'healthy') {
    if (previousAlerted && previousAlerted !== 'healthy') {
      await sendStatusMessage(
        `✅ Source recovered: **${sourceName}** (${sourceType}) is healthy again after being ${previous}.`
      );
      db.setSourceAlertedHealthState(sourceName, current);
    }
    return;
  }

  if (current === 'warning') {
    return;
  }

  if (!previous && !previousAlerted && current !== 'degraded' && current !== 'disabled-temporarily') {
    return;
  }

  if (previousAlerted === current) {
    return;
  }

  const details = [];
  if (statusUpdate.consecutiveFailures > 0) {
    details.push(`${statusUpdate.consecutiveFailures} consecutive failure(s)`);
  }
  if (statusUpdate.consecutiveEmptyChecks > 0) {
    details.push(`${statusUpdate.consecutiveEmptyChecks} consecutive empty check(s)`);
  }
  if (Number.isFinite(statusUpdate.latencyMs)) {
    details.push(`${statusUpdate.latencyMs}ms latency`);
  }
  if (error?.message) {
    details.push(`last error: ${error.message}`);
  }

  const detailText = details.length > 0 ? ` — ${details.join(' • ')}` : '';
  await sendStatusMessage(
    `⚠️ Source health changed: **${sourceName}** (${sourceType}) is now **${current}**${detailText}`
  );
  db.setSourceAlertedHealthState(sourceName, current);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  scheduleAdapter,
  scheduleAll,
  stopAll,
  runAdapterCheck,
  parseSimpleCronIntervalToMs,
  computeNextIntervalMs,
  shouldSkipForHealthBackoff,
};
