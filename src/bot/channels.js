const { ChannelType, PermissionFlagsBits } = require('discord.js');
const logger = require('../services/logger');

// Channel definitions with their Discord display names
const CHANNEL_DEFS = {
  'major-releases':      { name: '🔴-major-releases',      topic: 'Major official model launches, flagship upgrades, and notable tech product, software, hardware, or robotics releases' },
  'model-updates':       { name: '📦-model-updates',       topic: 'Meaningful LLM and AI model changes that matter, but are not top-tier major-release alerts' },
  'tech-news':           { name: '📰-tech-news',            topic: 'Broader tech company news, announcements, blogs, reports, and articles across AI and technology' },
  'community-buzz':      { name: '💬-community-buzz',       topic: 'Forum, social, and open-source chatter surfacing around AI models, companies, and tech developments' },
  'leaderboard-updates': { name: '📊-leaderboard-updates',  topic: 'Arena, eval, benchmark, and leaderboard movement only' },
  'research-papers':     { name: '📄-research-papers',      topic: 'Weekly curated digest of top AI/ML research papers' },
  'weekly-digest':       { name: '📋-weekly-digest',        topic: 'Sunday roundup of everything that happened in AI this week' },
  'major-events':        { name: '🎪-major-events',         topic: 'Planned event announcements, live event-related coverage, recap digests, and special monitoring mode threads' },
  'rumors-leaks':        { name: '🔮-rumors-leaks',         topic: 'Unverified leaks, rumors, low-confidence signals, and insider whispers around upcoming models and products' },
  'china-ai':            { name: '🐉-china-ai',             topic: 'China-focused AI and tech landscape updates when no more specific channel is the better primary home' },
  'talent-moves':        { name: '🧠-talent-moves',         topic: 'AI researcher movement alerts and affiliation changes' },
  'bot-status':          { name: '🤖-bot-status',           topic: 'Bot health, source status, and operational alerts' },
};

// Cache resolved channel IDs
const channelCache = {};

/**
 * Ensure all tracker channels exist in the guild. Creates them if missing.
 * Optionally creates them under a category called "AI Tracker".
 */
async function ensureChannels(guild) {
  // Try to find or create the category
  let category = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase().includes('ai tracker')
  );

  if (!category) {
    try {
      category = await guild.channels.create({
        name: '🤖 AI Tracker',
        type: ChannelType.GuildCategory,
      });
      logger.info(`Created category: ${category.name}`);
    } catch (err) {
      logger.warn('Could not create category, channels will be created without one:', err.message);
    }
  }

  for (const [key, def] of Object.entries(CHANNEL_DEFS)) {
    // Look for existing channel
    let channel = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildText && ch.name === def.name
    );

    if (!channel) {
      try {
        channel = await guild.channels.create({
          name: def.name,
          type: ChannelType.GuildText,
          topic: def.topic,
          parent: category?.id,
        });
        logger.info(`Created channel: #${channel.name}`);
      } catch (err) {
        logger.error(`Failed to create channel ${def.name}:`, err.message);
        continue;
      }
    }

    channelCache[key] = channel;
  }

  return channelCache;
}

/**
 * Get a channel by its key name.
 */
function getChannel(key) {
  return channelCache[key] || null;
}

/**
 * Get all channel references.
 */
function getAllChannels() {
  return { ...channelCache };
}

module.exports = { ensureChannels, getChannel, getAllChannels, CHANNEL_DEFS };
