# Phase 2 — Ingestion Acceleration

_Last updated: March 6, 2026_

## Phase goal

Increase detection speed and source coverage quality by combining:

- webhooks where available
- adaptive polling where webhooks are unavailable
- event-aware monitoring mode for conferences and launch windows
- browser-backed scraping for protected or JS-heavy sites
- domain-specific extraction recipes for high-value sites

### Features in this phase

- **1. Webhooks over polling where possible**
- **2. Adaptive polling frequencies**
- **3. Event-aware monitoring mode**
- **4. Browser-backed scraping for protected sites**
- **9. Domain-specific extraction recipes**

## Why this phase comes after Phase 1

This phase increases the bot’s complexity and request patterns.

That only becomes safe after:

- a stronger HTTP layer exists
- source health is visible
- crawl fallbacks exist
- delivery is queue-backed

Without that foundation, faster ingestion would mostly produce faster failures.

## End-state objective for Phase 2

By the end of this phase, the bot should be able to:

1. receive certain source updates immediately through webhooks
2. poll dynamic sources at different rates based on activity and health
3. temporarily boost monitoring during major events or conferences
4. scrape JS-heavy or protected pages using a browser transport when necessary
5. parse important domains with purpose-built extractors instead of generic `a` tag harvesting

---

## Feature 1 — Webhooks over polling where possible

### Core objective

Reduce time-to-detect and unnecessary request volume by replacing polling with webhooks for sources that support push delivery.

### Recommended principle

Use **hybrid ingestion**, not webhook absolutism.

Some sources will always remain polling-based. The architecture should support both cleanly.

### Best first-wave webhook candidates

| Source type | Why it is a strong first candidate |
|---|---|
| GitHub releases/tags | Mature webhook support, high signal, current repo already monitors GitHub |
| Package/version ecosystems where webhook or push mechanisms exist | Good signal for SDK tracker and supply-chain features |
| Any provider platform with stable outbound event support | Good for low-latency official updates |

### Recommended architecture

#### Preferred internal model

Webhook events should not bypass the main pipeline.

Instead:

1. receive webhook
2. validate signature/authentication
3. normalize into an observation payload
4. write to `observations` or `ingest_webhooks`
5. push into the same classification/corroboration pipeline used by polling

### Deployment considerations for AWS

The current deployment guide assumes outbound-only networking.

To add webhook support, one of these must be chosen:

#### Option A — In-process webhook receiver on EC2

Add a lightweight HTTP server to the Node bot or alongside it.

Pros:

- simplest to reason about
- easy local development

Cons:

- requires exposing HTTPS ingress
- requires secret verification and rate limiting
- mixes Discord bot runtime and public webhook ingress

#### Option B — Separate webhook relay service

Use a small relay that validates webhook requests and forwards canonical events to the bot.

Pros:

- cleaner isolation
- can scale independently
- easier future migration

Cons:

- more moving pieces

### Recommended decision

For a side-project-sized system, start with:

- **one small webhook receiver service** for GitHub first
- forward normalized webhook payloads into the same SQLite-backed intake path used by the bot

If you want the fewest moving parts possible, you can embed the receiver into the bot process first, but keep the code isolated behind a clear interface so it can be split later.

### Suggested modules

| File | Purpose |
|---|---|
| `src/services/webhooks/receiver.js` | HTTP receiver and route registration |
| `src/services/webhooks/validators.js` | Signature and secret verification |
| `src/services/webhooks/normalizers.js` | Convert provider webhook payloads into observations |
| `src/services/webhooks/routes/github.js` | GitHub-specific event mapping |

### Acceptance criteria

- GitHub release/tag webhook events can enter the pipeline
- Signature validation is enforced
- Webhook failures or duplicates do not create duplicate Discord alerts
- Webhook observations are indistinguishable from polled observations downstream

---

## Feature 2 — Adaptive polling frequencies

### Core objective

Replace static cron-only behavior with a scheduler that adapts to:

- recent source activity
- source health
- event mode
- source priority
- time-of-day patterns where useful

### Current state

