const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { buildStatusEmbed, buildSourcesEmbed, buildLatestEmbed, buildHealthEmbed, buildTimelineEmbed, buildEventModesEmbed } = require('./embeds');
const db = require('../db/database');
const logger = require('../services/logger');
const { parseCommaSeparatedList, startEventMode, listEventModes, stopEventMode } = require('../services/event-mode');

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
    .setName('health')
    .setDescription('Show source health and delivery queue backlog'),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Manage major event monitoring mode')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription('Start a new event monitoring mode')
        .addStringOption((opt) => opt.setName('title').setDescription('Event title').setRequired(true))
        .addStringOption((opt) => opt.setName('keywords').setDescription('Comma-separated event keywords').setRequired(true))
        .addStringOption((opt) => opt.setName('slug').setDescription('Optional event slug'))
        .addStringOption((opt) => opt.setName('sources').setDescription('Comma-separated boosted source names or type:<sourceType> values'))
        .addIntegerOption((opt) => opt.setName('duration-hours').setDescription('How long the event mode stays active').setMinValue(1).setMaxValue(168))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('stop')
        .setDescription('Stop an active event monitoring mode')
        .addStringOption((opt) => opt.setName('slug').setDescription('Event slug').setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List active and recent event modes')
    ),
  new SlashCommandBuilder()
    .setName('latest')
    .setDescription('Show the most recent tracked items')
    .addIntegerOption((opt) =>
      opt.setName('count').setDescription('Number of items to show (default: 10)').setMinValue(1).setMaxValue(25)
    ),
  new SlashCommandBuilder()
    .setName('timeline')
    .setDescription('Show recent confirmed events and top reliable sources')
    .addIntegerOption((opt) =>
      opt.setName('count').setDescription('Number of timeline events to show (default: 8)').setMinValue(1).setMaxValue(15)
    ),
  new SlashCommandBuilder()
    .setName('digest')
    .setDescription('Manually trigger a digest generation')
    .addStringOption((opt) =>
      opt.setName('type')
         .setDescription('Type of digest to generate')
         .setRequired(true)
         .addChoices(
           { name: 'Breaking Signals', value: 'breaking' },
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
        const reliabilityRows = db.getLatestSourceReliabilityScores();
        const reliabilityBySource = Object.fromEntries(reliabilityRows.map((row) => [row.source_name, row]));
        const embed = buildSourcesEmbed(statuses, reliabilityBySource);
        await interaction.reply(embed);
        break;
      }
      case 'health': {
        const sourceHealth = db.getSourceHealthSummaries();
        const queueStats = db.getDeliveryQueueStats();
        const embed = buildHealthEmbed(sourceHealth, queueStats);
        await interaction.reply(embed);
        break;
      }
      case 'event': {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'start') {
          const title = interaction.options.getString('title');
          const slug = interaction.options.getString('slug');
          const keywords = parseCommaSeparatedList(interaction.options.getString('keywords'));
          const sourceBoosts = parseCommaSeparatedList(interaction.options.getString('sources'));
          const durationHours = interaction.options.getInteger('duration-hours') || 24;
          const eventMode = await startEventMode({ title, slug, keywords, sourceBoosts, durationHours });
          const threadSuffix = eventMode.threadId ? ` • thread <#${eventMode.threadId}>` : '';
          await interaction.reply(`🎪 Event mode started: **${eventMode.title}** (\`${eventMode.slug}\`)${threadSuffix}`);
          break;
        }

        if (subcommand === 'stop') {
          const slug = interaction.options.getString('slug');
          const eventMode = stopEventMode(slug);
          if (!eventMode) {
            await interaction.reply({ content: `❌ No event mode found for \`${slug}\`.`, ephemeral: true });
            break;
          }

          await interaction.reply(`🛑 Event mode stopped: **${eventMode.title}** (\`${eventMode.slug}\`)`);
          break;
        }

        const eventModes = listEventModes();
        const embed = buildEventModesEmbed(eventModes);
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
      case 'timeline': {
        const count = interaction.options.getInteger('count') || 8;
        const events = db.getRecentEventTimeline(count, 24 * 7);
        const topSources = db.getTopReliableSources(5);
        const embed = buildTimelineEmbed(events, topSources);
        await interaction.reply(embed);
        break;
      }
      case 'digest': {
        const { sendBreakingDigest, sendPaperDigest, sendWeeklyRoundup } = require('../services/digest');
        const type = interaction.options.getString('type');

        await interaction.deferReply({ ephemeral: true });
        try {
          if (type === 'breaking') await sendBreakingDigest();
          if (type === 'paper' || type === 'both') await sendPaperDigest();
          if (type === 'roundup' || type === 'both') await sendWeeklyRoundup();
          await interaction.editReply('✅ Digest generation triggered successfully.');
        } catch (err) {
          logger.error(`Error generating digest: ${err.message}`);
          await interaction.editReply('❌ Failed to generate digest.');
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
