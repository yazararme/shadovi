# Claude Code Prompt — Brand Knowledge Migration + Fresh Run Prep
*Updated to incorporate BVI architecture, post-query enrichment calls, Source Intelligence section, and market research validation*

---

## Context for Claude Code: What We're Building and Why

Shadovi is an AI visibility intelligence platform that tracks how brands appear in LLM responses across GPT-4o, Perplexity, Claude, and Gemini. We're building a section called **Brand Knowledge** that measures how accurately LLMs represent a brand's features, markets, pricing, and messaging.

Inside Brand Knowledge, we're building a subsection called the **Brand Vulnerability Index (BVI)** — a scored measure of how susceptible LLMs are to asserting false claims about a brand when prompted. This is distinct from accuracy measurement (which tests known true facts) and is our most differentiated capability. No other AEO platform currently does this.

We have validated through market research (practitioner surveys, vendor analysis) that the two most significant unmet needs in this space are:
1. **Source identification** — practitioners cannot identify which sources AI trusts, and no existing tool solves this well
2. **Continuous tracking vs. snapshots** — practitioners need data that accumulates over time, not one-off audits

Both of these directly inform the data collection architecture below.

---

### The two types of validation queries we run:

1. **True fact queries** — we ask LLMs about real brand claims (e.g. "Does Beko offer a 14-minute Quick Programme?") and score whether the response is accurate, complete, and hallucination-free.

2. **Bait queries** — we ask LLMs about claims that are either entirely fabricated (e.g. "I heard Beko makes a fridge with an espresso machine built in") or sceptically framed about real features. These probe whether LLMs can be led into confidently asserting false things. For bait queries, the scoring logic is **inverted** — a correct score means the LLM *rejected* the false claim, not confirmed it.

---

### Strategic decisions already made:

- Brand Knowledge and BVI are part of the same sidebar section, not separate modules. BVI is surfaced as a score and alert panel within Brand Knowledge — accessible to non-technical buyers while giving technical marketers the depth they need.
- The BVI score is computed from four components: Frequency (F), Severity (S), Replication (R), Persistence (P). We are building F and R now. S requires client-configurable severity ratings on facts (not yet built). P requires at least two time periods of data — show it greyed out in the UI with "available after 30 days of tracking."
- Secondary scoring uses Claude Haiku for cost efficiency. Scorer model must be recorded on each score record so historical scores are not mixed when we change models.
- Share-of-model calculations already exclude validation intent runs — confirmed in place, do not touch.
- A future section called **Source Intelligence** will surface which domains and URLs LLMs cite most frequently, and which sources correlate with hallucinations. We are collecting the raw data for this now so the data moat starts building. The UI section is not being built yet — just the data collection.

---

### Why we're doing a fresh run:

The previous data run failed. Before re-running, we want to ensure the schema captures all fields needed for BVI scoring and enrichment from the first run — so we never need to retrofit or backfill. Old validation queries with null `fact_id` are being cleaned up as they are unscoreable. Non-validation queries (category, comparative, problem_aware) are untouched.

---

## The Task

Run a single Supabase migration adding all new fields. Update the query generator, runner, and scorer to stamp these fields correctly. Add post-query enrichment calls where specified. Verify schema completeness before triggering the re-run.

---

## Step 1 — Migration (`005_bvi_fields.sql`)

### On `queries` table — add if not exists:
```sql
is_bait BOOLEAN DEFAULT FALSE,
bait_type TEXT CHECK (bait_type IN ('false_positive', 'leading_negative'))
```
- `is_bait`: true for any query generated from a `brand_facts` row where `is_true = false`
- `bait_type`:
  - `false_positive` = claim being tested does not exist (e.g. espresso fridge)
  - `leading_negative` = sceptical framing on a claim that IS true (e.g. "is that actually just a marketing claim?")

---

### On `tracking_runs` table — add if not exists:
```sql
query_intent TEXT,
citation_present BOOLEAN,
source_attribution JSONB,
content_age_estimate TEXT,
competitor_mentions_unprompted JSONB,
brand_positioning TEXT CHECK (brand_positioning IN ('budget', 'mid-market', 'premium', 'unclear'))
```

Field definitions:

- `query_intent` — denormalised copy of `queries.intent` stamped at run insert time. Eliminates joins in every downstream query and UI calculation.

- `citation_present` — boolean derived at insert time from whether `cited_sources` array is non-empty. No extra API call. Surfaces citation coverage as a metric — practitioners need to know which prompts surface their brand without citations so they know where to focus content efforts.

