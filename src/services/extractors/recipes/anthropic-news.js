const { collectAnchors } = require('../generic-recipe');

module.exports = {
  key: 'anthropic-news',
  matches: (adapter) => adapter.recipeKey === 'anthropic-news' || /anthropic\.com/.test(adapter.url),
  extract: ($, adapter) => collectAnchors($, adapter, [
    { selector: 'main article a[href*="/news/"]', tags: ['blog', 'official', 'anthropic'] },
    { selector: 'main a[href*="/news/"]', tags: ['blog', 'official', 'anthropic'] },
  ]),
};
