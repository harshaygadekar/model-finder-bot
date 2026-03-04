const cron = require('node-cron');
const { filterItems } = require('./filter');
const { notifyItems, sendStatusMessage } = require('./notifier');
const db = require('../db/database');
const logger = require('./logger');

// Store scheduled tasks for cleanup
const scheduledTasks = [];

/**
 * Run a single adapter check cycle: fetch → filter → notify.
 */
async function runAdapterCheck(adapter) {
  const name = adapter.getName();
  const sourceType = adapter.getSourceType();

  try {
    // Fetch items from the source
    const rawItems = await adapter.check();

    // Filter for relevance
    const filteredItems = filterItems(rawItems);

    // Notify Discord (pass sourceName for first-run seeding detection)
    const { notified, seeded, skippedOld } = await notifyItems(filteredItems, name);

    // Update source status (AFTER notifyItems so isSourceNew works correctly)
    db.updateSourceStatus(name, sourceType, true, null, rawItems.length);

    if (notified > 0) {
      logger.info(`[Scheduler] ${name}: ${notified} new notification(s) sent (${rawItems.length} checked)`);
    } else if (seeded > 0) {
      logger.info(`[Scheduler] ${name}: seeded ${seeded} item(s) on first run (no notifications)`);
    }
  } catch (error) {
    db.updateSourceStatus(name, sourceType, false, error.message, 0);
    logger.error(`[Scheduler] ${name} failed: ${error.message}`);
  }
}

/**
 * Schedule an adapter to run at the specified cron interval.
 */
function scheduleAdapter(adapter, cronExpression) {
  const name = adapter.getName();

  // Run immediately on first load
  logger.info(`[Scheduler] Running initial check for: ${name}`);
  runAdapterCheck(adapter).catch((err) => {
    logger.error(`[Scheduler] Initial check failed for ${name}: ${err.message}`);
  });

  // Schedule recurring checks
  const task = cron.schedule(cronExpression, () => {
    runAdapterCheck(adapter);
  });

  scheduledTasks.push({ name, task });
  logger.info(`[Scheduler] Scheduled ${name} at "${cronExpression}"`);
}

/**
 * Schedule all adapters from the provided list.
 * @param {Array<{adapter: BaseAdapter, interval: string}>} adapterConfigs
 */
function scheduleAll(adapterConfigs) {
  logger.info(`[Scheduler] Scheduling ${adapterConfigs.length} adapter(s)...`);

  // Stagger start times to avoid all adapters hitting at once
  adapterConfigs.forEach(({ adapter, interval }, index) => {
    setTimeout(() => {
      scheduleAdapter(adapter, interval);
    }, index * 2000); // 2 second stagger between adapters
  });
}

/**
 * Stop all scheduled tasks.
 */
function stopAll() {
  for (const { name, task } of scheduledTasks) {
    task.stop();
    logger.info(`[Scheduler] Stopped: ${name}`);
  }
  scheduledTasks.length = 0;
}

module.exports = { scheduleAdapter, scheduleAll, stopAll, runAdapterCheck };
