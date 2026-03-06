const { buildNotificationEmbed } = require('../bot/embeds');
const { getChannel } = require('../bot/channels');
const { CHANNEL_MAP, MAX_AGE_HOURS } = require('../config/sources');
const db = require('../db/database');
const { translateItem } = require('./translator');
const logger = require('./logger');
const { mirrorToEventThread } = require('./event-mode');
const { maybeEnrichItem } = require('./intelligence/enrichment');
const { computeDeliveryDecision } = require('./intelligence/delivery-policy');

const DELIVERY_WORKER_ID = `delivery-worker-${process.pid}`;
const DELIVERY_POLL_INTERVAL_MS = 1000;
const DELIVERY_MAX_ATTEMPTS = 4;
const DELIVERY_RETRY_BASE_MS = 5000;
const OFFICIAL_SOURCE_TYPES = new Set(['rss', 'scrape', 'github', 'huggingface', 'ollama', 'changelog']);
const OFFICIAL_RELEASE_PATTERN = /\b(release|released|launch|launched|announc|available|official)\b/i;

let deliveryWorkerTimer = null;
let deliveryWorkerRunning = false;

const RUMOR_KEYWORDS = [
  'leak', 'rumor', 'anonymous', 'insider', 'unreleased', 
  'strawberry', 'orion', 'q-star',
  'mystery-model', 'model-leak', 'sdk-leak',
  'api-live',
];

function isRumor(item) {
  if (item.classification?.label) {
    return item.classification.label === 'rumor_or_leak';
  }

  const text = `${item.title} ${item.description || ''} ${item.tags?.join(' ') || ''}`.toLowerCase();
  const hasRumorKeyword = RUMOR_KEYWORDS.some((keyword) => text.includes(keyword));
  if (!hasRumorKeyword) {
    return false;
  }

  const isOfficialSource = item.priority <= 1 && OFFICIAL_SOURCE_TYPES.has(item.sourceType);
  if (isOfficialSource && OFFICIAL_RELEASE_PATTERN.test(text)) {
    return false;
  }

  return true;
}

/**
 * Check if an item is fresh enough to notify about.
 * Items older than MAX_AGE_HOURS are silently marked as seen.
 * If item has no date, assume fresh (we rely on first-run seeding instead).
 */
function isFresh(item) {
  if (!item.publishedAt) return true;
  const ageMs = Date.now() - new Date(item.publishedAt).getTime();
  return ageMs / (1000 * 60 * 60) <= MAX_AGE_HOURS;
}

function isTransientDeliveryError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return true;
  }

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('rate limit')
    || message.includes('timeout')
    || message.includes('network')
    || message.includes('temporar')
  );
}

function getDeliveryRetryDelayMs(attemptCount) {
  const exponent = Math.max(0, attemptCount);
  return Math.min(5 * 60 * 1000, DELIVERY_RETRY_BASE_MS * (2 ** exponent));
}

async function safeTranslateItem(item) {
  try {
    return await translateItem(item);
  } catch (error) {
    logger.warn(`[Notifier] Translation failed for "${item.title}": ${error.message}`);
    return item;
  }
}

/**
 * Process a list of filtered items: check first-run seeding, dedup,
 * freshness, translate, and send to Discord.
 *
 * First-run seeding: if the source has NEVER been checked before, silently
 * mark ALL its items as seen without sending any Discord notifications.
 * This prevents the initial flood from sources like Ollama (no timestamps).
 *
 * @param {Array} items - Filtered items from adapters
 * @param {string} sourceName - The adapter's source name (for first-run check)
 * @returns {Promise<{notified: number, seeded: number, skippedOld: number}>}
 */
