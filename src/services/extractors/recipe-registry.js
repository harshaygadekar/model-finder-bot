const anthropicNewsRecipe = require('./recipes/anthropic-news');
const mistralNewsRecipe = require('./recipes/mistral-news');
const cohereBlogRecipe = require('./recipes/cohere-blog');
const qwenBlogRecipe = require('./recipes/qwen-blog');
const moonshotKimiRecipe = require('./recipes/moonshot-kimi');

const RECIPES = [
  anthropicNewsRecipe,
  mistralNewsRecipe,
  cohereBlogRecipe,
  qwenBlogRecipe,
  moonshotKimiRecipe,
];

function getRecipeForAdapter(adapter) {
  return RECIPES.find((recipe) => recipe.matches(adapter)) || null;
}

module.exports = {
  RECIPES,
  getRecipeForAdapter,
};
