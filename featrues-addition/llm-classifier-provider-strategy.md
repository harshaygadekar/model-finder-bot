# LLM Classifier Provider Strategy

_Last updated: March 6, 2026_

## Why this document exists

Feature 5 needs extra design attention because the classifier is the most architecture-sensitive feature in the roadmap.

The roadmap originally explored multiple provider options. This document now locks the first implementation to a simpler answer:

- keep keyword classification as fallback
- use **Groq directly** for the remote LLM path
- do **not** add Ollama Cloud, Vertex AI, or a multi-provider registry in Phase 3
- choose one Groq model that best fits the classifier + enrichment workload and today's rate limits

## Short answer

### Recommended decision

- **Use keyword/rule classification as the permanent fallback path**
- **Use Groq as the only remote LLM provider in the first rollout**
- **Use `llama-3.1-8b-instant` as the default Groq model**
- **Do not add Ollama Cloud, Vertex AI, or cross-provider routing in Phase 3**

## Why Groq-only is the right first implementation

The bot already has `GROQ_API_KEY` in `.env.example`, the app is deployed in AWS, and the Phase 3 use case is narrow:

- classify ambiguous source items
- extract structured facts from high-value items
- produce short, machine-readable JSON

That means the first version benefits more from **simplicity and quota headroom** than from building a provider marketplace inside the bot.

### What this decision avoids

This removes the need to design and support:

1. provider chains
2. provider selection logic
3. Ollama Cloud compatibility handling
4. Vertex AI deployment setup
5. extra env/config surfaces for providers we are not planning to use

### Bottom line

**For Phase 3, use Groq directly and keep keyword fallback permanent.**

---

## Selected Groq model

### Default model: `llama-3.1-8b-instant`

This is the best model from the provided Groq list for the bot's first real classifier rollout.

### Why it wins for this bot

1. **Best free-plan headroom**
   - `30 RPM`
   - `14.4K RPD`
   - `6K TPM`
   - `500K TPD`

   Compared with the other serious candidates, the `14.4K RPD` limit is the standout advantage. For a polling intelligence bot that may classify many borderline items and enrich high-value articles, that matters a lot more than benchmark bragging rights.

2. **Best cost profile**
   - input: `$0.05 / 1M`
   - output: `$0.08 / 1M`

3. **Best documented fit**
   Groq's own model guidance positions it well for:
   - content filtering
   - automated data extraction and analysis
   - bulk metadata generation and tagging

4. **Structured-output friendly**
   JSON mode support makes it practical for a schema-first classifier.

5. **Enough context for this job**
   `131,072` context is more than enough for title/snippet classification and compact article-enrichment inputs.

### Why not the other Groq candidates

| Model | Why it is not the default |
|---|---|
| `openai/gpt-oss-20b` | Strong value model, but the provided limits show only `1K RPD` and `200K TPD`, which is much tighter for an always-on bot. |
| `openai/gpt-oss-120b` | Better reasoning, but unnecessarily expensive and rate-limited for classification-first workloads. |
| `llama-3.3-70b-versatile` | Excellent quality, but much more expensive and limited to `100K TPD` on the shown plan. |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Interesting throughput and token budget, but still on a tighter `1K RPD` limit and not as conservative a first production choice. |
| `meta-llama/llama-4-maverick-17b-128e-instruct` | Similar issue: tighter daily request budget and not necessary for the first classifier rollout. |
| `qwen/qwen3-32b` | Good multilingual option, but again `1K RPD` and not as operationally forgiving as Llama 3.1 8B on the provided plan. |
| `moonshotai/kimi-k2-instruct(-0905)` | Too expensive for the classifier role and unnecessary for this roadmap phase. |

### Practical interpretation

If the bot later proves that `llama-3.1-8b-instant` misses too much nuance on the hardest ambiguous cases, then the next Groq upgrade to test is `openai/gpt-oss-20b`.

But the plan should **not** start there.

---

## Recommended production architecture

Use a **single Groq-backed LLM path plus keyword fallback**.

### Runtime order

1. **Keyword/rule classification always runs first**
2. **Groq `llama-3.1-8b-instant` runs only for ambiguous or high-value items**
3. **Keyword fallback decides the outcome when Groq errors, times out, or rate-limits**

This gives the bot one remote dependency instead of several, while keeping the core loop safe.

---

## How the hybrid classifier should work

### Stage 1 — Deterministic path always runs

Every item should go through:

- source-priority shortcuts
- keyword relevance scoring
- negative keyword checks
- model/lab entity pattern extraction

This produces:

- base relevance score
- ambiguity assessment
- initial label candidates

### Stage 2 — Groq path only when justified

Only call Groq when the item is:

- ambiguous
- high-value
- likely rumor/leak
- likely breaking-news material
- selected for enrichment or digest inclusion

### Stage 3 — Fallback rules on failure

