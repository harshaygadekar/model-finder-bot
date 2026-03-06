const test = require('node:test');
const assert = require('node:assert/strict');

const groqModulePath = require.resolve('../../src/services/classification/groq-classifier');
const httpModulePath = require.resolve('../../src/services/http');

function restoreModule(modulePath, originalModule) {
  if (originalModule) {
    require.cache[modulePath] = originalModule;
  } else {
    delete require.cache[modulePath];
  }
}

test('getGroqResponseFormat chooses a model-compatible response format', () => {
  delete require.cache[groqModulePath];
  const {
    getGroqResponseFormat,
    STRICT_JSON_SCHEMA_MODELS,
    BEST_EFFORT_JSON_SCHEMA_MODELS,
  } = require('../../src/services/classification/groq-classifier');

  const defaultFormat = getGroqResponseFormat('llama-3.1-8b-instant');
  assert.equal(defaultFormat.type, 'json_object');

  const strictModel = [...STRICT_JSON_SCHEMA_MODELS][0];
  const strictFormat = getGroqResponseFormat(strictModel);
  assert.equal(strictFormat.type, 'json_schema');
  assert.equal(strictFormat.json_schema.strict, true);

  const bestEffortModel = [...BEST_EFFORT_JSON_SCHEMA_MODELS].find((model) => !STRICT_JSON_SCHEMA_MODELS.has(model));
  const bestEffortFormat = getGroqResponseFormat(bestEffortModel);
  assert.equal(bestEffortFormat.type, 'json_schema');
  assert.equal(bestEffortFormat.json_schema.strict, false);
});

test('classifyWithGroq accepts valid JSON object responses for the default model path', async () => {
  const originalHttpModule = require.cache[httpModulePath];
  const originalModel = process.env.CLASSIFIER_MODEL;

  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      post: async (_url, body) => {
        assert.equal(body.response_format.type, 'json_object');
        return {
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    label: 'official_release',
                    confidence: 0.97,
                    reasonCodes: ['anthropic', 'release', 'api'],
                    entities: {
                      provider: 'anthropic',
                      modelFamily: 'Claude 4.1',
                      modelId: 'Claude 4.1',
                      releaseSurface: 'blog',
                    },
                    priorityHint: 'high',
                    majorEventRelated: false,
                  }),
                },
              },
            ],
          },
        };
      },
    },
  };
  delete require.cache[groqModulePath];
  delete process.env.CLASSIFIER_MODEL;

  try {
    const { classifyWithGroq } = require('../../src/services/classification/groq-classifier');
    const result = await classifyWithGroq(
      {
        sourceName: 'Anthropic Blog',
        sourceType: 'rss',
        priority: 0,
        title: 'Anthropic launches Claude 4.1',
        description: 'Launch summary',
        url: 'https://example.com/claude-4-1',
      },
      {
        label: 'official_release',
        confidence: 0.92,
        reasonCodes: ['anthropic'],
      }
    );

    assert.equal(result.providerUsed, 'groq:llama-3.1-8b-instant');
    assert.equal(result.label, 'official_release');
    assert.equal(result.entities.provider, 'Anthropic');
  } finally {
    if (originalModel === undefined) {
      delete process.env.CLASSIFIER_MODEL;
    } else {
      process.env.CLASSIFIER_MODEL = originalModel;
    }
    restoreModule(httpModulePath, originalHttpModule);
    delete require.cache[groqModulePath];
  }
});

test('classifyWithGroq repairs schema drift in json_object responses', async () => {
  const originalHttpModule = require.cache[httpModulePath];

  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      post: async () => ({
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  label: 'informational',
                  confidence: '93%',
                  reasonCodes: 'official, release',
                  entities: [
                    { type: 'url', value: 'https://example.com/claude-4-1' },
                  ],
                  priorityHint: 'medium',
                  majorEventRelated: 'true',
                }),
              },
            },
          ],
        },
      }),
    },
  };
  delete require.cache[groqModulePath];

  try {
    const { classifyWithGroq } = require('../../src/services/classification/groq-classifier');
    const result = await classifyWithGroq(
      {
        sourceName: 'Anthropic Blog',
        sourceType: 'rss',
        priority: 0,
        title: 'Anthropic launches Claude 4.1',
        description: 'Launch summary',
        url: 'https://example.com/claude-4-1',
      },
      {
        label: 'official_release',
        confidence: 0.92,
        reasonCodes: ['anthropic'],
        entities: {
          provider: 'Anthropic',
          modelFamily: 'Claude 4.1',
          modelId: 'Claude 4.1',
          releaseSurface: 'blog',
        },
        priorityHint: 'high',
        majorEventRelated: false,
      }
    );

    assert.equal(result.label, 'official_release');
    assert.equal(result.confidence, 0.93);
    assert.deepEqual(result.reasonCodes, ['official', 'release']);
    assert.equal(result.entities.provider, 'Anthropic');
    assert.equal(result.repairUsed, true);
    assert.equal(result.repairNotes.includes('reason_codes_repaired'), true);
  } finally {
    restoreModule(httpModulePath, originalHttpModule);
    delete require.cache[groqModulePath];
  }
});

test('classifyWithGroq retries once with a repair prompt when the initial response is not parseable', async () => {
  const originalHttpModule = require.cache[httpModulePath];
  let callCount = 0;

  require.cache[httpModulePath] = {
    id: httpModulePath,
    filename: httpModulePath,
    loaded: true,
    exports: {
      post: async (_url, body) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            data: {
              choices: [
                {
                  message: {
                    content: 'not valid json at all',
                  },
                },
              ],
            },
          };
        }

        assert.equal(body.messages[1].role, 'user');
        assert.equal(body.messages[1].content.includes('invalidCandidate'), true);
        return {
          data: {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    label: 'official_release',
                    confidence: 0.96,
                    reasonCodes: ['official', 'release'],
                    entities: {
                      provider: 'Anthropic',
                      modelFamily: 'Claude 4.1',
                      modelId: 'Claude 4.1',
                      releaseSurface: 'blog',
                    },
                    priorityHint: 'high',
                    majorEventRelated: false,
                  }),
                },
              },
            ],
          },
        };
      },
    },
  };
  delete require.cache[groqModulePath];

  try {
    const { classifyWithGroq } = require('../../src/services/classification/groq-classifier');
    const result = await classifyWithGroq(
      {
        sourceName: 'Anthropic Blog',
        sourceType: 'rss',
        priority: 0,
        title: 'Anthropic launches Claude 4.1',
        description: 'Launch summary',
        url: 'https://example.com/claude-4-1',
      },
      {
        label: 'official_release',
        confidence: 0.92,
        reasonCodes: ['anthropic'],
      }
    );

    assert.equal(callCount, 2);
    assert.equal(result.label, 'official_release');
    assert.equal(result.repairUsed, true);
    assert.equal(result.repairNotes.includes('llm_schema_repair_roundtrip'), true);
  } finally {
    restoreModule(httpModulePath, originalHttpModule);
    delete require.cache[groqModulePath];
  }
});
