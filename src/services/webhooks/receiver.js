const http = require('http');
const logger = require('../logger');
const { handleGitHubWebhook } = require('./routes/github');

const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;

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

function startWebhookReceiver() {
  if (!shouldEnableWebhookReceiver()) {
    return null;
  }

  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    throw new Error('WEBHOOK_ENABLED is true but GITHUB_WEBHOOK_SECRET is not set');
  }

  const port = Number(process.env.WEBHOOK_PORT || 8787);
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

  server.listen(port, () => {
    logger.info(`[Webhooks] Receiver listening on port ${port}`);
  });

  server.requestTimeout = getWebhookRequestTimeoutMs();

  return server;
}

function stopWebhookReceiver(server) {
  if (!server) {
    return;
  }

  server.close();
}

module.exports = {
  startWebhookReceiver,
  stopWebhookReceiver,
};