`src/services/scheduler.js` currently uses fixed cron expressions from `src/config/sources.js`.

That works, but it means:

- active sources are sometimes checked too slowly
- quiet or unhealthy sources are sometimes checked too often
- event windows cannot be boosted cleanly

### How it should work

Introduce a **runtime polling profile** per source.

Each source should have:

- minimum interval
- maximum interval
- current interval
- activity multiplier
- health backoff multiplier
- event-mode multiplier

### Recommended scheduler model

Instead of regenerating cron expressions dynamically, switch to a tick-based dispatcher:

1. run a scheduler loop every minute
2. read due sources from memory or SQLite runtime state
3. dispatch sources whose `next_run_at` is due
4. recompute their next interval after each run

### Suggested runtime factors

| Factor | Effect |
|---|---|
| Recent signal density | More recent relevant items → shorter interval |
| Error/degraded state | Repeated failures → longer interval/backoff |
| Official launch window | During event mode → shorter interval for selected sources |
| Source priority | P0/P1 sources get tighter bounds |
| Source reliability | High-reliability sources can justify faster checks |

### Integration details

| Existing file | Change |
|---|---|
| `src/services/scheduler.js` | Becomes runtime scheduler instead of cron-only scheduler |
| `src/config/sources.js` | Adds min/max/default intervals and adaptive hints |
| `src/db/database.js` | Adds runtime scheduler state if persistence is desired |

### Acceptance criteria

- polling intervals can change without restarts
- unhealthy sources automatically back off
- event mode can temporarily accelerate targeted sources
- scheduler decisions are observable in logs or status views

---

## Feature 3 — Event-aware monitoring mode

### Core objective

Give the bot a dedicated operating mode for major events, conferences, launch windows, and likely announcement periods.

This directly incorporates the user requirement for a special place to track big events.

### Recommended product behavior

When an event mode is active, the system should:

- boost polling on selected sources
- prioritize event-relevant items in classification and routing
- route event updates into a dedicated surface
- optionally summarize the event in near-real time

### Recommended Discord UX

#### Permanent channel + per-event threads

Add:

- `🎪-major-events`

When an event mode starts:

- create a thread like `google-io-2026`
- route event-tagged alerts into that thread
- optionally mirror the highest-confidence items to `🚨-breaking-news`

### Recommended event mode model

#### `event_modes`

| Field | Purpose |
|---|---|
| `id` | Identifier |
| `slug` | e.g. `google-io-2026` |
| `title` | Human-readable event name |
| `status` | scheduled / active / finished |
| `starts_at` | Start timestamp |
| `ends_at` | End timestamp |
| `keywords_json` | Event keywords and entity hints |
| `source_boosts_json` | Which sources get faster polling |
| `delivery_channel_key` | `major-events` by default |
| `thread_id` | Discord thread reference |

### Recommended command set

| Command | Purpose |
|---|---|
| `/event start` | Start an event mode |
| `/event stop` | Stop it |
| `/event list` | Show scheduled/active events |
| `/event boost` | Adjust source boost set |

### Classification impact

Event mode should not blindly route everything into the event thread.

Instead, it should raise the score for items that match:

- event keywords
- relevant labs/speakers/products
- official sources associated with the event

### Acceptance criteria

- event mode can be enabled without code changes
- selected sources poll faster while active
- event-relevant alerts go to `major-events`
- normal server channels remain readable and not flooded

---

## Feature 4 — Browser-backed scraping for protected sites

### Core objective

Add a browser transport for sites where plain HTTP + Cheerio is insufficient because of:

- JS rendering
- anti-bot challenges
- dynamically injected content
- model IDs embedded in client-side bundles

### Important deployment reality

The current AWS guide recommends small EC2 footprints like `t2.micro`.

A full browser runtime may be heavy for that environment.

### Recommended operating modes

| Mode | Use when | Notes |
|---|---|---|
| `disabled` | Default if no browser infrastructure exists | Safest default |
| `local` | Local development or larger EC2 instance | Use Playwright locally |
| `remote` | Production on small hosts | Use a remote browser worker/service |

