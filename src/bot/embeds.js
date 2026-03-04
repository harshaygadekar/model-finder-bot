const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { PRIORITY } = require('../config/sources');

// Color scheme by priority
const PRIORITY_COLORS = {
  [PRIORITY.P0]: 0xEF4444, // Red
  [PRIORITY.P1]: 0xF97316, // Orange
  [PRIORITY.P2]: 0xEAB308, // Yellow
  [PRIORITY.P3]: 0x22C55E, // Green
  [PRIORITY.P4]: 0x3B82F6, // Blue
};

const PRIORITY_LABELS = {
  [PRIORITY.P0]: '🔴 Official Release',
  [PRIORITY.P1]: '🟠 Model Platform',
  [PRIORITY.P2]: '🟡 Tech News',
  [PRIORITY.P3]: '🟢 Community',
  [PRIORITY.P4]: '🔵 Leaderboard',
};

// Source type icons
const SOURCE_ICONS = {
  rss: '📡',
  github: '🐙',
  huggingface: '🤗',
  reddit: '🔶',
  ollama: '🦙',
  bluesky: '🦋',
  scrape: '🌐',
  newsletter: '📰',
  'china-ai': '🐉',
  hackernews: '🟧',
  'sdk-tracker': '📦',
  'arena-mystery': '🔮',
  'api-models': '�',  'arena-models': '🏟️',
  changelog: '📋',
  'playground-leak': '🕵️',  talent: '🧠',
  leaderboard: '📊',
};

/**
 * Build a rich Discord embed for a tracked item.
 * @param {Object} item - The item to create an embed for
 * @param {string} item.title - Item title
 * @param {string} item.description - Item description (truncated)
 * @param {string} item.url - Source URL
 * @param {string} item.sourceName - Name of the source
 * @param {string} item.sourceType - Type of source (rss, github, etc.)
 * @param {number} item.priority - Priority level (0-4)
 * @param {string[]} [item.tags] - Optional tags
 * @param {string} [item.imageUrl] - Optional image URL
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildNotificationEmbed(item) {
  const embed = new EmbedBuilder()
    .setColor(PRIORITY_COLORS[item.priority] ?? 0x6B7280)
    .setTitle(truncate(item.title, 256))
    .setURL(item.url || null)
    .setTimestamp(new Date())
    .setFooter({
      text: `${PRIORITY_LABELS[item.priority] ?? 'Info'} • ${SOURCE_ICONS[item.sourceType] ?? '📌'} ${item.sourceName}`,
    });

  // Add description if available
  if (item.description) {
    embed.setDescription(truncate(item.description, 300));
  }

  // Add tags as field
  if (item.tags && item.tags.length > 0) {
    embed.addFields({
      name: 'Tags',
      value: item.tags.map((t) => `\`${t}\``).join(' '),
      inline: true,
    });
  }

  // Add image if available
  if (item.imageUrl) {
    embed.setThumbnail(item.imageUrl);
  }

  // Build link button
  const components = [];
  if (item.url) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('View Source')
        .setStyle(ButtonStyle.Link)
        .setURL(item.url)
        .setEmoji('🔗')
    );
    components.push(row);
  }

  return { embeds: [embed], components };
}

/**
 * Build a status embed showing bot health.
 */
function buildStatusEmbed(stats, sourceStatuses, uptime) {
  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6)
    .setTitle('🤖 AI Model Tracker — Status')
    .setTimestamp(new Date())
    .addFields(
      { name: '⏱️ Uptime', value: formatUptime(uptime), inline: true },
      { name: '📊 Total Items Tracked', value: `${stats.totalItems}`, inline: true },
      { name: '📨 Notifications Sent', value: `${stats.notifiedItems}`, inline: true },
      { name: '📅 Last 24h', value: `${stats.last24h} items`, inline: true },
    );

  // Add source status summary
  const healthy = sourceStatuses.filter((s) => s.error_count === 0).length;
  const total = sourceStatuses.length;
  const errorSources = sourceStatuses.filter((s) => s.error_count > 0);

  embed.addFields({
    name: '📡 Sources',
    value: `${healthy}/${total} healthy`,
    inline: true,
  });

  if (errorSources.length > 0) {
    embed.addFields({
      name: '⚠️ Errors',
      value: errorSources.map((s) => `• ${s.source_name}: ${s.last_error}`).join('\n').substring(0, 1024),
      inline: false,
    });
  }

  return { embeds: [embed] };
}

/**
 * Build an embed listing all sources.
 */
function buildSourcesEmbed(sourceStatuses) {
  const embed = new EmbedBuilder()
    .setColor(0x06B6D4)
    .setTitle('📡 Monitored Sources')
    .setTimestamp(new Date());

  // Group by type
  const grouped = {};
  for (const s of sourceStatuses) {
    if (!grouped[s.source_type]) grouped[s.source_type] = [];
    grouped[s.source_type].push(s);
  }

  for (const [type, sources] of Object.entries(grouped)) {
    const icon = SOURCE_ICONS[type] || '📌';
    const lines = sources.map((s) => {
      const status = s.error_count === 0 ? '✅' : '❌';
      const lastCheck = s.last_checked ? timeAgo(new Date(s.last_checked)) : 'never';
      return `${status} ${s.source_name} (${lastCheck})`;
    });
    embed.addFields({
      name: `${icon} ${type.toUpperCase()}`,
      value: lines.join('\n').substring(0, 1024) || 'None',
      inline: false,
    });
  }

  return { embeds: [embed] };
}

/**
 * Build an embed showing recent items.
 */
function buildLatestEmbed(items) {
  const embed = new EmbedBuilder()
    .setColor(0xA855F7)
    .setTitle('🕐 Latest Tracked Items')
    .setTimestamp(new Date());

  if (items.length === 0) {
    embed.setDescription('No items tracked yet. The bot just started!');
    return { embeds: [embed] };
  }

  const lines = items.map((item, i) => {
    const ago = timeAgo(new Date(item.discovered_at));
    const link = item.url ? `[Link](${item.url})` : 'No link';
    return `**${i + 1}.** ${truncate(item.title, 80)}\n└ ${item.source_name} • ${ago} • ${link}`;
  });

  embed.setDescription(lines.join('\n\n').substring(0, 4096));
  return { embeds: [embed] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = {
  buildNotificationEmbed,
  buildStatusEmbed,
  buildSourcesEmbed,
  buildLatestEmbed,
};
