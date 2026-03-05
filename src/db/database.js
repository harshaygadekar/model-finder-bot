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
    CREATE INDEX IF NOT EXISTS idx_seen_items_url ON seen_items(url);
    CREATE INDEX IF NOT EXISTS idx_papers_category ON papers(category, published_at);

    CREATE TABLE IF NOT EXISTS arena_models (
      name TEXT PRIMARY KEY,
      organization TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'leaderboard'
    );
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
 * Check if a URL has already been seen (URL-only dedup safety net).
 * Catches same article with minor title variations across polls.
 */
function isUrlSeen(url) {
  if (!url) return false;
  const normalized = url.trim().toLowerCase().replace(/\/+$/, '');
  const row = db.prepare('SELECT id FROM seen_items WHERE LOWER(TRIM(url)) = ? LIMIT 1').get(normalized);
  return !!row;
}

/**
 * Check if a similar title was seen recently (cross-source content dedup).
 * Prevents the same news story from being posted from multiple sources.
 */
function isContentSimilarSeen(title, hoursBack = 48) {
  if (!title || title.length < 10) return false;

  const normalize = (t) =>
    (t || '').toLowerCase().replace(/[^a-z0-9\s\u4e00-\u9fff]/g, '').replace(/\s+/g, ' ').trim();

  const needle = normalize(title);
  if (needle.length < 8) return false;

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const recent = db.prepare(
    'SELECT title FROM seen_items WHERE discovered_at >= ? AND notified_at IS NOT NULL'
  ).all(cutoff);

  for (const row of recent) {
    const hay = normalize(row.title);
    if (!hay) continue;

    // Token overlap ratio (Jaccard-like similarity)
    const needleTokens = new Set(needle.split(' ').filter(t => t.length > 2));
    const hayTokens = new Set(hay.split(' ').filter(t => t.length > 2));
    if (needleTokens.size === 0 || hayTokens.size === 0) continue;

    const intersection = [...needleTokens].filter(t => hayTokens.has(t)).length;
    const union = new Set([...needleTokens, ...hayTokens]).size;
    if (union > 0 && intersection / union > 0.6) return true;

    // Substring containment for CJK text (Chinese chars don't use spaces)
    if (needle.length > 15 && hay.length > 15) {
      const needleSub = needle.substring(0, Math.min(needle.length, 20));
      const haySub = hay.substring(0, Math.min(hay.length, 20));
      if (needle.includes(haySub) || hay.includes(needleSub)) return true;
    }
  }

  return false;
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

// ─── Arena Model Persistence ─────────────────────────────────────────────────

/**
 * Get all known arena models from the database.
 */
function getKnownArenaModels() {
  return db.prepare('SELECT name, organization, first_seen FROM arena_models').all();
}

/**
 * Add a new arena model to the database.
 */
function addArenaModel(name, organization, source = 'leaderboard') {
  db.prepare('INSERT OR IGNORE INTO arena_models (name, organization, source) VALUES (?, ?, ?)')
    .run(name, organization || 'Unknown', source);
}

/**
 * Check if an arena model is already known.
 */
function isArenaModelKnown(name) {
  const row = db.prepare('SELECT name FROM arena_models WHERE name = ?').get(name);
  return !!row;
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
  isUrlSeen,
  isContentSimilarSeen,
  markSeen,
  getRecentItems,
  updateSourceStatus,
  getAllSourceStatuses,
  getStats,
  isSourceNew,
  savePaper,
  getKnownArenaModels,
  addArenaModel,
  isArenaModelKnown,
  getWeeklyPapers,
  markPapersDigested,
  getWeeklyNotified,
  close,
};
