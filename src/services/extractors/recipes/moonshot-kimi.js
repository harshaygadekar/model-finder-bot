const { collectAnchors } = require('../generic-recipe');

module.exports = {
  key: 'moonshot-kimi',
  matches: (adapter) => adapter.recipeKey === 'moonshot-kimi' || /kimi\.ai/.test(adapter.url),
  extract: ($, adapter) => collectAnchors($, adapter, [
    { selector: 'main article a[href*="/blog/"]', tags: ['blog', 'official', 'moonshot', 'kimi'] },
    { selector: 'main a[href*="/blog/"]', tags: ['blog', 'official', 'moonshot', 'kimi'] },
  ]),
};
