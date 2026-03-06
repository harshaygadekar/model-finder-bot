const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function verifyGitHubSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader || !rawBody) {
    return false;
  }

  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return timingSafeEqual(expected, signatureHeader);
}

module.exports = {
  verifyGitHubSignature,
};
