const { collectAnchors } = require('../generic-recipe');

module.exports = {
  key: 'mistral-news',
  matches: (adapter) => adapter.recipeKey === 'mistral-news' || /mistral\.ai/.test(adapter.url),
  extract: ($, adapter) => collectAnchors($, adapter, [
    { selector: 'main article a[href*="/news/"]', tags: ['blog', 'official', 'mistral'] },
    { selector: 'main a[href*="/news/"]', tags: ['blog', 'official', 'mistral'] },
  ]),
};
