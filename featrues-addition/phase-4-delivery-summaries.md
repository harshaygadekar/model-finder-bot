# Phase 4 — Delivery, Breaking News & Summaries

_Last updated: March 6, 2026_

## Phase goal

Turn classified and corroborated events into a better user experience in Discord.

By this point, the bot should already know much more about what an item means. Phase 4 makes sure that intelligence shows up in how alerts are delivered, grouped, and summarized.

### Features in this phase

- **11. Breaking news aggregation**
- **12. Priority-aware delivery rules**
- **13. Better weekly summaries**

## Why this phase comes after Phase 3

Breaking-news aggregation and better summaries depend on:

- canonical events instead of only raw items
- classifier labels and confidence
- corroboration scores
- optional enriched article facts
- a queue-backed dispatch system

Without those, delivery upgrades become mostly formatting changes instead of real product improvements.

## End-state objective for Phase 4

By the end of this phase, the bot should be able to:

1. post one strong alert for one real-world event even when multiple sources detect it
2. route content differently based on urgency, confidence, and event type
3. produce weekly summaries centered on events, not on raw source buckets

---

## Feature 11 — Breaking news aggregation

### Core objective

When multiple adapters detect the same major event within a short window, produce **one stronger alert** instead of several loosely connected messages.

### Current state

The current system suppresses similar content through dedup logic, but it does not preserve the value of corroboration.

That means:

- some duplicate noise is prevented
- but the resulting alert does not become richer or stronger as more evidence arrives

### How breaking-news aggregation should work

For major event types, use a short aggregation window before sending the top-level alert.

#### Recommended default behavior

- hold provisional event for 3–10 minutes
- collect corroborating observations during that window
- if confidence crosses threshold, emit one aggregated alert
- if an official source arrives later, update the same event thread or post a confirmation follow-up

### Recommended breaking-news event states

| State | Meaning |
|---|---|
| `provisional` | Single-source or low-confidence early signal |
| `warming` | More evidence arriving, still under aggregation window |
| `breaking` | Threshold crossed; immediate alert should be sent |
| `confirmed` | Official confirmation or high-confidence corroboration reached |
| `closed` | Event is stable and no longer needs live aggregation |

### Recommended Discord behavior

#### Channel strategy

- post high-confidence breaking alerts to `🚨-breaking-news`
- if event mode is active, also route or mirror into the relevant `🎪-major-events` thread
- if the event is a rumor/leak only, keep it in `🔮-rumors-leaks` until it upgrades

#### Update strategy

For the same event, prefer:

- one top-level breaking alert
- follow-up updates in a thread or linked updates

Avoid posting a brand-new top-level alert for every corroborating item unless it materially changes the story.

### Suggested aggregated alert payload

A breaking-news alert should include:

- canonical event title
- confidence level
- event type
- top evidence sources
- important extracted facts if available
- a note such as “confirmed by official changelog” when applicable

### Acceptance criteria

- one real-world story usually produces one top-level breaking post, not many
- official confirmations upgrade the same event narrative
- corroboration makes alerts stronger instead of simply disappearing into dedup

---

## Feature 12 — Priority-aware delivery rules

### Core objective

Send the right event to the right place at the right urgency level.

### Current state

Routing is currently based primarily on `sourceType` through `CHANNEL_MAP` in `src/config/sources.js`.

That is a useful first-generation strategy, but it does not account for:

- corroboration

### Recommended future routing model

Route by **event attributes**, not just source type.

### Recommended routing inputs

| Input | Why it matters |
|---|---|
| `event_type` | Release, rumor, research, benchmark, deprecation, etc. |
| `confidence_score` | Determines immediacy and channel risk |
| `impact_score` | Separates major launches from minor updates |
| `source_reliability` | Avoids over-promoting weak evidence |
| `major_event_related` | Enables event-specific delivery |
| `needs_followup_thread` | Good for live evolving stories |

### Suggested delivery tiers

