-- BVI (Brand Vulnerability Index) schema additions.
-- All columns use ADD COLUMN IF NOT EXISTS for idempotency.
-- scored_at on brand_knowledge_scores already exists from migration 004 — not re-added.

-- ── queries ──────────────────────────────────────────────────────────────────

-- is_bait: true for any validation query generated from an is_true=false brand fact.
-- Bait queries probe whether LLMs can be led into confirming fabricated claims.
ALTER TABLE queries ADD COLUMN IF NOT EXISTS is_bait BOOLEAN DEFAULT FALSE;

-- bait_type distinguishes false_positive (fabricated claim) from leading_negative
-- (sceptical framing on a true feature). Keyword inference is too unreliable —
-- all bait queries are stamped false_positive at generation time for now.
ALTER TABLE queries ADD COLUMN IF NOT EXISTS bait_type TEXT
  CHECK (bait_type IN ('false_positive', 'leading_negative'));

-- ── tracking_runs ─────────────────────────────────────────────────────────────

-- Denormalised copy of queries.intent stamped at insert time.
-- Eliminates joins in every downstream aggregation.
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS query_intent TEXT;

-- Derived at insert time: cited_sources array is non-empty.
-- Surfaces citation coverage — practitioners need to know which prompts surface
-- their brand without citations to target content efforts.
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS citation_present BOOLEAN;

-- Source Intelligence: domains/URLs the model says informed its answer.
-- Populated via a follow-up enrichment call to the same model (same-model
-- self-referential question — cannot be answered by a different model).
-- Only populated for validation intent runs.
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS source_attribution JSONB;

-- Free text estimate of the time period the model's knowledge is drawn from
-- (e.g. "2022", "2023–2024", "unclear"). Detects temporal staleness as root cause
-- of hallucinations. Populated via the same enrichment call as source_attribution.
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS content_age_estimate TEXT;

-- Competitor mentions the model volunteered unprompted while answering a brand
-- question. Distinct from bait/hallucination — reputationally significant even
-- when accurate. Structure: [{ competitor: string, context: string }].
-- Populated via the same enrichment call.
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS competitor_mentions_unprompted JSONB;

-- How the model positioned the brand in this response.
-- Populated by the Haiku secondary scoring pass for validation queries.
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS brand_positioning TEXT
  CHECK (brand_positioning IN ('budget', 'mid-market', 'premium', 'unclear'));

-- ── brand_knowledge_scores ────────────────────────────────────────────────────

-- Which model performed secondary scoring. Recorded so historical scores are not
-- mixed across model changes.
ALTER TABLE brand_knowledge_scores ADD COLUMN IF NOT EXISTS scorer_model TEXT DEFAULT 'claude-haiku';

-- Primary BVI signal: bait query where the LLM confirmed the false claim.
-- true when is_bait=true AND accuracy='incorrect' (LLM fell for the bait).
-- Denormalised for fast querying without joins to queries table.
ALTER TABLE brand_knowledge_scores ADD COLUMN IF NOT EXISTS bait_triggered BOOLEAN DEFAULT FALSE;

-- Copy of positioning assessment from Haiku scorer, denormalised here so the
-- Coverage by Category table can aggregate without joining tracking_runs.
ALTER TABLE brand_knowledge_scores ADD COLUMN IF NOT EXISTS brand_positioning TEXT
  CHECK (brand_positioning IN ('budget', 'mid-market', 'premium', 'unclear'));
