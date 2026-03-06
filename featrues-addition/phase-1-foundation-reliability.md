# Phase 1 — Foundation & Reliability

_Last updated: March 6, 2026_

## Phase goal

Before the bot becomes smarter, it must become **safer to operate and easier to extend**.

This phase establishes the reliability primitives that almost every later feature depends on.

### Features in this phase

- **14. Shared HTTP client layer**
- **10. Crawl health and fallback paths**
- **16. Source-level health monitoring and alerting**
- **15. Queue-based notification pipeline**
- **17. Test coverage for filters, dedup, and extractors**

## Why this phase comes first

The repository already has the beginnings of this foundation:

- `src/services/http.js` already centralizes retries and ArXiv pacing
- `src/db/database.js` already stores `source_status` and `adapter_state`
- `src/services/scheduler.js` already queues startup checks modestly
- `src/services/notifier.js` already implements dedup/freshness before Discord sends

That means Phase 1 is not a rewrite. It is a **formalization and expansion of patterns that are already emerging**.

Without this phase, later features would suffer from:

- brittle scraper failures
- direct-delivery message loss
- poor production visibility
- feature regressions with no test safety net
- impossible-to-debug enrichment and classification failures

## End-state objective for Phase 1

At the end of Phase 1, the bot should behave like this:

1. Every fetch attempt has a clear request policy, telemetry, and retry behavior
2. Every source has a health record with enough detail to detect degradation early
3. Every send to Discord is queue-backed and retryable
4. Every source can define a primary and fallback crawl path
5. High-value parsing and dedup logic is protected by repeatable tests

---

## Feature 14 — Shared HTTP client layer

### Core objective

Create one network layer that all adapters use for:

- retries
- timeouts
- backoff/jitter
- user-agent policy
- source-specific rate limits
- HTTP metrics
- structured error classification
- optional transport switching (plain HTTP vs browser fallback)

### Current state

`src/services/http.js` already provides:

- retry logic for transient errors
- retry-after support
- ArXiv pacing
- `get`, `post`, and `getArxiv`

That is a strong starting point. The gap is that it is still **request-centric**, not **source-policy-centric**.

### How it should work

Introduce the idea of a **fetch policy**.

A fetch policy describes how a source should be accessed:

- timeout
- retry count
- rate limit bucket
- headers
- allowed transports
- whether browser fallback is allowed
- whether HTML snapshots should be kept on failure

### Recommended design

#### Keep `src/services/http.js` as the compatibility facade

Do not force every adapter import to change immediately.

Instead:

- keep `src/services/http.js` as the public entry point
- move richer logic into new modules behind it

### Recommended new modules

| File | Purpose |
|---|---|
| `src/services/network/request-client.js` | Core request execution, retry loop, timeout handling |
| `src/services/network/fetch-policies.js` | Policy registry per source/source type |
| `src/services/network/rate-limits.js` | Named buckets and request pacing |
| `src/services/network/crawl-recorder.js` | Writes `crawl_attempts` telemetry to SQLite |
| `src/services/network/error-classifier.js` | Normalizes 403/429/5xx/timeouts/bot-protection failures |

### Integration details

- `src/adapters/*.js` should call `http.get()` as they do now, but pass `sourceName` / `sourceType` context
- `src/services/http.js` should derive the policy from source metadata where available
- `src/db/database.js` should add `crawl_attempts`

### Suggested schema additions

#### `crawl_attempts`

| Column | Purpose |
|---|---|
| `id` | Primary key |
| `source_name` | Source identifier |
| `source_type` | Source type |
| `target_url` | Requested URL |
| `transport` | `http`, `browser`, `rss`, `api`, fallback transport used |
| `attempted_at` | Timestamp |
| `latency_ms` | Request duration |
| `status_code` | HTTP status if available |
| `success` | Boolean |
| `error_type` | Normalized error classification |
| `fallback_used` | Boolean |
| `response_size_bytes` | Optional payload size |

### Acceptance criteria

- Every adapter request path uses the shared client
- Failures are classified consistently
- Per-source latency and error rates can be queried from SQLite
- Rate-limit/politeness logic is centrally defined instead of scattered in adapters

---

## Feature 10 — Crawl health and fallback paths

### Core objective

Make source ingestion resilient by giving each source a **primary fetch path**, one or more **fallback strategies**, and a known **degraded mode**.

### Why it matters

Today, many adapters effectively have this behavior informally:

- `scrape-adapter.js` catches 403/401 and returns empty
- `changelog-adapter.js` has primary selectors and fallback selectors
- `playground-scraper-adapter.js` scans HTML and optionally JS bundles

The roadmap turns these patterns into a declared strategy per source.

### How it should work

Every source should define a crawl profile like this conceptually:

