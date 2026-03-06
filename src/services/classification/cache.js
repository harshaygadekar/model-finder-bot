const crypto = require('crypto');
const db = require('../../db/database');

function buildClassificationHash(item) {
  const normalized = [
    item.sourceName || '',
    item.sourceType || '',
    item.title || '',
    item.description || '',
    item.url || '',
  ].join('\n').toLowerCase().trim();

  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function getCachedClassification(item, ttlSeconds) {
  const contentHash = buildClassificationHash(item);
  const cached = db.getCachedClassification(contentHash, ttlSeconds);
  return {
    contentHash,
    cached,
  };
}

module.exports = {
  buildClassificationHash,
  getCachedClassification,
};
