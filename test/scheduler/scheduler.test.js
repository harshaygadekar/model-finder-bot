const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseSimpleCronIntervalToMs,
  computeNextIntervalMs,
  shouldSkipForHealthBackoff,
} = require('../../src/services/scheduler');

test('parseSimpleCronIntervalToMs understands minute, hourly, and daily cron patterns', () => {
  assert.equal(parseSimpleCronIntervalToMs('*/5 * * * *'), 5 * 60 * 1000);
  assert.equal(parseSimpleCronIntervalToMs('0 */2 * * *'), 2 * 60 * 60 * 1000);
  assert.equal(parseSimpleCronIntervalToMs('0 * * * *'), 60 * 60 * 1000);
  assert.equal(parseSimpleCronIntervalToMs('0 8 * * *'), 24 * 60 * 60 * 1000);
});

test('computeNextIntervalMs tightens for active sources and backs off for failures', () => {
  const entry = {
    baseIntervalMs: 10 * 60 * 1000,
    currentIntervalMs: 10 * 60 * 1000,
    minIntervalMs: 5 * 60 * 1000,
    maxIntervalMs: 40 * 60 * 1000,
  };

  const shorter = computeNextIntervalMs(entry, { status: 'success', queuedCount: 2, filteredCount: 2, rawCount: 2 }, { health_state: 'healthy' });
  assert.equal(shorter, 6 * 60 * 1000);

  const longer = computeNextIntervalMs(entry, { status: 'failed' }, { health_state: 'healthy' });
  assert.equal(longer, 15 * 60 * 1000);

  const degraded = computeNextIntervalMs(entry, { status: 'success', queuedCount: 0, filteredCount: 0, rawCount: 0 }, { health_state: 'degraded' });
  assert.equal(degraded, 20 * 60 * 1000);
});

test('shouldSkipForHealthBackoff only defers degraded sources inside the cooldown window', () => {
  assert.equal(
    shouldSkipForHealthBackoff({
      health_state: 'degraded',
      last_checked: new Date().toISOString(),
    }),
    true
  );

  assert.equal(
    shouldSkipForHealthBackoff({
      health_state: 'healthy',
      last_checked: new Date().toISOString(),
    }),
    false
  );
});
