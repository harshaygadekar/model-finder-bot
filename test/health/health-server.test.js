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

test('health server exposes live, ready, and detailed health responses', async () => {
  const temp = createTempDbPath('health-server');
  db.init({ dbPath: temp.dbPath });

  const healthServerModulePath = require.resolve('../../src/services/health-server');
  const clientModulePath = require.resolve('../../src/bot/client');
  const channelsModulePath = require.resolve('../../src/bot/channels');
  const schedulerModulePath = require.resolve('../../src/services/scheduler');
  const notifierModulePath = require.resolve('../../src/services/notifier');
  const webhookModulePath = require.resolve('../../src/services/webhooks/receiver');
  const runtimeStateModulePath = require.resolve('../../src/services/runtime-state');

  const originals = {
    client: require.cache[clientModulePath],
    channels: require.cache[channelsModulePath],
    scheduler: require.cache[schedulerModulePath],
    notifier: require.cache[notifierModulePath],
    webhook: require.cache[webhookModulePath],
    runtimeState: require.cache[runtimeStateModulePath],
  };

  const status = {
    discordReady: true,
    guildFound: true,
    missingChannelKeys: [],
    schedulerHealthy: true,
    deliveryHealthy: true,
    webhookEnabled: false,
    webhookListening: false,
  };
  const channelDefs = {
    'bot-status': { name: 'bot-status' },
    'major-releases': { name: 'major-releases' },
  };
  const guildMap = new Map([['guild-123', { id: 'guild-123', name: 'Test Guild' }]]);
  const originalGuildId = process.env.DISCORD_GUILD_ID;
  process.env.DISCORD_GUILD_ID = 'guild-123';

  require.cache[clientModulePath] = {
    id: clientModulePath,
    filename: clientModulePath,
    loaded: true,
    exports: {
      getClient: () => ({
        isReady: () => status.discordReady,
        readyTimestamp: Date.now(),
        user: status.discordReady ? { tag: 'TestBot#0001' } : null,
        guilds: { cache: status.guildFound ? guildMap : new Map() },
        ws: { status: status.discordReady ? 0 : 2 },
      }),
    },
  };
  require.cache[channelsModulePath] = {
    id: channelsModulePath,
    filename: channelsModulePath,
    loaded: true,
    exports: {
      CHANNEL_DEFS: channelDefs,
      getAllChannels: () => Object.fromEntries(
        Object.keys(channelDefs)
          .filter((key) => !status.missingChannelKeys.includes(key))
          .map((key) => [key, { id: key }])
      ),
    },
  };
  require.cache[schedulerModulePath] = {
    id: schedulerModulePath,
    filename: schedulerModulePath,
    loaded: true,
    exports: {
      getSchedulerStatus: () => ({
        startedAt: new Date().toISOString(),
        running: true,
        lastHeartbeatAt: new Date().toISOString(),
        heartbeatAgeMs: 1000,
        heartbeatTimeoutMs: 90000,
        healthy: status.schedulerHealthy,
        entryCount: 3,
        inFlightCount: 0,
        initialChecksCompletedAt: new Date().toISOString(),
        lastError: null,
      }),
    },
  };
  require.cache[notifierModulePath] = {
    id: notifierModulePath,
    filename: notifierModulePath,
    loaded: true,
    exports: {
      getDeliveryWorkerStatus: () => ({
        workerId: 'delivery-worker-test',
        startedAt: new Date().toISOString(),
        timerActive: true,
        running: false,
        pollIntervalMs: 1000,
        stuckThresholdMs: 300000,
        lastPollStartedAt: new Date().toISOString(),
        lastPollCompletedAt: new Date().toISOString(),
        lastError: null,
        currentPollAgeMs: null,
        healthy: status.deliveryHealthy,
      }),
    },
  };
  require.cache[webhookModulePath] = {
    id: webhookModulePath,
    filename: webhookModulePath,
    loaded: true,
    exports: {
      getWebhookReceiverStatus: () => ({
        enabled: status.webhookEnabled,
        listening: status.webhookListening,
        port: status.webhookEnabled ? 8787 : null,
        updatedAt: new Date().toISOString(),
        error: null,
      }),
    },
  };
  require.cache[runtimeStateModulePath] = {
    id: runtimeStateModulePath,
    filename: runtimeStateModulePath,
    loaded: true,
    exports: {
      getRuntimeState: () => ({
        startedAt: new Date(Date.now() - 5000).toISOString(),
        shuttingDown: false,
        shutdownAt: null,
        lastFatalError: null,
        lastUnhandledRejection: null,
        startup: {
          environment: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          database: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          discordLogin: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          guild: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          channels: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          commands: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          deliveryWorker: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          scheduler: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          digests: { status: 'ready', updatedAt: new Date().toISOString(), error: null },
          webhook: { status: status.webhookEnabled ? 'ready' : 'disabled', updatedAt: new Date().toISOString(), error: null },
        },
      }),
    },
  };
  delete require.cache[healthServerModulePath];

  const { startHealthServer, stopHealthServer } = require('../../src/services/health-server');

  let server;
  try {
    server = await startHealthServer({ port: 0 });
    const port = server.address().port;

    const liveResponse = await fetch(`http://127.0.0.1:${port}/live`);
    assert.equal(liveResponse.status, 200);

    const readyResponse = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(readyResponse.status, 200);
    const readyBody = await readyResponse.json();
    assert.equal(readyBody.ready, true);
    assert.equal(readyBody.checks.database.ok, true);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthResponse.status, 200);
    const healthBody = await healthResponse.json();
    assert.equal(healthBody.ready, true);
    assert.equal(healthBody.webhook.enabled, false);

    status.discordReady = false;
    const degradedReadyResponse = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(degradedReadyResponse.status, 503);
    const degradedBody = await degradedReadyResponse.json();
    assert.equal(degradedBody.ready, false);
    assert.equal(degradedBody.checks.discord.ok, false);

    status.discordReady = true;
    status.webhookEnabled = true;
    status.webhookListening = false;

    const webhookDegradedResponse = await fetch(`http://127.0.0.1:${port}/ready`);
    assert.equal(webhookDegradedResponse.status, 503);
    const webhookDegradedBody = await webhookDegradedResponse.json();
    assert.equal(webhookDegradedBody.ready, false);
    assert.equal(webhookDegradedBody.checks.webhook.ok, false);
    assert.equal(webhookDegradedBody.checks.webhook.status, 'not-ready');
  } finally {
    stopHealthServer(server);
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });

    if (originalGuildId === undefined) {
      delete process.env.DISCORD_GUILD_ID;
    } else {
      process.env.DISCORD_GUILD_ID = originalGuildId;
    }

    if (originals.client) require.cache[clientModulePath] = originals.client;
    else delete require.cache[clientModulePath];

    if (originals.channels) require.cache[channelsModulePath] = originals.channels;
    else delete require.cache[channelsModulePath];

    if (originals.scheduler) require.cache[schedulerModulePath] = originals.scheduler;
    else delete require.cache[schedulerModulePath];

    if (originals.notifier) require.cache[notifierModulePath] = originals.notifier;
    else delete require.cache[notifierModulePath];

    if (originals.webhook) require.cache[webhookModulePath] = originals.webhook;
    else delete require.cache[webhookModulePath];

    if (originals.runtimeState) require.cache[runtimeStateModulePath] = originals.runtimeState;
    else delete require.cache[runtimeStateModulePath];

    delete require.cache[healthServerModulePath];
  }
});
