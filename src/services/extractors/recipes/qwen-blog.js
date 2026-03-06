const { collectAnchors } = require('../generic-recipe');

module.exports = {
  key: 'qwen-blog',
  matches: (adapter) => adapter.recipeKey === 'qwen-blog' || /qwenlm\.github\.io/.test(adapter.url),
  extract: ($, adapter) => collectAnchors($, adapter, [
    { selector: 'main article a[href*="/blog/"]', tags: ['blog', 'official', 'qwen'] },
    { selector: 'article h2 a[href*="/blog/"]', tags: ['blog', 'official', 'qwen'] },
    { selector: 'a[href*="/blog/"]', tags: ['blog', 'official', 'qwen'] },
  ]),
};
