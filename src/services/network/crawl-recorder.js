const db = require('../../db/database');
const { classifyError, getStatusCode } = require('./error-classifier');

function getResponseSizeBytes(data) {
  if (data == null) return null;
  if (Buffer.isBuffer(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data);

  try {
    return Buffer.byteLength(JSON.stringify(data));
  } catch {
    return null;
  }
}

function shouldRecord(context, options = {}) {
  if (options.recordCrawl === false) return false;
  return Boolean(context.sourceName && context.sourceType);
}

function recordHttpSuccess({ context, policy, response, startedAt, requestConfig, options = {} }) {
  if (!shouldRecord(context, options)) return null;

  return db.recordCrawlAttempt({
    sourceName: context.sourceName,
    sourceType: context.sourceType,
    attemptKind: context.attemptKind || 'fetch',
    targetUrl: requestConfig.url,
    transport: requestConfig.transportMode || context.transport || policy.transport || 'http',
    policyName: policy.name,
    attemptedAt: new Date(startedAt).toISOString(),
    latencyMs: Date.now() - startedAt,
    statusCode: response?.status ?? null,
    success: true,
    fallbackUsed: options.fallbackUsed === true,
    responseSizeBytes: getResponseSizeBytes(response?.data),
    itemsFound: options.itemsFound,
    metadata: {
      method: requestConfig.method || 'get',
      bucket: policy.bucket,
    },
  });
}

function recordHttpFailure({ context, policy, error, startedAt, requestConfig, options = {} }) {
  if (!shouldRecord(context, options)) return null;

  return db.recordCrawlAttempt({
    sourceName: context.sourceName,
    sourceType: context.sourceType,
    attemptKind: context.attemptKind || 'fetch',
    targetUrl: requestConfig.url,
    transport: requestConfig.transportMode || context.transport || policy.transport || 'http',
    policyName: policy.name,
    attemptedAt: new Date(startedAt).toISOString(),
    latencyMs: Date.now() - startedAt,
    statusCode: getStatusCode(error),
    success: false,
    errorType: classifyError(error),
    errorMessage: error?.message || 'Unknown HTTP error',
    fallbackUsed: options.fallbackUsed === true,
    metadata: {
      method: requestConfig.method || 'get',
      bucket: policy.bucket,
    },
  });
}

module.exports = {
  recordHttpSuccess,
  recordHttpFailure,
};
