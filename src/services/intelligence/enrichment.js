const cheerio = require('cheerio');
const db = require('../../db/database');
const http = require('../http');

async function maybeEnrichItem(item) {
  if (!shouldEnrich(item)) {
    return item;
  }

  const cached = db.getArticleEnrichment(item.observationId);
  if (cached) {
    return applyEnrichmentToItem(item, cached);
  }

  try {
    const response = await http.get(item.url, {
      timeout: 15000,
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      recordCrawl: false,
    });

    const enrichment = extractEnrichment(item, response.data);
    try {
      const stored = db.recordArticleEnrichment({
        observationId: item.observationId,
        ...enrichment,
      });
      return applyEnrichmentToItem(item, stored);
    } catch {
      return applyEnrichmentToItem(item, enrichment);
    }
  } catch {
    return item;
  }
}

function applyEnrichmentToItem(item, enrichment) {
  return {
    ...item,
    url: enrichment.canonical_url || enrichment.canonicalUrl || item.url,
    enrichment,
    description: enrichment.summary || item.description,
    publishedAt: enrichment.published_at || enrichment.publishedAt || item.publishedAt,
  };
}

function shouldEnrich(item) {
  return Boolean(item.url && item.observationId && item.priority <= 1);
}

function extractEnrichment(item, html) {
  const $ = cheerio.load(html);
  const rawCanonicalUrl = $('link[rel="canonical"]').attr('href') || item.url;
  const canonicalUrl = resolveUrl(rawCanonicalUrl, item.url);
  const title = $('meta[property="og:title"]').attr('content')
    || $('title').text().trim()
    || item.title;
  const publishedAt = $('meta[property="article:published_time"]').attr('content')
    || $('time[datetime]').first().attr('datetime')
    || item.publishedAt
    || null;

  const paragraphs = $('article p, main p, .content p, .post-content p')
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 40)
    .slice(0, 12);

  const bodyText = paragraphs.join('\n\n');
  const summary = buildSummary(bodyText, item.description);
  const facts = extractFacts(bodyText);
  const qualityScore = Math.max(0, Math.min(1, bodyText.length / 2500));

  return {
    canonicalUrl,
    title,
    publishedAt,
    bodyText,
    summary,
    facts,
    entities: item.classification?.entities || {},
    qualityScore,
  };
}

function resolveUrl(value, fallbackBase) {
  try {
    return new URL(value, fallbackBase).href;
  } catch {
    return fallbackBase;
  }
}

function buildSummary(bodyText, fallback) {
  if (!bodyText) {
    return fallback || null;
  }

  const sentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2);

  return sentences.join(' ').slice(0, 320) || fallback || null;
}

function extractFacts(bodyText) {
  if (!bodyText) {
    return [];
  }

  const facts = [];
  const contextWindow = bodyText.match(/(\d+[\d,]*(k|m)?\s+(token|tokens|context window))/i);
  const pricing = bodyText.match(/(\$\d+(?:\.\d+)?[^\n.]{0,40}(million tokens|month|per token|pricing))/i);
  const benchmark = bodyText.match(/(mmlu|arena|benchmark|evals?[^\n.]{0,40}\d+(?:\.\d+)?%?)/i);

  for (const match of [contextWindow, pricing, benchmark]) {
    if (match?.[0]) {
      facts.push(match[0].trim());
    }
  }

  return [...new Set(facts)];
}

module.exports = {
  maybeEnrichItem,
  shouldEnrich,
  extractEnrichment,
};