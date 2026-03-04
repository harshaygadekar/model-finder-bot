const axios = require('axios');
const BaseAdapter = require('./base-adapter');
const logger = require('../services/logger');
const db = require('../db/database');

/**
 * ArXiv adapter — fetches AI/ML research papers by category.
 * Uses ArXiv Atom feed API (free, no auth required).
 * Papers are stored in the DB daily and sent as weekly digests.
 */

const ARXIV_BASE = 'https://export.arxiv.org/api/query';

// ArXiv categories to monitor
const CATEGORIES = [
  { id: 'cs.AI',  label: '🤖 Artificial Intelligence' },
  { id: 'cs.CL',  label: '💬 Language Models & NLP' },
  { id: 'cs.CV',  label: '👁️ Computer Vision' },
  { id: 'cs.LG',  label: '📈 Machine Learning' },
  { id: 'cs.RO',  label: '🦾 Robotics' },
  { id: 'q-bio.QM', label: '🧬 AI in Biotech' },
];

class ArxivAdapter extends BaseAdapter {
  constructor(category = null) {
    super(
      category ? `ArXiv: ${category.label}` : 'ArXiv: All',
      'arxiv',
      3
    );
    this.category = category;
    this.categories = category ? [category] : CATEGORIES;
  }

  async check() {
    const allPapers = [];

    for (const cat of this.categories) {
      try {
        const response = await axios.get(ARXIV_BASE, {
          params: {
            search_query: `cat:${cat.id}`,
            sortBy: 'submittedDate',
            sortOrder: 'descending',
            max_results: 20,
          },
          timeout: 20000,
          headers: { 'User-Agent': 'ModelLookerBot/1.0' },
        });

        const papers = parseArxivAtom(response.data, cat);
        papers.forEach((p) => {
          try {
            db.savePaper(p);
          } catch (e) {
            // Ignore duplicate save errors
          }
        });
        allPapers.push(...papers);

        // Polite delay between ArXiv requests
        await new Promise((r) => setTimeout(r, 1000));
      } catch (error) {
        logger.error(`[ArXiv] ${cat.id} error: ${error.message}`);
      }
    }

    return allPapers;
  }
}

function parseArxivAtom(xml, category) {
  const papers = [];
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (const entry of entries) {
    const id = extract(entry, 'id');
    const title = extract(entry, 'title').replace(/\s+/g, ' ').trim();
    const summary = extract(entry, 'summary').replace(/\s+/g, ' ').trim();
    const published = extract(entry, 'published');
    const authors = extractAll(entry, 'name').slice(0, 3).join(', ');
    const arxivId = id.split('/abs/').pop();

    if (!title || !id) continue;

    papers.push({
      arxivId,
      title,
      authors,
      abstract: summary.substring(0, 500),
      url: `https://arxiv.org/abs/${arxivId}`,
      category: category.id,
      source: 'arxiv',
      publishedAt: published,
      hfLikes: 0,
      // Also expose as a notifiable item format (for filter compatibility)
      description: `${authors} • ${category.label}\n${summary.substring(0, 200)}...`,
      sourceName: `ArXiv: ${category.label}`,
      sourceType: 'arxiv',
      priority: 3,
      tags: ['research', 'arxiv', category.id],
    });
  }

  return papers;
}

function extract(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
}

function extractAll(xml, tag) {
  const results = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'g');
  let m;
  while ((m = regex.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

module.exports = ArxivAdapter;
module.exports.CATEGORIES = CATEGORIES;
