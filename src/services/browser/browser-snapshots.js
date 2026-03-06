const fs = require('fs');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, '..', '..', '..', 'data', 'browser-snapshots');

function slugify(value) {
  return String(value || 'snapshot')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function ensureSnapshotDirectory() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function writeBrowserSnapshot({ sourceName, label, html }) {
  if (!process.env.BROWSER_SNAPSHOTS_ENABLED || !html) {
    return null;
  }

  ensureSnapshotDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${timestamp}-${slugify(sourceName)}-${slugify(label)}.html`;
  const filePath = path.join(SNAPSHOT_DIR, fileName);
  fs.writeFileSync(filePath, html, 'utf8');
  return filePath;
}

module.exports = {
  writeBrowserSnapshot,
};
