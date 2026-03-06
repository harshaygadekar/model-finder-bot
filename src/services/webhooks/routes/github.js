const db = require('../../../db/database');
const logger = require('../../logger');
const { filterItems } = require('../../filter');
const { notifyItems } = require('../../notifier');
const { verifyGitHubSignature } = require('../validators');
const { normalizeGitHubWebhook } = require('../normalizers');

async function handleGitHubWebhook({ headers, rawBody, body }) {
  const deliveryId = headers['x-github-delivery'];
  const eventType = headers['x-github-event'];
  const signature = headers['x-hub-signature-256'];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!deliveryId || !eventType) {
    const error = new Error('Missing GitHub webhook headers');
    error.statusCode = 400;
    throw error;
  }

  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    const error = new Error('Invalid GitHub webhook signature');
    error.statusCode = 401;
    throw error;
  }

  const receipt = db.recordWebhookReceipt({
    provider: 'github',
    eventType,
    deliveryId,
    signatureState: 'verified',
    payload: body,
  });

  if (receipt.duplicate) {
    return {
      statusCode: 200,
      body: 'duplicate',
    };
  }

  try {
    const normalizedItems = normalizeGitHubWebhook(eventType, body);
    const filteredItems = await filterItems(normalizedItems);
    await notifyItems(filteredItems, null);

    db.markWebhookProcessed(deliveryId, {
      status: 'processed',
      normalized: {
        itemCount: normalizedItems.length,
        filteredCount: filteredItems.length,
      },
    });

    return {
      statusCode: 202,
      body: JSON.stringify({ accepted: true, items: filteredItems.length }),
    };
  } catch (error) {
    db.markWebhookProcessed(deliveryId, {
      status: 'failed',
      errorMessage: error.message,
    });
    logger.error(`[Webhooks] GitHub webhook failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  handleGitHubWebhook,
};