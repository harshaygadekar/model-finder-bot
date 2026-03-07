const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');
const { computeDeliveryDecision } = require('../../src/services/intelligence/delivery-policy');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('delivery policy routes structured classifier outputs to the right channels', () => {
  const temp = createTempDbPath('delivery-policy');
  db.init({ dbPath: temp.dbPath });

  try {
    const reliabilityRows = [
      ['Anthropic Blog', 'rss', 0.9],
      ['Alibaba Qwen Blog', 'china-ai', 0.9],
      ['TechCrunch', 'newsletter', 0.8],
      ['ITHome', 'china-ai', 0.8],
      ['Google Blog', 'rss', 0.9],
      ['OpenAI Blog', 'rss', 0.95],
      ['SDK Watch', 'sdk-tracker', 0.55],
    ];

    for (const [sourceName, sourceType, overallScore] of reliabilityRows) {
      db.recordSourceReliabilityScore({
        sourceName,
        sourceType,
        overallScore,
        freshnessScore: overallScore,
        precisionScore: overallScore,
        stabilityScore: overallScore,
        noiseScore: overallScore,
        asOf: new Date().toISOString(),
      });
    }

    const cases = [
      {
        name: 'major official releases go to major-releases',
        item: {
          sourceName: 'Anthropic Blog',
          sourceType: 'rss',
          priority: 0,
          title: 'Anthropic announces Claude 4.1',
          description: 'Official launch of a new frontier model now available via API.',
          eventConfidence: 0.92,
          classification: {
            label: 'official_release',
            confidence: 0.95,
            majorEventRelated: false,
            entities: { provider: 'Anthropic', modelFamily: 'Claude 4.1', modelId: 'Claude 4.1', releaseSurface: 'blog' },
          },
        },
        expectedChannel: 'major-releases',
      },
      {
        name: 'community chatter about launches stays in community-buzz',
        item: {
          sourceName: 'LocalLLaMA',
          sourceType: 'reddit',
          priority: 3,
          title: 'Google just launched Gemini 3?',
          description: 'Community thread reacting to the launch and comparing benchmarks.',
          eventConfidence: 0.8,
          classification: {
            label: 'official_release',
            confidence: 0.8,
            majorEventRelated: false,
            entities: { provider: 'Google', modelFamily: 'Gemini 3', modelId: 'Gemini 3', releaseSurface: 'community forum' },
          },
        },
        expectedChannel: 'community-buzz',
      },
      {
        name: 'broad company analysis lands in tech-news',
        item: {
          sourceName: 'TechCrunch',
          sourceType: 'newsletter',
          priority: 2,
          title: 'OpenAI outlines its enterprise AI roadmap for 2026',
          description: 'A report on company strategy, partnerships, and broader product direction.',
          eventConfidence: 0.68,
          classification: {
            label: 'general_ai_news',
            confidence: 0.68,
            majorEventRelated: false,
            entities: { provider: 'OpenAI', modelFamily: null, modelId: null, releaseSurface: 'article' },
          },
        },
        expectedChannel: 'tech-news',
      },
      {
        name: 'research papers stay isolated',
        item: {
          sourceName: 'ArXiv',
          sourceType: 'arxiv',
          priority: 1,
          title: 'Sparse reasoning for frontier models',
          description: 'A new research paper on model efficiency.',
          eventConfidence: 0.9,
          classification: {
            label: 'research_paper',
            confidence: 0.9,
            majorEventRelated: false,
            entities: { provider: null, modelFamily: null, modelId: null, releaseSurface: 'arxiv' },
          },
        },
        expectedChannel: 'research-papers',
      },
      {
        name: 'arena leaderboard entries go to leaderboard-updates',
        item: {
          sourceName: 'LM Arena',
          sourceType: 'arena-models',
          priority: 1,
          title: 'New model enters LM Arena leaderboard',
          description: 'Arena ranking updated with a new blind-tested entry and eval scores.',
          eventConfidence: 0.82,
          classification: {
            label: 'benchmark_update',
            confidence: 0.82,
            majorEventRelated: false,
            entities: { provider: null, modelFamily: null, modelId: null, releaseSurface: 'leaderboard' },
          },
        },
        expectedChannel: 'leaderboard-updates',
      },
      {
        name: 'major official GitHub model releases can reach major-releases',
        item: {
          sourceName: 'Meta GitHub',
          sourceType: 'github',
          priority: 1,
          title: 'Meta releases Llama 4 weights on GitHub',
          description: 'Official repository release for the new flagship open-source model.',
          eventConfidence: 0.93,
          classification: {
            label: 'official_release',
            confidence: 0.93,
            majorEventRelated: false,
            entities: { provider: 'Meta', modelFamily: 'Llama 4', modelId: 'Llama 4', releaseSurface: 'github' },
          },
          tags: ['new-model', 'open-source'],
        },
        expectedChannel: 'major-releases',
      },
      {
        name: 'api registry discoveries become model-updates, not major-releases',
        item: {
          sourceName: 'API Models: OpenAI',
          sourceType: 'api-models',
          priority: 0,
          title: '🆕 New OpenAI Model: gpt-5.4',
          description: 'This model is now live and callable via the API. It may not yet be officially announced.',
          eventConfidence: 0.95,
          classification: {
            label: 'api_availability',
            confidence: 0.95,
            majorEventRelated: false,
            entities: { provider: 'OpenAI', modelFamily: 'gpt-5.4', modelId: 'gpt-5.4', releaseSurface: 'api' },
          },
          tags: ['new-model', 'api-live'],
        },
        expectedChannel: 'model-updates',
      },
      {
        name: 'general China ecosystem news uses china-ai as primary',
        item: {
          sourceName: 'ITHome',
          sourceType: 'china-ai',
          priority: 2,
          title: 'DeepSeek expands enterprise AI rollout in China',
          description: 'A report on the Chinese AI landscape and adoption trends.',
          eventConfidence: 0.72,
          classification: {
            label: 'general_ai_news',
            confidence: 0.72,
            majorEventRelated: false,
            entities: { provider: 'DeepSeek', modelFamily: null, modelId: null, releaseSurface: 'article' },
          },
        },
        expectedChannel: 'china-ai',
      },
      {
        name: 'generic global company coverage should not be pulled into china-ai without China-specific context',
        item: {
          sourceName: 'ByteDance Global News',
          sourceType: 'newsletter',
          priority: 2,
          title: 'ByteDance expands its European AI video tooling team',
          description: 'International company expansion and product operations update.',
          eventConfidence: 0.67,
          classification: {
            label: 'general_ai_news',
            confidence: 0.67,
            majorEventRelated: false,
            entities: { provider: 'ByteDance', modelFamily: null, modelId: null, releaseSurface: 'article' },
          },
        },
        expectedChannel: 'tech-news',
      },
      {
        name: 'major China model launches still prioritize the more specific domain channel',
        item: {
          sourceName: 'Alibaba Qwen Blog',
          sourceType: 'china-ai',
          priority: 0,
          title: 'Alibaba announces Qwen 3 flagship model release',
          description: 'The new model is now available with upgraded reasoning and multimodal support.',
          eventConfidence: 0.96,
          classification: {
            label: 'official_release',
            confidence: 0.96,
            majorEventRelated: false,
            entities: { provider: 'Qwen', modelFamily: 'Qwen 3', modelId: 'Qwen 3', releaseSurface: 'blog' },
          },
        },
        expectedChannel: 'major-releases',
      },
      {
        name: 'planned event announcements route to major-events',
        item: {
          sourceName: 'Google Blog',
          sourceType: 'rss',
          priority: 0,
          title: 'Google announces I/O 2026 dates and keynote schedule',
          description: 'Save the date for Google I/O and register for the livestream.',
          eventConfidence: 0.88,
          classification: {
            label: 'general_ai_news',
            confidence: 0.88,
            majorEventRelated: true,
            entities: { provider: 'Google', modelFamily: null, modelId: null, releaseSurface: 'blog' },
          },
        },
        expectedChannel: 'major-events',
      },
      {
        name: 'event-related launch stories keep their domain channel and mirror to major-events',
        item: {
          sourceName: 'OpenAI Blog',
          sourceType: 'rss',
          priority: 0,
          title: 'At DevDay, OpenAI launches GPT-5.4',
          description: 'Keynote announcement: GPT-5.4 is now available to developers.',
          eventConfidence: 0.97,
          classification: {
            label: 'official_release',
            confidence: 0.97,
            majorEventRelated: true,
            entities: { provider: 'OpenAI', modelFamily: 'GPT-5.4', modelId: 'GPT-5.4', releaseSurface: 'blog' },
          },
        },
        expectedChannel: 'major-releases',
        expectedSecondaryChannels: ['major-events'],
      },
      {
        name: 'weak sdk signals stay in rumors-leaks',
        item: {
          sourceName: 'SDK Watch',
          sourceType: 'sdk-tracker',
          priority: 2,
          title: 'New sdk references hint at GPT-5.4',
          description: 'A package diff surfaced unreleased model names in a client library.',
          eventConfidence: 0.55,
          classification: {
            label: 'sdk_signal',
            confidence: 0.55,
            majorEventRelated: false,
            entities: { provider: 'OpenAI', modelFamily: 'GPT-5.4', modelId: 'GPT-5.4', releaseSurface: 'npm' },
          },
        },
        expectedChannel: 'rumors-leaks',
      },
    ];

    for (const scenario of cases) {
      const decision = computeDeliveryDecision(scenario.item);
      assert.equal(decision.channelKey, scenario.expectedChannel, scenario.name);
      assert.deepEqual(decision.secondaryChannelKeys, scenario.expectedSecondaryChannels || [], `${scenario.name} (secondary)`);
    }
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
