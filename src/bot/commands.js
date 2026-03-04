const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { buildStatusEmbed, buildSourcesEmbed, buildLatestEmbed } = require('./embeds');
const db = require('../db/database');
const logger = require('../services/logger');

const startTime = Date.now();

// Command definitions
const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show bot status, uptime, and health info'),
  new SlashCommandBuilder()
    .setName('sources')
    .setDescription('List all monitored sources and their status'),
  new SlashCommandBuilder()
    .setName('latest')
    .setDescription('Show the most recent tracked items')
    .addIntegerOption((opt) =>
      opt.setName('count').setDescription('Number of items to show (default: 10)').setMinValue(1).setMaxValue(25)
    ),
  new SlashCommandBuilder()
    .setName('digest')
    .setDescription('Manually trigger a digest generation')
    .addStringOption((opt) =>
      opt.setName('type')
         .setDescription('Type of digest to generate')
         .setRequired(true)
         .addChoices(
           { name: 'Research Papers', value: 'paper' },
           { name: 'Weekly Roundup', value: 'roundup' },
           { name: 'Both', value: 'both' }
         )
    ),
];

/**
 * Register slash commands with Discord.
 */
async function registerCommands(token, clientId, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    logger.info('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands.map((c) => c.toJSON()),
    });
    logger.info('✅ Slash commands registered');
  } catch (error) {
    logger.error('Failed to register slash commands:', error);
  }
}

/**
 * Handle slash command interactions.
 */
async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'status': {
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const stats = db.getStats();
        const statuses = db.getAllSourceStatuses();
        const embed = buildStatusEmbed(stats, statuses, uptimeSeconds);
        await interaction.reply(embed);
        break;
      }
      case 'sources': {
        const statuses = db.getAllSourceStatuses();
        const embed = buildSourcesEmbed(statuses);
        await interaction.reply(embed);
        break;
      }
      case 'latest': {
        const count = interaction.options.getInteger('count') || 10;
        const items = db.getRecentItems(count);
        const embed = buildLatestEmbed(items);
        await interaction.reply(embed);
        break;
      }
      case 'digest': {
        const { sendPaperDigest, sendWeeklyRoundup } = require('../services/digest');
        const type = interaction.options.getString('type');
        
        await interaction.deferReply();
        try {
          if (type === 'paper' || type === 'both') await sendPaperDigest();
          if (type === 'roundup' || type === 'both') await sendWeeklyRoundup();
          await interaction.followUp('✅ Digest generation triggered successfully.');
        } catch (err) {
          logger.error(`Error generating digest: ${err.message}`);
          await interaction.followUp('❌ Failed to generate digest.');
        }
        break;
      }
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  } catch (error) {
    logger.error(`Error handling command /${interaction.commandName}:`, error);
    const reply = { content: '❌ An error occurred while processing the command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
}

module.exports = { registerCommands, handleInteraction, commands };