- `source_attribution` — JSONB array of domains/URLs the model says informed its answer. Populated via a follow-up API call to the **same model that generated the primary response** (not Haiku — this is a self-referential question about the model's own knowledge provenance). Only run on validation and bait queries.

- `content_age_estimate` — free text string (e.g. "2022", "2023–2024", "unclear"). Populated via the same follow-up call as source_attribution. Detects temporal staleness as a root cause of misinformation. Converts a bad score into an actionable finding: "Perplexity's pricing data appears to be from 2022 retail listings."

- `competitor_mentions_unprompted` — JSONB array of `{ competitor: string, context: string }`. Populated via the same follow-up call. Captures cases where a model answers a brand question but surfaces a competitor unprompted (e.g. "Yes, though Samsung's equivalent is faster"). This is a distinct brand vulnerability — not a hallucination but reputationally meaningful. Connects Brand Knowledge back to the share-of-model story.

- `brand_positioning` — how the model positioned the brand in this response: budget, mid-market, premium, or unclear. Populated by the existing scorer call (Haiku) as an additional JSON field at zero marginal cost. Tracks whether LLMs consistently represent the brand's intended positioning — a metric practitioners cite as a key unmet need.

---

### On `brand_knowledge_scores` table — add if not exists:
```sql
scorer_model TEXT DEFAULT 'claude-haiku',
scored_at TIMESTAMPTZ DEFAULT NOW(),
bait_triggered BOOLEAN DEFAULT FALSE,
brand_positioning TEXT CHECK (brand_positioning IN ('budget', 'mid-market', 'premium', 'unclear'))
```

- `scorer_model`: which model performed secondary scoring
- `scored_at`: when scoring happened, separate from run timestamp
- `bait_triggered`: true when a bait query produced a hallucinated confirmation — primary BVI signal, denormalised for fast querying
- `brand_positioning`: copy of positioning assessment from scorer JSON, denormalised for Coverage by Category table queries

---

## Step 2 — Update query generator (`query-generator.ts`)

When generating validation queries from brand facts:
- Set `is_bait = true` when `brand_fact.is_true === false`
- Set `bait_type`:
  - Default to `false_positive` for all bait queries from `is_true = false` facts
  - Override to `leading_negative` if query text contains sceptical framing keywords: "is that actually", "marketing claim", "really true", "verified", "unsubstantiated", "rumour"
  - If classification feels unreliable, **flag it** — default everything to `false_positive` rather than risk wrong labels

---

## Step 3 — Post-query enrichment calls (`runner.ts`)

After each validation or bait run is inserted, fire a follow-up call to the **same model** that generated the primary response. This must be the same model — not Haiku — because we are asking the model to reflect on its own knowledge provenance. Sending this to a different model would return that model's guess about what the original model knows, which is meaningless.

**Enrichment prompt:**
```
For the response you just gave to the question: "[original query]"

Please answer the following:
1. What sources, publications, websites, or product documentation informed your answer? 
   List specific domains or publication names where possible, including any you did not 
   explicitly reference in your response.
2. Roughly what time period or date range does the information you relied on come from? 
   (e.g. "primarily 2022–2023", "recent within the last year", "unclear")
3. Did your response mention any competitor brands to [brand name]? If so, list each one 
   and briefly describe the context in which you mentioned them.

Return as JSON only:
{ 
  "sources": string[], 
  "content_age": string, 
  "competitor_mentions": [{ "competitor": string, "context": string }] 
}
```

Store results:
- `source_attribution` ← `sources` array
- `content_age_estimate` ← `content_age` string
- `competitor_mentions_unprompted` ← `competitor_mentions` array

**Only run enrichment on validation and bait queries** (`query_intent = 'validation'`). Skip for category, comparative, and problem_aware — source provenance is not actionable for those.

Enrichment is non-critical — wrap in try/catch, log errors, do not fail the run if enrichment call fails.

---

## Step 4 — Update scorer (`knowledge-scorer.ts`)

The scorer already runs on validation queries via Haiku. Extend the scorer JSON output with one additional field:

```
Add to existing scorer prompt:

"Also assess: based on how the brand is described in this response, how is it positioned?
Choose one: budget, mid-market, premium, or unclear.
Add to your JSON output: { ..., brand_positioning: 'budget' | 'mid-market' | 'premium' | 'unclear' }"
```

Additional scorer logic:
- Pass `scorer_model: 'claude-haiku'` into the score insert
- Set `bait_triggered = true` when `query.is_bait === true` AND `accuracy === 'correct'` (inverted scoring — correct on a bait query means the LLM confirmed a false claim)
- Set `scored_at` to current timestamp, not inherited from run timestamp
- Write `brand_positioning` to both `brand_knowledge_scores.brand_positioning` and `tracking_runs.brand_positioning`

---

## Step 5 — Stamp `query_intent` and `citation_present` on run insert (`runner.ts`)

At the point of inserting each `tracking_run` record:

```typescript
query_intent: query.intent,
citation_present: Array.isArray(citedSources) && citedSources.length > 0
```

Both should be available in scope during the run loop. Stamp once at insert time — no triggers or sync logic.

---

## Step 6 — Cleanup before re-run

```sql
DELETE FROM tracking_runs 
WHERE query_id IN (
  SELECT id FROM queries 
  WHERE intent = 'validation' AND fact_id IS NULL
);

DELETE FROM queries 
WHERE intent = 'validation' AND fact_id IS NULL;
```

**Do NOT delete** queries where intent is `category`, `comparative`, or `problem_aware` regardless of `fact_id` status.

---

## Step 7 — Verify before triggering re-run

```sql
-- Validation query health check — should show zero nulls on fact_id
SELECT intent, is_bait, COUNT(*) 
FROM queries 
WHERE client_id = '2f6ab5b8-50d2-4fff-b638-3ab5c6b3eb87'
GROUP BY intent, is_bait;

-- tracking_runs column check
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'tracking_runs' 
AND column_name IN (
  'query_intent', 'citation_present', 'source_attribution', 
  'content_age_estimate', 'competitor_mentions_unprompted', 'brand_positioning'
);

-- brand_knowledge_scores column check
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'brand_knowledge_scores' 
AND column_name IN ('scorer_model', 'scored_at', 'bait_triggered', 'brand_positioning');
```

Expected: 6 tracking_runs columns present, 4 brand_knowledge_scores columns present, zero validation queries with null fact_id.

---

## What NOT to change

- Share-of-model calculations — validation exclusion fix is confirmed in place
- Persona fields — planned but not needed for this run
- Severity ratings on brand_facts — requires client-facing UI not yet built
- Persistence calculations — needs two time periods minimum, add after 30 days of data
- Hallucination alert UI — bait_triggered field will improve it automatically
- Source Intelligence UI section — collecting data now but not building the UI yet. Do not add a sidebar item or page.

---

## Flags to raise, not decide

- If `bait_type` keyword inference feels unreliable, flag it — default to `false_positive` rather than risk wrong labels
- If denormalising `query_intent` onto `tracking_runs` creates trigger/sync complexity, flag it — join approach is acceptable
- If enrichment follow-up call returns inconsistent or unparseable JSON from GPT-4o or Gemini, flag with examples — we can simplify the prompt or add a fallback parser
- If `brand_positioning` inference feels too coarse for some response types, flag it — we can add additional values rather than force bad classifications

---

## Background: Why these specific fields

This section documents reasoning so future development does not second-guess these decisions.

**source_attribution + content_age_estimate** — Market research confirms "identifying the sources AI trusts" is the #1 unmet need among AEO practitioners. No competitor currently solves this. Collecting it now creates a data moat that grows with every run. Content age specifically explains *why* hallucinations happen (stale sources), which converts scores into actionable recommendations rather than just alerts.

**competitor_mentions_unprompted** — Captures a distinct vulnerability type: LLMs that answer brand questions by surfacing competitors without being asked. Connects Brand Knowledge scoring back to share-of-model and gives brand teams a signal they currently have no visibility into anywhere.

**citation_present** — Practitioners explicitly want to know which prompts surface their brand without citations so they can target content creation efforts. Derived at zero cost from existing data.

**brand_positioning** — "Category framing" is cited in practitioner research as a key unmet metric. Knowing that GPT-4o consistently positions Beko as budget while Perplexity positions it as mid-market is strategically meaningful for brand and GTM teams. Zero marginal cost since scorer call already runs.

**bait_type** — False positives (fabricated claims) and leading negatives (sceptical framing on true features) are different vulnerability types with different remediation strategies. Labelling them now enables model-level analysis later: some models may be more susceptible to one type than the other.

**Why enrichment calls go to the same model, not Haiku** — Source attribution and content age are self-referential questions about a model's own knowledge provenance. A different model cannot answer them accurately. Scorer calls (accuracy, completeness, hallucination, positioning) go to Haiku because they are classification tasks on provided text — the scorer doesn't need to know anything about its own training.
