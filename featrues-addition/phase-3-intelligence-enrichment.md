# Phase 3 — Intelligence & Enrichment

_Last updated: March 6, 2026_

## Phase goal

Transform raw source items into **confidence-scored intelligence events**.

This phase is where the bot starts behaving less like a feed forwarder and more like a signal intelligence system.

### Features in this phase

- **5. Replace keyword-only relevance scoring with a smarter classifier**
- **6. Cross-source corroboration scoring**
- **7. Source reliability scoring**
- **8. Full article enrichment pipeline**

## Why this phase comes after Phases 1 and 2

This phase depends on:

- queue-backed asynchronous processing
- strong crawl telemetry and health data
- better extraction quality from Phase 2
- a runtime flexible enough to tolerate slower classification and enrichment steps

Without those, LLM and enrichment work would either block delivery or create hard-to-debug failures.

## End-state objective for Phase 3

By the end of this phase, the bot should be able to:

1. classify items into meaningful alert types with a hybrid rules + LLM approach
2. group related observations from different sources into one event
3. rank sources based on observed precision, freshness, and stability
4. enrich high-value articles into structured summaries and extracted facts

---

## Feature 5 — Hybrid smarter classifier with keyword fallback

### Core objective

Improve relevance precision without losing the speed and safety of the current keyword system.

This directly incorporates the user requirement:

- **do not fully replace keyword scoring**
- keep keyword classification as a **fallback** when the LLM path fails, times out, or rate-limits

### Current state

`src/services/filter.js` currently:

- auto-passes P0/P1 items
- uses `calculateRelevance()` from `src/config/keywords.js` for lower-priority sources
- returns a binary pass/fail with a relevance score

That is fast and deterministic, but it does not understand:

- nuanced launch vs rumor vs benchmark distinctions
- ambiguous titles
- when an item is AI-related but not actually relevant to model tracking
- cross-source context

### Recommended classifier model

Use a **two-stage hybrid classifier** with **Groq as the only remote LLM provider** in the first rollout.

#### Selected Groq model

Use **`llama-3.1-8b-instant`** as the default Phase 3 model.

Why this is the best fit for this bot:

- Groq explicitly positions it for **content filtering**, **automated data extraction**, and **bulk tagging**, which closely matches this classifier/enrichment workload.
- It is the **cheapest production model** in the Groq list.
- It has the most practical **free-plan daily headroom** from the provided rate-limit table: `30 RPM`, `14.4K RPD`, `6K TPM`, and `500K TPD`.
- It supports **JSON mode / structured outputs**, which is essential for reliable label contracts.
- Its `131K` context window is more than enough for title/snippet classification and compact article-enrichment inputs.

This roadmap intentionally does **not** add Ollama Cloud, Vertex AI, or a multi-provider decision layer in Phase 3. Keep the remote path simple: **Groq + keyword fallback**.

#### Stage A — Deterministic heuristic pass

Run first for every item:

- source priority shortcuts
- keyword scoring
- negative keyword handling
- model-name pattern extraction
- fast entity hints

#### Stage B — Groq classification for ambiguous or high-value items

Send to Groq only when at least one of these is true:

- heuristic score falls into an ambiguity band
- source is important but title is unclear
- item is a potential rumor/leak or breaking story
- article enrichment needs structured extraction anyway

#### Rate-limit-aware operating rules

Because Groq rate limits are part of the design constraint, the first implementation should:

- keep classification prompts compact and schema-first
- truncate article bodies before enrichment classification
- cache by normalized content hash
- classify only ambiguity-band or high-value items
- automatically fall back to keyword-only mode during cooldown windows if Groq starts rate-limiting

The goal is to make the selected Groq model viable on the current limits without letting the classifier path become a quota-eating goblin.

### Recommended label taxonomy

The classifier should emit one primary label and optional secondary flags.

#### Primary labels

- `official_release`
- `api_availability`
- `model_update`
- `research_paper`
- `benchmark_update`
- `sdk_signal`
- `rumor_or_leak`
- `general_ai_news`
- `irrelevant`

#### Secondary flags

- `high_impact`
- `major_event_related`
- `china_ai`
- `pricing_change`
- `deprecation`
- `new_model_family`
- `timeline_worthy`

### Recommended output contract

The classifier result should include:

