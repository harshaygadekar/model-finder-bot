const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { verifyGitHubSignature } = require('../../src/services/webhooks/validators');

test('verifyGitHubSignature accepts valid signatures and rejects invalid ones', () => {
  const secret = 'super-secret';
  const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
  const validSignature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

  assert.equal(verifyGitHubSignature(rawBody, validSignature, secret), true);
  assert.equal(verifyGitHubSignature(rawBody, 'sha256=deadbeef', secret), false);
  assert.equal(verifyGitHubSignature(rawBody, validSignature, ''), false);
});