| Tier | Rule | Destination |
|---|---|---|
| P0 Immediate | official or highly corroborated major event | `🚨-breaking-news`, plus domain channel if appropriate |
| P1 High priority | important but not “breaking” | existing target channels such as `major-releases`, `model-updates`, `research-papers` |
| P2 Rumor/weak signal | uncertain, predictive, or low-confidence leak | `rumors-leaks` |
| P3 Batched | low urgency, informative but not urgent | weekly summary or delayed batch |
| Event-mode override | relevant to active conference/window | `major-events` thread, possibly mirrored |

### Recommended policy engine behavior

The delivery engine should answer these questions for every event:

1. Should this be posted now, delayed, aggregated, or suppressed?
2. Which channel(s) should receive it?
3. Should it create or reuse a thread?
4. Should it be eligible for the weekly digest?
5. Should it be downgraded to rumor status until official confirmation appears?

### Suggested modules

| File | Purpose |
|---|---|
| `src/services/delivery/policy-engine.js` | Main routing decision logic |
| `src/services/delivery/channel-router.js` | Maps event outcome to channels/threads |
| `src/services/delivery/priority-scorer.js` | Computes delivery tier |

### Acceptance criteria

- routing decisions depend on event confidence and type, not only source type
- rumor/leak content stays isolated unless upgraded
- major, confirmed stories get immediate and visible treatment
- low-priority items stop cluttering high-signal channels

---

## Feature 13 — Better weekly summaries

### Core objective

Make weekly digests read like a curated intelligence briefing instead of a bucket of links grouped by source type.

### Current state

`src/services/digest.js` already does two useful things:

- weekly paper digest grouped by category
- weekly AI roundup grouped by source type

That is a strong baseline, but it is still source-oriented.

### How weekly summaries should evolve

Summaries should become **event-centric**.

### Recommended weekly summary structure

1. Executive summary of the week
2. Top confirmed launches and major releases
3. Important rumors/leaks that were later confirmed or disproven
4. Research highlights
5. Notable China AI developments
6. Benchmark / leaderboard shifts
7. SDK and platform signals
8. Source reliability and detection-speed highlights

### Recommended digest variants

| Digest | Destination | Purpose |
|---|---|---|
| Weekly executive digest | `weekly-digest` | Main briefing |
| Weekly research digest | existing `research-papers` | Continue and improve current paper digest |
| Major event recap | `major-events` thread or `weekly-digest` | Conference-specific roundup |

### Recommended content building logic

Use events as the primary unit.

For each event chosen for the digest, include:

- canonical title
- why it matters
- top evidence sources
- confirmation status
- key extracted facts
- links to the most useful source(s)

### Recommended ranking signals for weekly digests

- event confidence
- source diversity
- impact score
- official confirmation
- community engagement or follow-up coverage, if available later

### Optional LLM use in summaries

LLM summarization is useful here, but it should be optional and controlled.

Recommended rule:

- build a deterministic digest candidate set first
- use the LLM only to rewrite or compress the narrative
- fall back to template-based formatting if the LLM path fails

### Suggested future command enhancements

| Command | Purpose |
|---|---|
| `/digest preview` | Preview upcoming weekly digest |
| `/digest event <slug>` | Generate a conference/event recap |
| `/digest rerun` | Rebuild with updated templates |

### Acceptance criteria

- weekly digest highlights the biggest events, not just the busiest source types
- repeated references to the same story are merged into one narrative section
- the summary feels like a curated briefing, not a raw log export

---

## Phase 4 recommended implementation order

### Milestone 1 — Event-aware delivery rules

1. Add policy engine and routing tiers
2. Keep existing channels as default fallbacks
3. Validate decisions in shadow mode

### Milestone 2 — Breaking-news aggregation

1. Add aggregation windows for major event classes
2. Send first aggregated alerts to `breaking-news`
3. Add follow-up thread/update behavior

### Milestone 3 — Digest engine upgrade

1. Build weekly selection from events, not raw items
2. Introduce narrative sections and confirmation tracking
3. Optionally enable LLM-assisted compression after deterministic selection is stable

## Definition of done for Phase 4

Phase 4 is complete when:

- major stories are aggregated into stronger alerts
- channel routing is confidence-aware and priority-aware
- weekly summaries describe the week’s events cleanly and coherently

## Main risk to avoid

Do **not** over-automate channel fan-out.

The moment the bot starts posting everything everywhere, every channel becomes a hallway. A hallway is not a news strategy.