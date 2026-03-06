const test = require('node:test');
const assert = require('node:assert/strict');

const {
  repairClassificationResult,
  normalizeClassificationResult,
  validateClassificationResult,
  looksLikeBusinessOnlyCompanyNews,
} = require('../../src/services/classification/schema');

test('repairClassificationResult coerces label aliases and malformed fields into the expected shape', () => {
  const repaired = repairClassificationResult(
    {
      label: 'informational',
      confidence: '93%',
      reasonCodes: 'official, release',
      entities: [{ type: 'url', value: 'https://example.com/claude-4-1' }],
      priorityHint: 'medium',
      majorEventRelated: 'true',
    },
    {
      item: {
        sourceName: 'Anthropic Blog',
        sourceType: 'rss',
        priority: 0,
        url: 'https://example.com/claude-4-1',
      },
      keywordResult: {
        label: 'official_release',
        confidence: 0.92,
        reasonCodes: ['anthropic'],
        entities: {
          provider: 'Anthropic',
          modelFamily: 'Claude 4.1',
          modelId: 'Claude 4.1',
          releaseSurface: 'blog',
        },
      },
    }
  );

  assert.equal(repaired.label, 'official_release');
  assert.equal(repaired.confidence, 0.93);
  assert.deepEqual(repaired.reasonCodes, ['official', 'release']);
  assert.equal(repaired.entities.provider, 'Anthropic');
  assert.equal(repaired.priorityHint, 'normal');
  assert.equal(repaired.majorEventRelated, true);
  assert.equal(repaired.repairUsed, true);
});

test('normalizeClassificationResult returns a strictly valid result object after repair', () => {
  const normalized = normalizeClassificationResult(
    {
      label: 'informational',
      confidence: '0.4',
      reasonCodes: '',
      entities: 'community forum',
      priorityHint: '',
      majorEventRelated: 'false',
      providerUsed: 'groq:llama-3.1-8b-instant',
      fallbackUsed: false,
    },
    {
      item: {
        sourceType: 'reddit',
        sourceName: 'Forum A',
        priority: 3,
      },
      keywordResult: {
        label: 'rumor_or_leak',
        confidence: 0.58,
        reasonCodes: ['leak'],
      },
    }
  );

  assert.equal(validateClassificationResult(normalized), true);
  assert.equal(normalized.providerUsed, 'groq:llama-3.1-8b-instant');
  assert.equal(normalized.fallbackUsed, false);
});

test('business-only company news is demoted to irrelevant during repair', () => {
  const context = {
    item: {
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
      title: 'Anthropic opens new EMEA office in London',
      description: 'The company shared office expansion, operations, and hiring plans for the region, with no product or model announcement.',
    },
    keywordResult: {
      label: 'official_release',
      confidence: 1,
      reasonCodes: ['hiring', 'announcement', 'anthropic'],
      entities: {
        provider: 'anthropic',
        modelFamily: null,
        modelId: null,
        releaseSurface: null,
      },
    },
  };

  assert.equal(looksLikeBusinessOnlyCompanyNews(context), true);

  const repaired = repairClassificationResult(
    {
      label: 'official_release',
      confidence: 0.8,
      reasonCodes: ['hiring', 'announce'],
      entities: {
        provider: 'Anthropic',
        modelFamily: null,
        modelId: null,
        releaseSurface: 'blog',
      },
      priorityHint: 'low',
      majorEventRelated: false,
    },
    context
  );

  assert.equal(repaired.label, 'irrelevant');
  assert.equal(repaired.repairNotes.includes('label_business_news_demoted'), true);
});

