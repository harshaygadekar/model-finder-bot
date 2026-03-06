#!/usr/bin/env node

require('dotenv').config();

const {
  DEFAULT_MODEL,
  buildPrompt,
  buildSystemPrompt,
  classifyWithGroq,
  extractGroqContent,
  getGroqResponseFormat,
  sendGroqClassificationRequest,
} = require('../src/services/classification/groq-classifier');

const SAMPLES = [
  {
    name: 'official-release-sample',
    item: {
      sourceName: 'Anthropic Blog',
      sourceType: 'rss',
      priority: 0,
      title: 'Anthropic launches Claude 4.1 with 200k context window',
      description: 'Anthropic announced Claude 4.1 is now available through the API for enterprise and developer workflows.',
      url: 'https://example.com/anthropic-claude-4-1',
    },
    keywordResult: {
      label: 'official_release',
      confidence: 0.92,
      reasonCodes: ['anthropic', 'launch', 'api'],
      entities: {
        provider: 'Anthropic',
        modelFamily: 'Claude 4.1',
        modelId: 'Claude 4.1',
        releaseSurface: 'blog',
      },
      priorityHint: 'high',
      majorEventRelated: false,
    },
  },
  {
    name: 'rumor-sample',
    item: {
      sourceName: 'Community Forum',
      sourceType: 'reddit',
      priority: 3,
      title: 'Possible GPT-5 leak spotted in a hidden playground menu',
      description: 'Users claim an unreleased model identifier briefly appeared in a screenshot, but there is no official confirmation yet.',
      url: 'https://example.com/gpt5-leak',
    },
    keywordResult: {
      label: 'rumor_or_leak',
      confidence: 0.58,
      reasonCodes: ['leak', 'unreleased'],
      entities: {
        provider: 'OpenAI',
        modelFamily: 'GPT-5',
        modelId: 'GPT-5',
        releaseSurface: 'community forum',
      },
      priorityHint: 'normal',
      majorEventRelated: false,
    },
  },
];

async function run() {
  const model = process.env.CLASSIFIER_MODEL || DEFAULT_MODEL;
  const timeout = Number(process.env.CLASSIFIER_TIMEOUT_MS || 7000);
  const maxInputChars = Number(process.env.CLASSIFIER_MAX_INPUT_CHARS || 1800);

  if (!process.env.GROQ_API_KEY) {
    console.error(JSON.stringify({ ok: false, error: 'GROQ_API_KEY is not set in environment' }, null, 2));
    process.exit(2);
  }

  const output = {
    ok: true,
    timestamp: new Date().toISOString(),
    model,
    responseFormat: getGroqResponseFormat(model),
    results: [],
  };

  for (const sample of SAMPLES) {
    const entry = {
      sample: sample.name,
    };

    try {
      const rawStarted = Date.now();
      const rawResponse = await sendGroqClassificationRequest({
        model,
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(model),
          },
          {
            role: 'user',
            content: buildPrompt(sample.item, sample.keywordResult, maxInputChars),
          },
        ],
        timeout,
      });

      entry.raw = {
        latencyMs: Date.now() - rawStarted,
        finishReason: rawResponse.data?.choices?.[0]?.finish_reason || null,
        content: extractGroqContent(rawResponse),
        usage: rawResponse.data?.usage || null,
      };
    } catch (error) {
      output.ok = false;
      entry.raw = {
        error: error.message,
      };
    }

    try {
      const normalizedStarted = Date.now();
      const normalizedResult = await classifyWithGroq(sample.item, sample.keywordResult);
      entry.normalized = {
        latencyMs: Date.now() - normalizedStarted,
        result: normalizedResult,
      };
    } catch (error) {
      output.ok = false;
      entry.normalized = {
        error: error.message,
      };
    }

    output.results.push(entry);
  }

  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});