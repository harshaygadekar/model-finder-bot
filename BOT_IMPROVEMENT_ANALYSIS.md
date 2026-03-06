# Bot Improvement Analysis

_Last updated: March 6, 2026_

## Purpose

This document captures a repository-level review of `model_looker_bot` with a focus on:

- current bugs and design issues
- missing sources that can improve freshness and coverage
- feature ideas to improve scraping, crawling, classification, and delivery
- a practical priority matrix for implementation

This is a planning and analysis document only. No code changes are included here.

## Executive Summary

The bot already has strong breadth across RSS, GitHub, Hugging Face, Reddit, Bluesky, SDK tracking, Arena monitoring, changelog scraping, and playground leak detection. The main gaps are not about having zero coverage; they are about **detection speed, persistence of state, robustness under failures, and precision of relevance classification**.

The fastest path to becoming more competitive is:

1. persist state for all diff-based adapters
2. add retry and queueing behavior
3. add faster sources such as X/Twitter-like feeds, Discord/community feeds, and webhook-capable sources
4. upgrade relevance filtering from keyword-only logic to a smarter classification pipeline
5. improve aggregation so repeated corroborating signals become stronger alerts instead of simply being deduplicated away

---

## 1. Bugs and Issues Found

### Critical Issues

#### 1.1 In-memory state is lost on restart for several adapters

**Affected areas**
- `src/adapters/api-models-adapter.js`
- `src/adapters/sdk-tracker-adapter.js`
- `src/adapters/changelog-adapter.js`
- `src/adapters/playground-scraper-adapter.js`

**Problem**
These adapters keep their known state in memory only, such as known models, known entries, and last-seen versions. After a bot restart, they seed again and lose their previous comparison baseline.

**Why it matters**
- weaker continuity across deployments and crashes
- missed historical comparison context
- poor recovery after downtime
- higher chance of noisy first-run behavior

**Proposed fix**
Add a generic SQLite-backed state store, for example an `adapter_state` table, and persist:
- known model IDs per source
- known changelog entry hashes
- last seen package versions
- known playground model IDs

---

#### 1.2 Mystery model detection logic is duplicated

**Affected areas**
- `src/adapters/leaderboard-adapter.js`
- `src/adapters/arena-monitor-adapter.js`

**Problem**
The mystery-model rules, patterns, and helper logic are duplicated in both files.

**Why it matters**
- maintenance drift risk
- inconsistent behavior over time
- harder testing

**Proposed fix**
Extract shared logic into a reusable module such as `src/utils/mystery-detector.js` and cover it with tests.

---

#### 1.3 Broken source icon in notification embeds

**Affected area**
- `src/bot/embeds.js`

**Problem**
The `api-models` icon uses a corrupted replacement character instead of a valid emoji.

**Why it matters**
- visible user-facing formatting bug
- lower polish in Discord output

**Proposed fix**
Replace the invalid icon with a valid one such as `🔌`, `📡`, or `🧪`.

---

#### 1.4 Date-variant model IDs may produce false “new model” alerts

**Affected area**
- `src/adapters/api-models-adapter.js`

**Problem**
The date-variant dedup logic does not normalize provider-prefixed IDs deeply enough. IDs such as `openai/gpt-4o-2025-03-01` may be treated as brand-new instead of a date-tagged variant of an existing model family.

**Why it matters**
- false positives
- noisy model alerts
- weaker trust in detection quality

**Proposed fix**
Normalize both provider-prefixed and provider-less versions before comparison, and compare by canonical family ID.

---

#### 1.5 Hugging Face trending alerts can become repetitive

**Affected area**
- `src/adapters/hf-trending-adapter.js`

**Problem**
Trending items are emitted with “now” timestamps and position-based titles. This can cause repeated notifications when the same model stays trending.

**Why it matters**
- repetitive alerts
- reduced channel quality
- alert fatigue

**Proposed fix**
Use stable dedup keys for trending entities and suppress repeated alerts for the same model within a defined cooldown window.

---

### High-Priority Robustness Issues

#### 1.6 Reddit token refresh can race on cold start

**Affected area**
- `src/adapters/reddit-adapter.js`

**Problem**
The shared OAuth token is stored at module scope. Multiple simultaneous checks could trigger duplicate refresh attempts.

**Proposed fix**
Use a single in-flight refresh promise or a lightweight mutex.