| Field | Meaning |
|---|---|
| `label` | Primary class |
| `confidence` | 0–1 score |
| `reason_codes` | Short machine-readable reasons |
| `entities` | provider, model family, model id, release surface |
| `priority_hint` | Suggested routing priority |
| `fallback_used` | Whether keyword fallback decided the outcome |
| `provider_used` | `keyword` or `groq:llama-3.1-8b-instant` |

### Recommended runtime behavior

If the Groq call fails, the bot should:

1. log the failure in `classifier_runs`
2. increment Groq error counters
3. fall back to keyword/rule logic immediately
4. continue delivering alerts without blocking the pipeline

### Integration details

| Current file | Change |
|---|---|
| `src/services/filter.js` | Becomes a thin wrapper or compatibility layer over a richer classifier service |
| `src/config/keywords.js` | Remains active as heuristic/fallback input |
| `src/services/notifier.js` | Reads classification outputs instead of only source type + priority |

### Suggested new modules

| File | Purpose |
|---|---|
| `src/services/classification/classifier.js` | Main orchestrator |
| `src/services/classification/keyword-classifier.js` | Current rules migrated into structured outputs |
| `src/services/classification/groq-classifier.js` | Groq-specific classification and response parsing |
| `src/services/classification/schema.js` | JSON schema for structured responses |

### Acceptance criteria

- keyword scoring still works when LLM is disabled or failing
- ambiguous items receive better labels than keyword-only logic
- classifier outputs are structured and auditable
- provider failures do not block ingestion or delivery

---

## Feature 6 — Cross-source corroboration scoring

### Core objective

Stop treating every near-duplicate as a nuisance. Treat multiple independent detections as evidence that strengthens the event.

### Current state

`src/db/database.js` currently uses content similarity to suppress repeated alerts.

That is helpful for spam prevention, but it leaves a lot of value on the table because it does not preserve:

- how many sources observed the same story
- whether an official source confirmed a rumor
- whether multiple independent communities saw the same leak

### How it should work

The system should cluster observations into canonical events.

#### Example

These may all belong to the same event:

- GitHub release note
- provider changelog entry
- Bluesky post from lab staff
- SDK version bump
- news article covering it
- playground leak found hours earlier

### Recommended event model

#### `events`

| Field | Purpose |
|---|---|
| `id` | Event ID |
| `event_key` | Canonical dedup/correlation key |
| `title` | Canonical event title |
| `event_type` | release, rumor, benchmark, deprecation, etc. |
| `confidence_score` | Overall confidence |
| `first_seen_at` | First observation time |
| `last_seen_at` | Most recent observation time |
| `official_confirmation_at` | When official confirmation arrived, if any |
| `status` | provisional / confirmed / suppressed |

#### `event_observations`

Maps each observation to its event and stores contribution metadata.

### Recommended scoring factors

- source diversity
- official-source presence
- source reliability score
- semantic similarity / entity match
- time proximity
- classifier confidence

### Example scoring components

| Factor | Effect |
|---|---|
| Official lab or provider source | Large positive boost |
| Two or more independent sources | Positive boost |
| Same content copied across mirrors only | Smaller boost |
| Low-reliability rumor source only | Modest or capped boost |
| Contradictory evidence | Negative or hold-state |

### Recommended behavior

- low-confidence single-source items can stay provisional
- corroborated items can upgrade from provisional to confirmed
- official confirmation should update the same event instead of creating a new one

### Acceptance criteria

- duplicate alerts are reduced without losing evidence
- rumors can become confirmed events rather than separate posts
- event confidence increases when corroborating evidence appears

---

## Feature 7 — Source reliability scoring

### Core objective

Track which sources are consistently useful, accurate, and early so the bot can weigh them differently.

### Why this matters

Not every source should influence routing equally.

A provider changelog, a curated official blog, and an anonymous rumor surface should not carry the same weight.

### Recommended reliability dimensions

| Dimension | Description |
|---|---|
| Precision proxy | How often a source produces events that remain valid or get confirmed |
| Freshness | How early the source tends to surface events |
| Stability | How often the extractor works cleanly |
| Noise rate | How often the source emits irrelevant or low-value items |
| Corroboration utility | How often the source adds genuinely new evidence |

### Important nuance

Reliability should be **contextual**, not absolute.

Examples:

- a rumor source may be poor for official announcements but excellent for early weak signals
- a news site may be slow but reliable for polished summaries
- a docs changelog may be authoritative but narrow in scope