### Recommended technology choice

Use **Playwright** if browser support is added.

Why:

- strong DOM/query tooling
- good support for waiting on client rendering
- can capture HTML snapshots and screenshots for diagnostics
- flexible enough for both local and remote browser patterns

### Integration pattern

Do not make every adapter run a browser.

Only use browser transport when all of these are true:

1. the source is marked browser-eligible
2. the HTTP path is known to fail or miss critical data
3. the item is important enough to justify browser cost

### Suggested modules

| File | Purpose |
|---|---|
| `src/services/browser/browser-client.js` | Browser lifecycle and page fetch API |
| `src/services/browser/browser-policies.js` | Timeouts, wait strategies, screenshot rules |
| `src/services/browser/browser-snapshots.js` | Optional screenshot/HTML capture |

### First browser-backed targets

Based on the current repo and analysis document, the best early candidates are:

- protected or JS-heavy changelog pages
- playground/frontends where model IDs are client-side only
- selected blog pages currently returning 403 or partial HTML

### Acceptance criteria

- browser transport can be enabled per source
- HTML and extracted content match real rendered output better than plain HTTP
- costs/latency are bounded with strict policies
- browser failures degrade cleanly to non-browser behavior

---

## Feature 9 — Domain-specific extraction recipes

### Core objective

Move high-value sources away from broad generic extraction into domain recipes that know:

- where article cards live
- how titles are structured
- which URLs are canonical
- which links are navigation noise
- how to extract publish dates and authors where available

### Current state

`src/adapters/scrape-adapter.js` is a flexible generic adapter already, but it still relies mostly on:

- broad link selectors
- generic title extraction
- simple title heuristics

That is a strong generic fallback, but not the best long-term strategy for high-value sources.

### Recommended recipe architecture

Each recipe should define:

- domain matcher
- list extractor
- content extractor
- canonical URL logic
- title quality rules
- health expectations

### Suggested module layout

| File | Purpose |
|---|---|
| `src/services/extractors/recipe-registry.js` | Chooses a recipe by domain or source key |
| `src/services/extractors/recipes/*.js` | One recipe per high-value domain |
| `src/services/extractors/generic-recipe.js` | Fallback generic extractor |

### Best early recipe targets

- Anthropic blog/news pages
- Mistral announcements/news
- Cohere blog/research pages
- Gemini/API changelog pages
- provider docs or changelog pages already monitored today

### Acceptance criteria

- high-value domains no longer rely on broad `a` scraping alone
- parser precision improves measurably
- recipes are covered by fixture-based tests from Phase 1
- generic scrape logic remains as a fallback, not the primary path for major sources

---

## Phase 2 recommended implementation order

### Milestone 1 — Adaptive scheduler groundwork

1. Add source runtime profiles
2. Replace fixed-only dispatch logic with due-time scheduling
3. Log scheduler decisions

### Milestone 2 — Event mode

1. Add `event_modes` table and commands
2. Add `major-events` channel/thread support
3. Apply polling boosts and routing overrides

### Milestone 3 — Domain recipes

1. Add recipe registry
2. Migrate the top 3–5 highest-value domains first
3. Cover them with fixtures

### Milestone 4 — Browser transport

1. Add browser client abstraction
2. Enable only for a tiny allowlist of sources
3. Measure latency and success impact before broadening

### Milestone 5 — Webhook intake

1. Add GitHub webhook receiver first
2. Normalize webhook payloads into the same intake path as polling
3. Add dedup protection between polling and webhooks

## Definition of done for Phase 2

Phase 2 is complete when:

- the scheduler adapts instead of using only static cron intervals
- major events can be monitored in a dedicated mode and channel/thread
- selected domains use dedicated extraction recipes
- protected/JS-heavy pages can use a browser path when justified
- at least one real webhook source is integrated safely

## Main risk to avoid

Do **not** let Phase 2 create uncontrolled request growth.

Faster detection is only valuable if it remains operationally sustainable. Adaptive polling and browser scraping must always be bounded by health state, backoff rules, and cost-aware policies.