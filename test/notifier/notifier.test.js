const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

test('notifier queues and dispatches alert jobs through the delivery worker', async () => {
  const temp = createTempDbPath('notifier');
  db.init({ dbPath: temp.dbPath });

  const sentMessages = [];
  const channelsModulePath = require.resolve('../../src/bot/channels');
  const embedsModulePath = require.resolve('../../src/bot/embeds');
  const translatorModulePath = require.resolve('../../src/services/translator');
  const notifierModulePath = require.resolve('../../src/services/notifier');

  const originalChannelsModule = require.cache[channelsModulePath];
  const originalEmbedsModule = require.cache[embedsModulePath];
  const originalTranslatorModule = require.cache[translatorModulePath];

  require.cache[channelsModulePath] = {
    id: channelsModulePath,
    filename: channelsModulePath,
    loaded: true,
    exports: {
      getChannel: (key) => ({
        async send(payload) {
          sentMessages.push({ key, payload });
          return { id: `message-${sentMessages.length}` };
        },
      }),
    },
  };
  require.cache[embedsModulePath] = {
    id: embedsModulePath,
    filename: embedsModulePath,
    loaded: true,
    exports: {
      buildNotificationEmbed: (item) => ({ embeds: [{ title: item.title }], components: [] }),
    },
  };
  require.cache[translatorModulePath] = {
    id: translatorModulePath,
    filename: translatorModulePath,
    loaded: true,
    exports: {
      translateItem: async (item) => item,
    },
  };
  delete require.cache[notifierModulePath];

  const notifier = require('../../src/services/notifier');

  try {
    const sourceName = 'Dispatch Source';
    db.updateSourceStatus(sourceName, 'rss', true, null, 0, { latencyMs: 100 });

    const result = await notifier.notifyItems([
      {
        title: 'OpenAI releases GPT-5',
        description: 'Official release note',
        url: 'https://example.com/gpt-5',
        sourceName,
        sourceType: 'rss',
        priority: 0,
        publishedAt: new Date().toISOString(),
      },
    ], sourceName);

    assert.equal(result.notified, 1);

    await notifier.pollDeliveryQueue();

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].key, 'major-releases');

    const stats = db.getDeliveryQueueStats();
    assert.equal(stats.sent, 1);

    const recentItems = db.getRecentItems(5);
    assert.equal(recentItems.length, 1);
    assert.equal(recentItems[0].title, 'OpenAI releases GPT-5');
  } finally {
    notifier.stopDeliveryWorker();
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });

    if (originalChannelsModule) {
      require.cache[channelsModulePath] = originalChannelsModule;
    } else {
      delete require.cache[channelsModulePath];
    }
    if (originalEmbedsModule) {
      require.cache[embedsModulePath] = originalEmbedsModule;
    } else {
      delete require.cache[embedsModulePath];
    }
    if (originalTranslatorModule) {
      require.cache[translatorModulePath] = originalTranslatorModule;
    } else {
      delete require.cache[translatorModulePath];
    }
    delete require.cache[notifierModulePath];
  }
});

test('notifier mirrors event-related stories to major-events while keeping a primary channel', async () => {
  const temp = createTempDbPath('notifier-major-events');
  db.init({ dbPath: temp.dbPath });

  const sentMessages = [];
  const channelsModulePath = require.resolve('../../src/bot/channels');
  const embedsModulePath = require.resolve('../../src/bot/embeds');
  const translatorModulePath = require.resolve('../../src/services/translator');
  const enrichmentModulePath = require.resolve('../../src/services/intelligence/enrichment');
  const eventModeModulePath = require.resolve('../../src/services/event-mode');
  const notifierModulePath = require.resolve('../../src/services/notifier');

  const originalChannelsModule = require.cache[channelsModulePath];
  const originalEmbedsModule = require.cache[embedsModulePath];
  const originalTranslatorModule = require.cache[translatorModulePath];
  const originalEnrichmentModule = require.cache[enrichmentModulePath];
  const originalEventModeModule = require.cache[eventModeModulePath];

  require.cache[channelsModulePath] = {
    id: channelsModulePath,
    filename: channelsModulePath,
    loaded: true,
    exports: {
      getChannel: (key) => ({
        async send(payload) {
          sentMessages.push({ key, payload });
          return { id: `message-${sentMessages.length}` };
        },
      }),
    },
  };
  require.cache[embedsModulePath] = {
    id: embedsModulePath,
    filename: embedsModulePath,
    loaded: true,
    exports: {
      buildNotificationEmbed: (item) => ({ embeds: [{ title: item.title }], components: [] }),
    },
  };
  require.cache[translatorModulePath] = {
    id: translatorModulePath,
    filename: translatorModulePath,
    loaded: true,
    exports: {
      translateItem: async (item) => item,
    },
  };
  require.cache[enrichmentModulePath] = {
    id: enrichmentModulePath,
    filename: enrichmentModulePath,
    loaded: true,
    exports: {
      maybeEnrichItem: async (item) => item,
    },
  };
  require.cache[eventModeModulePath] = {
    id: eventModeModulePath,
    filename: eventModeModulePath,
    loaded: true,
    exports: {
      mirrorToEventThread: async () => null,
    },
  };
  delete require.cache[notifierModulePath];

  const notifier = require('../../src/services/notifier');

  try {
    const sourceName = 'OpenAI Blog';
    db.updateSourceStatus(sourceName, 'rss', true, null, 0, { latencyMs: 100 });
    db.recordSourceReliabilityScore({
      sourceName,
      sourceType: 'rss',
      overallScore: 0.95,
      freshnessScore: 0.95,
      precisionScore: 0.95,
      stabilityScore: 0.95,
      noiseScore: 0.95,
      asOf: new Date().toISOString(),
    });

    const result = await notifier.notifyItems([
      {
        title: 'At DevDay, OpenAI launches GPT-5.4',
        description: 'Keynote announcement and immediate API availability.',
        url: 'https://example.com/devday-gpt-5-4',
        sourceName,
        sourceType: 'rss',
        priority: 0,
        publishedAt: new Date().toISOString(),
        eventConfidence: 0.97,
        classification: {
          label: 'official_release',
          confidence: 0.97,
          majorEventRelated: true,
          entities: {
            provider: 'OpenAI',
            modelFamily: 'GPT-5.4',
            modelId: 'GPT-5.4',
            releaseSurface: 'blog',
          },
        },
      },
    ], sourceName);

    assert.equal(result.notified, 1);

    await notifier.pollDeliveryQueue();

    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[0].key, 'major-releases');
    assert.equal(sentMessages[1].key, 'major-events');
  } finally {
    notifier.stopDeliveryWorker();
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });

    if (originalChannelsModule) {
      require.cache[channelsModulePath] = originalChannelsModule;
    } else {
      delete require.cache[channelsModulePath];
    }
    if (originalEmbedsModule) {
      require.cache[embedsModulePath] = originalEmbedsModule;
    } else {
      delete require.cache[embedsModulePath];
    }
    if (originalTranslatorModule) {
      require.cache[translatorModulePath] = originalTranslatorModule;
    } else {
      delete require.cache[translatorModulePath];
    }
    if (originalEnrichmentModule) {
      require.cache[enrichmentModulePath] = originalEnrichmentModule;
    } else {
      delete require.cache[enrichmentModulePath];
    }
    if (originalEventModeModule) {
      require.cache[eventModeModulePath] = originalEventModeModule;
    } else {
      delete require.cache[eventModeModulePath];
    }
    delete require.cache[notifierModulePath];
  }
});
