const axios = require('axios');
const logger = require('../logger');
const { classifyError, RETRYABLE_ERROR_CODES } = require('./error-classifier');
const { getFetchPolicy } = require('./fetch-policies');
const { withRateLimit } = require('./rate-limits');
const { getRequestContext } = require('./request-context');
const { recordHttpSuccess, recordHttpFailure } = require('./crawl-recorder');
const { fetchPage } = require('../browser/browser-client');
const { getBrowserPolicy } = require('../browser/browser-policies');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterDelay(retryAfterHeader) {
  if (!retryAfterHeader) return null;

  const retryAfterValue = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
  const seconds = Number(retryAfterValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfterValue);
  if (Number.isNaN(dateMs)) return null;

  return Math.max(0, dateMs - Date.now());
}

function shouldRetry(error, attempt, retryOptions) {
  if (attempt >= retryOptions.retries) return false;

  if (typeof retryOptions.shouldRetry === 'function') {
    return retryOptions.shouldRetry(error, attempt);
  }

  if (error.response) {
    const { status } = error.response;
    return retryOptions.retryableStatusCodes.includes(status) || status >= 500;
  }

  if (error.code && RETRYABLE_ERROR_CODES.has(error.code)) return true;

  const errorType = classifyError(error);
  return errorType === 'timeout' || errorType === 'network_error';
}

function computeRetryDelay(error, attempt, retryOptions) {
  const retryAfterDelay = getRetryAfterDelay(error.response?.headers?.['retry-after']);
  if (retryAfterDelay !== null) {
    return Math.min(retryOptions.maxDelayMs, retryAfterDelay);
  }

  const baseDelay = Math.min(
    retryOptions.maxDelayMs,
    retryOptions.baseDelayMs * (2 ** Math.max(0, attempt - 1))
  );
  const jitter = retryOptions.jitterMs > 0
    ? Math.floor(Math.random() * retryOptions.jitterMs)
    : 0;

  return baseDelay + jitter;
}

function buildExecutionContext(config) {
  const ambientContext = getRequestContext();
  return {
    sourceName: config.sourceName || config.metadata?.sourceName || ambientContext.sourceName || null,
    sourceType: config.sourceType || config.metadata?.sourceType || ambientContext.sourceType || null,
    transport: config.transport || config.metadata?.transport || ambientContext.transport || 'http',
    attemptKind: config.attemptKind || config.metadata?.attemptKind || ambientContext.attemptKind || 'fetch',
  };
}

function shouldAttemptFallback(error, policy, didFallback) {
  if (didFallback || !policy.allowFallback || !policy.fallback) {
    return false;
  }

  const errorType = classifyError(error);
  return ['forbidden', 'bot_protection', 'timeout', 'server_error', 'network_error'].includes(errorType);
}

function buildFallbackRequestConfig(requestConfig, policy) {
  return {
    ...requestConfig,
    transportMode: policy.fallback.transport || requestConfig.transportMode || 'http',
    timeout: policy.fallback.timeoutMs || requestConfig.timeout,
    headers: {
      ...(requestConfig.headers || {}),
      ...((policy.fallback && policy.fallback.headers) || {}),
    },
  };
}

async function executeTransportRequest(requestConfig, context, policy) {
  const activeTransport = requestConfig.transportMode || context.transport || policy.transport || 'http';

  if (activeTransport === 'browser') {
    const browserPolicy = getBrowserPolicy(
      {
        sourceName: context.sourceName,
        sourceType: context.sourceType,
        url: requestConfig.url,
      },
      {
        timeoutMs: requestConfig.timeout,
        headers: requestConfig.headers,
        sourceName: context.sourceName,
        label: `${context.sourceType || 'source'}-browser`,
        snapshotOnFailure: policy.fallback?.snapshotOnFailure,
        contentSelector: policy.fallback?.contentSelector,
      }
    );

    const browserResponse = await fetchPage(requestConfig.url, browserPolicy);
    return {
      status: browserResponse.status || 200,
      data: browserResponse.html,
      headers: {},
      browserMeta: browserResponse,
    };
  }

  return axios(requestConfig);
}

async function request(config) {
  const {
    retry: retryConfig,
    metadata,
    recordCrawl = true,
    fallbackUsed = false,
    sourceName,
    sourceType,
    attemptKind,
    transport,
    policyName,
    bucket,
    bucketMinIntervalMs,
    allowFallback,
    timeoutMs,
    ...axiosConfig
  } = config;

  const context = buildExecutionContext({
    sourceName,
    sourceType,
    attemptKind,
    transport,
    metadata,
  });

  const policy = getFetchPolicy(
    {
      sourceName: context.sourceName,
      sourceType: context.sourceType,
      url: axiosConfig.url,
      transport: context.transport,
    },
    {
      policyName,
      bucket,
      bucketMinIntervalMs,
      allowFallback,
      timeout: axiosConfig.timeout ?? timeoutMs,
      headers: axiosConfig.headers,
      retry: retryConfig,
      transport: context.transport,
    }
  );

  const retryOptions = { ...policy.retry, ...(retryConfig || {}) };
  const requestConfig = {
    ...axiosConfig,
    transportMode: transport || policy.transport || 'http',
    timeout: axiosConfig.timeout ?? timeoutMs ?? policy.timeoutMs,
    headers: {
      ...(policy.headers || {}),
      ...(axiosConfig.headers || {}),
    },
  };

  const executeRequest = async () => {
    let attempt = 0;
    let didFallback = fallbackUsed;
    let activeRequestConfig = requestConfig;
    while (true) {
      const startedAt = Date.now();

      try {
        const response = await executeTransportRequest(activeRequestConfig, context, policy);
        recordHttpSuccess({
          context,
          policy,
          response,
          startedAt,
          requestConfig: activeRequestConfig,
          options: { recordCrawl, fallbackUsed: didFallback },
        });
        return response;
      } catch (error) {
        recordHttpFailure({
          context,
          policy,
          error,
          startedAt,
          requestConfig: activeRequestConfig,
          options: { recordCrawl, fallbackUsed: didFallback },
        });

        if (shouldAttemptFallback(error, policy, didFallback)) {
          didFallback = true;
          activeRequestConfig = buildFallbackRequestConfig(requestConfig, policy);
          logger.warn(
            `[HTTP] Switching to ${activeRequestConfig.transportMode || 'fallback'} strategy for ${String(activeRequestConfig.method || 'get').toUpperCase()} ${activeRequestConfig.url || 'request'}`
          );
          continue;
        }

        if (!shouldRetry(error, attempt, retryOptions)) {
          throw error;
        }

        attempt += 1;
        const delayMs = computeRetryDelay(error, attempt, retryOptions);
        const method = String(activeRequestConfig.method || 'get').toUpperCase();
        const target = activeRequestConfig.url || 'request';
        logger.warn(
          `[HTTP] Retry ${attempt}/${retryOptions.retries} for ${method} ${target} in ${delayMs}ms (${error.message})`
        );
        await sleep(delayMs);
      }
    }
  };

  return withRateLimit(policy.bucket, policy.bucketMinIntervalMs, executeRequest);
}

module.exports = {
  request,
};