If the Groq path:

- times out
- rate limits
- errors
- returns invalid schema
- is disabled by config

then the system immediately falls back to keyword/rule output.

The bot must still function normally.

---

## Recommended implementation shape

### Design goal

Keep the first implementation simple:

- one remote provider
- one remote model
- one fallback path

That means we do **not** need a broad provider abstraction in Phase 3. A small internal Groq adapter is enough.

### Suggested module layout

| File | Purpose |
|---|---|
| `src/services/classification/classifier.js` | Main orchestrator |
| `src/services/classification/keyword-classifier.js` | Deterministic fallback and heuristics |
| `src/services/classification/groq-classifier.js` | Groq request/response handling |
| `src/services/classification/schema.js` | JSON schema and validation |
| `src/services/classification/cache.js` | Content-hash caching to protect quota |

---

## Recommended environment variables

Keep the config small and Groq-specific.

### Suggested new env vars

| Variable | Purpose |
|---|---|
| `CLASSIFIER_ENABLED` | master switch |
| `CLASSIFIER_MODEL` | default `llama-3.1-8b-instant` |
| `CLASSIFIER_TIMEOUT_MS` | per-call timeout |
| `CLASSIFIER_MAX_RETRIES` | retry count |
| `CLASSIFIER_AMBIGUITY_MIN` | lower bound for Groq handoff |
| `CLASSIFIER_AMBIGUITY_MAX` | upper bound for Groq handoff |
| `CLASSIFIER_CACHE_TTL_SECONDS` | cache repeated classifications |
| `CLASSIFIER_MAX_INPUT_CHARS` | hard prompt/input cap for rate control |

### Existing env that already helps

`GROQ_API_KEY` already exists in `.env.example`, which makes the Groq-only approach immediately practical.

---

## Rate-limit-aware operating rules

The roadmap should explicitly respect the rate-limit dimensions you included:

- `RPM` — requests per minute
- `RPD` — requests per day
- `TPM` — tokens per minute
- `TPD` — tokens per day

For the selected model, the main operational constraints are:

- `30 RPM`
- `14.4K RPD`
- `6K TPM`
- `500K TPD`

### What that means in practice

1. **Prompts must stay compact**
   Send normalized title, snippet, source metadata, and only short extracted body text when needed.

2. **Do not classify every item**
   Only escalate ambiguity-band or high-value items.

3. **Cache aggressively**
   Use a normalized content hash so reposts and retries do not consume extra Groq calls.

4. **Treat enrichment as premium work**
   Only enrich P0/P1, corroborated, or digest-selected items.

5. **Add a circuit breaker**
   If Groq starts rate-limiting, cool down and use keyword-only mode temporarily.

---

## Recommended dev / staging / production profiles

### Development profile

Use saved fixtures and Groq sparingly.

Recommended use:

- prompt iteration on stored examples
- schema validation checks
- mismatch review between keyword and Groq outputs

### Staging profile

Run in **shadow mode**:

- keyword path still controls final routing
- Groq outputs are logged and compared
- no user-facing routing changes yet

### Production profile

Use the selected Groq model directly:

- remote provider: Groq only
- model: `llama-3.1-8b-instant`
- keyword fallback: always on

---

## Recommended rollout plan for Feature 5

### Step 1 — Taxonomy and schema first

Define labels, JSON schema, and evaluation fixtures before changing delivery behavior.

### Step 2 — Groq shadow mode

Run `llama-3.1-8b-instant` in shadow mode and store:

- Groq result
- keyword fallback result
- mismatches
- latency
- timeout/error rates
- rate-limit events

### Step 3 — Selective rollout

Only allow Groq output to influence routing for:

- ambiguous items
- rumor/leak sources
- digest enrichment candidates

### Step 4 — Expand carefully

If production quality is strong, extend Groq influence to more cases. Keep the keyword path intact indefinitely.

---

## Operational guardrails

### Caching

Cache classification results by normalized content hash so repeated reposts or retries do not burn extra Groq calls.

### Budget control

Apply Groq calls only to items likely to benefit from them.

### Circuit breaker

If Groq error or rate-limit counters spike, automatically fall back to keyword-only mode for a cooldown period.

### Observability

Store every classification run outcome in `classifier_runs` with:

- provider name
- model name
- latency
- success/failure
- schema-valid or invalid
- fallback-used flag

---

## Final recommendation

If the question is:

> “What should the Phase 3 classifier provider plan be now?”

then the best answer is:

1. **use Groq directly as the only remote LLM provider**
2. **use `llama-3.1-8b-instant` as the default model**
3. **keep keyword/rule classification as a permanent fallback**
4. **do not add Ollama Cloud, Vertex AI, or multi-provider routing yet**
5. **treat rate-limit awareness as part of the design, not an afterthought**

That gives you a simpler, cheaper, and more operationally realistic Phase 3 rollout.
