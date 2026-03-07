const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const db = require('../../src/db/database');

function createTempDbPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `model-looker-${name}-`));
  return {
    dir,
    dbPath: path.join(dir, 'tracker.sqlite'),
  };
}

function cleanupTempDir(dir) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test('database dedup helpers catch exact, URL, and similar content matches', () => {
  const temp = createTempDbPath('dedup');
  db.init({ dbPath: temp.dbPath });

  const item = {
    url: 'https://example.com/openai/gpt-5',
    title: 'OpenAI releases GPT-5 model',
    description: 'A major new model release',
    sourceType: 'rss',
    sourceName: 'Example Feed',
    priority: 0,
    relevanceScore: 1,
  };

  db.markSeen(item, true);

  assert.equal(db.isItemSeen(item.url, item.title), true);
  assert.equal(db.isUrlSeen('https://example.com/openai/gpt-5/'), true);
  assert.equal(db.isContentSimilarSeen('OpenAI releases GPT-5 new model today'), true);

  cleanupTempDir(temp.dir);
});

test('database delivery queue helpers claim, track, and settle jobs', () => {
  const temp = createTempDbPath('queue');
  db.init({ dbPath: temp.dbPath });

  const jobId = db.enqueueDeliveryJob({
    jobType: 'alert',
    sourceName: 'Smoke Source',
    sourceType: 'rss',
    payload: { item: { title: 'Queued item' } },
    priority: 5,
  });

  const statsBeforeClaim = db.getDeliveryQueueStats();
  assert.equal(statsBeforeClaim.ready, 1);
  assert.equal(statsBeforeClaim.pending, 1);

  const claimed = db.claimNextDeliveryJob('test-worker');
  assert.ok(claimed);
  assert.equal(claimed.id, jobId);
  assert.equal(claimed.payload.item.title, 'Queued item');

  db.recordDeliveryAttempt(jobId, {
    success: true,
    channelKey: 'major-releases',
    messageId: 'message-123',
    response: { ok: true },
  });
  db.markDeliveryJobSent(jobId);

  const stats = db.getDeliveryQueueStats();
  assert.equal(stats.sent, 1);
  assert.equal(stats.pending, 0);

  cleanupTempDir(temp.dir);
});

test('database health summaries include adapter telemetry and backlog', () => {
  const temp = createTempDbPath('health');
  db.init({ dbPath: temp.dbPath });

  db.updateSourceStatus('Health Source', 'rss', false, 'timeout', 0, { latencyMs: 9000 });
  db.recordCrawlAttempt({
    sourceName: 'Health Source',
    sourceType: 'rss',
    attemptKind: 'adapter-check',
    targetUrl: 'https://example.com/health',
    transport: 'adapter',
    policyName: 'adapter-check',
    success: false,
    latencyMs: 9000,
    errorType: 'timeout',
    errorMessage: 'timeout',
  });
  db.enqueueDeliveryJob({
    jobType: 'alert',
    sourceName: 'Health Source',
    sourceType: 'rss',
    payload: { item: { title: 'Pending item' } },
    priority: 10,
  });

  const summaries = db.getSourceHealthSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].source_name, 'Health Source');
  assert.equal(summaries[0].delivery_backlog, 1);
  assert.notEqual(summaries[0].health_state, 'healthy');

  cleanupTempDir(temp.dir);
});

test('database runtime probe verifies the SQLite file is writable', () => {
  const temp = createTempDbPath('runtime-probe');
  db.init({ dbPath: temp.dbPath });

  const probe = db.probeRuntimeWrite('readiness', { source: 'test-suite' });

  assert.equal(probe.ok, true);
  assert.equal(probe.component, 'readiness');
  assert.equal(probe.dbPath, temp.dbPath);
  assert.deepEqual(probe.metadata, { source: 'test-suite' });

  cleanupTempDir(temp.dir);
});