async function notifyItems(items, sourceName) {
  let queuedCount = 0;
  let seededCount = 0;
  let skippedOld = 0;

  // First-run seeding: if this source has never been checked, skip all notifications
  const isFirstRun = sourceName ? db.isSourceNew(sourceName) : false;
  if (isFirstRun) {
    logger.info(`[Notifier] 🌱 First run for "${sourceName}" — seeding ${items.length} item(s) silently`);
    for (const item of items) {
      if (!db.isItemSeen(item.url, item.title)) {
        db.markSeen(item, false);
        seededCount++;
      }
    }
    return { notified: 0, seeded: seededCount, skippedOld: 0 };
  }

  for (const item of items) {
    try {
      // ── Triple-layer dedup (all checks use ORIGINAL pre-translation title) ──
      // Layer 1: Exact hash match (url + title)
      if (db.isItemSeen(item.url, item.title)) continue;
      // Layer 2: URL-only match (catches same article with minor title changes)
      if (db.isUrlSeen(item.url)) continue;
      // Layer 3: Content similarity (catches same story from different sources)
      if (db.isContentSimilarSeen(item.title)) continue;

      // Freshness gate: silently mark old items as seen without notifying
      if (!isFresh(item)) {
        db.markSeen(item, false);
        skippedOld++;
        continue;
      }

      // Mark seen immediately so duplicate polls do not enqueue the same item again.
      db.markSeen(item, false);

      const jobId = db.enqueueDeliveryJob({
        jobType: 'alert',
        sourceName: item.sourceName || sourceName || 'unknown',
        sourceType: item.sourceType || 'unknown',
        priority: item.priority ?? 100,
        payload: {
          item,
          originalUrl: item.url,
          originalTitle: item.title,
        },
      });

      queuedCount++;
      logger.debug(`[Notifier] Queued delivery job ${jobId} for "${item.title.substring(0, 60)}..."`);
    } catch (error) {
      logger.error(`[Notifier] Failed to queue item "${item.title}": ${error.message}`);
    }
  }

  if (skippedOld > 0) {
    logger.info(`[Notifier] Skipped ${skippedOld} old item(s) (older than ${MAX_AGE_HOURS}h)`);
  }

  if (deliveryWorkerTimer) {
    pollDeliveryQueue().catch((error) => {
      logger.error(`[Notifier] Failed to kick delivery worker: ${error.message}`);
    });
  }

  return { notified: queuedCount, seeded: seededCount, skippedOld };
}

/**
 * Send a system status message to the bot-status channel.
 */
async function sendStatusMessage(text) {
  const botStatusChannel = getChannel('bot-status');
  if (!botStatusChannel) {
    logger.warn('[Notifier] bot-status channel is unavailable; status message was not queued');
    return null;
  }

  const jobId = db.enqueueDeliveryJob({
    jobType: 'status',
    sourceName: 'bot-status',
    sourceType: 'system',
    priority: 0,
    payload: {
      channelKey: 'bot-status',
      text,
    },
  });

  if (deliveryWorkerTimer) {
    pollDeliveryQueue().catch((error) => {
      logger.error(`[Notifier] Failed to kick delivery worker: ${error.message}`);
    });
  }

  return jobId;
}

function startDeliveryWorker() {
  if (deliveryWorkerTimer) {
    return;
  }

  const releasedJobs = db.releaseStaleDeliveryJobs();
  if (releasedJobs > 0) {
    logger.warn(`[Notifier] Requeued ${releasedJobs} stale delivery job(s) on startup`);
  }

  deliveryWorkerTimer = setInterval(() => {
    pollDeliveryQueue().catch((error) => {
      logger.error(`[Notifier] Delivery worker loop failed: ${error.message}`);
    });
  }, DELIVERY_POLL_INTERVAL_MS);

  pollDeliveryQueue().catch((error) => {
    logger.error(`[Notifier] Delivery worker bootstrap failed: ${error.message}`);
  });

  logger.info('[Notifier] Delivery worker started');
}

function stopDeliveryWorker() {
  if (!deliveryWorkerTimer) {
    return;
  }

  clearInterval(deliveryWorkerTimer);
  deliveryWorkerTimer = null;
  logger.info('[Notifier] Delivery worker stopped');
}

async function pollDeliveryQueue() {
  if (deliveryWorkerRunning) {
    return;
  }

  deliveryWorkerRunning = true;

  try {
    while (true) {
      const job = db.claimNextDeliveryJob(DELIVERY_WORKER_ID);
      if (!job) {
        return;
      }

      await processDeliveryJob(job);
    }
  } finally {
    deliveryWorkerRunning = false;
  }
}

