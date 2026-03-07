const http = require('http');
const logger = require('../logger');
const { handleGitHubWebhook } = require('./routes/github');

const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;

let webhookStatus = {
  enabled: false,
  listening: false,
  port: null,
  updatedAt: null,
  error: null,
};

function updateWebhookStatus(patch) {
  webhookStatus = {
    ...webhookStatus,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return getWebhookReceiverStatus();
}

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getWebhookMaxBodyBytes() {
  const parsed = Number(process.env.WEBHOOK_MAX_BODY_BYTES || DEFAULT_WEBHOOK_MAX_BODY_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WEBHOOK_MAX_BODY_BYTES;
}

function getWebhookRequestTimeoutMs() {
  const parsed = Number(process.env.WEBHOOK_REQUEST_TIMEOUT_MS || DEFAULT_WEBHOOK_REQUEST_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WEBHOOK_REQUEST_TIMEOUT_MS;
}

function readRequestBody(request, maxBodyBytes = getWebhookMaxBodyBytes()) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBodyBytes) {
        request.destroy(createHttpError(`Webhook payload too large (max ${maxBodyBytes} bytes)`, 413));
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function shouldEnableWebhookReceiver() {
  return String(process.env.WEBHOOK_ENABLED || '').toLowerCase() === 'true';
}

async function startWebhookReceiver() {
  const enabled = shouldEnableWebhookReceiver();
  const port = Number(process.env.WEBHOOK_PORT || 8787);

  updateWebhookStatus({
    enabled,
    listening: false,
    port: enabled ? port : null,
    error: null,
  });

  if (!enabled) {
    return null;
  }

  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    const error = new Error('WEBHOOK_ENABLED is true but GITHUB_WEBHOOK_SECRET is not set');
    updateWebhookStatus({
      enabled: true,
      listening: false,
      port,
      error: error.message,
    });
    throw error;
  }

  const server = http.createServer(async (request, response) => {
    request.setTimeout(getWebhookRequestTimeoutMs(), () => {
      request.destroy(createHttpError('Webhook request timed out', 408));
    });

    if (request.method !== 'POST') {
      jsonResponse(response, 404, { error: 'not found' });
      return;
    }

    if (request.url !== '/webhooks/github') {
      jsonResponse(response, 404, { error: 'not found' });
      return;
    }

    try {
      const rawBody = await readRequestBody(request);

      if (!String(request.headers['content-type'] || '').toLowerCase().includes('application/json')) {
        throw createHttpError('Webhook requests must use application/json', 415);
      }

      const parsedBody = JSON.parse(rawBody.toString('utf8') || '{}');
      const result = await handleGitHubWebhook({
        headers: request.headers,
        rawBody,
        body: parsedBody,
      });
      jsonResponse(response, result.statusCode || 202, result.body || { accepted: true });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      jsonResponse(response, statusCode, { error: error.message || 'webhook error' });
    }
  });

  server.on('close', () => {
    updateWebhookStatus({
      enabled: true,
      listening: false,
      port,
    });
  });

  server.requestTimeout = getWebhookRequestTimeoutMs();

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      updateWebhookStatus({
        enabled: true,
        listening: false,
        port,
        error: error.message,
      });
      reject(error);
    };

    const handleListening = () => {
      server.off('error', handleError);
      updateWebhookStatus({
        enabled: true,
        listening: true,
        port,
        error: null,
      });
      logger.info(`[Webhooks] Receiver listening on port ${port}`);
      resolve();
    };

    server.once('error', handleError);
    server.listen(port, handleListening);
  });

  server.on('error', (error) => {
    updateWebhookStatus({
      enabled: true,
      listening: false,
      port,
      error: error.message,
    });
    logger.error(`[Webhooks] Receiver error: ${error.message}`);
  });

  return server;
}

function stopWebhookReceiver(server) {
  if (!server) {
    updateWebhookStatus({
      enabled: shouldEnableWebhookReceiver(),
      listening: false,
      port: null,
    });
    return;
  }

  server.close();
}

function getWebhookReceiverStatus() {
  return { ...webhookStatus };
}

module.exports = {
  startWebhookReceiver,
  stopWebhookReceiver,
  getWebhookReceiverStatus,
};
