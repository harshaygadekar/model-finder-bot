const { collectAnchors } = require('../generic-recipe');

module.exports = {
  key: 'cohere-blog',
  matches: (adapter) => adapter.recipeKey === 'cohere-blog' || /cohere\.com/.test(adapter.url),
  extract: ($, adapter) => collectAnchors($, adapter, [
    { selector: 'main article a[href*="/blog/"]', tags: ['blog', 'official', 'cohere'] },
    { selector: 'main article a[href*="/research/"]', tags: ['blog', 'official', 'cohere', 'research'] },
    { selector: 'main a[href*="/blog/"]', tags: ['blog', 'official', 'cohere'] },
  ]),
};
