const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'tracker.db');

let db;

/**
 * Initialize the SQLite database and create tables if they don't exist.
 */
function init() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_items (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      url TEXT,
      title TEXT,
      description TEXT,
      priority INTEGER DEFAULT 0,
      relevance_score REAL DEFAULT 1.0,
      discovered_at TEXT DEFAULT (datetime('now')),
      notified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS source_status (
      source_name TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      last_checked TEXT,
      last_success TEXT,
      error_count INTEGER DEFAULT 0,
      last_error TEXT,
      items_found INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      arxiv_id TEXT UNIQUE,
      title TEXT NOT NULL,
      authors TEXT,
      abstract TEXT,
      url TEXT,
      category TEXT,
      source TEXT,
      published_at TEXT,
      hf_likes INTEGER DEFAULT 0,
      discovered_at TEXT DEFAULT (datetime('now')),
      digest_sent INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_seen_items_discovered ON seen_items(discovered_at);
    CREATE INDEX IF NOT EXISTS idx_seen_items_source ON seen_items(source_type, source_name);
    CREATE INDEX IF NOT EXISTS idx_papers_category ON papers(category, published_at);
  `);

  return db;
}

/**
 * Generate a unique hash for an item to use as dedup key.
 */
function hashItem(url, title) {
  const input = `${(url || '').trim().toLowerCase()}::${(title || '').trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Check if an item has already been seen.
 */
function isItemSeen(url, title) {
  const id = hashItem(url, title);
  const row = db.prepare('SELECT id FROM seen_items WHERE id = ?').get(id);
  return !!row;
}

/**
 * Mark an item as seen and optionally as notified.
 */
function markSeen(item, notified = false) {
  const id = hashItem(item.url, item.title);
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO seen_items (id, source_type, source_name, url, title, description, priority, relevance_score, notified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    item.sourceType || 'unknown',
    item.sourceName || 'unknown',
    item.url || '',
    item.title || '',
    item.description || '',
    item.priority ?? 0,
    item.relevanceScore ?? 1.0,
    notified ? new Date().toISOString() : null
  );
  return id;
}

/**
 * Get recent items from the database.
 */
function getRecentItems(limit = 10) {
  return db.prepare(`
    SELECT * FROM seen_items
    WHERE notified_at IS NOT NULL
    ORDER BY discovered_at DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Update source check status.
 */
function updateSourceStatus(sourceName, sourceType, success, error = null, itemsFound = 0) {
  const now = new Date().toISOString();
  const successInt = success ? 1 : 0;
  const stmt = db.prepare(`
    INSERT INTO source_status (source_name, source_type, last_checked, last_success, error_count, last_error, items_found)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_name) DO UPDATE SET
      last_checked = ?,
      last_success = CASE WHEN ? THEN ? ELSE last_success END,
      error_count = CASE WHEN ? THEN 0 ELSE error_count + 1 END,
      last_error = ?,
      items_found = CASE WHEN ? THEN ? ELSE items_found END
  `);
  stmt.run(
    sourceName, sourceType, now, success ? now : null, success ? 0 : 1, error, itemsFound,
    now,
    successInt, now,
    successInt,
    error,
    successInt, itemsFound
  );
}

/**
 * Get all source statuses.
 */
function getAllSourceStatuses() {
  return db.prepare('SELECT * FROM source_status ORDER BY source_name').all();
}

/**
 * Get total counts for status summary.
 */
function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM seen_items').get();
  const notified = db.prepare('SELECT COUNT(*) as count FROM seen_items WHERE notified_at IS NOT NULL').get();
  const today = db.prepare(
    "SELECT COUNT(*) as count FROM seen_items WHERE discovered_at >= datetime('now', '-1 day')"
  ).get();
  return {
    totalItems: total.count,
    notifiedItems: notified.count,
    last24h: today.count,
  };
}

/**
 * Check if a source has never been checked before (first run).
 * Used for first-run seeding — silently add items without notifying.
 */
function isSourceNew(sourceName) {
  const row = db.prepare('SELECT source_name FROM source_status WHERE source_name = ?').get(sourceName);
  return !row;
}

/**
 * Save a research paper to the papers table.
 */
function savePaper(paper) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO papers (id, arxiv_id, title, authors, abstract, url, category, source, published_at, hf_likes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const id = crypto.createHash('sha256').update(paper.url || paper.arxivId).digest('hex').substring(0, 16);
  stmt.run(id, paper.arxivId || null, paper.title, paper.authors || '', paper.abstract || '', paper.url, paper.category || 'AI', paper.source || 'arxiv', paper.publishedAt || new Date().toISOString(), paper.hfLikes || 0);
  return id;
}

/**
 * Get papers from the last N days that haven't been included in a digest yet.
 */
function getWeeklyPapers(days = 7) {
  return db.prepare(`
    SELECT * FROM papers
    WHERE published_at >= datetime('now', '-${days} days')
    AND digest_sent = 0
    ORDER BY hf_likes DESC, published_at DESC
  `).all();
}

/**
 * Mark papers as included in a digest.
 */
function markPapersDigested(paperIds) {
  const stmt = db.prepare('UPDATE papers SET digest_sent = 1 WHERE id = ?');
  for (const id of paperIds) stmt.run(id);
}

/**
 * Get notified items from the last N days for weekly roundup.
 */
function getWeeklyNotified(days = 7) {
  return db.prepare(`
    SELECT * FROM seen_items
    WHERE notified_at IS NOT NULL
    AND notified_at >= datetime('now', '-${days} days')
    ORDER BY priority ASC, notified_at DESC
  `).all();
}

/**
 * Close the database connection.
 */
function close() {
  if (db) db.close();
}

module.exports = {
  init,
  hashItem,
  isItemSeen,
  markSeen,
  getRecentItems,
  updateSourceStatus,
  getAllSourceStatuses,
  getStats,
  isSourceNew,
  savePaper,
  getWeeklyPapers,
  markPapersDigested,
  getWeeklyNotified,
  close,
};
