-- Brand Knowledge scoring output: one row per tracking_run for validation intent queries.
-- Populated by a secondary Haiku scoring pass after each LLM response is captured.
-- Only applied forward — historical validation runs are not retroactively scored.
CREATE TABLE brand_knowledge_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_run_id UUID REFERENCES tracking_runs(id) ON DELETE CASCADE,
  fact_id UUID REFERENCES brand_facts(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  -- accuracy: did the LLM state the fact correctly?
  --   For is_true facts: "correct" = LLM affirms, "incorrect" = contradicts, "uncertain" = hedged
  --   For is_true=false bait: "correct" = LLM correctly denies, "incorrect" = LLM affirms (hallucination)
  accuracy TEXT NOT NULL,        -- correct | incorrect | uncertain
  completeness TEXT NOT NULL,    -- full | partial | vague
  hallucination BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  scored_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE brand_knowledge_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_knowledge_scores_select_own" ON brand_knowledge_scores
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = brand_knowledge_scores.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "brand_knowledge_scores_insert_own" ON brand_knowledge_scores
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = brand_knowledge_scores.client_id AND clients.user_id = auth.uid())
  );
