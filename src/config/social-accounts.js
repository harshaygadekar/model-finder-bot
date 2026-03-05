/**
 * Social media accounts to monitor via Bluesky native RSS feeds.
 * Imported from bluesky-adapter.js where they are defined.
 */
const { BLUESKY_SOURCES } = require('../adapters/bluesky-adapter');

/**
 * Newsletter RSS feeds — curate AI Twitter/social content.
 * These surface major announcements (resignations, leaks, rumors) within hours.
 */
const NEWSLETTER_RSS_SOURCES = [
  {
    name: 'The Rundown AI',
    url: 'https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml',
    priority: 2,
    translate: false,
  },
  {
    name: 'Import AI (Jack Clark)',
    url: 'https://importai.substack.com/feed',
    priority: 2,
    translate: false,
  },
  {
    name: 'AI News',
    url: 'https://www.artificialintelligence-news.com/feed/',
    priority: 2,
    translate: false,
  },
  {
    name: 'VentureBeat AI',
    url: 'https://venturebeat.com/category/ai/feed/',
    priority: 2,
    translate: false,
  },
  {
    name: 'MIT Technology Review AI',
    url: 'https://www.technologyreview.com/feed/',
    priority: 2,
    translate: false,
  },

  // ─── Expert Analysis & Curated AI Newsletters ────────────────────────────
  {
    name: 'SemiAnalysis',
    url: 'https://semianalysis.com/feed',
    priority: 1,
    translate: false,
  },
  {
    name: "Ben's Bites",
    url: 'https://www.bensbites.com/feed',
    priority: 2,
    translate: false,
  },
  {
    name: 'Latent Space',
    url: 'https://www.latent.space/feed',
    priority: 2,
    translate: false,
  },

  // ─── Fast-updating Tech News (for breaking product launches) ─────────────
  {
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    priority: 2,
    translate: false,
  },
  {
    name: 'The Verge',
    url: 'https://www.theverge.com/rss/index.xml',
    priority: 2,
    translate: false,
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
    priority: 2,
    translate: false,
  },
  {
    name: '9to5Mac',
    url: 'https://9to5mac.com/feed/',
    priority: 2,
    translate: false,
  },
];

module.exports = { BLUESKY_SOURCES, NEWSLETTER_RSS_SOURCES };
