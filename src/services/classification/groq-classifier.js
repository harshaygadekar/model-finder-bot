const http = require('../http');
const { hasClassificationShape, normalizeClassificationResult, validateClassificationResult } = require('./schema');

const DEFAULT_MODEL = process.env.CLASSIFIER_MODEL || 'llama-3.1-8b-instant';
const MAX_SCHEMA_REPAIR_ATTEMPTS = 1;
const STRICT_JSON_SCHEMA_MODELS = new Set([
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
]);
const BEST_EFFORT_JSON_SCHEMA_MODELS = new Set([
  ...STRICT_JSON_SCHEMA_MODELS,
  'openai/gpt-oss-safeguard-20b',
  'moonshotai/kimi-k2-instruct-0905',
  'meta-llama/llama-4-scout-17b-16e-instruct',
]);

function getClassificationTemperature() {
  const parsed = Number(process.env.CLASSIFIER_TEMPERATURE ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getOptionalSeed(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) ? parsed : null;
}

function isGroqAvailable() {
  return Boolean(process.env.GROQ_API_KEY);
}

async function classifyWithGroq(item, keywordResult) {
  const model = process.env.CLASSIFIER_MODEL || DEFAULT_MODEL;
  const timeout = Number(process.env.CLASSIFIER_TIMEOUT_MS || 7000);
  const maxInputChars = Number(process.env.CLASSIFIER_MAX_INPUT_CHARS || 1800);
  const temperature = getClassificationTemperature();
  const seed = getOptionalSeed(process.env.CLASSIFIER_SEED);

  const response = await sendGroqClassificationRequest({
    model,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(model),
      },
      {
        role: 'user',
        content: buildPrompt(item, keywordResult, maxInputChars),
      },
    ],
    timeout,
    temperature,
    seed,
  });

  const rawContent = extractGroqContent(response);
  return normalizeGroqResponseContent(rawContent, {
    item,
    keywordResult,
    model,
    timeout,
    maxInputChars,
    temperature,
    seed,
  });
}

async function sendGroqClassificationRequest({ model, messages, timeout, temperature = getClassificationTemperature(), seed = getOptionalSeed(process.env.CLASSIFIER_SEED) }) {
  const payload = {
    model,
    messages,
    response_format: getGroqResponseFormat(model),
    temperature,
  };
  if (seed !== null) {
    payload.seed = seed;
  }

  return http.post(
    'https://api.groq.com/openai/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout,
      retry: {
        retries: Number(process.env.CLASSIFIER_MAX_RETRIES || 1),
        baseDelayMs: 500,
        maxDelayMs: 2000,
      },
      recordCrawl: false,
    }
  );
}

function extractGroqContent(response) {
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Groq returned no classification content');
  }

  return content;
}

async function normalizeGroqResponseContent(rawContent, {
  item,
  keywordResult,
  model = process.env.CLASSIFIER_MODEL || DEFAULT_MODEL,
  timeout = Number(process.env.CLASSIFIER_TIMEOUT_MS || 7000),
  maxInputChars = Number(process.env.CLASSIFIER_MAX_INPUT_CHARS || 1800),
  temperature = getClassificationTemperature(),
  seed = getOptionalSeed(process.env.CLASSIFIER_SEED),
} = {}) {
  const parsedContent = parseGroqResponseContent(rawContent);
  const normalized = buildNormalizedGroqResult(parsedContent, { item, keywordResult, model });
  if (normalized) {
    return normalized;
  }

  for (let attempt = 0; attempt < MAX_SCHEMA_REPAIR_ATTEMPTS; attempt += 1) {
    const repairResponse = await sendGroqClassificationRequest({
      model,
      messages: buildSchemaRepairMessages(model, item, keywordResult, rawContent, maxInputChars),
      timeout,
      temperature,
      seed,
    });
    const repairRawContent = extractGroqContent(repairResponse);
    const repairParsedContent = parseGroqResponseContent(repairRawContent);
    const repaired = buildNormalizedGroqResult(repairParsedContent, {
      item,
      keywordResult,
      model,
      repairNotes: ['llm_schema_repair_roundtrip'],
    });
    if (repaired) {
      return repaired;
    }
  }

  throw new Error('Groq classification failed schema validation');
}

function buildNormalizedGroqResult(parsed, { item, keywordResult, model, repairNotes = [] } = {}) {
  if (!hasClassificationShape(parsed)) {
    return null;
  }

  const normalized = normalizeClassificationResult({
    ...parsed,
    fallbackUsed: false,
    providerUsed: `groq:${model}`,
    repairUsed: repairNotes.length > 0,
    repairNotes,
  }, { item, keywordResult });

  return validateClassificationResult(normalized) ? normalized : null;
}

