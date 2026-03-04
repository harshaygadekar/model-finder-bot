const { buildNotificationEmbed } = require('../bot/embeds');
const { getChannel } = require('../bot/channels');
const { CHANNEL_MAP, MAX_AGE_HOURS } = require('../config/sources');
const db = require('../db/database');
const { translateItem } = require('./translator');
const logger = require('./logger');

const RUMOR_KEYWORDS = [
  'leak', 'rumor', 'anonymous', 'insider', 'unreleased', 
  'strawberry', 'orion', 'q-star', 'grok-3', 'gpt-5',
  'mystery-model', 'model-leak', 'sdk-leak',
  'new-model', 'api-live',      // API model registry detections
];

function isRumor(item) {
  const text = `${item.title} ${item.description || ''} ${item.tags?.join(' ') || ''}`.toLowerCase();
  return RUMOR_KEYWORDS.some(kw => text.toLowerCase().includes(kw));
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
  let notifiedCount = 0;
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
      // Check dedup
      if (db.isItemSeen(item.url, item.title)) continue;

      // Freshness gate: silently mark old items as seen without notifying
      if (!isFresh(item)) {
        db.markSeen(item, false);
        skippedOld++;
        continue;
      }

      // Translate if needed
      const processedItem = await translateItem(item);

      // Determine target channel by source type
      const channelKey = CHANNEL_MAP[processedItem.sourceType] || 'tech-news';
      const channel = getChannel(channelKey);
      const rumorChannel = getChannel('rumors-leaks');
      const isItemRumor = isRumor(processedItem);

      if (!channel && (!isItemRumor || !rumorChannel)) {
        logger.warn(`[Notifier] No destination channels found, skipping: ${processedItem.title}`);
        db.markSeen(processedItem, false);
        continue;
      }

      // Build and send embed
      const message = buildNotificationEmbed(processedItem);
      
      if (channel && channelKey !== 'rumors-leaks') {
        await channel.send(message);
        logger.info(`[Notifier] 📨 Sent to #${channelKey}: "${processedItem.title.substring(0, 60)}..."`);
      }

      // Send to rumors channel if it's a rumor (with special alert header)
      if (isItemRumor && rumorChannel) {
        await rumorChannel.send({ content: '🚨 **RUMOR/LEAK DETECTED** 🚨', embeds: message.embeds });
        logger.info(`[Notifier] 🔮 Sent RUMOR to #rumors-leaks: "${processedItem.title.substring(0, 60)}..."`);
      }

      db.markSeen(processedItem, true);
      notifiedCount++;

      // Small delay between messages to avoid Discord rate limiting
      await sleep(500);
    } catch (error) {
      logger.error(`[Notifier] Failed to send item "${item.title}": ${error.message}`);
      db.markSeen(item, false);
    }
  }

  if (skippedOld > 0) {
    logger.info(`[Notifier] Skipped ${skippedOld} old item(s) (older than ${MAX_AGE_HOURS}h)`);
  }

  return { notified: notifiedCount, seeded: seededCount, skippedOld };
}

/**
 * Send a system status message to the bot-status channel.
 */
async function sendStatusMessage(text) {
  const channel = getChannel('bot-status');
  if (channel) {
    try {
      await channel.send(`🤖 ${text}`);
    } catch (err) {
      logger.error(`[Notifier] Failed to send status message: ${err.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { notifyItems, sendStatusMessage };
