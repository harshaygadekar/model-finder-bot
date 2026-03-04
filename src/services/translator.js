const axios = require('axios');
const logger = require('./logger');

/**
 * Lightweight translation using the free Google Translate web API.
 * This uses the unofficial free endpoint (no API key needed).
 * Rate-limited but sufficient for our volume (~10-20 translations/day).
 */

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';

/**
 * Translate text to English.
 * @param {string} text - Text to translate
 * @param {string} [sourceLang='auto'] - Source language (auto-detect by default)
 * @returns {Promise<string>} - Translated text
 */
async function translateToEnglish(text, sourceLang = 'auto') {
  if (!text || text.trim().length === 0) return text;

  // Skip if already in English (simple heuristic: check for CJK characters)
  if (!containsCJK(text)) return text;

  try {
    const response = await axios.get(TRANSLATE_URL, {
      params: {
        client: 'gtx',
        sl: sourceLang,
        tl: 'en',
        dt: 't',
        q: text.substring(0, 2000), // Limit to prevent abuse
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ModelLookerBot/1.0)',
      },
      timeout: 10000,
    });

    // Response format: [[["translated text","original text",...],...],...]]
    if (response.data && Array.isArray(response.data[0])) {
      const translated = response.data[0]
        .map((segment) => segment[0])
        .filter(Boolean)
        .join('');
      return translated || text;
    }

    return text;
  } catch (error) {
    logger.warn(`[Translator] Failed to translate: ${error.message}`);
    return text; // Return original on failure
  }
}

/**
 * Translate both title and description of an item if needed.
 */
async function translateItem(item) {
  if (!item.needsTranslation) return item;

  const [translatedTitle, translatedDesc] = await Promise.all([
    translateToEnglish(item.title),
    translateToEnglish(item.description),
  ]);

  const wasTranslated = translatedTitle !== item.title || translatedDesc !== item.description;

  return {
    ...item,
    title: translatedTitle,
    description: translatedDesc,
    originalTitle: wasTranslated ? item.title : undefined,
    tags: wasTranslated ? [...(item.tags || []), 'translated'] : item.tags,
  };
}

/**
 * Check if text contains CJK (Chinese/Japanese/Korean) characters.
 */
function containsCJK(text) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF\u2e80-\u2eff\u3000-\u303f]/.test(text);
}

module.exports = { translateToEnglish, translateItem, containsCJK };