function parseGroqResponseContent(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const candidates = [];
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  candidates.push(trimmed);

  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  if (unfenced && unfenced !== trimmed) {
    candidates.push(unfenced);
  }

  const extracted = extractFirstJsonObject(unfenced);
  if (extracted && !candidates.includes(extracted)) {
    candidates.push(extracted);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function extractFirstJsonObject(text) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === '\\') {
      escaping = true;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function buildSchemaRepairMessages(model, item, keywordResult, rawContent, maxInputChars) {
  return [
    {
      role: 'system',
      content: [
        buildSystemPrompt(model),
        'You previously returned an invalid or schema-incompatible object.',
        'Repair it into a valid JSON object using only the allowed labels.',
        'Never return labels such as informational, announcement, or news unless mapped to the allowed taxonomy.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        originalItem: JSON.parse(buildPrompt(item, keywordResult, maxInputChars)),
        invalidCandidate: String(rawContent || '').slice(0, maxInputChars),
        allowedLabels: [
          'official_release',
          'api_availability',
          'model_update',
          'research_paper',
          'benchmark_update',
          'sdk_signal',
          'rumor_or_leak',
          'general_ai_news',
          'irrelevant',
        ],
      }),
    },
  ];
}

function getGroqResponseFormat(model) {
  if (STRICT_JSON_SCHEMA_MODELS.has(model)) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'classification_result',
        strict: true,
        schema: getClassificationJsonSchema(),
      },
    };
  }

  if (BEST_EFFORT_JSON_SCHEMA_MODELS.has(model)) {
    return {
      type: 'json_schema',
      json_schema: {
        name: 'classification_result',
        strict: false,
        schema: getClassificationJsonSchema(),
      },
    };
  }

  return {
    type: 'json_object',
  };
}

function getClassificationJsonSchema() {
  return {
    type: 'object',
    properties: {
      label: { type: 'string' },
      confidence: { type: 'number' },
      reasonCodes: { type: 'array', items: { type: 'string' } },
      entities: {
        type: 'object',
        properties: {
          provider: { type: ['string', 'null'] },
          modelFamily: { type: ['string', 'null'] },
          modelId: { type: ['string', 'null'] },
          releaseSurface: { type: ['string', 'null'] },
        },
        required: ['provider', 'modelFamily', 'modelId', 'releaseSurface'],
        additionalProperties: false,
      },
      priorityHint: { type: 'string' },
      majorEventRelated: { type: 'boolean' },
    },
    required: ['label', 'confidence', 'reasonCodes', 'entities', 'priorityHint', 'majorEventRelated'],
    additionalProperties: false,
  };
}

function buildSystemPrompt(model) {
  const mode = STRICT_JSON_SCHEMA_MODELS.has(model)
    ? 'strict-json-schema'
    : (BEST_EFFORT_JSON_SCHEMA_MODELS.has(model) ? 'best-effort-json-schema' : 'json-object');

  return [
    'Classify AI news items conservatively.',
    'Use irrelevant when the item is not directly about AI models, APIs, releases, benchmarks, SDK signals, or rumors.',
    'Return JSON only. No markdown fences, no prose, no explanation outside the JSON object.',
    'Never invent labels such as informational, announcement, release-news, or update-news. Always map to the allowed labels.',
    'Allowed labels: official_release, api_availability, model_update, research_paper, benchmark_update, sdk_signal, rumor_or_leak, general_ai_news, irrelevant.',
    'The JSON object must contain: label (string), confidence (number 0..1), reasonCodes (array of strings), entities (object with provider, modelFamily, modelId, releaseSurface), priorityHint (string), majorEventRelated (boolean).',
    'Set missing entity values to null.',
    `Response mode: ${mode}.`,
  ].join(' ');
}

function buildPrompt(item, keywordResult, maxInputChars) {
  const payload = {
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    priority: item.priority,
    title: item.title,
    description: String(item.description || '').slice(0, maxInputChars),
    url: item.url,
    keywordLabel: keywordResult.label,
    keywordConfidence: keywordResult.confidence,
    keywordReasons: keywordResult.reasonCodes,
  };

  return JSON.stringify(payload);
}

module.exports = {
  DEFAULT_MODEL,
  STRICT_JSON_SCHEMA_MODELS,
  BEST_EFFORT_JSON_SCHEMA_MODELS,
  isGroqAvailable,
  classifyWithGroq,
  sendGroqClassificationRequest,
  extractGroqContent,
  normalizeGroqResponseContent,
  parseGroqResponseContent,
  getGroqResponseFormat,
  buildSystemPrompt,
  buildPrompt,
  buildSchemaRepairMessages,
  getClassificationTemperature,
  getOptionalSeed,
};
