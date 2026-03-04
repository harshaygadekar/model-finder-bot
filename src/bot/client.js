const { Client, GatewayIntentBits, Events } = require('discord.js');
const logger = require('../services/logger');

let client;

/**
 * Create and configure the Discord client.
 */
function createClient() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info(`✅ Discord bot logged in as ${c.user.tag}`);
    logger.info(`📡 Connected to ${c.guilds.cache.size} server(s)`);
  });

  client.on(Events.Error, (error) => {
    logger.error('Discord client error:', error);
  });

  client.on(Events.Warn, (warning) => {
    logger.warn('Discord client warning:', warning);
  });

  return client;
}

/**
 * Log in the client with the bot token.
 */
async function login(token) {
  if (!client) createClient();
  await client.login(token);
  return client;
}

/**
 * Get the client instance.
 */
function getClient() {
  return client;
}

module.exports = { createClient, login, getClient };
