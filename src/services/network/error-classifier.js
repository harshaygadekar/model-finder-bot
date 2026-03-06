const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
]);

function getStatusCode(error) {
  return error?.response?.status ?? null;
}

function classifyError(error) {
  const statusCode = getStatusCode(error);
  if (statusCode === 401) return 'auth_error';
  if (statusCode === 403) {
    const body = String(error?.response?.data || '').toLowerCase();
    if (body.includes('cloudflare') || body.includes('captcha') || body.includes('bot')) {
      return 'bot_protection';
    }
    return 'forbidden';
  }
  if (statusCode === 404) return 'not_found';
  if (statusCode === 408) return 'timeout';
  if (statusCode === 409) return 'conflict';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500) return 'server_error';

  const code = String(error?.code || '').toUpperCase();
  if (code.startsWith('BROWSER_')) return 'transport_unavailable';
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
  if (RETRYABLE_ERROR_CODES.has(code)) return 'network_error';

  const message = String(error?.message || '').toLowerCase();
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('cloudflare') || message.includes('captcha') || message.includes('bot protection')) {
    return 'bot_protection';
  }
  if (message.includes('parse')) return 'parse_error';
  if (message.includes('network') || message.includes('socket hang up')) return 'network_error';

  return 'request_error';
}

module.exports = {
  RETRYABLE_ERROR_CODES,
  classifyError,
  getStatusCode,
};
