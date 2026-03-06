const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

test('GitHub webhook route validates, normalizes, and deduplicates release deliveries', async () => {
  const temp = createTempDbPath('github-webhook');
  db.init({ dbPath: temp.dbPath });

  const notifierModulePath = require.resolve('../../src/services/notifier');
  const routeModulePath = require.resolve('../../src/services/webhooks/routes/github');
  const originalNotifierModule = require.cache[notifierModulePath];
  const receivedBatches = [];

  require.cache[notifierModulePath] = {
    id: notifierModulePath,
    filename: notifierModulePath,
    loaded: true,
    exports: {
      notifyItems: async (items) => {
        receivedBatches.push(items);
        return { notified: items.length, seeded: 0, skippedOld: 0 };
      },
    },
  };
  delete require.cache[routeModulePath];

  const { handleGitHubWebhook } = require('../../src/services/webhooks/routes/github');
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = 'webhook-secret';

  try {
    const body = {
      action: 'published',
      repository: { full_name: 'openai/openai-node' },
      release: {
        name: 'v1.0.0',
        tag_name: 'v1.0.0',
        html_url: 'https://github.com/openai/openai-node/releases/tag/v1.0.0',
        body: 'Initial release',
        prerelease: false,
        published_at: new Date().toISOString(),
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
    const headers = {
      'x-github-delivery': 'delivery-1',
      'x-github-event': 'release',
      'x-hub-signature-256': signature,
    };

    const first = await handleGitHubWebhook({ headers, rawBody, body });
    assert.equal(first.statusCode, 202);
    assert.equal(receivedBatches.length, 1);
    assert.equal(receivedBatches[0][0].title, 'openai/openai-node: v1.0.0');
    assert.equal(db.getWebhookReceipt('delivery-1').status, 'processed');

    const duplicate = await handleGitHubWebhook({ headers, rawBody, body });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(receivedBatches.length, 1);
  } finally {
    db.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });

    if (originalNotifierModule) {
      require.cache[notifierModulePath] = originalNotifierModule;
    } else {
      delete require.cache[notifierModulePath];
    }
    delete require.cache[routeModulePath];

    if (previousSecret === undefined) {
      delete process.env.GITHUB_WEBHOOK_SECRET;
    } else {
      process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    }
  }
});
