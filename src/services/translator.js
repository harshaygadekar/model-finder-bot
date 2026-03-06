const http = require('./http');
const logger = require('./logger');

/**
 * Lightweight translation using the free Google Translate web API.
 * This uses the unofficial free endpoint (no API key needed).
 * Rate-limited but sufficient for our volume (~10-20 translations/day).
 */

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MY_MEMORY_URL = 'https://api.mymemory.translated.net/get';

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

  const detectedSourceLang = sourceLang === 'auto' ? detectLikelySourceLanguage(text) : sourceLang;
  const providers = [
    () => translateWithGoogle(text, detectedSourceLang),
    () => translateWithMyMemory(text, detectedSourceLang),
  ];

  for (const provider of providers) {
    try {
      const translated = await provider();
      if (translated && translated !== text) {
        return translated;
      }
    } catch (error) {
      logger.warn(`[Translator] Provider failed: ${error.message}`);
    }
  }

  return text;
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
  return /[\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

async function translateWithGoogle(text, sourceLang) {
  const response = await http.get(TRANSLATE_URL, {
    params: {
      client: 'gtx',
      sl: sourceLang || 'auto',
      tl: 'en',
      dt: 't',
      q: text.substring(0, 2000),
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ModelLookerBot/1.0)',
    },
    timeout: 10000,
    retry: { retries: 1 },
  });

  if (response.data && Array.isArray(response.data[0])) {
    return response.data[0]
      .map((segment) => segment[0])
      .filter(Boolean)
      .join('') || text;
  }

  return text;
}

async function translateWithMyMemory(text, sourceLang) {
  const response = await http.get(MY_MEMORY_URL, {
    params: {
      q: text.substring(0, 500),
      langpair: `${normalizeMyMemorySourceLang(sourceLang)}|en`,
    },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ModelLookerBot/1.0)',
    },
    timeout: 10000,
    retry: { retries: 1 },
  });

  const translated = response.data?.responseData?.translatedText;
  if (translated && typeof translated === 'string') {
    return translated;
  }

  return text;
}

function detectLikelySourceLanguage(text) {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\uac00-\ud7af]/.test(text)) return 'ko';
  if (containsCJK(text)) return 'zh-CN';
  return 'auto';
}

function normalizeMyMemorySourceLang(sourceLang) {
  if (!sourceLang || sourceLang === 'auto') return 'zh-CN';
  return sourceLang;
}

module.exports = { translateToEnglish, translateItem, containsCJK };
