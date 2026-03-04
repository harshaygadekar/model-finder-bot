const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { getChannel } = require('../bot/channels');
const db = require('../db/database');
const logger = require('./logger');
const { CATEGORIES } = require('../adapters/arxiv-adapter');

/**
 * Digest service — generates:
 * 1. Weekly research paper digest (Sundays 10 AM) → #research-papers
 * 2. Weekly news roundup (Sundays 10:15 AM) → #weekly-digest
 */

// ─── Paper Digest ─────────────────────────────────────────────────────────────

async function sendPaperDigest() {
  logger.info('[Digest] Building weekly research paper digest...');
  const channel = getChannel('research-papers');
  if (!channel) {
    logger.warn('[Digest] #research-papers channel not found, skipping digest');
    return;
  }

  const papers = db.getWeeklyPapers(7);
  if (papers.length === 0) {
    logger.info('[Digest] No papers to include in digest this week');
    return;
  }

  // Group by category
  const byCategory = {};
  for (const paper of papers) {
    const cat = paper.category || 'AI';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(paper);
  }

  const digestedIds = [];

  // Send one embed per category (up to top 8 papers each)
  for (const cat of CATEGORIES) {
    const catPapers = (byCategory[cat.id] || []).slice(0, 8);
    if (catPapers.length === 0) continue;

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`📄 Weekly Papers: ${cat.label}`)
      .setDescription(`Top ${catPapers.length} paper${catPapers.length > 1 ? 's' : ''} from the past 7 days`)
      .setTimestamp()
      .setFooter({ text: 'Sources: ArXiv · HuggingFace Daily Papers' });

    for (const paper of catPapers) {
      const likes = paper.hf_likes > 0 ? ` · ❤️ ${paper.hf_likes}` : '';
      const authors = paper.authors ? `*${paper.authors.substring(0, 60)}${paper.authors.length > 60 ? '...' : ''}*\n` : '';
      embed.addFields({
        name: paper.title.substring(0, 256),
        value: `${authors}[ArXiv](${paper.url})${likes}`,
      });
      digestedIds.push(paper.id);
    }

    try {
      await channel.send({ embeds: [embed] });
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      logger.error(`[Digest] Failed to send paper digest for ${cat.id}: ${err.message}`);
    }
  }

  // Mark papers as digested
  if (digestedIds.length > 0) {
    db.markPapersDigested(digestedIds);
    logger.info(`[Digest] ✅ Paper digest sent — ${digestedIds.length} papers marked as digested`);
  }
}

// ─── Weekly News Roundup ──────────────────────────────────────────────────────

async function sendWeeklyRoundup() {
  logger.info('[Digest] Building weekly news roundup...');
  const channel = getChannel('weekly-digest');
  if (!channel) {
    logger.warn('[Digest] #weekly-digest channel not found, skipping roundup');
    return;
  }

  const items = db.getWeeklyNotified(7);
  if (items.length === 0) {
    logger.info('[Digest] No items to include in weekly roundup');
    return;
  }

  // Group by source_type
  const byType = { rss: [], github: [], huggingface: [], bluesky: [], reddit: [], newsletter: [], other: [] };
  for (const item of items) {
    const key = byType[item.source_type] ? item.source_type : 'other';
    byType[key].push(item);
  }

  const now = new Date();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const dateRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const embed = new EmbedBuilder()
    .setColor(0x059669)
    .setTitle(`📋 Weekly AI Roundup: ${dateRange}`)
    .setDescription(`**${items.length} updates** tracked across all sources this week`)
    .setTimestamp()
    .setFooter({ text: 'AI Model Tracker Bot' });

  const sections = [
    { key: 'rss',        emoji: '📢', label: 'Lab Announcements' },
    { key: 'github',     emoji: '🐙', label: 'GitHub Releases' },
    { key: 'huggingface',emoji: '🤗', label: 'HuggingFace Models' },
    { key: 'newsletter', emoji: '📰', label: 'Newsletter & News' },
    { key: 'bluesky',    emoji: '🦋', label: 'Bluesky Highlights' },
    { key: 'reddit',     emoji: '💬', label: 'Community Buzz' },
  ];

  for (const section of sections) {
    const sectionItems = byType[section.key];
    if (!sectionItems || sectionItems.length === 0) continue;

    const lines = sectionItems.slice(0, 5).map((item) => {
      const title = item.title.substring(0, 80);
      return item.url ? `• [${title}](${item.url})` : `• ${title}`;
    });

    if (sectionItems.length > 5) {
      lines.push(`*...and ${sectionItems.length - 5} more*`);
    }

    embed.addFields({
      name: `${section.emoji} ${section.label} (${sectionItems.length})`,
      value: lines.join('\n'),
    });
  }

  try {
    await channel.send({ embeds: [embed] });
    logger.info('[Digest] ✅ Weekly roundup sent');
  } catch (err) {
    logger.error(`[Digest] Failed to send weekly roundup: ${err.message}`);
  }
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

function scheduleDigests() {
  // Sunday 10:00 AM — research paper digest
  cron.schedule('0 10 * * 0', () => {
    sendPaperDigest().catch((e) => logger.error('[Digest] Paper digest failed:', e));
  }, { timezone: 'Asia/Kolkata' });

  // Sunday 10:15 AM — weekly news roundup
  cron.schedule('15 10 * * 0', () => {
    sendWeeklyRoundup().catch((e) => logger.error('[Digest] Roundup failed:', e));
  }, { timezone: 'Asia/Kolkata' });

  logger.info('[Digest] 📅 Scheduled: paper digest + roundup every Sunday 10:00 AM IST');
}

module.exports = { scheduleDigests, sendPaperDigest, sendWeeklyRoundup };
