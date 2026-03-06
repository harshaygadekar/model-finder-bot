const PRIMARY_LABELS = [
  'official_release',
  'api_availability',
  'model_update',
  'research_paper',
  'benchmark_update',
  'sdk_signal',
  'rumor_or_leak',
  'general_ai_news',
  'irrelevant',
];

const ENTITY_KEYS = ['provider', 'modelFamily', 'modelId', 'releaseSurface'];
const BUSINESS_NEWS_PATTERN = /\b(hiring|hire|hired|career|careers|office|headquarters|hq|expansion|operations|operational|workplace|employee|employees|team growth|funding|fundraise|fundraising|investment|investor|valuation|lease|real estate|regional office)\b/i;
const PRODUCT_SIGNAL_PATTERN = /\b(model|models|api|sdk|research|paper|benchmark|leaderboard|arena|release|released|launch|launched|available|availability|context window|token|tokens|multimodal|weights|checkpoint|reasoning|eval|evals|pricing|prompt|completion|inference)\b/i;
const NEGATED_PRODUCT_SIGNAL_PATTERN = /\b(?:no|without)\s+(?:new\s+)?(?:product|products|model|models|api|sdk|research|paper|benchmark|leaderboard|arena|release|released|launch|launched|availability|pricing|prompt|completion|inference)(?:\s+(?:or|and)\s+(?:product|products|model|models|api|sdk|research|paper|benchmark|leaderboard|arena|release|released|launch|launched|availability|pricing|prompt|completion|inference))*\b/i;
const MODEL_EXTRACTION_PATTERNS = [
  /\bClaude(?:[-\s]?(?:Opus|Sonnet|Haiku|Instant))?(?:[-\s]?\d+(?:\.\d+)*)?\b/gi,
  /\bGPT[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:mini|turbo|preview|thinking|pro|exp|chat|codex|omni|nano|audio|vision|realtime|high|low))|(?:-[0-9]+)){0,4}\b/gi,
  /\bGemini[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:pro|flash|max|ultra|mini|exp|experimental|thinking|vision|audio|live|advanced|preview))|(?:-[0-9]+)){0,6}\b/gi,
  /\bGemma[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:it|vision|pro|mini))|(?:-[0-9]+)){0,4}\b/gi,
  /\bQwen[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:omni|max|plus|coder|chat|vl|audio|math|turbo|pro))|(?:-[0-9]+)){0,6}\b/gi,
  /\bQwen\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+){0,6}\b/g,
  /\bDeepSeek[-\s]?(?:R\d|V\d|Coder|Chat|Reasoner|Prover)(?:[-\s]?[A-Za-z0-9.]+){0,6}\b/gi,
  /\bLlama[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:pro|instruct|chat|vision|guard|coder|reasoning))|(?:-[0-9]+)){0,6}\b/gi,
  /\bMistral[-\s]?[A-Za-z0-9.]+(?:[-\s]?[A-Za-z0-9.]+){0,4}\b/gi,
  /\bMixtral[-\s]?[A-Za-z0-9.]+(?:[-\s]?[A-Za-z0-9.]+){0,4}\b/gi,
  /\bCodestral[-\s]?[A-Za-z0-9.]+(?:[-\s]?[A-Za-z0-9.]+){0,4}\b/gi,
  /\bGrok[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:mini|vision|beta))|(?:-[0-9]+)){0,4}\b/gi,
  /\b(?:Chat)?GLM[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:chat|code|vision))|(?:-[0-9]+)){0,4}\b/gi,
  /\bYi[-\s]?\d+(?:\.\d+)*(?:(?:[-\s](?:chat|vision|coder|lightning|large))|(?:-[0-9]+)){0,4}\b/gi,
  /\bKimi[-\s]?[A-Za-z0-9.]+(?:[-\s]?[A-Za-z0-9.]+){0,4}\b/gi,
  /\bDoubao[-\s]?[A-Za-z0-9.]+(?:[-\s]?[A-Za-z0-9.]+){0,4}\b/gi,
  /\bErnie[-\s]?[A-Za-z0-9.]+(?:[-\s]?[A-Za-z0-9.]+){0,4}\b/gi,
];
const PROVIDER_ALIASES = [
  { pattern: /\bopenai|chatgpt\b/i, canonical: 'OpenAI' },
  { pattern: /\banthropic|claude\b/i, canonical: 'Anthropic' },
  { pattern: /\bgoogle|deepmind|gemini|gemma\b/i, canonical: 'Google' },
  { pattern: /\bmeta|facebook|llama\b/i, canonical: 'Meta' },
  { pattern: /\bqwen\b/i, canonical: 'Qwen' },
  { pattern: /\bdeepseek\b/i, canonical: 'DeepSeek' },
  { pattern: /\bglm|chatglm|zhipu\b/i, canonical: 'GLM' },
  { pattern: /\bmistral|mixtral|codestral\b/i, canonical: 'Mistral' },
  { pattern: /\bgrok|x\.ai|xai\b/i, canonical: 'xAI' },
  { pattern: /\byi|01\.ai|01ai\b/i, canonical: 'Yi' },
  { pattern: /\bkimi|moonshot\b/i, canonical: 'Kimi' },
  { pattern: /\bdoubao|bytedance\b/i, canonical: 'ByteDance' },
  { pattern: /\bernie|baidu\b/i, canonical: 'Baidu' },
  { pattern: /\balibaba\b/i, canonical: 'Alibaba' },
];
const SURFACE_PROVIDER_PATTERN = /\b(arxiv|lm arena|arena|playground|sdk tracker|github|pypi|npm|rss|reddit|web app|frontend|leaderboard)\b/i;
const LABEL_ALIASES = {
  announcement: 'official_release',
  announcements: 'official_release',
  api: 'api_availability',
  availability: 'api_availability',
  benchmark: 'benchmark_update',
  benchmarks: 'benchmark_update',
  client: 'sdk_signal',
  general: 'general_ai_news',
  general_news: 'general_ai_news',
  info: 'general_ai_news',
  informational: 'general_ai_news',
  launch: 'official_release',
  launches: 'official_release',
  leaderboard: 'benchmark_update',
  leak: 'rumor_or_leak',
  leaks: 'rumor_or_leak',
  library: 'sdk_signal',
  model: 'model_update',
  news: 'general_ai_news',
  package: 'sdk_signal',
  paper: 'research_paper',
  release: 'official_release',
  releases: 'official_release',
  research: 'research_paper',
  rumor: 'rumor_or_leak',
  rumors: 'rumor_or_leak',
  sdk: 'sdk_signal',
  speculative: 'rumor_or_leak',
  unrelated: 'irrelevant',
  update: 'model_update',
  updates: 'model_update',
};

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function createEmptyEntities() {
  return {
    provider: null,
    modelFamily: null,
    modelId: null,
    releaseSurface: null,
  };
}

function canonicalizeLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[`'".]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLabel(value, context = {}, repairNotes = []) {
  const normalized = canonicalizeLabel(value);
  const keywordLabel = PRIMARY_LABELS.includes(context.keywordResult?.label)
    ? context.keywordResult.label
    : null;

  if (PRIMARY_LABELS.includes(normalized)) {
    return normalized;
  }

  let mappedLabel = LABEL_ALIASES[normalized] || null;
  if (!mappedLabel && normalized) {
    if (/rumou?r|leak|speculat/.test(normalized)) mappedLabel = 'rumor_or_leak';
    else if (/release|launch|announc/.test(normalized)) mappedLabel = 'official_release';
    else if (/api/.test(normalized)) mappedLabel = 'api_availability';
    else if (/paper|research/.test(normalized)) mappedLabel = 'research_paper';
    else if (/benchmark|leaderboard|arena/.test(normalized)) mappedLabel = 'benchmark_update';
    else if (/sdk|client|package|library/.test(normalized)) mappedLabel = 'sdk_signal';
    else if (/update|model/.test(normalized)) mappedLabel = 'model_update';
    else if (/irrelevant|ignore|unrelated/.test(normalized)) mappedLabel = 'irrelevant';
    else if (/news|info|general/.test(normalized)) mappedLabel = 'general_ai_news';
  }

  if (mappedLabel) {
    if (mappedLabel !== value) {
      repairNotes.push('label_repaired');
    }

    if (mappedLabel === 'general_ai_news' && keywordLabel && keywordLabel !== 'irrelevant') {
      repairNotes.push('label_keyword_preferred');
      return keywordLabel;
    }

    return mappedLabel;
  }

  if (keywordLabel) {
    repairNotes.push('label_keyword_fallback');
    return keywordLabel;
  }

  repairNotes.push('label_defaulted');
  return 'general_ai_news';
}

function clampConfidence(value, fallback = 0) {
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    value = Number(value.trim().slice(0, -1)) / 100;
  }

  let numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    numeric = Number(fallback);
  }

  if (Number.isFinite(numeric) && numeric > 1 && numeric <= 100) {
    numeric = numeric / 100;
  }

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

function normalizeReasonCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeReasonCodes(value, context = {}, repairNotes = []) {
  let rawCodes = [];

  if (Array.isArray(value)) {
    rawCodes = value.flatMap((entry) => {
      if (typeof entry === 'string') return [entry];
      if (isPlainObject(entry)) {
        return [entry.code, entry.reason, entry.type, entry.value].filter(Boolean);
      }
      return [];
    });
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      rawCodes = trimmed.split(/[\n,;|]+/).map((entry) => entry.trim()).filter(Boolean);
      if (rawCodes.length === 0) {
        rawCodes = [trimmed];
      }
      repairNotes.push('reason_codes_repaired');
    }
  } else if (value != null) {
    repairNotes.push('reason_codes_defaulted');
  }

  if (rawCodes.length === 0 && Array.isArray(context.keywordResult?.reasonCodes)) {
    rawCodes = context.keywordResult.reasonCodes;
    if (rawCodes.length > 0) {
      repairNotes.push('reason_codes_keyword_fallback');
    }
  }

  return [...new Set(rawCodes.map(normalizeReasonCode).filter(Boolean))].slice(0, 8);
}

function coerceOptionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (/^(null|undefined|none|n\/a|na|unknown)$/i.test(normalized)) return null;
  return normalized.length > 0 ? normalized : null;
}

function inferReleaseSurfaceFromText(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;
  if (text.includes('github')) return 'github';
  if (text.includes('reddit') || text.includes('forum') || text.includes('community')) return 'community forum';
  if (text.includes('api') || text.includes('platform') || text.includes('console')) return 'api';
  if (text.includes('blog') || text.includes('news') || text.includes('changelog') || text.includes('article')) return 'blog';
  return null;
}

function extractEntityValue(entry) {
  if (typeof entry === 'string') {
    return { type: null, value: entry };
  }

  if (isPlainObject(entry)) {
    return {
      type: coerceOptionalString(entry.type || entry.key || entry.name),
      value: coerceOptionalString(entry.value || entry.text || entry.id || entry.label),
    };
  }

  return { type: null, value: null };
}

function stripEntityObject(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    provider: coerceOptionalString(source.provider),
    modelFamily: coerceOptionalString(source.modelFamily),
    modelId: coerceOptionalString(source.modelId),
    releaseSurface: coerceOptionalString(source.releaseSurface),
  };
}

function normalizeModelCandidate(value) {
  const normalized = coerceOptionalString(value);
  if (!normalized) return null;
  return normalized
    .replace(/[“”]/g, '"')
    .replace(/[()\[\]{}]/g, ' ')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.]+$/g, '')
    .trim();
}

function modelSpecificityScore(value) {
  const normalized = normalizeModelCandidate(value);
  if (!normalized) return -1;

  const versionParts = normalized.match(/\d+(?:\.\d+)*/g) || [];
  const separators = normalized.match(/[-\s]/g) || [];
  let score = normalized.length;
  score += versionParts.length * 15;
  score += versionParts.reduce((sum, part) => sum + part.split('.').length, 0) * 5;
  score += Math.min(20, separators.length * 3);
  if (/\b(?:pro|max|omni|flash|mini|turbo|preview|exp|experimental|vision|audio|coder|chat|reasoner|instruct)\b/i.test(normalized)) {
    score += 12;
  }
  if (/\d/.test(normalized)) {
    score += 8;
  }
  return score;
}

function isMoreSpecificModel(candidate, current) {
  const candidateScore = modelSpecificityScore(candidate);
  const currentScore = modelSpecificityScore(current);
  if (candidateScore < 0) return false;
  if (currentScore < 0) return true;

  const candidateNormalized = normalizeText(candidate);
  const currentNormalized = normalizeText(current);
  if (candidateNormalized === currentNormalized) return false;
  if (candidateNormalized.includes(currentNormalized) && candidateScore >= currentScore) return true;
  if (currentNormalized.includes(candidateNormalized) && candidateScore <= currentScore) return false;
  return candidateScore > currentScore;
}

function extractModelCandidatesFromText(text) {
  if (!text) return [];

  const candidates = [];
  for (const pattern of MODEL_EXTRACTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = normalizeModelCandidate(match[0]);
      if (!value) continue;
      candidates.push({
        value,
        index: match.index,
        specificity: modelSpecificityScore(value),
      });
    }
  }

  candidates.sort((left, right) => {
    if (left.index !== right.index) return left.index - right.index;
    return right.specificity - left.specificity;
  });

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizeText(candidate.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((candidate) => candidate.value);
}

function choosePreferredModelCandidate(context = {}, entities = {}) {
  const titleCandidates = extractModelCandidatesFromText(context.item?.title || '');
  const descriptionCandidates = extractModelCandidatesFromText(context.item?.description || '');
  const explicitCandidates = [
    entities.modelId,
    entities.modelFamily,
    context.keywordResult?.entities?.modelId,
    context.keywordResult?.entities?.modelFamily,
  ].map(normalizeModelCandidate).filter(Boolean);

  if (titleCandidates.length > 0) {
    return titleCandidates[0];
  }

  const ordered = [...explicitCandidates, ...descriptionCandidates];

  let best = null;
  for (const candidate of ordered) {
    if (!best || isMoreSpecificModel(candidate, best)) {
      best = candidate;
    }
  }

  return best;
}

function canonicalizeProvider(value) {
  const normalized = coerceOptionalString(value);
  if (!normalized) return null;

  for (const alias of PROVIDER_ALIASES) {
    if (alias.pattern.test(normalized)) {
      return alias.canonical;
    }
  }

  if (SURFACE_PROVIDER_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function deriveProviderFromModel(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (normalized.startsWith('claude')) return 'Anthropic';
  if (normalized.startsWith('gpt') || /^o[134](?:[-\s]|\d|$)/.test(normalized)) return 'OpenAI';
  if (normalized.startsWith('gemini') || normalized.startsWith('gemma')) return 'Google';
  if (normalized.startsWith('qwen')) return 'Qwen';
  if (normalized.startsWith('deepseek')) return 'DeepSeek';
  if (normalized.startsWith('llama')) return 'Meta';
  if (normalized.startsWith('mistral') || normalized.startsWith('mixtral') || normalized.startsWith('codestral')) return 'Mistral';
  if (normalized.startsWith('grok')) return 'xAI';
  if (normalized.startsWith('glm') || normalized.startsWith('chatglm')) return 'GLM';
  if (normalized.startsWith('yi')) return 'Yi';
  if (normalized.startsWith('kimi')) return 'Kimi';
  if (normalized.startsWith('doubao')) return 'ByteDance';
  if (normalized.startsWith('ernie')) return 'Baidu';
  return null;
}

function canonicalizeReleaseSurface(value, context = {}) {
  const normalized = coerceOptionalString(value);
  const text = [
    normalized,
    context.item?.sourceName,
    context.item?.sourceType,
    context.item?.url,
  ].filter(Boolean).join(' ');

  if (/github|releases\/tag|repo/i.test(text)) return 'github';
  if (/\bpypi\b/i.test(text)) return 'pypi';
  if (/\bnpm\b/i.test(text)) return 'npm';
  if (/leaderboard|lm arena|\barena\b/i.test(text) || context.item?.sourceType === 'leaderboard') return 'leaderboard';
  if (/frontend|web app|playground/i.test(text) || context.item?.sourceType === 'playground-leak') return 'frontend';
  if (/arxiv|cs\.[a-z]+/i.test(text) || context.item?.sourceType === 'arxiv') return 'arxiv';
  if (/changelog/i.test(text) || context.item?.sourceType === 'changelog') return 'changelog';
  if (/api|messages api|cloud api|console|platform/i.test(text)) return 'api';
  if (/blog|news|article/i.test(text) || ['rss', 'scrape', 'china-ai'].includes(context.item?.sourceType)) return 'blog';
  return normalized || inferReleaseSurfaceFromText(text);
}

function finalizeEntities(entities, context = {}, repairNotes = []) {
  const preferredModel = choosePreferredModelCandidate(context, entities);
  if (preferredModel) {
    if (!entities.modelId || isMoreSpecificModel(preferredModel, entities.modelId)) {
      entities.modelId = preferredModel;
      repairNotes.push('entities_model_id_canonicalized');
    }
    if (!entities.modelFamily || isMoreSpecificModel(preferredModel, entities.modelFamily)) {
      entities.modelFamily = preferredModel;
      repairNotes.push('entities_model_family_canonicalized');
    }
  }

  const providerFromModel = deriveProviderFromModel(entities.modelId || entities.modelFamily || preferredModel);
  const providerFromEntities = canonicalizeProvider(entities.provider);
  const providerFromKeyword = canonicalizeProvider(context.keywordResult?.entities?.provider);
  const providerFromSource = canonicalizeProvider(context.item?.sourceName);
  const nextProvider = providerFromModel || providerFromEntities || providerFromKeyword || providerFromSource;
  if (nextProvider && nextProvider !== entities.provider) {
    entities.provider = nextProvider;
    repairNotes.push('entities_provider_canonicalized');
  } else {
    entities.provider = nextProvider || entities.provider;
  }

  const canonicalReleaseSurface = canonicalizeReleaseSurface(entities.releaseSurface, context);
  if (canonicalReleaseSurface && canonicalReleaseSurface !== entities.releaseSurface) {
    entities.releaseSurface = canonicalReleaseSurface;
    repairNotes.push('entities_release_surface_canonicalized');
  } else {
    entities.releaseSurface = canonicalReleaseSurface;
  }

  return stripEntityObject(entities);
}

function normalizeEntities(value, context = {}, repairNotes = []) {
  const keywordEntities = stripEntityObject(context.keywordResult?.entities);
  const entities = {
    ...createEmptyEntities(),
    ...keywordEntities,
  };

  if (isPlainObject(value)) {
    const source = value;
    entities.provider = coerceOptionalString(source.provider || source.vendor || source.organization) || entities.provider;
    entities.modelFamily = coerceOptionalString(source.modelFamily || source.model_family || source.family || source.model) || entities.modelFamily;
    entities.modelId = coerceOptionalString(source.modelId || source.model_id || source.id || source.model) || entities.modelId;
    entities.releaseSurface = coerceOptionalString(source.releaseSurface || source.release_surface || source.surface || source.channel)
      || inferReleaseSurfaceFromText(source.url || source.link || source.releaseSurface)
      || entities.releaseSurface;
  } else if (Array.isArray(value)) {
    repairNotes.push('entities_array_repaired');
    for (const entry of value) {
      const { type, value: entityValue } = extractEntityValue(entry);
      if (!entityValue) continue;

      const normalizedType = canonicalizeLabel(type);
      if (/provider|vendor|organization/.test(normalizedType)) {
        entities.provider = entityValue;
      } else if (/model_family|family/.test(normalizedType)) {
        entities.modelFamily = entityValue;
      } else if (/model_id|model|id/.test(normalizedType)) {
        entities.modelId = entityValue;
      } else if (/surface|channel|release_surface/.test(normalizedType)) {
        entities.releaseSurface = entityValue;
      } else {
        entities.releaseSurface = entities.releaseSurface || inferReleaseSurfaceFromText(entityValue);
      }
    }
  } else if (typeof value === 'string' && value.trim()) {
    repairNotes.push('entities_string_repaired');
    entities.releaseSurface = entities.releaseSurface || inferReleaseSurfaceFromText(value);
    if (!entities.modelFamily && !entities.modelId && !entities.releaseSurface) {
      entities.modelFamily = value.trim();
      entities.modelId = value.trim();
    }
  } else if (value != null) {
    repairNotes.push('entities_defaulted');
  }

  if (!entities.releaseSurface) {
    entities.releaseSurface = inferReleaseSurfaceFromText([
      context.item?.url,
      context.item?.sourceName,
      context.item?.sourceType,
      context.item?.title,
      context.item?.description,
    ].filter(Boolean).join(' ')) || entities.releaseSurface;
  }

  if (entities.modelId && !entities.modelFamily) {
    entities.modelFamily = entities.modelId;
  }
  if (entities.modelFamily && !entities.modelId) {
    entities.modelId = entities.modelFamily;
  }

  return finalizeEntities(entities, context, repairNotes);
}

function normalizePriorityHint(value, context = {}, repairNotes = []) {
  const normalized = canonicalizeLabel(value);
  if (['critical', 'high', 'immediate', 'urgent'].includes(normalized)) return 'high';
  if (['low', 'minor'].includes(normalized)) return 'low';
  if (['medium', 'moderate', 'normal'].includes(normalized)) return 'normal';
  if (typeof value === 'string' && value.trim()) {
    repairNotes.push('priority_hint_repaired');
  }

  if (typeof context.keywordResult?.priorityHint === 'string' && context.keywordResult.priorityHint.trim()) {
    return context.keywordResult.priorityHint;
  }

  if (Number(context.item?.priority) <= 1) return 'high';
  if (Number(context.keywordResult?.confidence) >= 0.75) return 'high';
  if (Number(context.keywordResult?.confidence) >= 0.3) return 'normal';
  return 'low';
}

function normalizeBoolean(value, fallback = false, repairNotes = [], repairNote = null) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(normalized)) {
      if (repairNote) repairNotes.push(repairNote);
      return true;
    }
    if (['false', 'no', '0'].includes(normalized)) {
      if (repairNote) repairNotes.push(repairNote);
      return false;
    }
  }
  return Boolean(fallback);
}

function looksLikeBusinessOnlyCompanyNews(context = {}) {
  const text = [context.item?.title, context.item?.description]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) return false;

  const hasBusinessTerms = BUSINESS_NEWS_PATTERN.test(text);
  if (!hasBusinessTerms) return false;

  const hasNegatedProductSignals = NEGATED_PRODUCT_SIGNAL_PATTERN.test(text);
  const hasProductSignals = PRODUCT_SIGNAL_PATTERN.test(text) && !hasNegatedProductSignals;
  if (hasProductSignals) return false;

  const explicitModelEntity = context.keywordResult?.entities?.modelFamily || context.keywordResult?.entities?.modelId;
  return !explicitModelEntity;
}

function repairClassificationResult(result = {}, context = {}) {
  const repairNotes = [];
  const confidenceFallback = context.keywordResult?.confidence ?? 0;
  let label = normalizeLabel(result.label, context, repairNotes);

  if (
    ['official_release', 'api_availability', 'model_update', 'general_ai_news'].includes(label)
    && looksLikeBusinessOnlyCompanyNews(context)
  ) {
    label = 'irrelevant';
    repairNotes.push('label_business_news_demoted');
  }

  return {
    label,
    confidence: clampConfidence(result.confidence, confidenceFallback),
    reasonCodes: normalizeReasonCodes(result.reasonCodes, context, repairNotes),
    entities: normalizeEntities(result.entities, context, repairNotes),
    priorityHint: normalizePriorityHint(result.priorityHint, context, repairNotes),
    majorEventRelated: normalizeBoolean(result.majorEventRelated, context.keywordResult?.majorEventRelated, repairNotes, 'major_event_related_repaired'),
    repairUsed: repairNotes.length > 0,
    repairNotes: [...new Set(repairNotes)],
  };
}

function hasClassificationShape(result = {}) {
  if (!isPlainObject(result)) return false;

  return ['label', 'confidence', 'reasonCodes', 'entities', 'priorityHint', 'majorEventRelated']
    .some((key) => Object.prototype.hasOwnProperty.call(result, key));
}

function normalizeClassificationResult(result = {}, context = {}) {
  const repaired = repairClassificationResult(result, context);
  return {
    label: repaired.label,
    confidence: repaired.confidence,
    reasonCodes: repaired.reasonCodes,
    entities: repaired.entities,
    priorityHint: repaired.priorityHint,
    fallbackUsed: result.fallbackUsed === true,
    providerUsed: result.providerUsed || 'keyword',
    majorEventRelated: repaired.majorEventRelated,
    repairUsed: result.repairUsed === true || repaired.repairUsed === true,
    repairNotes: [...new Set([...(Array.isArray(result.repairNotes) ? result.repairNotes : []), ...repaired.repairNotes])],
  };
}

function validateClassificationResult(result = {}, options = {}) {
  const { requireProviderUsed = true } = options;
  if (!isPlainObject(result)) return false;
  if (!PRIMARY_LABELS.includes(result.label)) return false;
  if (typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) return false;
  if (!Array.isArray(result.reasonCodes) || result.reasonCodes.some((reasonCode) => typeof reasonCode !== 'string' || !reasonCode.trim())) return false;
  if (!isPlainObject(result.entities)) return false;
  if (!ENTITY_KEYS.every((key) => Object.prototype.hasOwnProperty.call(result.entities, key))) return false;
  if (!ENTITY_KEYS.every((key) => result.entities[key] === null || typeof result.entities[key] === 'string')) return false;
  if (typeof result.priorityHint !== 'string' || !result.priorityHint.trim()) return false;
  if (typeof result.majorEventRelated !== 'boolean') return false;
  if (typeof result.fallbackUsed !== 'boolean') return false;
  if (typeof result.repairUsed !== 'boolean') return false;
  if (!Array.isArray(result.repairNotes) || result.repairNotes.some((repairNote) => typeof repairNote !== 'string' || !repairNote.trim())) return false;
  if (requireProviderUsed && (typeof result.providerUsed !== 'string' || !result.providerUsed.trim())) return false;
  return true;
}

module.exports = {
  PRIMARY_LABELS,
  ENTITY_KEYS,
  LABEL_ALIASES,
  createEmptyEntities,
  canonicalizeLabel,
  repairClassificationResult,
  hasClassificationShape,
  normalizeClassificationResult,
  validateClassificationResult,
  clampConfidence,
  looksLikeBusinessOnlyCompanyNews,
};
