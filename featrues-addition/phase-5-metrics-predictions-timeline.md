# Phase 5 — Metrics, Predictions & Historical Intelligence

_Last updated: March 6, 2026_

## Phase goal

Create the long-term intelligence layer that differentiates the bot from a normal alerting tool.

This phase turns accumulated evidence into:

- measurable detection performance
- predictive early-warning signals
- durable historical timelines for model ecosystems

### Features in this phase

- **18. Time-to-detect metrics**
- **19. “Something is brewing” predictive alerts**
- **20. Historical model timeline**

## Why this phase comes last

These features depend on clean historical data from earlier phases:

- observations
- canonical events
- source reliability scores
- event confirmations
- enrichment facts
- delivery outcomes

If they are implemented too early, they become guesswork dashboards over noisy data.

## End-state objective for Phase 5

By the end of this phase, the bot should be able to:

1. measure how quickly it detects meaningful updates
2. identify clusters of weak signals that suggest an upcoming launch or reveal
3. preserve a model-centric historical timeline that explains what happened and when

---

## Feature 18 — Time-to-detect metrics

### Core objective

Quantify how fast the bot detects an event relative to when that event became externally visible.

### Why it matters

Time-to-detect is one of the most valuable product-level metrics for this bot because it answers:

- Are we actually early?
- Which sources help us detect first?
- Are webhooks and adaptive polling worth the complexity?
- Are we improving or regressing over time?

### Recommended metric definitions

#### Event detection lag

Time between:

- `event.first_visible_at` (best known publish/exposure time)
- and `event.first_detected_at` (first observation by the bot)

#### Official confirmation lead/lag

Time between:

- first rumor or weak signal
- first official confirmation

This is especially valuable for leak-heavy monitoring.

#### Source contribution lag

Time between:

- `event.first_detected_at`
- and each subsequent source observation

This shows which sources are early, confirming, or late.

### Important caveat

Not every source has a trustworthy publish time.

So the system should store a **timestamp confidence** level:

- exact
- inferred
- unavailable

### Suggested schema additions

#### `detection_metrics`

| Column | Purpose |
|---|---|
| `event_id` | Event |
| `first_visible_at` | Best known external visibility time |
| `first_visible_confidence` | exact / inferred / unknown |
| `first_detected_at` | Bot detection time |
| `detection_lag_seconds` | Core lag metric |
| `official_confirmation_at` | Optional official confirmation time |
| `lead_vs_official_seconds` | Negative = detected before official confirmation |

### Recommended outputs

- per-source average detection lag
- per-source distribution of first-detection wins
- top fastest detections this week/month
- pre-official detections by rumor/playground/API sources

### Acceptance criteria

- time-to-detect can be computed for a meaningful subset of events
- sources can be ranked by timeliness
- metrics can be referenced in weekly or monthly reporting

---

## Feature 19 — “Something is brewing” predictive alerts

### Core objective

Generate cautious, low-confidence alerts when multiple weak signals suggest that a model launch or major update may be imminent.

### Product intent

This feature should not pretend certainty. It should act as an early-warning system.

### Recommended product behavior

Predictive alerts should:

- be clearly labeled as speculative
- live in a lower-risk surface like `rumors-leaks`
- require multiple weak signals or one unusually strong unofficial signal
- use cooldowns to avoid repetitive noise

### Recommended signal sources

| Signal family | Example inputs |
|---|---|
| API changes | new live model IDs, direct API model appearance |
| Playground/frontends | newly exposed model identifiers |
| Benchmark shifts | mystery models or sudden leaderboard entries |
| SDK/package changes | new package versions, hidden symbols, new model enums |
| Docs/changelog hints | preview mentions, quiet model references |
| Social chatter | multiple relevant posts without official confirmation |

### Recommended predictive scoring idea

Build a weighted signal score using:

- signal strength
- source reliability
- source diversity
- recency decay
- prior confirmation history for similar signal patterns