1. Primary transport and extractor
2. Secondary transport or extractor
3. Degraded mode behavior
4. Health escalation threshold
5. Recovery condition

### Example crawl profile shape

| Field | Meaning |
|---|---|
| `primaryTransport` | `http`, `rss`, `api`, `browser` |
| `fallbacks` | Ordered alternatives |
| `parser` | Extraction recipe name |
| `healthBudget` | Error threshold before degraded status |
| `cooldownMinutes` | Backoff after repeated failure |
| `snapshotOnFailure` | Save HTML or selected DOM for diagnosis |

### Recommended implementation approach

#### Do not hardcode fallback rules deep inside each adapter

Instead:

- adapters describe source intent
- crawl policies decide the fallback sequence
- extraction recipes decide how to parse each transport’s payload

### Integration details

| Current file | Evolution |
|---|---|
| `src/adapters/scrape-adapter.js` | Uses policy-driven fallback and recipe selection |
| `src/adapters/changelog-adapter.js` | Uses explicit parser fallback stack |
| `src/adapters/playground-scraper-adapter.js` | Uses primary HTML scan + optional browser path in later phases |
| `src/services/scheduler.js` | Uses source health to slow down unhealthy sources automatically |

### Degraded mode rules

When a source degrades, the bot should not silently fail forever.

Recommended degraded states:

- `healthy`
- `warning`
- `degraded`
- `disabled-temporarily`

### Acceptance criteria

- Each high-value source has a documented fallback path
- Repeated failures change source health state
- Degraded sources stop burning requests aggressively
- Failure snapshots exist for hard-to-debug parser breakages

---

## Feature 16 — Source-level health monitoring and alerting

### Core objective

Turn `source_status` from a simple “last checked / last error” table into a real operations surface.

### Current state

`src/db/database.js` already stores:

- `last_checked`
- `last_success`
- `error_count`
- `last_error`
- `items_found`

This is a good base, but it is not enough to answer key operational questions like:

- Is the source failing hard or just quiet?
- Did the page structure change?
- Is the source suddenly producing low-quality items?
- Is the source slower than usual?

### How it should work

Health should combine:

- fetch health
- extraction health
- notification health
- silence anomaly detection

### Recommended health dimensions

| Dimension | Examples |
|---|---|
| Availability | timeouts, 403, 5xx, auth failures |
| Extraction quality | zero items on a usually active page, empty titles, malformed URLs |
| Delivery quality | queue backlog, Discord failures |
| Freshness anomaly | source historically active but unexpectedly silent |
| Noise anomaly | sudden spike in low-quality or filtered-out items |

### Recommended schema additions

#### `source_health_metrics`

| Column | Purpose |
|---|---|
| `source_name` | Source |
| `window_start` | Aggregation window |
| `window_end` | Aggregation window |
| `success_rate` | Fetch success ratio |
| `avg_latency_ms` | Mean response time |
| `empty_result_rate` | Share of checks returning no usable items |
| `parse_error_rate` | Parser/extractor failures |
| `delivery_backlog` | Pending items relevant to this source |
| `health_state` | healthy / warning / degraded |

### Alerting behavior

Health alerts should go to the existing `bot-status` channel first.

Suggested alert triggers:

- 3 consecutive failures for a source
- 24 hours of silence from a historically active source
- parser success suddenly drops below threshold
- delivery queue backlog exceeds threshold

### Recommended command additions later

| Command | Purpose |
|---|---|
| `/health` | Show unhealthy sources and backlog |
| `/source <name>` | Detailed source health view |
| `/event status` | Active event-mode status |

### Acceptance criteria

- Operators can see unhealthy sources clearly
- Alerts are actionable, not noisy
- Source health informs adaptive polling in Phase 2
- Parser breakages become obvious within hours, not days

---

## Feature 15 — Queue-based notification pipeline

### Core objective

Separate discovery from delivery so alerts are not lost when Discord sends fail, rate limits hit, or classification/enrichment gets slower.

### Why this is foundational

The current flow in `src/services/scheduler.js` is:

`adapter.check() -> filterItems() -> notifyItems()`

That works for a small synchronous bot, but later features introduce:

- LLM classification latency
- article enrichment latency
- breaking-news aggregation windows
- retries and delayed dispatch
- priority routing rules

All of that becomes much easier when delivery is queue-backed.

### Recommended implementation strategy

#### Start with a SQLite queue, not a distributed broker

Because the project is:

- single-process today
- already SQLite-backed
- moderate-volume

The queue should be implemented in SQLite first.

### Recommended queue stages

#### Stage 1 — Delivery queue only

Use the queue first for the current notification payloads.

Flow:

1. adapters return items
2. existing filter/dedup still runs
3. instead of direct send, create `delivery_queue` rows
4. worker sends to Discord and retries on failure