---

#### 1.7 ArXiv request pacing is too aggressive for documented etiquette

**Affected areas**
- `src/adapters/arxiv-adapter.js`
- `src/adapters/talent-adapter.js`

**Problem**
The comments mention ArXiv pacing expectations, but the actual delays are shorter than ideal.

**Why it matters**
- higher rate-limit risk
- increased chance of temporary blocks or degraded responses

**Proposed fix**
Increase inter-request delays and centralize politeness/rate-limiting logic.

---

#### 1.8 Startup scheduling is bursty

**Affected area**
- `src/services/scheduler.js`

**Problem**
All adapters run almost immediately on startup with only a small stagger.

**Why it matters**
- startup thundering herd
- simultaneous network spikes
- higher chance of source-side throttling

**Proposed fix**
Add concurrency limits, larger staggering, or a startup queue with per-source-type pacing.

---

#### 1.9 Scrape adapter is too broad for some pages

**Affected area**
- `src/adapters/scrape-adapter.js`

**Problem**
Generic `a` selectors and broad link extraction logic can collect navigation, footer, or category links that are not true content items.

**Why it matters**
- false positives
- noisier downstream filtering
- wasted crawl budget

**Proposed fix**
Support content-scoped selectors, stricter title quality rules, optional allowlists, and domain-specific extractors.

---

#### 1.10 Translation relies on an unofficial endpoint with no fallback

**Affected area**
- `src/services/translator.js`

**Problem**
Translation currently depends on an unofficial Google Translate endpoint.

**Why it matters**
- fragile dependency
- unexpected breakage risk
- inconsistent translation quality and availability

**Proposed fix**
Add a fallback chain and abstract translation providers behind a service layer.

---

#### 1.11 No retry policy across network-heavy adapters

**Affected areas**
- most adapters using `axios`

**Problem**
A single transient error fails the entire check cycle.

**Why it matters**
- missed updates
- poor resilience during short outages

**Proposed fix**
Add a shared HTTP utility with:
- retries for network and 5xx failures
- exponential backoff
- timeout policy
- optional jitter

---

#### 1.12 SQL query construction should be tightened in a few places

**Affected area**
- `src/db/database.js`

**Problem**
A few SQL statements embed values directly into query strings instead of using parameter binding.

**Why it matters**
- avoidable maintainability risk
- inconsistent DB hygiene

**Proposed fix**
Use parameterized queries consistently.

---

## 2. Missing Sources to Add

These are the best candidates to improve freshness, breadth, and early detection.

### Highest-Value Additions

| Source | Signal Type | Why It Matters | Expected Speed Advantage | Suggested Implementation |
|---|---|---|---|---|
| X / Twitter-like feeds | social | Many AI launches leak or get teased there before official blogs | 30–60 minutes faster in many cases | API integration or RSS/Nitter-like bridge where available |
| Official Discord servers | community / official | Beta launches and product notices often appear here first | minutes to hours | Discord webhook or community monitor service |
| YouTube channel RSS | video / official | Keynotes, demos, and launch videos can precede blog posts | same-hour for events | Native YouTube RSS feeds |
| Mastodon / Fediverse | social | Strong presence from researchers and some labs | minutes to hours | public API polling |
| Weibo | Chinese social | Chinese labs often post there before English-language coverage | 1–3 hours faster for China AI | scraping or public endpoints |
| WeChat official accounts | Chinese social | Strong source for Chinese ecosystem announcements | hours | RSS bridge or specialized scraper |
| GitHub tags and commits | code | Some projects ship tags or code changes without formal releases | same-hour | GitHub API plus keyword scanning |
| Hugging Face Spaces | platform | Demo spaces often appear before official announcements | hours | Hugging Face APIs |
| Package registries for new packages | package distribution | New SDKs and new libraries can signal new products | same-day | npm and PyPI search/index polling |
| Cloud model catalogs | marketplace | Azure, Bedrock, and similar catalogs can expose new availability | same-day | provider catalog APIs |

---

## Expand Existing Coverage

### GitHub
Current coverage focuses on releases.

**Add next**
- tags without releases
- new repos inside watched orgs
- commit messages to main branch with model-related keywords
- discussions and issues for selected repos

### Reddit
Current coverage is useful but narrow.