test('normalizeClassificationResult canonicalizes provider and model from paper-style sources', () => {
  const normalized = normalizeClassificationResult(
    {
      label: 'research_paper',
      confidence: 0.95,
      reasonCodes: ['multimodal', 'qwen2'],
      entities: {
        provider: 'ArXiv',
        modelFamily: null,
        modelId: null,
        releaseSurface: 'cs.AI',
      },
      priorityHint: 'normal',
      majorEventRelated: false,
      providerUsed: 'groq:llama-3.1-8b-instant',
      fallbackUsed: false,
    },
    {
      item: {
        sourceName: 'ArXiv: cs.AI',
        sourceType: 'arxiv',
        priority: 2,
        title: 'Qwen2.5-Omni Technical Report',
        description: 'We present Qwen2.5-Omni, a multimodal model with speech, vision, and text capabilities.',
        url: 'https://arxiv.org/abs/2503.01234',
      },
      keywordResult: {
        label: 'research_paper',
        confidence: 0.95,
        reasonCodes: ['multimodal', 'qwen2', 'qwen'],
        entities: {
          provider: 'qwen',
          modelFamily: 'Qwen2',
          modelId: 'Qwen2',
          releaseSurface: null,
        },
        priorityHint: 'high',
      },
    }
  );

  assert.equal(normalized.entities.provider, 'Qwen');
  assert.equal(normalized.entities.modelFamily, 'Qwen2.5-Omni');
  assert.equal(normalized.entities.modelId, 'Qwen2.5-Omni');
  assert.equal(normalized.entities.releaseSurface, 'arxiv');
});

test('normalizeClassificationResult prefers the leading title model and canonical provider aliases', () => {
  const normalized = normalizeClassificationResult(
    {
      label: 'benchmark_update',
      confidence: 0.9,
      reasonCodes: ['claude_4', 'gpt_5'],
      entities: {
        provider: null,
        modelFamily: null,
        modelId: null,
        releaseSurface: 'leaderboard',
      },
      priorityHint: 'high',
      majorEventRelated: false,
      providerUsed: 'groq:llama-3.1-8b-instant',
      fallbackUsed: false,
    },
    {
      item: {
        sourceName: 'LM Arena',
        sourceType: 'leaderboard',
        priority: 4,
        title: 'LM Arena leaderboard update: Claude 4.1 takes the #1 spot above GPT-5 and Gemini 2.5 Pro',
        description: 'Community voting shows Anthropic\'s newest model now leads the text leaderboard.',
      },
      keywordResult: {
        label: 'benchmark_update',
        confidence: 1,
        reasonCodes: ['claude_4', 'gpt_5', 'anthropic'],
        entities: {
          provider: 'anthropic',
          modelFamily: 'GPT-5',
          modelId: 'GPT-5',
          releaseSurface: null,
        },
        priorityHint: 'high',
      },
    }
  );

  assert.equal(normalized.entities.provider, 'Anthropic');
  assert.equal(normalized.entities.modelFamily, 'Claude 4.1');
  assert.equal(normalized.entities.modelId, 'Claude 4.1');
  assert.equal(normalized.entities.releaseSurface, 'leaderboard');
});

test('normalizeClassificationResult maps platform brands like Gemini to canonical providers', () => {
  const normalized = normalizeClassificationResult(
    {
      label: 'rumor_or_leak',
      confidence: 1,
      reasonCodes: ['rumor'],
      entities: {
        provider: 'Gemini',
        modelFamily: 'Gemini',
        modelId: 'gemini-2.5-pro-exp-03-25',
        releaseSurface: 'Gemini frontend code',
      },
      priorityHint: 'High',
      majorEventRelated: true,
      providerUsed: 'groq:llama-3.1-8b-instant',
      fallbackUsed: false,
    },
    {
      item: {
        sourceName: 'Playground: Gemini Web App',
        sourceType: 'playground-leak',
        priority: 1,
        title: 'Potential Unreleased Model: gemini-2.5-pro-exp-03-25',
        description: 'A new model identifier gemini-2.5-pro-exp-03-25 was found in the Gemini frontend code.',
      },
      keywordResult: {
        label: 'rumor_or_leak',
        confidence: 1,
        reasonCodes: ['gemini_2'],
        entities: {
          provider: null,
          modelFamily: 'gemini-2',
          modelId: 'gemini-2',
          releaseSurface: null,
        },
        priorityHint: 'high',
      },
    }
  );

  assert.equal(normalized.entities.provider, 'Google');
  assert.equal(normalized.entities.modelId, 'gemini-2.5-pro-exp-03-25');
  assert.equal(normalized.entities.releaseSurface, 'frontend');
});