async function processDeliveryJob(job) {
  try {
    const result = await dispatchDeliveryJob(job);

    db.recordDeliveryAttempt(job.id, {
      success: true,
      channelKey: result.channelKey,
      messageId: result.messageId,
      response: result,
    });
    db.markDeliveryJobSent(job.id);

    if (job.job_type === 'alert') {
      const originalUrl = job.payload.originalUrl || job.payload.item?.url;
      const originalTitle = job.payload.originalTitle || job.payload.item?.title;
      if (originalUrl || originalTitle) {
        db.markItemNotified(originalUrl || '', originalTitle || '');
      }
    }
  } catch (error) {
    db.recordDeliveryAttempt(job.id, {
      success: false,
      errorMessage: error.message,
    });

    const transient = isTransientDeliveryError(error);
    const nextAttemptNumber = job.attempt_count + 1;

    if (transient && nextAttemptNumber < DELIVERY_MAX_ATTEMPTS) {
      const delayMs = getDeliveryRetryDelayMs(job.attempt_count);
      db.retryDeliveryJob(job.id, error.message, { delayMs });
      logger.warn(`[Notifier] Retrying delivery job ${job.id} in ${delayMs}ms (${error.message})`);
      return;
    }

    db.markDeliveryJobDeadLetter(job.id, error.message);
    logger.error(`[Notifier] Delivery job ${job.id} moved to dead-letter queue: ${error.message}`);
  }
}

async function dispatchDeliveryJob(job) {
  switch (job.job_type) {
    case 'alert':
      return sendAlertPayload(job.payload);
    case 'status':
      return sendStatusPayload(job.payload);
    default:
      throw new Error(`Unsupported delivery job type: ${job.job_type}`);
  }
}

async function sendAlertPayload(payload) {
  const enrichedItem = await maybeEnrichItem(payload.item);
  const deliverableItem = await safeTranslateItem(enrichedItem);
  const deliveryDecision = computeDeliveryDecision(deliverableItem);
  const channelKey = deliveryDecision.channelKey || CHANNEL_MAP[deliverableItem.sourceType] || 'tech-news';
  const channel = getChannel(channelKey);
  const rumorChannel = getChannel('rumors-leaks');
  const rumor = deliveryDecision.channelKey === 'rumors-leaks' || isRumor(deliverableItem);

  if (!channel && (!rumor || !rumorChannel)) {
    throw new Error(`No destination channels found for ${deliverableItem.title}`);
  }

  const message = buildNotificationEmbed(deliverableItem);
  let sentMessage;
  let destinationKey;
  const breakingBanner = deliveryDecision.breakingCandidate && !rumor
    ? '🚨 **BREAKING MODEL SIGNAL** 🚨'
    : null;

  if (rumor && rumorChannel) {
    sentMessage = await rumorChannel.send({
      content: '🚨 **RUMOR/LEAK DETECTED** 🚨',
      ...message,
    });
    destinationKey = 'rumors-leaks';
    logger.info(`[Notifier] 🔮 Sent RUMOR to #rumors-leaks: "${deliverableItem.title.substring(0, 60)}..."`);
  } else {
    sentMessage = await channel.send(breakingBanner ? { content: breakingBanner, ...message } : message);
    destinationKey = channelKey;
    logger.info(`[Notifier] 📨 Sent to #${channelKey}: "${deliverableItem.title.substring(0, 60)}..."`);
  }

  const eventMirrorPayload = rumor
    ? { content: '🎪 **EVENT MODE MIRROR**', ...message }
    : message;
  await mirrorToEventThread(deliverableItem, eventMirrorPayload).catch((error) => {
    logger.warn(`[Notifier] Failed to mirror item to event thread: ${error.message}`);
  });

  await sleep(500);

  return {
    channelKey: destinationKey,
    messageId: sentMessage?.id || null,
  };
}

async function sendStatusPayload(payload) {
  const channelKey = payload.channelKey || 'bot-status';
  const channel = getChannel(channelKey);
  if (!channel) {
    throw new Error(`Status channel ${channelKey} is unavailable`);
  }

  const messageText = payload.text.startsWith('🤖') ? payload.text : `🤖 ${payload.text}`;
  const sentMessage = await channel.send(messageText);

  return {
    channelKey,
    messageId: sentMessage?.id || null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  notifyItems,
  sendStatusMessage,
  startDeliveryWorker,
  stopDeliveryWorker,
  pollDeliveryQueue,
};