**Candidate additions**
- `r/StableDiffusion`
- `r/ChatGPT`
- `r/AnthropicAI`
- `r/GoogleGeminiAI`
- `r/singularity`
- `r/Oobabooga`

### Bluesky
Expand beyond current accounts to include more labs, executives, and researchers.

### Hugging Face organizations
Strong start already, but could add more official and ecosystem orgs such as:
- `allenai`
- `BAAI`
- `internlm`
- `openbmb`
- `ai21labs`
- Apple or Apple-adjacent orgs if applicable

### Newsletters and curated feeds
Add more high-signal curated AI news sources.

**Candidate additions**
- The Batch
- TLDR AI
- Last Week in AI
- The Algorithm

---

## 3. Feature Suggestions

### A. Faster Detection

#### 3.1 Webhooks over polling where possible
Use push-based delivery for GitHub, Hugging Face, npm, and similar sources when available.

**Benefits**
- faster updates
- fewer wasted requests
- less rate-limit pressure

---

#### 3.2 Adaptive polling frequencies
Not every source should be polled on a fixed static schedule.

**Idea**
Adjust poll frequency based on:
- recent source activity
- time of day
- known launch windows
- conference or event calendars

---

#### 3.3 Event-aware monitoring mode
Increase polling before and during high-probability launch events such as:
- Google I/O
- OpenAI events
- major developer conferences
- research conference announcement periods

---

#### 3.4 Browser-backed scraping for protected sites
A headless-browser fallback would unlock sites currently blocked by bot protection and improve JS-heavy page extraction.

**Best use cases**
- Cloudflare-protected blogs
- JS-rendered changelog pages
- chat/playground frontends

---

### B. Better Accuracy and Classification

#### 3.5 Replace keyword-only relevance scoring with a smarter classifier
Current relevance scoring is keyword-driven and can produce both false positives and false negatives.

**Upgrade path**
Use a lightweight model classifier to label items as:
- model release
- research paper
- benchmark update
- rumor / leak
- general AI news
- irrelevant

**Benefits**
- fewer false alerts
- better routing
- better summaries

---

#### 3.6 Cross-source corroboration scoring
Right now, similar items are mostly suppressed by deduplication.

**Better approach**
Treat repeated discovery across multiple sources as a confidence boost.

**Example outcome**
- one source only → low confidence
- two independent sources → medium confidence
- official source plus community source → high confidence

---

#### 3.7 Source reliability scoring
Track which sources historically provide:
- accurate early signals
- low false-positive rates
- better freshness

Use this in ranking and routing.

---

#### 3.8 Full-article enrichment pipeline
For important items, do more than just pass through the snippet.

**Possible enrichment**
- full article fetch
- structured extraction of model name, provider, params, pricing, benchmarks
- concise human-friendly summary
- confidence score

---

### C. Better Scraping and Crawling Quality

#### 3.9 Domain-specific extraction recipes
Generic scraping works, but major sites often need special logic.

**Improve with**
- site-specific selectors
- title/content confidence rules
- anti-navigation filtering
- canonical URL extraction
- extraction health metrics per domain

---

#### 3.10 Crawl health and fallback paths
Each source should have:
- primary fetch path
- fallback fetch path
- retry strategy
- degraded-mode behavior
- explicit health reporting

---

#### 3.11 Screenshot or DOM diff snapshots for fragile pages
For highly dynamic or JS-driven pages, keep small change fingerprints or structural snapshots so breakage is easier to detect.

---

### D. Better Delivery and User Experience

#### 3.12 Breaking-news aggregation
If multiple adapters detect the same event within a short window, combine them into one stronger alert instead of spamming multiple messages.

---

#### 3.13 Priority-aware delivery rules
Examples:
- P0 items get immediate standalone posts
- lower-confidence rumors go to a dedicated channel
- lower-priority items may be batched hourly or daily

---

#### 3.14 User subscriptions and personalization
Add slash commands for users to subscribe to:
- labs
- model families
- research categories
- rumor/leak alerts only

---

#### 3.15 Better daily and weekly summaries
Make digests more intelligent by including:
- top stories by confidence and engagement
- grouped events across multiple sources
- category-specific highlights
- “what changed today” summaries

---

### E. Reliability and Architecture Improvements

#### 3.16 Queue-based notification pipeline
Separate discovery from delivery.

**Suggested flow**
`adapter -> normalize -> classify -> queue -> notify worker -> Discord`

