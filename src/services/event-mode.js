const db = require('../db/database');
const { getChannel } = require('../bot/channels');
const logger = require('./logger');

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parseCommaSeparatedList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function startEventMode({ title, slug, keywords, sourceBoosts, durationHours = 24 }) {
  const normalizedSlug = slugify(slug || title);
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + Math.max(1, durationHours) * 60 * 60 * 1000).toISOString();
  const eventMode = db.createEventMode({
    slug: normalizedSlug,
    title,
    status: 'active',
    startsAt,
    endsAt,
    keywords,
    sourceBoosts,
    deliveryChannelKey: 'major-events',
  });

  const thread = await ensureEventThread(eventMode);
  return {
    ...eventMode,
    threadId: thread?.id || eventMode.thread_id || null,
  };
}

function listEventModes(status = null) {
  return db.listEventModes(status);
}

function stopEventMode(identifier) {
  return db.stopEventMode(identifier);
}

function getActiveEventModes() {
  return db.getActiveEventModes();
}

async function ensureEventThread(eventMode) {
  const channel = getChannel(eventMode.delivery_channel_key || 'major-events');
  if (!channel) {
    logger.warn(`[EventMode] major-events channel not available for ${eventMode.slug}`);
    return null;
  }

  let thread = null;
  if (eventMode.thread_id) {
    thread = channel.threads?.cache?.get(eventMode.thread_id) || null;
    if (!thread && channel.threads?.fetch) {
      thread = await channel.threads.fetch(eventMode.thread_id).catch(() => null);
    }
    if (thread?.archived) {
      await thread.setArchived(false).catch(() => null);
    }
  }

  if (!thread && channel.threads?.create) {
    thread = await channel.threads.create({
      name: eventMode.slug,
      autoArchiveDuration: 1440,
      reason: `Event mode thread for ${eventMode.title}`,
    });
    db.updateEventModeThreadId(eventMode.id, thread.id);
  }

  return thread;
}

async function mirrorToEventThread(item, payload) {
  const eventMode = db.findMatchingActiveEventMode(item);
  if (!eventMode) {
    return null;
  }

  const thread = await ensureEventThread(eventMode);
  if (!thread) {
    return null;
  }

  const sentMessage = await thread.send(payload);
  logger.info(`[EventMode] Mirrored "${item.title}" to event thread ${eventMode.slug}`);
  return {
    eventMode,
    threadId: thread.id,
    messageId: sentMessage?.id || null,
  };
}

module.exports = {
  slugify,
  parseCommaSeparatedList,
  startEventMode,
  listEventModes,
  stopEventMode,
  getActiveEventModes,
  ensureEventThread,
  mirrorToEventThread,
};
