-- Competitive mention extraction results.
-- One row per brand found in a problem_aware or category run response.
-- brand_name is always the normalised canonical form; brand_name_raw preserves
-- exactly what the LLM returned so the normalisation map can be audited.
-- Only problem_aware and category intents are populated — see runner.ts comment.

CREATE TABLE IF NOT EXISTS response_brand_mentions (
  id                 UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  tracking_run_id    UUID          REFERENCES tracking_runs(id) ON DELETE CASCADE,
  query_id           UUID          REFERENCES queries(id) ON DELETE CASCADE,
  client_id          UUID          REFERENCES clients(id) ON DELETE CASCADE,
  model              TEXT          NOT NULL,
  query_intent       TEXT          NOT NULL,
  brand_name         TEXT          NOT NULL,   -- normalised canonical form
  brand_name_raw     TEXT          NOT NULL,   -- verbatim as returned by Haiku
  is_tracked_brand   BOOLEAN       DEFAULT FALSE,
  mention_context    TEXT,
  mention_sentiment  TEXT          CHECK (mention_sentiment IN ('positive', 'neutral', 'negative', 'unclear')),
  created_at         TIMESTAMPTZ   DEFAULT NOW()
);

-- Join path from tracking_runs (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_response_brand_mentions_tracking_run_id
  ON response_brand_mentions(tracking_run_id);

-- Join path from queries
CREATE INDEX IF NOT EXISTS idx_response_brand_mentions_query_id
  ON response_brand_mentions(query_id);

-- Core filter for mention rate calculations: brand + model + intent
CREATE INDEX IF NOT EXISTS idx_response_brand_mentions_brand_model
  ON response_brand_mentions(brand_name, model);

-- Time-series filtering
CREATE INDEX IF NOT EXISTS idx_response_brand_mentions_created_at
  ON response_brand_mentions(created_at);

-- Distinguish tracked brand rows from competitor rows without extra filtering
CREATE INDEX IF NOT EXISTS idx_response_brand_mentions_is_tracked
  ON response_brand_mentions(is_tracked_brand);

-- RLS: users may only access rows belonging to their own clients
ALTER TABLE response_brand_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access their own brand mentions"
  ON response_brand_mentions
  FOR ALL
  USING (
    client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );
