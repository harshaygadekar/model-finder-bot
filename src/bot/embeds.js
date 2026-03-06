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
  'api-models': '🔌',
  'arena-models': '🏟️',
  changelog: '📋',
  'playground-leak': '🕵️',
  talent: '🧠',
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

  if (item.classification) {
    embed.addFields({
      name: 'Classification',
      value: `\`${String(item.classification.label || 'unknown').replace(/_/g, ' ')}\` • ${Math.round(Number(item.classification.confidence || 0) * 100)}% • ${item.classification.providerUsed || 'keyword'}`,
      inline: true,
    });
  }

  if (item.enrichment?.facts?.length) {
    embed.addFields({
      name: 'Facts',
      value: item.enrichment.facts.slice(0, 3).map((fact) => `• ${truncate(fact, 90)}`).join('\n').substring(0, 1024),
      inline: false,
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
  const healthCounts = sourceStatuses.reduce((acc, source) => {
    const state = source.health_state || 'healthy';
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});

  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6)
    .setTitle('🤖 AI Model Tracker — Status')
    .setTimestamp(new Date())
    .addFields(
      { name: '⏱️ Uptime', value: formatUptime(uptime), inline: true },
      { name: '📊 Total Items Tracked', value: `${stats.totalItems}`, inline: true },
      { name: '📨 Notifications Sent', value: `${stats.notifiedItems}`, inline: true },
      { name: '📅 Last 24h', value: `${stats.last24h} items`, inline: true },
      {
        name: '📬 Delivery Queue',
        value: `ready ${stats.deliveryQueue?.ready ?? 0} • pending ${stats.deliveryQueue?.pending ?? 0} • processing ${stats.deliveryQueue?.processing ?? 0} • dead ${stats.deliveryQueue?.['dead-letter'] ?? 0}`,
        inline: false,
      },
    );

  // Add source status summary
  const healthy = sourceStatuses.filter((s) => (s.health_state || 'healthy') === 'healthy').length;
  const total = sourceStatuses.length;
  const errorSources = sourceStatuses.filter((s) => s.error_count > 0);

  embed.addFields({
    name: '📡 Sources',
    value: `${healthy}/${total} healthy`,
    inline: true,
  });

  embed.addFields({
    name: '🩺 Health States',
    value: `healthy ${healthCounts.healthy || 0} • warning ${healthCounts.warning || 0} • degraded ${healthCounts.degraded || 0}`,
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
function buildSourcesEmbed(sourceStatuses, reliabilityBySource = {}) {
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
      const status = s.health_state === 'healthy' ? '✅' : (s.health_state === 'warning' ? '⚠️' : '❌');
      const lastCheck = s.last_checked ? timeAgo(new Date(s.last_checked)) : 'never';
      const reliability = reliabilityBySource[s.source_name]?.overall_score;
      const reliabilityText = Number.isFinite(reliability)
        ? ` • reliability ${(Number(reliability) * 100).toFixed(0)}%`
        : '';
      return `${status} ${s.source_name} (${lastCheck}) • ${s.health_state || 'healthy'}${reliabilityText}`;
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

function buildHealthEmbed(sourceHealth, queueStats) {
  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle('🩺 Source Health')
    .setTimestamp(new Date())
    .addFields({
      name: '📬 Delivery Queue',
      value: `ready ${queueStats.ready} • pending ${queueStats.pending} • processing ${queueStats.processing} • dead ${queueStats['dead-letter']}`,
      inline: false,
    });

  const unhealthy = sourceHealth.filter((source) => source.health_state !== 'healthy');
  const lines = (unhealthy.length > 0 ? unhealthy : sourceHealth.slice(0, 10)).map((source) => {
    const latency = source.observed_avg_latency_ms ? `${Math.round(source.observed_avg_latency_ms)}ms` : 'n/a';
    const backlog = source.delivery_backlog ?? 0;
    return `• **${source.source_name}** — ${source.health_state || 'healthy'} • success ${(Number(source.success_rate || 0) * 100).toFixed(0)}% • latency ${latency} • backlog ${backlog}`;
  });

  embed.setDescription(lines.length > 0 ? lines.join('\n').substring(0, 4096) : 'All sources are healthy.');
  return { embeds: [embed] };
}

function buildTimelineEmbed(events, topSources) {
  const embed = new EmbedBuilder()
    .setColor(0x2563EB)
    .setTitle('🕰️ Signal Timeline')
    .setTimestamp(new Date());

  if (!events || events.length === 0) {
    embed.setDescription('No corroborated events yet. The timeline is still warming up.');
    return { embeds: [embed] };
  }

  const timelineLines = events.map((event, index) => {
    const confidence = `${(Number(event.confidence_score) * 100).toFixed(0)}%`;
    const lastSeen = timeAgo(new Date(event.last_seen_at));
    return `**${index + 1}.** ${truncate(event.title, 80)}\n└ ${event.event_type.replace(/_/g, ' ')} • ${confidence} • ${event.distinct_sources} source${event.distinct_sources > 1 ? 's' : ''} • ${lastSeen}`;
  });

  embed.setDescription(timelineLines.join('\n\n').substring(0, 4096));

  if (topSources && topSources.length > 0) {
    embed.addFields({
      name: '📈 Top Reliable Sources',
      value: topSources.map((source) => `• ${source.source_name} — ${(Number(source.overall_score) * 100).toFixed(0)}%`).join('\n').substring(0, 1024),
      inline: false,
    });
  }

  return { embeds: [embed] };
}

function buildEventModesEmbed(eventModes) {
  const embed = new EmbedBuilder()
    .setColor(0xEC4899)
    .setTitle('🎪 Event Modes')
    .setTimestamp(new Date());

  if (!eventModes || eventModes.length === 0) {
    embed.setDescription('No event modes are active or scheduled right now.');
    return { embeds: [embed] };
  }

  const lines = eventModes.map((eventMode) => {
    const keywords = (eventMode.keywords || []).slice(0, 5).join(', ') || 'none';
    const boosts = (eventMode.sourceBoosts || []).slice(0, 4).join(', ') || 'none';
    return `• **${eventMode.title}** — slug: ${eventMode.slug} • ${eventMode.status} • keywords: ${keywords} • boosts: ${boosts}`;
  });

  embed.setDescription(lines.join('\n').substring(0, 4096));
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
  buildHealthEmbed,
  buildTimelineEmbed,
  buildEventModesEmbed,
};
