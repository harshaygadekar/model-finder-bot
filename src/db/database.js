const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_DB_PATH = path.join(DEFAULT_DATA_DIR, 'tracker.db');

let db;
let currentDbPath = DEFAULT_DB_PATH;

function toSqliteDayModifier(days, fallback = 7) {
  const numericDays = Number(days);
  const safeDays = Number.isFinite(numericDays) ? Math.max(0, Math.floor(numericDays)) : fallback;
  return `-${safeDays} days`;
}

function toSqliteHourModifier(hours, fallback = 24) {
  const numericHours = Number(hours);
  const safeHours = Number.isFinite(numericHours) ? Math.max(1, Math.floor(numericHours)) : fallback;
  return `-${safeHours} hours`;
}

function ensureDirectoryForFile(filePath) {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toDbTimestamp(value = new Date()) {
  if (value == null || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function tableHasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!tableHasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function runMigrations() {
  addColumnIfMissing('source_status', 'consecutive_failures', 'INTEGER DEFAULT 0');
  addColumnIfMissing('source_status', 'consecutive_empty_checks', 'INTEGER DEFAULT 0');
  addColumnIfMissing('source_status', 'last_latency_ms', 'INTEGER');
  addColumnIfMissing('source_status', 'avg_latency_ms', 'REAL');
  addColumnIfMissing('source_status', 'health_state', "TEXT DEFAULT 'healthy'");
  addColumnIfMissing('source_status', 'last_alerted_health_state', 'TEXT');
  addColumnIfMissing('crawl_attempts', 'attempt_kind', "TEXT DEFAULT 'fetch'");
}

function normalizePriority(priority, fallback = 100) {
  const numericPriority = Number(priority);
  return Number.isFinite(numericPriority) ? numericPriority : fallback;
}

function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return fallback;
  }
}

function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function computeRollingAverage(previousValue, nextValue, weight = 0.3) {
  if (!Number.isFinite(nextValue)) return previousValue ?? null;
  if (!Number.isFinite(previousValue)) return nextValue;
  return Number(((previousValue * (1 - weight)) + (nextValue * weight)).toFixed(2));
}

function deriveHealthState({ success, consecutiveFailures = 0, consecutiveEmptyChecks = 0 }) {
  if (!success && consecutiveFailures >= 5) return 'disabled-temporarily';
  if (!success && consecutiveFailures >= 3) return 'degraded';
  if (!success && consecutiveFailures >= 1) return 'warning';
  if (success && consecutiveEmptyChecks >= 6) return 'warning';
  return 'healthy';
}

/**
 * Initialize the SQLite database and create tables if they don't exist.
 * @param {{ dbPath?: string }|string} [options]
 */
function init(options = {}) {
  const normalizedOptions = typeof options === 'string' ? { dbPath: options } : options;
  const dbPath = normalizedOptions.dbPath || DEFAULT_DB_PATH;

  if (db && currentDbPath === dbPath) {
    return db;
  }

  if (db) {
    db.close();
  }

  currentDbPath = dbPath;
  ensureDirectoryForFile(currentDbPath);

  db = new Database(currentDbPath);
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
      consecutive_failures INTEGER DEFAULT 0,
      consecutive_empty_checks INTEGER DEFAULT 0,
      last_error TEXT,
      items_found INTEGER DEFAULT 0,
      last_latency_ms INTEGER,
      avg_latency_ms REAL,
      health_state TEXT DEFAULT 'healthy',
      last_alerted_health_state TEXT
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

    CREATE TABLE IF NOT EXISTS arena_models (
      name TEXT PRIMARY KEY,
      organization TEXT,
      first_seen TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'leaderboard'
    );

    CREATE TABLE IF NOT EXISTS adapter_state (
      adapter_key TEXT NOT NULL,
      state_key TEXT NOT NULL,
      state_value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (adapter_key, state_key)
    );

    CREATE TABLE IF NOT EXISTS crawl_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      attempt_kind TEXT DEFAULT 'fetch',
      target_url TEXT,
      transport TEXT DEFAULT 'http',
      policy_name TEXT,
      attempted_at TEXT DEFAULT (datetime('now')),
      latency_ms INTEGER,
      status_code INTEGER,
      success INTEGER DEFAULT 0,
      error_type TEXT,
      error_message TEXT,
      fallback_used INTEGER DEFAULT 0,
      response_size_bytes INTEGER,
      items_found INTEGER,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS delivery_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      source_name TEXT,
      source_type TEXT,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 100,
      available_at TEXT DEFAULT (datetime('now')),
      attempt_count INTEGER DEFAULT 0,
      last_error TEXT,
      locked_at TEXT,
      lock_token TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS delivery_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      attempted_at TEXT DEFAULT (datetime('now')),
      success INTEGER DEFAULT 0,
      channel_key TEXT,
      message_id TEXT,
      error_message TEXT,
      response_json TEXT,
      FOREIGN KEY (job_id) REFERENCES delivery_queue(id)
    );

    CREATE TABLE IF NOT EXISTS source_health_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      success_rate REAL DEFAULT 0,
      avg_latency_ms REAL DEFAULT 0,
      empty_result_rate REAL DEFAULT 0,
      parse_error_rate REAL DEFAULT 0,
      delivery_backlog INTEGER DEFAULT 0,
      health_state TEXT NOT NULL DEFAULT 'healthy',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS runtime_heartbeats (
      component TEXT PRIMARY KEY,
      last_heartbeat TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS event_modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT,
      ends_at TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      source_boosts_json TEXT NOT NULL DEFAULT '[]',
      delivery_channel_key TEXT NOT NULL DEFAULT 'major-events',
      thread_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingest_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      delivery_id TEXT NOT NULL UNIQUE,
      signature_state TEXT NOT NULL DEFAULT 'verified',
      payload_json TEXT NOT NULL,
      normalized_json TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      error_message TEXT,
      received_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS classifier_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL,
      source_name TEXT,
      source_type TEXT,
      provider_used TEXT NOT NULL,
      model_name TEXT,
      status TEXT NOT NULL DEFAULT 'success',
      fallback_used INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      confidence REAL,
      latency_ms INTEGER,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      classification_label TEXT,
      classification_confidence REAL,
      entities_json TEXT,
      item_json TEXT,
      observed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL,
      confidence_score REAL NOT NULL DEFAULT 0,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      official_confirmation_at TEXT,
      status TEXT NOT NULL DEFAULT 'provisional'
    );

    CREATE TABLE IF NOT EXISTS event_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      observation_id INTEGER NOT NULL UNIQUE,
      source_name TEXT NOT NULL,
      contribution_score REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(event_id) REFERENCES events(id),
      FOREIGN KEY(observation_id) REFERENCES observations(id)
    );

    CREATE TABLE IF NOT EXISTS source_reliability_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_name TEXT NOT NULL,
      source_type TEXT NOT NULL,
      overall_score REAL NOT NULL,
      freshness_score REAL NOT NULL,
      precision_score REAL NOT NULL,
      stability_score REAL NOT NULL,
      noise_score REAL NOT NULL,
      segment TEXT,
      as_of TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS article_enrichments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_id INTEGER NOT NULL UNIQUE,
      canonical_url TEXT,
      title TEXT,
      published_at TEXT,
      body_text TEXT,
      summary TEXT,
      facts_json TEXT,
      entities_json TEXT,
      quality_score REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(observation_id) REFERENCES observations(id)
    );

    CREATE TABLE IF NOT EXISTS digest_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      digest_type TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, digest_type),
      FOREIGN KEY(event_id) REFERENCES events(id)
    );

    CREATE INDEX IF NOT EXISTS idx_seen_items_discovered ON seen_items(discovered_at);
    CREATE INDEX IF NOT EXISTS idx_seen_items_source ON seen_items(source_type, source_name);
    CREATE INDEX IF NOT EXISTS idx_seen_items_url ON seen_items(url);
    CREATE INDEX IF NOT EXISTS idx_papers_category ON papers(category, published_at);
    CREATE INDEX IF NOT EXISTS idx_adapter_state_updated ON adapter_state(updated_at);
    CREATE INDEX IF NOT EXISTS idx_crawl_attempts_source_time ON crawl_attempts(source_name, attempted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crawl_attempts_status ON crawl_attempts(success, error_type);
    CREATE INDEX IF NOT EXISTS idx_delivery_queue_lookup ON delivery_queue(status, available_at, priority, created_at);
    CREATE INDEX IF NOT EXISTS idx_delivery_queue_source ON delivery_queue(source_name, status);
    CREATE INDEX IF NOT EXISTS idx_delivery_attempts_job ON delivery_attempts(job_id, attempted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_health_metrics_source ON source_health_metrics(source_name, window_end DESC);
    CREATE INDEX IF NOT EXISTS idx_event_modes_status ON event_modes(status, starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_ingest_webhooks_provider ON ingest_webhooks(provider, status, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_classifier_runs_hash ON classifier_runs(content_hash, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source_name, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_last_seen ON events(last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_observations_event ON event_observations(event_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_reliability_latest ON source_reliability_scores(source_name, as_of DESC);
    CREATE INDEX IF NOT EXISTS idx_article_enrichments_created ON article_enrichments(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_digest_dispatches_type ON digest_dispatches(digest_type, sent_at DESC);
  `);

  runMigrations();

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

  const normalize = (value) =>
    (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s\u4e00-\u9fff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const needle = normalize(title);
  if (needle.length < 8) return false;

  const cutoff = toDbTimestamp(new Date(Date.now() - hoursBack * 60 * 60 * 1000));
  const recent = db.prepare(
    'SELECT title FROM seen_items WHERE datetime(discovered_at) >= datetime(?) AND notified_at IS NOT NULL'
  ).all(cutoff);

  for (const row of recent) {
    const hay = normalize(row.title);
    if (!hay) continue;

    const needleTokens = new Set(needle.split(' ').filter((token) => token.length > 2));
    const hayTokens = new Set(hay.split(' ').filter((token) => token.length > 2));
    if (needleTokens.size === 0 || hayTokens.size === 0) continue;

    const intersection = [...needleTokens].filter((token) => hayTokens.has(token)).length;
    const union = new Set([...needleTokens, ...hayTokens]).size;
    if (union > 0 && intersection / union > 0.6) return true;

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
  const notifiedAt = notified ? new Date().toISOString() : null;
  const stmt = db.prepare(`
    INSERT INTO seen_items (id, source_type, source_name, url, title, description, priority, relevance_score, notified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_type = excluded.source_type,
      source_name = excluded.source_name,
      url = excluded.url,
      title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      relevance_score = excluded.relevance_score,
      notified_at = COALESCE(seen_items.notified_at, excluded.notified_at)
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
    notifiedAt
  );

  return id;
}

function markItemNotified(url, title, notifiedAt = new Date().toISOString()) {
  const id = hashItem(url, title);
  db.prepare('UPDATE seen_items SET notified_at = COALESCE(notified_at, ?) WHERE id = ?').run(notifiedAt, id);
  return id;
}

/**
 * Get recent items from the database.
 */
function getRecentItems(limit = 10) {
  return db.prepare(`
    SELECT * FROM seen_items
    WHERE notified_at IS NOT NULL
    ORDER BY datetime(discovered_at) DESC
    LIMIT ?
  `).all(limit);
}

/**
 * Load adapter-specific persisted state.
 */
function getAdapterStateValue(adapterKey, stateKey, defaultValue = null) {
  const row = db.prepare(
    'SELECT state_value FROM adapter_state WHERE adapter_key = ? AND state_key = ?'
  ).get(adapterKey, stateKey);

  if (!row) return defaultValue;

  try {
    return JSON.parse(row.state_value);
  } catch {
    return row.state_value;
  }
}

/**
 * Persist adapter-specific state as JSON.
 */
function setAdapterStateValue(adapterKey, stateKey, value) {
  const now = toDbTimestamp();
  const serialized = JSON.stringify(value ?? null);

  db.prepare(`
    INSERT INTO adapter_state (adapter_key, state_key, state_value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(adapter_key, state_key) DO UPDATE SET
      state_value = excluded.state_value,
      updated_at = excluded.updated_at
  `).run(adapterKey, stateKey, serialized, now);

  return value;
}

/**
 * Update source check status.
 */
function updateSourceStatus(sourceName, sourceType, success, error = null, itemsFound = 0, options = {}) {
  const now = toDbTimestamp();
  const existing = db.prepare(`
    SELECT
      error_count,
      consecutive_failures,
      consecutive_empty_checks,
      items_found,
      avg_latency_ms,
      health_state,
      last_alerted_health_state
    FROM source_status
    WHERE source_name = ?
  `).get(sourceName) || {};

  const latencyMs = Number.isFinite(options.latencyMs) ? Math.max(0, Math.round(options.latencyMs)) : null;
  const consecutiveFailures = success ? 0 : (existing.consecutive_failures || 0) + 1;
  const consecutiveEmptyChecks = success
    ? (itemsFound === 0 ? (existing.consecutive_empty_checks || 0) + 1 : 0)
    : (existing.consecutive_empty_checks || 0);
  const avgLatencyMs = latencyMs == null
    ? (existing.avg_latency_ms ?? null)
    : computeRollingAverage(existing.avg_latency_ms, latencyMs);
  const healthState = options.healthState || deriveHealthState({
    success,
    consecutiveFailures,
    consecutiveEmptyChecks,
  });

  db.prepare(`
    INSERT INTO source_status (
      source_name,
      source_type,
      last_checked,
      last_success,
      error_count,
      consecutive_failures,
      consecutive_empty_checks,
      last_error,
      items_found,
      last_latency_ms,
      avg_latency_ms,
      health_state,
      last_alerted_health_state
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_name) DO UPDATE SET
      source_type = excluded.source_type,
      last_checked = excluded.last_checked,
      last_success = CASE WHEN excluded.last_success IS NOT NULL THEN excluded.last_success ELSE source_status.last_success END,
      error_count = excluded.error_count,
      consecutive_failures = excluded.consecutive_failures,
      consecutive_empty_checks = excluded.consecutive_empty_checks,
      last_error = excluded.last_error,
      items_found = excluded.items_found,
      last_latency_ms = excluded.last_latency_ms,
      avg_latency_ms = excluded.avg_latency_ms,
      health_state = excluded.health_state,
      last_alerted_health_state = COALESCE(source_status.last_alerted_health_state, excluded.last_alerted_health_state)
  `).run(
    sourceName,
    sourceType,
    now,
    success ? now : null,
    success ? 0 : consecutiveFailures,
    consecutiveFailures,
    consecutiveEmptyChecks,
    error,
    success ? itemsFound : (existing.items_found || 0),
    latencyMs,
    avgLatencyMs,
    healthState,
    existing.last_alerted_health_state || null
  );

  return {
    sourceName,
    sourceType,
    previousHealthState: existing.health_state || null,
    previousAlertedHealthState: existing.last_alerted_health_state || null,
    healthState,
    consecutiveFailures,
    consecutiveEmptyChecks,
    latencyMs,
    avgLatencyMs,
    itemsFound: success ? itemsFound : (existing.items_found || 0),
  };
}

function setSourceAlertedHealthState(sourceName, healthState) {
  db.prepare('UPDATE source_status SET last_alerted_health_state = ? WHERE source_name = ?').run(healthState, sourceName);
}

/**
 * Record a network crawl attempt for observability.
 */
function recordCrawlAttempt(attempt) {
  const result = db.prepare(`
    INSERT INTO crawl_attempts (
      source_name,
      source_type,
      attempt_kind,
      target_url,
      transport,
      policy_name,
      attempted_at,
      latency_ms,
      status_code,
      success,
      error_type,
      error_message,
      fallback_used,
      response_size_bytes,
      items_found,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attempt.sourceName || 'unknown',
    attempt.sourceType || 'unknown',
    attempt.attemptKind || 'fetch',
    attempt.targetUrl || null,
    attempt.transport || 'http',
    attempt.policyName || null,
    toDbTimestamp(attempt.attemptedAt || new Date()),
    Number.isFinite(attempt.latencyMs) ? Math.max(0, Math.round(attempt.latencyMs)) : null,
    Number.isFinite(attempt.statusCode) ? attempt.statusCode : null,
    attempt.success ? 1 : 0,
    attempt.errorType || null,
    attempt.errorMessage || null,
    attempt.fallbackUsed ? 1 : 0,
    Number.isFinite(attempt.responseSizeBytes) ? Math.max(0, Math.round(attempt.responseSizeBytes)) : null,
    Number.isFinite(attempt.itemsFound) ? Math.max(0, Math.round(attempt.itemsFound)) : null,
    safeJsonStringify(attempt.metadata || null)
  );

  return Number(result.lastInsertRowid);
}

function getRecentCrawlAttempts(limit = 50, sourceName = null) {
  const query = sourceName
    ? 'SELECT * FROM crawl_attempts WHERE source_name = ? ORDER BY datetime(attempted_at) DESC LIMIT ?'
    : 'SELECT * FROM crawl_attempts ORDER BY datetime(attempted_at) DESC LIMIT ?';

  const rows = sourceName
    ? db.prepare(query).all(sourceName, limit)
    : db.prepare(query).all(limit);

  return rows.map((row) => ({
    ...row,
    metadata: safeJsonParse(row.metadata_json, null),
  }));
}

/**
 * Enqueue a delivery job for asynchronous dispatch.
 */
function enqueueDeliveryJob(job) {
  const now = toDbTimestamp();
  const result = db.prepare(`
    INSERT INTO delivery_queue (
      job_type,
      source_name,
      source_type,
      payload_json,
      status,
      priority,
      available_at,
      attempt_count,
      last_error,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `).run(
    job.jobType || 'alert',
    job.sourceName || null,
    job.sourceType || null,
    safeJsonStringify(job.payload || {}),
    normalizePriority(job.priority, 100),
    toDbTimestamp(job.availableAt || now),
    Number.isFinite(job.attemptCount) ? job.attemptCount : 0,
    job.lastError || null,
    now,
    now
  );

  return Number(result.lastInsertRowid);
}

function claimNextDeliveryJob(lockToken, options = {}) {
  const now = toDbTimestamp(options.now || new Date());
  const jobTypes = Array.isArray(options.jobTypes) && options.jobTypes.length > 0 ? options.jobTypes : null;

  const claimJob = db.transaction(() => {
    const row = jobTypes
      ? db.prepare(`
          SELECT *
          FROM delivery_queue
          WHERE status = 'pending'
            AND available_at <= ?
            AND job_type IN (${jobTypes.map(() => '?').join(', ')})
          ORDER BY priority ASC, available_at ASC, created_at ASC
          LIMIT 1
        `).get(now, ...jobTypes)
      : db.prepare(`
          SELECT *
          FROM delivery_queue
          WHERE status = 'pending'
            AND available_at <= ?
          ORDER BY priority ASC, available_at ASC, created_at ASC
          LIMIT 1
        `).get(now);

    if (!row) return null;

    db.prepare(`
      UPDATE delivery_queue
      SET status = 'processing',
          lock_token = ?,
          locked_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(lockToken, now, now, row.id);

    return {
      ...row,
      payload: safeJsonParse(row.payload_json, {}),
      status: 'processing',
      lock_token: lockToken,
      locked_at: now,
      updated_at: now,
    };
  });

  return claimJob();
}

function releaseStaleDeliveryJobs(maxAgeMinutes = 15) {
  const now = toDbTimestamp();
  const cutoff = toDbTimestamp(new Date(Date.now() - maxAgeMinutes * 60 * 1000));
  const result = db.prepare(`
    UPDATE delivery_queue
    SET status = 'pending',
        lock_token = NULL,
        locked_at = NULL,
        updated_at = ?
    WHERE status = 'processing'
      AND locked_at IS NOT NULL
      AND locked_at <= ?
  `).run(now, cutoff);

  return result.changes;
}

function recordDeliveryAttempt(jobId, attempt) {
  const result = db.prepare(`
    INSERT INTO delivery_attempts (
      job_id,
      attempted_at,
      success,
      channel_key,
      message_id,
      error_message,
      response_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    toDbTimestamp(attempt.attemptedAt || new Date()),
    attempt.success ? 1 : 0,
    attempt.channelKey || null,
    attempt.messageId || null,
    attempt.errorMessage || null,
    safeJsonStringify(attempt.response || null)
  );

  return Number(result.lastInsertRowid);
}

function markDeliveryJobSent(jobId, details = {}) {
  const now = toDbTimestamp(details.sentAt || new Date());
  db.prepare(`
    UPDATE delivery_queue
    SET status = 'sent',
        sent_at = ?,
        last_error = NULL,
        lock_token = NULL,
        locked_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(now, now, jobId);
}

function retryDeliveryJob(jobId, errorMessage, options = {}) {
  const now = toDbTimestamp();
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : 60_000;
  const availableAt = toDbTimestamp(new Date(Date.now() + delayMs));

  db.prepare(`
    UPDATE delivery_queue
    SET status = 'pending',
        attempt_count = attempt_count + 1,
        last_error = ?,
        available_at = ?,
        lock_token = NULL,
        locked_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(errorMessage || null, availableAt, now, jobId);

  return availableAt;
}

function markDeliveryJobDeadLetter(jobId, errorMessage) {
  const now = toDbTimestamp();
  db.prepare(`
    UPDATE delivery_queue
    SET status = 'dead-letter',
        attempt_count = attempt_count + 1,
        last_error = ?,
        lock_token = NULL,
        locked_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(errorMessage || null, now, jobId);
}

function getDeliveryQueueStats() {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM delivery_queue
    GROUP BY status
  `).all();

  const stats = {
    pending: 0,
    processing: 0,
    sent: 0,
    'dead-letter': 0,
    total: 0,
    ready: 0,
  };

  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }

  const ready = db.prepare(`
    SELECT COUNT(*) AS count
    FROM delivery_queue
    WHERE status = 'pending'
      AND datetime(available_at) <= datetime('now')
  `).get();
  stats.ready = ready.count;

  return stats;
}

function getSourceHealthSummaries(windowHours = 24) {
  const hourModifier = toSqliteHourModifier(windowHours, 24);
  return db.prepare(`
    SELECT
      ss.*,
      COALESCE(crawl.success_rate, CASE WHEN ss.error_count = 0 AND ss.last_checked IS NOT NULL THEN 1.0 ELSE 0 END) AS success_rate,
      COALESCE(crawl.avg_latency_ms, ss.avg_latency_ms, 0) AS observed_avg_latency_ms,
      COALESCE(crawl.empty_result_rate, CASE WHEN ss.last_checked IS NOT NULL AND ss.items_found = 0 THEN 1.0 ELSE 0 END) AS empty_result_rate,
      COALESCE(crawl.parse_error_rate, 0) AS parse_error_rate,
      COALESCE(queue.delivery_backlog, 0) AS delivery_backlog
    FROM source_status ss
    LEFT JOIN (
      SELECT
        source_name,
        AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) AS success_rate,
        AVG(latency_ms) AS avg_latency_ms,
        AVG(CASE WHEN success = 1 AND COALESCE(items_found, 0) = 0 THEN 1.0 ELSE 0.0 END) AS empty_result_rate,
        AVG(CASE WHEN success = 0 AND error_type = 'parse_error' THEN 1.0 ELSE 0.0 END) AS parse_error_rate
      FROM crawl_attempts
      WHERE datetime(attempted_at) >= datetime('now', ?)
        AND attempt_kind = 'adapter-check'
      GROUP BY source_name
    ) crawl ON crawl.source_name = ss.source_name
    LEFT JOIN (
      SELECT source_name, COUNT(*) AS delivery_backlog
      FROM delivery_queue
      WHERE status IN ('pending', 'processing')
      GROUP BY source_name
    ) queue ON queue.source_name = ss.source_name
    ORDER BY
      CASE ss.health_state
        WHEN 'degraded' THEN 0
        WHEN 'warning' THEN 1
        ELSE 2
      END,
      ss.source_name ASC
  `).all(hourModifier);
}

function getSourceStatus(sourceName) {
  return db.prepare('SELECT * FROM source_status WHERE source_name = ?').get(sourceName) || null;
}

function snapshotSourceHealth(sourceName, sourceType, windowHours = 24) {
  const hourModifier = toSqliteHourModifier(windowHours, 24);
  const now = toDbTimestamp();
  const windowStart = toDbTimestamp(new Date(Date.now() - windowHours * 60 * 60 * 1000));
  const aggregated = db.prepare(`
    SELECT
      AVG(CASE WHEN success = 1 THEN 1.0 ELSE 0.0 END) AS success_rate,
      AVG(latency_ms) AS avg_latency_ms,
      AVG(CASE WHEN success = 1 AND COALESCE(items_found, 0) = 0 THEN 1.0 ELSE 0.0 END) AS empty_result_rate,
      AVG(CASE WHEN success = 0 AND error_type = 'parse_error' THEN 1.0 ELSE 0.0 END) AS parse_error_rate
    FROM crawl_attempts
    WHERE source_name = ?
        AND datetime(attempted_at) >= datetime('now', ?)
      AND attempt_kind = 'adapter-check'
  `).get(sourceName, hourModifier) || {};

  const backlog = db.prepare(`
    SELECT COUNT(*) AS count
    FROM delivery_queue
    WHERE source_name = ?
      AND status IN ('pending', 'processing')
  `).get(sourceName);

  const currentStatus = db.prepare('SELECT health_state FROM source_status WHERE source_name = ?').get(sourceName);

  const result = db.prepare(`
    INSERT INTO source_health_metrics (
      source_name,
      source_type,
      window_start,
      window_end,
      success_rate,
      avg_latency_ms,
      empty_result_rate,
      parse_error_rate,
      delivery_backlog,
      health_state
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourceName,
    sourceType,
    windowStart,
    now,
    aggregated.success_rate ?? 0,
    aggregated.avg_latency_ms ?? 0,
    aggregated.empty_result_rate ?? 0,
    aggregated.parse_error_rate ?? 0,
    backlog.count,
    currentStatus?.health_state || 'healthy'
  );

  return {
    id: Number(result.lastInsertRowid),
    sourceName,
    sourceType,
    windowStart,
    windowEnd: now,
    successRate: aggregated.success_rate ?? 0,
    avgLatencyMs: aggregated.avg_latency_ms ?? 0,
    emptyResultRate: aggregated.empty_result_rate ?? 0,
    parseErrorRate: aggregated.parse_error_rate ?? 0,
    deliveryBacklog: backlog.count,
    healthState: currentStatus?.health_state || 'healthy',
  };
}

function normalizeEventModeRow(row) {
  if (!row) return null;

  return {
    ...row,
    keywords: safeJsonParse(row.keywords_json, []),
    sourceBoosts: safeJsonParse(row.source_boosts_json, []),
  };
}

function createEventMode(eventMode) {
  const now = toDbTimestamp();
  const result = db.prepare(`
    INSERT INTO event_modes (
      slug,
      title,
      status,
      starts_at,
      ends_at,
      keywords_json,
      source_boosts_json,
      delivery_channel_key,
      thread_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventMode.slug,
    eventMode.title,
    eventMode.status || 'active',
    toDbTimestamp(eventMode.startsAt || now),
    toDbTimestamp(eventMode.endsAt || null),
    safeJsonStringify(eventMode.keywords || []),
    safeJsonStringify(eventMode.sourceBoosts || []),
    eventMode.deliveryChannelKey || 'major-events',
    eventMode.threadId || null,
    now,
    now
  );

  return getEventModeById(Number(result.lastInsertRowid));
}

function getEventModeById(id) {
  const row = db.prepare('SELECT * FROM event_modes WHERE id = ?').get(id);
  return normalizeEventModeRow(row);
}

function listEventModes(status = null) {
  const rows = status
    ? db.prepare('SELECT * FROM event_modes WHERE status = ? ORDER BY datetime(created_at) DESC').all(status)
    : db.prepare('SELECT * FROM event_modes ORDER BY datetime(created_at) DESC').all();

  return rows.map(normalizeEventModeRow);
}

function getActiveEventModes(at = new Date().toISOString()) {
  const resolvedAt = toDbTimestamp(at);
  const rows = db.prepare(`
    SELECT *
    FROM event_modes
    WHERE status = 'active'
      AND (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at >= ?)
    ORDER BY datetime(created_at) DESC
  `).all(resolvedAt, resolvedAt);

  return rows.map(normalizeEventModeRow);
}

function updateEventModeThreadId(id, threadId) {
  const now = toDbTimestamp();
  db.prepare(`
    UPDATE event_modes
    SET thread_id = ?,
        updated_at = ?
    WHERE id = ?
  `).run(threadId, now, id);

  return getEventModeById(id);
}

function stopEventMode(identifier) {
  const now = toDbTimestamp();
  const field = Number.isInteger(identifier) ? 'id' : 'slug';

  db.prepare(`
    UPDATE event_modes
    SET status = 'finished',
        ends_at = COALESCE(ends_at, ?),
        updated_at = ?
    WHERE ${field} = ?
  `).run(now, now, identifier);

  const row = db.prepare(`SELECT * FROM event_modes WHERE ${field} = ?`).get(identifier);
  return normalizeEventModeRow(row);
}

function matchesEventBoost(boosts, sourceName, sourceType) {
  if (!Array.isArray(boosts) || boosts.length === 0) {
    return false;
  }

  return boosts.some((boost) => {
    if (typeof boost !== 'string') return false;
    const normalized = boost.trim().toLowerCase();
    return normalized === String(sourceName || '').toLowerCase()
      || normalized === `type:${String(sourceType || '').toLowerCase()}`;
  });
}

function getActiveEventBoostForSource(sourceName, sourceType) {
  const activeModes = getActiveEventModes();
  const matchedModes = activeModes.filter((eventMode) => matchesEventBoost(eventMode.sourceBoosts, sourceName, sourceType));
  return matchedModes.length > 0 ? 2 : 1;
}

function findMatchingActiveEventMode(item) {
  const activeModes = getActiveEventModes();
  const text = `${item.title || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();

  return activeModes.find((eventMode) =>
    Array.isArray(eventMode.keywords)
      && eventMode.keywords.some((keyword) => keyword && text.includes(String(keyword).toLowerCase()))
  ) || null;
}

function recordWebhookReceipt({ provider, eventType, deliveryId, signatureState = 'verified', payload }) {
  const now = toDbTimestamp();
  const result = db.prepare(`
    INSERT OR IGNORE INTO ingest_webhooks (
      provider,
      event_type,
      delivery_id,
      signature_state,
      payload_json,
      received_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    provider,
    eventType,
    deliveryId,
    signatureState,
    safeJsonStringify(payload),
    now
  );

  if (result.changes === 0) {
    return { duplicate: true, deliveryId };
  }

  return { duplicate: false, deliveryId };
}

function markWebhookProcessed(deliveryId, { status = 'processed', normalized = null, errorMessage = null } = {}) {
  const now = toDbTimestamp();
  db.prepare(`
    UPDATE ingest_webhooks
    SET status = ?,
        normalized_json = ?,
        error_message = ?,
        processed_at = ?
    WHERE delivery_id = ?
  `).run(status, normalized ? safeJsonStringify(normalized) : null, errorMessage, now, deliveryId);
}

function getWebhookReceipt(deliveryId) {
  return db.prepare('SELECT * FROM ingest_webhooks WHERE delivery_id = ?').get(deliveryId) || null;
}

function recordClassifierRun(run) {
  const now = toDbTimestamp();
  db.prepare(`
    INSERT INTO classifier_runs (
      content_hash,
      source_name,
      source_type,
      provider_used,
      model_name,
      status,
      fallback_used,
      label,
      confidence,
      latency_ms,
      result_json,
      error_message,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.contentHash,
    run.sourceName || null,
    run.sourceType || null,
    run.providerUsed,
    run.modelName || null,
    run.status || 'success',
    run.fallbackUsed ? 1 : 0,
    run.label || null,
    run.confidence ?? null,
    run.latencyMs ?? null,
    run.result ? safeJsonStringify(run.result) : null,
    run.errorMessage || null,
    now
  );
}

function getCachedClassification(contentHash, ttlSeconds = 3600) {
  const cutoff = toDbTimestamp(new Date(Date.now() - (ttlSeconds * 1000)));
  const row = db.prepare(`
    SELECT *
    FROM classifier_runs
    WHERE content_hash = ?
      AND status = 'success'
      AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(contentHash, cutoff);

  if (!row?.result_json) {
    return null;
  }

  const result = safeJsonParse(row.result_json, null);
  if (!result) {
    return null;
  }

  return {
    ...result,
    cacheHit: true,
    providerUsed: row.provider_used,
    fallbackUsed: row.fallback_used === 1,
  };
}

function getObservationByHash(contentHash) {
  return db.prepare('SELECT * FROM observations WHERE content_hash = ?').get(contentHash) || null;
}

function recordObservation(observation) {
  const now = toDbTimestamp();
  db.prepare(`
    INSERT OR IGNORE INTO observations (
      content_hash,
      source_name,
      source_type,
      title,
      description,
      url,
      classification_label,
      classification_confidence,
      entities_json,
      item_json,
      observed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    observation.contentHash,
    observation.sourceName,
    observation.sourceType,
    observation.title,
    observation.description || null,
    observation.url || null,
    observation.classificationLabel || null,
    observation.classificationConfidence ?? null,
    safeJsonStringify(observation.entities || {}),
    safeJsonStringify(observation.item || {}),
    toDbTimestamp(observation.observedAt || now)
  );

  return getObservationByHash(observation.contentHash);
}

function getEventByKey(eventKey) {
  return db.prepare('SELECT * FROM events WHERE event_key = ?').get(eventKey) || null;
}

function upsertEvent(event) {
  const now = toDbTimestamp();
  db.prepare(`
    INSERT INTO events (
      event_key,
      title,
      event_type,
      confidence_score,
      first_seen_at,
      last_seen_at,
      official_confirmation_at,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_key) DO UPDATE SET
      title = excluded.title,
      event_type = excluded.event_type,
      confidence_score = excluded.confidence_score,
      last_seen_at = excluded.last_seen_at,
      official_confirmation_at = COALESCE(events.official_confirmation_at, excluded.official_confirmation_at),
      status = excluded.status
  `).run(
    event.eventKey,
    event.title,
    event.eventType,
    event.confidenceScore,
    toDbTimestamp(event.firstSeenAt || now),
    toDbTimestamp(event.lastSeenAt || now),
    toDbTimestamp(event.officialConfirmationAt || null),
    event.status || 'provisional'
  );

  return getEventByKey(event.eventKey);
}

function linkObservationToEvent(eventId, observationId, sourceName, contributionScore) {
  db.prepare(`
    INSERT OR IGNORE INTO event_observations (
      event_id,
      observation_id,
      source_name,
      contribution_score
    )
    VALUES (?, ?, ?, ?)
  `).run(eventId, observationId, sourceName, contributionScore ?? null);
}

function getEventObservationStats(eventId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS observation_count,
      COUNT(DISTINCT source_name) AS distinct_sources
    FROM event_observations
    WHERE event_id = ?
  `).get(eventId);

  return {
    observationCount: row?.observation_count || 0,
    distinctSources: row?.distinct_sources || 0,
  };
}

function recordSourceReliabilityScore(score) {
  const asOf = toDbTimestamp(score.asOf || new Date());
  db.prepare(`
    INSERT INTO source_reliability_scores (
      source_name,
      source_type,
      overall_score,
      freshness_score,
      precision_score,
      stability_score,
      noise_score,
      segment,
      as_of
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    score.sourceName,
    score.sourceType,
    score.overallScore,
    score.freshnessScore,
    score.precisionScore,
    score.stabilityScore,
    score.noiseScore,
    score.segment || null,
    asOf
  );
}

function getLatestSourceReliabilityScore(sourceName) {
  return db.prepare(`
    SELECT *
    FROM source_reliability_scores
    WHERE source_name = ?
    ORDER BY as_of DESC
    LIMIT 1
  `).get(sourceName) || null;
}

function getLatestSourceReliabilityScores() {
  const rows = db.prepare(`
    SELECT srs.*
    FROM source_reliability_scores srs
    JOIN (
      SELECT source_name, MAX(as_of) AS max_as_of
      FROM source_reliability_scores
      GROUP BY source_name
    ) latest
      ON latest.source_name = srs.source_name
     AND latest.max_as_of = srs.as_of
  `).all();

  return rows;
}

function getSourceReliabilityInputs(sourceName) {
  const observationStats = db.prepare(`
    SELECT
      COUNT(*) AS total_observations,
      SUM(CASE WHEN classification_label = 'irrelevant' THEN 1 ELSE 0 END) AS irrelevant_observations
    FROM observations
    WHERE source_name = ?
  `).get(sourceName);

  const eventStats = db.prepare(`
    SELECT
      COUNT(*) AS total_event_links,
      SUM(CASE WHEN events.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_event_links
    FROM event_observations
    JOIN events ON events.id = event_observations.event_id
    WHERE event_observations.source_name = ?
  `).get(sourceName);

  const sourceStatus = getSourceStatus(sourceName);
  const latestHealthMetric = db.prepare(`
    SELECT *
    FROM source_health_metrics
    WHERE source_name = ?
    ORDER BY window_end DESC
    LIMIT 1
  `).get(sourceName) || null;

  return {
    totalObservations: observationStats?.total_observations || 0,
    irrelevantObservations: observationStats?.irrelevant_observations || 0,
    totalEventLinks: eventStats?.total_event_links || 0,
    confirmedEventLinks: eventStats?.confirmed_event_links || 0,
    sourceStatus,
    latestHealthMetric,
  };
}

function getArticleEnrichment(observationId) {
  const row = db.prepare('SELECT * FROM article_enrichments WHERE observation_id = ?').get(observationId);
  if (!row) return null;

  return {
    ...row,
    facts: safeJsonParse(row.facts_json, []),
    entities: safeJsonParse(row.entities_json, {}),
  };
}

function recordArticleEnrichment(enrichment) {
  db.prepare(`
    INSERT INTO article_enrichments (
      observation_id,
      canonical_url,
      title,
      published_at,
      body_text,
      summary,
      facts_json,
      entities_json,
      quality_score
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(observation_id) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      title = excluded.title,
      published_at = excluded.published_at,
      body_text = excluded.body_text,
      summary = excluded.summary,
      facts_json = excluded.facts_json,
      entities_json = excluded.entities_json,
      quality_score = excluded.quality_score
  `).run(
    enrichment.observationId,
    enrichment.canonicalUrl || null,
    enrichment.title || null,
    enrichment.publishedAt || null,
    enrichment.bodyText || null,
    enrichment.summary || null,
    safeJsonStringify(enrichment.facts || []),
    safeJsonStringify(enrichment.entities || {}),
    enrichment.qualityScore ?? null
  );

  return getArticleEnrichment(enrichment.observationId);
}

function getRecentDigestCandidateEvents({ hours = 24, minConfidence = 0.7, limit = 8, digestType = 'breaking' } = {}) {
  const cutoff = toDbTimestamp(new Date(Date.now() - (Number(hours) * 60 * 60 * 1000)));
  return db.prepare(`
    SELECT
      events.*,
      COUNT(DISTINCT event_observations.source_name) AS distinct_sources,
      MIN(observations.url) AS representative_url,
      MAX(article_enrichments.summary) AS summary
    FROM events
    JOIN event_observations ON event_observations.event_id = events.id
    LEFT JOIN observations ON observations.id = event_observations.observation_id
    LEFT JOIN article_enrichments ON article_enrichments.observation_id = observations.id
    LEFT JOIN digest_dispatches ON digest_dispatches.event_id = events.id AND digest_dispatches.digest_type = ?
    WHERE events.status = 'confirmed'
      AND events.confidence_score >= ?
      AND datetime(events.last_seen_at) >= datetime(?)
      AND digest_dispatches.id IS NULL
    GROUP BY events.id
    ORDER BY events.confidence_score DESC, datetime(events.last_seen_at) DESC
    LIMIT ?
  `).all(digestType, minConfidence, cutoff, limit);
}

function markEventDigestDispatched(eventIds, digestType) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return;
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO digest_dispatches (event_id, digest_type, sent_at)
    VALUES (?, ?, ?)
  `);
  const now = toDbTimestamp();
  const insertMany = db.transaction((ids) => {
    for (const id of ids) {
      stmt.run(id, digestType, now);
    }
  });
  insertMany(eventIds);
}

function getRecentEventTimeline(limit = 10, hours = 24 * 7) {
  const cutoff = toDbTimestamp(new Date(Date.now() - (Number(hours) * 60 * 60 * 1000)));
  return db.prepare(`
    SELECT
      events.*,
      COUNT(DISTINCT event_observations.source_name) AS distinct_sources,
      MIN(observations.url) AS representative_url
    FROM events
    JOIN event_observations ON event_observations.event_id = events.id
    LEFT JOIN observations ON observations.id = event_observations.observation_id
    WHERE events.status = 'confirmed'
      AND datetime(events.last_seen_at) >= datetime(?)
    GROUP BY events.id
    ORDER BY datetime(events.last_seen_at) DESC, events.confidence_score DESC
    LIMIT ?
  `).all(cutoff, limit);
}

function getTopReliableSources(limit = 5) {
  return db.prepare(`
    SELECT srs.*
    FROM source_reliability_scores srs
    JOIN (
      SELECT source_name, MAX(as_of) AS max_as_of
      FROM source_reliability_scores
      GROUP BY source_name
    ) latest
      ON latest.source_name = srs.source_name
     AND latest.max_as_of = srs.as_of
    ORDER BY srs.overall_score DESC, srs.as_of DESC
    LIMIT ?
  `).all(limit);
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
    "SELECT COUNT(*) as count FROM seen_items WHERE datetime(discovered_at) >= datetime('now', '-1 day')"
  ).get();
  const queueStats = getDeliveryQueueStats();

  return {
    totalItems: total.count,
    notifiedItems: notified.count,
    last24h: today.count,
    deliveryQueue: queueStats,
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
  stmt.run(
    id,
    paper.arxivId || null,
    paper.title,
    paper.authors || '',
    paper.abstract || '',
    paper.url,
    paper.category || 'AI',
    paper.source || 'arxiv',
    toDbTimestamp(paper.publishedAt || new Date()),
    paper.hfLikes || 0
  );
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
  const dayModifier = toSqliteDayModifier(days, 7);
  return db.prepare(`
    SELECT * FROM papers
    WHERE datetime(published_at) >= datetime('now', ?)
    AND digest_sent = 0
    ORDER BY hf_likes DESC, datetime(published_at) DESC
  `).all(dayModifier);
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
  const dayModifier = toSqliteDayModifier(days, 7);
  return db.prepare(`
    SELECT * FROM seen_items
    WHERE notified_at IS NOT NULL
    AND datetime(notified_at) >= datetime('now', ?)
    ORDER BY priority ASC, datetime(notified_at) DESC
  `).all(dayModifier);
}

function getCurrentDbPath() {
  return currentDbPath;
}

function isInitialized() {
  return !!db;
}

function probeRuntimeWrite(component = 'readiness', metadata = null) {
  if (!db) {
    throw new Error('Database is not initialized');
  }

  const checkedAt = toDbTimestamp();
  const metadataJson = metadata == null ? null : safeJsonStringify(metadata);

  const writeProbe = db.transaction(() => {
    db.prepare(`
      INSERT INTO runtime_heartbeats (component, last_heartbeat, metadata_json)
      VALUES (?, ?, ?)
      ON CONFLICT(component) DO UPDATE SET
        last_heartbeat = excluded.last_heartbeat,
        metadata_json = excluded.metadata_json
    `).run(component, checkedAt, metadataJson);

    return db.prepare(`
      SELECT component, last_heartbeat, metadata_json
      FROM runtime_heartbeats
      WHERE component = ?
    `).get(component);
  });

  const row = writeProbe();
  if (!row) {
    throw new Error(`Failed to record runtime heartbeat for ${component}`);
  }

  return {
    ok: true,
    component: row.component,
    checkedAt: row.last_heartbeat,
    dbPath: currentDbPath,
    metadata: safeJsonParse(row.metadata_json, null),
  };
}

/**
 * Close the database connection.
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  init,
  hashItem,
  isItemSeen,
  isUrlSeen,
  isContentSimilarSeen,
  markSeen,
  markItemNotified,
  getRecentItems,
  updateSourceStatus,
  setSourceAlertedHealthState,
  recordCrawlAttempt,
  getRecentCrawlAttempts,
  enqueueDeliveryJob,
  claimNextDeliveryJob,
  releaseStaleDeliveryJobs,
  recordDeliveryAttempt,
  markDeliveryJobSent,
  retryDeliveryJob,
  markDeliveryJobDeadLetter,
  getDeliveryQueueStats,
  getSourceStatus,
  getSourceHealthSummaries,
  snapshotSourceHealth,
  createEventMode,
  getEventModeById,
  listEventModes,
  getActiveEventModes,
  updateEventModeThreadId,
  stopEventMode,
  getActiveEventBoostForSource,
  findMatchingActiveEventMode,
  recordWebhookReceipt,
  markWebhookProcessed,
  getWebhookReceipt,
  recordClassifierRun,
  getCachedClassification,
  recordObservation,
  getObservationByHash,
  upsertEvent,
  getEventByKey,
  linkObservationToEvent,
  getEventObservationStats,
  recordSourceReliabilityScore,
  getLatestSourceReliabilityScore,
  getLatestSourceReliabilityScores,
  getSourceReliabilityInputs,
  getArticleEnrichment,
  recordArticleEnrichment,
  getRecentDigestCandidateEvents,
  markEventDigestDispatched,
  getRecentEventTimeline,
  getTopReliableSources,
  getAllSourceStatuses,
  getStats,
  getAdapterStateValue,
  isSourceNew,
  savePaper,
  getKnownArenaModels,
  addArenaModel,
  isArenaModelKnown,
  setAdapterStateValue,
  getWeeklyPapers,
  markPapersDigested,
  getWeeklyNotified,
  getCurrentDbPath,
  isInitialized,
  probeRuntimeWrite,
  close,
};