### Recommended scoring model

Store a score per source and category where useful.

#### `source_reliability_scores`

| Column | Purpose |
|---|---|
| `source_name` | Source |
| `as_of` | Snapshot timestamp |
| `overall_score` | 0–1 score |
| `freshness_score` | 0–1 |
| `precision_score` | 0–1 |
| `stability_score` | 0–1 |
| `noise_score` | 0–1 inverse or penalty |
| `segment` | optional classification segment |

### Usage of reliability scores

- corroboration weighting
- adaptive polling bias
- delivery ranking
- weekly summary source statistics
- predictive alert scoring in Phase 5

### Acceptance criteria

- sources have visible reliability snapshots
- corroboration uses reliability weights
- scheduler and routing can reference reliability later without redesign

---

## Feature 8 — Full article enrichment pipeline

### Core objective

Convert important items from “title + snippet” into structured intelligence.

### What enrichment should add

For high-value items, enrich with:

- full article/body extraction
- canonical URL
- publish date if available
- provider and model entities
- pricing/context window/benchmark facts where stated
- concise summary
- extracted claims and evidence snippets

### Recommended run conditions

Do not enrich everything.

Only run enrichment when one or more is true:

- source priority is P0/P1
- event is corroborated or likely important
- item is selected for breaking-news or weekly summary use
- timeline storage would benefit from structured fields

### Recommended enrichment outputs

#### `article_enrichments`

| Field | Purpose |
|---|---|
| `observation_id` | Source observation |
| `canonical_url` | Clean canonical URL |
| `title` | Enriched canonical title |
| `byline` | Authors if found |
| `published_at` | Parsed publish time |
| `body_text` | Extracted cleaned body |
| `summary` | Concise summary |
| `facts_json` | Structured facts |
| `entities_json` | Extracted model/provider entities |
| `quality_score` | Extraction confidence |

### Recommended enrichment pipeline order

1. canonical URL resolution
2. fetch body using HTTP or browser transport
3. extract readable content
4. run structured extraction/classification on the body
5. cache and store the result

### Integration details

| Existing file | Change |
|---|---|
| `src/services/notifier.js` | Later uses enrichment summary for better embeds |
| `src/services/digest.js` | Later uses event summaries and extracted facts |
| `src/services/http.js` | Provides fetch transport and telemetry |

### Acceptance criteria

- important events can be summarized with more than a title/snippet
- structured metadata is stored for later digest and timeline use
- enrichment failures do not block base delivery

---

## Phase 3 data model recommendation

Phase 3 is the right time to formally introduce an **observation/event split**.

### Recommended intake flow after Phase 3

1. adapter emits observation candidate
2. observation stored in SQLite
3. classifier runs and labels it
4. corroboration links it to an event
5. enrichment optionally adds structured body-level facts
6. delivery rules decide whether to alert immediately, aggregate, or wait

## Phase 3 recommended implementation order

### Milestone 1 — Observation model

1. Add `observations`, `events`, and `event_observations`
2. Keep current user-facing notifications unchanged
3. Run in shadow mode first

### Milestone 2 — Hybrid classifier

1. Move keyword logic into structured classifier outputs
2. Add a Groq classifier client with schema validation, caching, and rate-limit guards
3. Enable LLM only for ambiguity/high-value paths

### Milestone 3 — Corroboration engine

1. Add canonicalization and event grouping
2. Track official confirmation and event upgrades
3. Compare output against existing dedup logic

### Milestone 4 — Reliability scoring

1. Compute first source snapshots from collected telemetry
2. Feed reliability into corroboration
3. Expose basic stats in ops views

### Milestone 5 — Enrichment

1. Enrich only top-priority items initially
2. Add caching and structured fact storage
3. Feed enriched content into summaries and alerts later

## Definition of done for Phase 3

Phase 3 is complete when:

- keyword filtering remains available as a safe fallback
- the bot can produce structured labels beyond pass/fail relevance
- repeated evidence across sources becomes a stronger event rather than a discarded duplicate
- source quality is captured in a reusable score
- important stories can be summarized with structured facts

## Main risk to avoid

Do **not** make the LLM path mandatory for the core bot loop.

The system must remain operational if the LLM provider is unavailable, slow, expensive, or temporarily disabled. The keyword path is not legacy baggage here; it is operational insurance with a tie and a clipboard.