### Recommended prediction record

#### `prediction_signals`

| Column | Purpose |
|---|---|
| `id` | Signal ID |
| `event_key` | Candidate event cluster |
| `signal_type` | playground, sdk, api-live, benchmark, social, docs |
| `source_name` | Source |
| `weight` | Signal contribution |
| `observed_at` | Time |
| `expires_at` | Signal decay horizon |
| `context_json` | Details |

#### `predictions`

| Column | Purpose |
|---|---|
| `id` | Prediction ID |
| `event_key` | Candidate future event |
| `score` | Aggregate prediction score |
| `status` | active / cooled / confirmed / expired |
| `first_triggered_at` | Initial alert time |
| `last_strengthened_at` | Latest score increase |
| `confirmed_event_id` | If later confirmed |

### Risk controls

This feature can get noisy very quickly unless tightly constrained.

Recommended controls:

- require at least 2 independent weak signals, or 1 strong weak-signal category such as API + playground
- cap repeat alerts per candidate event
- store expiration windows
- never route predictive alerts to top-priority official channels by default

### Acceptance criteria

- predictive alerts are labeled clearly and routed safely
- repeat weak signals strengthen one candidate prediction rather than generating many alerts
- confirmed outcomes can be linked back to prior predictions for learning

---

## Feature 20 — Historical model timeline

### Core objective

Store a model-centric timeline that shows how a model or model family moved through its lifecycle.

### Why it matters

This is useful for:

- retrospective analysis
- competitive intelligence
- debugging detection quality
- understanding how rumors, leaks, docs, and official launches connect over time

### Recommended timeline model

#### `model_entities`

Represents a canonical model family or model identity.

Examples:

- `gpt-4o`
- `gpt-4.5`
- `claude-sonnet-4`
- `gemini-2.5-pro`

#### `model_timeline_events`

Stores lifecycle milestones.

### Recommended lifecycle event types

- `first_rumor_seen`
- `playground_identifier_seen`
- `api_model_live`
- `sdk_symbol_added`
- `benchmark_entry_seen`
- `official_blog_announced`
- `pricing_published`
- `model_removed`
- `deprecation_notice`

### Recommended timeline behavior

When a new event is confirmed or detected:

1. resolve the event to a canonical model entity if possible
2. append or update the relevant lifecycle milestone
3. link the timeline milestone back to the supporting event and observations

### Suggested user-facing outputs later

| Surface | Example |
|---|---|
| Slash command | `/timeline model:gpt-4o` |
| Weekly summary section | “Models that changed state this week” |
| Ops review | Compare first rumor vs official launch lag |

### Integration benefit

The timeline becomes the durable memory layer that ties together:

- corroboration
- predictive alerts
- official confirmation
- time-to-detect metrics

### Acceptance criteria

- model lifecycle milestones are queryable
- events can be traced from weak signal to official release to deprecation
- timeline data is reusable in summaries and diagnostics

---

## Phase 5 recommended implementation order

### Milestone 1 — Metrics first

1. Add first-visible / first-detected timestamps
2. Compute baseline detection lag reports
3. Validate metric quality and timestamp confidence handling

### Milestone 2 — Timeline model

1. Add canonical model entity resolution
2. Store lifecycle milestones from confirmed events
3. Backfill high-value historical items where feasible

### Milestone 3 — Predictive alerts

1. Start with shadow-mode scoring only
2. Review false positives manually
3. Route first live predictions to `rumors-leaks`
4. Later connect confirmed predictions back to actual outcomes

## Definition of done for Phase 5

Phase 5 is complete when:

- the bot can measure and report detection speed
- weak-signal clusters can trigger controlled predictive alerts
- model history can be viewed as a coherent timeline rather than isolated posts

## Main risk to avoid

Do **not** confuse “predictive” with “careless”.

This phase should make the bot more insightful, not more speculative. Prediction must be constrained, evidence-linked, and honest about confidence.