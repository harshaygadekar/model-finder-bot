const { request } = require('./network/request-client');
const { ARXIV_MIN_INTERVAL_MS } = require('./network/fetch-policies');

function get(url, config = {}) {
  return request({
    ...config,
    url,
    method: 'get',
  });
}

function post(url, data, config = {}) {
  return request({
    ...config,
    url,
    data,
    method: 'post',
  });
}

function getArxiv(url, config = {}) {
  return request({
    ...config,
    url,
    method: 'get',
    sourceType: config.sourceType || 'arxiv',
    policyName: config.policyName || 'arxiv-api',
    bucket: config.bucket || 'arxiv',
    bucketMinIntervalMs: config.bucketMinIntervalMs ?? ARXIV_MIN_INTERVAL_MS,
    retry: {
      retries: 2,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      ...(config.retry || {}),
    },
  });
}

module.exports = {
  request,
  get,
  post,
  getArxiv,
  ARXIV_MIN_INTERVAL_MS,
};