**Benefits**
- fewer lost events
- retryable delivery
- better observability
- cleaner rate-limit handling

---

#### 3.17 Shared HTTP client layer
Unify timeouts, retries, user-agents, backoff, and metrics into a single reusable network layer.

---

#### 3.18 Source-level health monitoring and alerting
Use `source_status` more aggressively.

**Alert when**
- a source fails repeatedly
- a source goes silent unexpectedly
- scrape structure changes
- a source begins producing mostly low-quality items

---

#### 3.19 Test coverage for filters, dedup, and extractors
High-value tests to add first:
- relevance scoring behavior
- mystery model classification
- duplicate detection and cross-source similarity
- adapter parsing against captured fixtures

---

### F. Competitive Differentiators

#### 3.20 Time-to-detect metrics
Measure how quickly the bot detects changes after publication or exposure.

**Why this matters**
It gives a concrete performance benchmark against competitors.

---

#### 3.21 “Something is brewing” predictive alerts
Aggregate weak signals into a pre-release confidence signal.

**Examples**
- new SDK symbols
- hidden playground model IDs
- mystery Arena model appearance
- new package or repo creation
- sudden cluster of relevant staff or repo activity

---

#### 3.22 Historical model timeline
Store and expose first-seen history for models, leaks, removals, and official confirmations.

**Benefits**
- better competitive intelligence
- useful retrospective reporting
- easier debugging of detection quality

---

## 4. Summary Priority Matrix

| Priority | Recommendation | Why It Comes First | Expected Impact |
|---|---|---|---|
| P0 | Persist adapter state in SQLite | Prevents baseline loss after restart | High |
| P0 | Fix broken embed icon and clean output quality issues | Easy visible polish win | Medium |
| P0 | Add retry logic and a shared HTTP policy | Prevents missed updates from transient errors | High |
| P0 | Reduce noisy repeated alerts from trending and variant IDs | Improves trust and channel quality | High |
| P1 | Add webhook-capable sources where possible | Faster than polling | High |
| P1 | Add higher-speed social/community sources | Competitors often win here | High |
| P1 | Upgrade relevance scoring to a smarter classifier | Improves precision and routing | High |
| P1 | Add cross-source corroboration scoring | Turns duplicates into confidence | High |
| P1 | Introduce queue-based delivery | Improves resilience and rate-limit handling | High |
| P2 | Add browser-backed scraping for blocked or JS-heavy sources | Expands coverage significantly | Medium to High |
| P2 | Expand Reddit, Bluesky, HF orgs, and newsletter coverage | Better breadth | Medium |
| P2 | Add startup throttling and adaptive polling | Better performance and fewer rate-limit issues | Medium |
| P2 | Add source health alerts and diagnostics | Better operational reliability | Medium |
| P3 | Add user subscriptions and personalization | Better user experience | Medium |
| P3 | Add time-to-detect metrics and dashboards | Strong product differentiation | Medium |
| P3 | Add predictive “brewing” alerts | Unique intelligence layer | Medium to High |

---

## 5. Recommended Rollout Order

### Phase 1: Reliability First
- persist adapter state
- add retries and shared HTTP behavior
- fix noisy dedup edge cases
- fix small output bugs

### Phase 2: Faster Detection
- add webhook sources
- add faster social/community sources
- introduce event-aware polling

### Phase 3: Accuracy Upgrade
- smarter classifier
- cross-source corroboration
- enrichment pipeline

### Phase 4: Product Differentiation
- advanced digests
- user subscriptions
- dashboards
- predictive alerts
- time-to-detect metrics

---

## 6. Practical Next Steps

If implementation starts next, the most sensible order is:

1. create a generic persistent adapter state layer in SQLite
2. refactor shared detection helpers such as mystery-model logic
3. introduce a shared HTTP utility with retries and backoff
4. clean up duplicate/noisy alert sources
5. add one fast new source category first, preferably webhook-capable or social
6. add smarter scoring after the raw ingest layer is more stable

---

## 7. Closing Note

The repository already has the bones of a strong competitive intelligence bot. The next big leap is not merely “more feeds”; it is **faster signal acquisition, better signal interpretation, and more reliable delivery**.

The highest-return improvements are therefore:
- persistent state
- better resilience
- faster upstream sources
- smarter ranking and corroboration
- more thoughtful presentation of breaking events