This minimizes risk.

#### Stage 2 — Observation queue

After the event model is added in Phase 3:

1. adapters write `observations`
2. classifier/corroboration produces `events`
3. delivery rules enqueue dispatch jobs

### Suggested schema

#### `delivery_queue`

| Column | Purpose |
|---|---|
| `id` | Primary key |
| `job_type` | `alert`, `aggregate`, `digest`, `health-alert` |
| `payload_json` | Serialized embed/event payload |
| `status` | `pending`, `processing`, `sent`, `failed`, `dead-letter` |
| `priority` | Queue priority |
| `available_at` | Scheduled execution time |
| `attempt_count` | Retry count |
| `last_error` | Failure details |
| `created_at` | Creation time |
| `sent_at` | Success time |

#### `delivery_attempts`

Tracks each send attempt for observability and rate-limit debugging.

### Worker design

Add a delivery worker that:

- pulls the oldest/highest-priority eligible job
- locks it
- sends to Discord
- retries with exponential backoff on transient failures
- dead-letters after max attempts

### Integration details

| File | Change |
|---|---|
| `src/services/notifier.js` | Split into queue producer + worker dispatch functions |
| `src/index.js` | Starts the delivery worker on boot |
| `src/services/scheduler.js` | Stops sending directly after Stage 1 cutover |
| `src/db/database.js` | Adds queue tables and queue accessors |

### Acceptance criteria

- Discord send failures do not lose alerts permanently
- Backlog depth is observable
- Queue retries are bounded and safe
- Current channel behavior remains compatible during Stage 1

---

## Feature 17 — Test coverage for filters, dedup, and extractors

### Core objective

Add a test safety net before the architecture becomes more dynamic.

### Why it matters now

This repo currently has:

- no test script in `package.json`
- no test files in the workspace
- several parsing-heavy adapters and heuristic-heavy services

That makes future refactors risky.

### Recommended test strategy

Use **Node 22’s built-in test runner** first.

Why this is the right first move:

- already available in the runtime
- low setup overhead
- works with CommonJS
- enough for unit and fixture-based parser tests

### Recommended test structure

| Path | Purpose |
|---|---|
| `test/filter/*.test.js` | relevance scoring, fallback behavior |
| `test/dedup/*.test.js` | URL dedup, similarity dedup, canonicalization |
| `test/adapters/*.test.js` | fixture-based parsing and extraction |
| `test/fixtures/html/*` | saved HTML pages for scrape/changelog/playground tests |
| `test/fixtures/json/*` | saved API responses for GitHub/API model tests |

### First tests to implement

1. `filter.js` keyword scoring behavior
2. `database.js` dedup logic:
   - exact hash match
   - URL-only match
   - content similarity match
3. `scrape-adapter.js` extraction from representative HTML fixtures
4. `changelog-adapter.js` relevant-entry extraction from saved pages
5. `playground-scraper-adapter.js` model ID detection against saved HTML/JS

### Testing rules for future phases

- every new extractor should ship with at least one fixture
- every new canonicalization rule should ship with a regression test
- classifier fallbacks should be tested with provider-failure cases
- queue retry logic should be tested with simulated transient errors

### Acceptance criteria

- A repeatable test command exists
- Core parsing/dedup logic is covered by fixtures
- Critical regressions are caught before deployment

---

## Phase 1 recommended implementation order

### Milestone 1 — Telemetry and schema groundwork

1. Add `crawl_attempts`, `delivery_queue`, `delivery_attempts`, `source_health_metrics`
2. Add DB access helpers
3. Keep all user-facing behavior unchanged

### Milestone 2 — HTTP layer formalization

1. Add source-aware fetch policies
2. Record crawl attempts
3. Centralize error classification

### Milestone 3 — Crawl fallbacks and health state

1. Add fallback path registry for highest-value sources
2. Add degraded-state transitions
3. Send operational alerts to `bot-status`

### Milestone 4 — Queue-backed delivery

1. Add queue producer and worker
2. Switch notifier from direct-send to queue-send
3. Validate retry and rate-limit handling

### Milestone 5 — Tests

1. Add test runner/script
2. Add fixtures for scrape/changelog/playground/filter/dedup
3. Make tests required for future feature work

## Definition of done for Phase 1

Phase 1 is complete when all of the following are true:

- fetches are policy-driven and recorded
- failed sends are retryable through a queue
- health degradation is visible in Discord and SQLite
- high-value parsers have fixture-based tests
- later phases can reuse the queue and telemetry instead of bypassing them

## Main risk to avoid

Do **not** turn Phase 1 into a multi-month infrastructure rewrite.

This phase should establish the minimum durable foundation needed for later intelligence features, not reinvent the entire application platform. A humble SQLite queue is better than a heroic distributed system nobody asked for.
