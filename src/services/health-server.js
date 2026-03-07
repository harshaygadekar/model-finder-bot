const http = require('http');

const { CHANNEL_DEFS, getAllChannels } = require('../bot/channels');
const { getClient } = require('../bot/client');
const db = require('../db/database');
const logger = require('./logger');
const { getDeliveryWorkerStatus } = require('./notifier');
const runtimeState = require('./runtime-state');
const { getSchedulerStatus } = require('./scheduler');
const { getWebhookReceiverStatus } = require('./webhooks/receiver');

const DEFAULT_HEALTH_PORT = 8788;
const DATABASE_PROBE_CACHE_TTL_MS = 15 * 1000;

let cachedDatabaseStatus = null;
let cachedDatabaseStatusAt = 0;

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function getHealthPort(explicitPort = null) {
  if (explicitPort === 0) {
    return 0;
  }

  const candidate = explicitPort ?? process.env.HEALTH_PORT ?? DEFAULT_HEALTH_PORT;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HEALTH_PORT;
}

function toIsoTimestamp(value) {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function getUptimeMs(startedAt) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) {
    return 0;
  }

  return Math.max(0, Date.now() - started);
}

function cloneSerializable(value) {
  if (value == null) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function buildDatabaseStatus(now = Date.now()) {
  if (!db.isInitialized()) {
    return {
      ok: false,
      initialized: false,
      component: 'health-readiness',
      dbPath: db.getCurrentDbPath(),
      error: 'Database is not initialized',
      checkedAt: new Date(now).toISOString(),
      cached: false,
      cacheAgeMs: null,
    };
  }

  const cacheAgeMs = cachedDatabaseStatusAt > 0 ? Math.max(0, now - cachedDatabaseStatusAt) : null;
  if (cachedDatabaseStatus && cacheAgeMs != null && cacheAgeMs <= DATABASE_PROBE_CACHE_TTL_MS) {
    return {
      ...cloneSerializable(cachedDatabaseStatus),
      cached: true,
      cacheAgeMs,
    };
  }

  try {
    const result = db.probeRuntimeWrite('health-readiness', {
      probe: 'health-server',
    });
    cachedDatabaseStatus = {
      ...result,
      initialized: true,
      cached: false,
      cacheAgeMs: 0,
    };
    cachedDatabaseStatusAt = now;

    return cloneSerializable(cachedDatabaseStatus);
  } catch (error) {
    cachedDatabaseStatus = {
      ok: false,
      initialized: db.isInitialized(),
      component: 'health-readiness',
      dbPath: db.getCurrentDbPath(),
      error: error.message,
      checkedAt: new Date().toISOString(),
      cached: false,
      cacheAgeMs: 0,
    };
    cachedDatabaseStatusAt = now;

    return cloneSerializable(cachedDatabaseStatus);
  }
}

function buildQueueStatus() {
  try {
    return db.getDeliveryQueueStats();
  } catch (error) {
    return {
      pending: 0,
      processing: 0,
      sent: 0,
      'dead-letter': 0,
      total: 0,
      ready: 0,
      error: error.message,
    };
  }
}

function buildHealthSnapshot() {
  const snapshot = runtimeState.getRuntimeState();
  const client = getClient();
  const discordReady = typeof client?.isReady === 'function' ? client.isReady() : false;
  const guildId = process.env.DISCORD_GUILD_ID || null;
  const guild = discordReady && guildId ? (client?.guilds?.cache?.get?.(guildId) || null) : null;

  const requiredChannelKeys = Object.keys(CHANNEL_DEFS);
  const cachedChannels = getAllChannels();
  const resolvedChannelKeys = requiredChannelKeys.filter((key) => !!cachedChannels[key]);
  const missingChannelKeys = requiredChannelKeys.filter((key) => !cachedChannels[key]);

  const scheduler = getSchedulerStatus();
  const deliveryWorker = getDeliveryWorkerStatus();
  const queue = buildQueueStatus();
  const database = buildDatabaseStatus();
  const webhook = getWebhookReceiverStatus();

  const schedulerCheck = {
    ok: scheduler.healthy,
    status: scheduler.healthy ? 'ready' : 'not-ready',
    ...scheduler,
  };

  const deliveryWorkerCheck = {
    ok: deliveryWorker.healthy,
    status: deliveryWorker.healthy ? 'ready' : 'not-ready',
    ...deliveryWorker,
    queue,
  };

  const databaseCheck = {
    ok: !!database.ok,
    status: database.ok ? 'ready' : 'not-ready',
    ...database,
  };

  const webhookCheck = {
    ok: !webhook.enabled || webhook.listening,
    status: !webhook.enabled ? 'disabled' : (webhook.listening ? 'ready' : 'not-ready'),
    ...webhook,
  };

  const checks = {
    discord: {
      ok: discordReady,
      status: discordReady ? 'ready' : 'not-ready',
      userTag: client?.user?.tag || null,
      readyAt: toIsoTimestamp(client?.readyTimestamp),
      wsStatus: client?.ws?.status ?? null,
      startupStatus: snapshot.startup.discordLogin.status,
      error: snapshot.startup.discordLogin.error,
    },
    guild: {
      ok: !!guild,
      status: guild ? 'ready' : 'not-ready',
      guildId,
      guildName: guild?.name || null,
      startupStatus: snapshot.startup.guild.status,
      error: snapshot.startup.guild.error,
    },
    channels: {
      ok: missingChannelKeys.length === 0,
      status: missingChannelKeys.length === 0 ? 'ready' : 'not-ready',
      requiredCount: requiredChannelKeys.length,
      resolvedCount: resolvedChannelKeys.length,
      missingChannelKeys,
      startupStatus: snapshot.startup.channels.status,
      error: snapshot.startup.channels.error,
    },
    scheduler: schedulerCheck,
    deliveryWorker: deliveryWorkerCheck,
    database: databaseCheck,
    webhook: webhookCheck,
  };

  const ready = Object.values(checks).every((check) => check.ok);

  return {
    service: 'model-looker-bot',
    checkedAt: new Date().toISOString(),
    uptimeMs: getUptimeMs(snapshot.startedAt),
    ready,
    status: ready ? 'ready' : 'not-ready',
    startup: snapshot,
    discord: {
      ready: discordReady,
      userTag: client?.user?.tag || null,
      readyAt: toIsoTimestamp(client?.readyTimestamp),
      guildCount: client?.guilds?.cache?.size ?? 0,
      wsStatus: client?.ws?.status ?? null,
    },
    guild: {
      id: guildId,
      name: guild?.name || null,
      found: !!guild,
    },
    channels: {
      requiredCount: requiredChannelKeys.length,
      resolvedCount: resolvedChannelKeys.length,
      resolvedChannelKeys,
      missingChannelKeys,
    },
    scheduler: schedulerCheck,
    deliveryWorker: deliveryWorkerCheck,
    database: databaseCheck,
    webhook: webhookCheck,
    readiness: {
      ready,
      checks,
    },
  };
}

function createRequestHandler() {
  return (request, response) => {
    if (request.method !== 'GET') {
      jsonResponse(response, 405, { error: 'method not allowed' });
      return;
    }

    if (request.url === '/live') {
      const snapshot = runtimeState.getRuntimeState();
      jsonResponse(response, 200, {
        status: 'live',
        checkedAt: new Date().toISOString(),
        uptimeMs: getUptimeMs(snapshot.startedAt),
      });
      return;
    }

    if (request.url === '/ready') {
      const snapshot = buildHealthSnapshot();
      jsonResponse(response, snapshot.ready ? 200 : 503, {
        status: snapshot.status,
        ready: snapshot.ready,
        checkedAt: snapshot.checkedAt,
        uptimeMs: snapshot.uptimeMs,
        checks: snapshot.readiness.checks,
      });
      return;
    }

    if (request.url === '/health') {
      jsonResponse(response, 200, buildHealthSnapshot());
      return;
    }

    jsonResponse(response, 404, { error: 'not found' });
  };
}

async function startHealthServer(options = {}) {
  const port = getHealthPort(options.port);
  const server = http.createServer(createRequestHandler());

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.listen(port, '0.0.0.0', handleListening);
  });

  const address = server.address();
  logger.info(`[Health] Server listening on port ${address?.port || port}`);
  return server;
}

function stopHealthServer(server) {
  if (!server) {
    return;
  }

  server.close();
}

module.exports = {
  DEFAULT_HEALTH_PORT,
  buildHealthSnapshot,
  startHealthServer,
  stopHealthServer,
};
