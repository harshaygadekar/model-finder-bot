function getContentRoots($, selectors) {
  const roots = selectors.flatMap((selector) => $(selector).toArray());
  if (roots.length > 0) return roots;

  const body = $('body').get(0);
  return body ? [body] : $.root().toArray();
}

function extractBestTitle($, element) {
  const title = $(element).attr('title')
    || $(element).attr('aria-label')
    || $(element).text()
    || $(element).find('img').attr('alt')
    || $(element).closest('article, li, div').find('h1, h2, h3, h4').first().text()
    || '';

  return title.replace(/\s+/g, ' ').trim();
}

function isLikelyContentTitle(title, adapter) {
  if (!title) return false;
  if (title.length < adapter.minTitleLength) return false;
  if (adapter.denyTitlePattern && adapter.denyTitlePattern.test(title)) return false;
  if (adapter.allowTitlePattern && !adapter.allowTitlePattern.test(title)) return false;

  const wordCount = title.split(/\s+/).filter(Boolean).length;
  const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(title);

  return hasCJK || wordCount >= 2;
}

function normalizeHref(rawHref, adapter) {
  if (!rawHref) return null;

  try {
    const href = new URL(rawHref, adapter.baseUrl).href;
    if (!adapter.allowedOrigins.includes(new URL(href).origin)) {
      return null;
    }
    return href;
  } catch {
    return null;
  }
}

function shouldIgnoreElement($, element) {
  return $(element).closest('nav, header, footer, aside, [role="navigation"]').length > 0;
}

function buildScrapedItem(adapter, title, href, extra = {}) {
  return {
    title,
    description: extra.description || `New article detected on ${adapter.name}`,
    url: href,
    sourceName: adapter.name,
    sourceType: adapter.sourceType,
    priority: adapter.priority,
    tags: extra.tags || ['blog', 'official'],
    publishedAt: extra.publishedAt || new Date(),
    needsTranslation: adapter.translate,
  };
}

function collectAnchors($, adapter, selectorConfigs) {
  const items = [];
  const seenLinks = new Set();

  for (const config of selectorConfigs) {
    const selector = typeof config === 'string' ? config : config.selector;
    const tags = typeof config === 'string' ? null : config.tags;
    const description = typeof config === 'string' ? null : config.description;

    $(selector).each((_, element) => {
      const anchor = $(element).is('a') ? $(element) : $(element).find('a').first();
      if (anchor.length === 0 || shouldIgnoreElement($, anchor)) return;

      const href = normalizeHref(anchor.attr('href'), adapter);
      if (!href) return;
      if (!adapter.linkPattern.test(href)) return;
      if (adapter.ignorePattern && adapter.ignorePattern.test(href)) return;

      const title = extractBestTitle($, anchor);
      if (!isLikelyContentTitle(title, adapter)) return;

      if (seenLinks.has(href)) {
        const existing = items.find((item) => item.url === href);
        if (existing && title.length > existing.title.length) {
          existing.title = title;
        }
        return;
      }

      seenLinks.add(href);
      items.push(buildScrapedItem(adapter, title, href, { tags, description }));
    });
  }

  return items.slice(0, adapter.maxItems);
}

function extractGenericItems($, adapter) {
  const items = [];
  const seenLinks = new Set();
  const contentRoots = getContentRoots($, adapter.contentSelectors);

  contentRoots.forEach((root) => {
    const $root = $(root);

    adapter.linkSelectors.forEach((selector) => {
      $root.find(selector).each((_, element) => {
        if (shouldIgnoreElement($, element)) return;

        const href = normalizeHref($(element).attr('href'), adapter);
        if (!href) return;
        if (!adapter.linkPattern.test(href)) return;
        if (adapter.ignorePattern && adapter.ignorePattern.test(href)) return;

        const title = extractBestTitle($, element);
        if (!isLikelyContentTitle(title, adapter)) return;

        if (seenLinks.has(href)) {
          const existing = items.find((item) => item.url === href);
          if (existing && title.length > existing.title.length) {
            existing.title = title;
          }
          return;
        }

        seenLinks.add(href);
        items.push(buildScrapedItem(adapter, title, href));
      });
    });
  });

  return items.slice(0, adapter.maxItems);
}

module.exports = {
  getContentRoots,
  extractBestTitle,
  isLikelyContentTitle,
  normalizeHref,
  shouldIgnoreElement,
  buildScrapedItem,
  collectAnchors,
  extractGenericItems,
};