-- Brand facts: client's source-of-truth claims for Brand Knowledge scoring.
-- is_true = false marks hallucination bait — claims that are deliberately false,
-- used to detect whether LLMs confidently invent things the brand doesn't offer.
CREATE TABLE brand_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  category TEXT NOT NULL,  -- feature | market | pricing | messaging
  is_true BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE brand_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_facts_select_own" ON brand_facts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = brand_facts.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "brand_facts_insert_own" ON brand_facts
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = brand_facts.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "brand_facts_update_own" ON brand_facts
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = brand_facts.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "brand_facts_delete_own" ON brand_facts
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = brand_facts.client_id AND clients.user_id = auth.uid())
  );

-- Add fact_id to queries so each validation query knows which brand fact it's testing.
-- Nullable: only populated for validation intent queries anchored to a specific fact.
ALTER TABLE queries ADD COLUMN fact_id UUID REFERENCES brand_facts(id) ON DELETE SET NULL;
