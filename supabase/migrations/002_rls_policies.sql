-- Enable Row Level Security on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

-- ─── clients ─────────────────────────────────────────────────────────────────
-- Users can only access their own client records
CREATE POLICY "clients_select_own" ON clients
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "clients_insert_own" ON clients
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "clients_update_own" ON clients
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "clients_delete_own" ON clients
  FOR DELETE USING (auth.uid() = user_id);

-- ─── personas ────────────────────────────────────────────────────────────────
-- Access via client ownership
CREATE POLICY "personas_select_own" ON personas
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = personas.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "personas_insert_own" ON personas
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = personas.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "personas_update_own" ON personas
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = personas.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "personas_delete_own" ON personas
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = personas.client_id AND clients.user_id = auth.uid())
  );

-- ─── competitors ─────────────────────────────────────────────────────────────
CREATE POLICY "competitors_select_own" ON competitors
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = competitors.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "competitors_insert_own" ON competitors
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = competitors.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "competitors_update_own" ON competitors
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = competitors.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "competitors_delete_own" ON competitors
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = competitors.client_id AND clients.user_id = auth.uid())
  );

-- ─── queries ─────────────────────────────────────────────────────────────────
CREATE POLICY "queries_select_own" ON queries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = queries.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "queries_insert_own" ON queries
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = queries.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "queries_update_own" ON queries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = queries.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "queries_delete_own" ON queries
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = queries.client_id AND clients.user_id = auth.uid())
  );

-- ─── tracking_runs ───────────────────────────────────────────────────────────
CREATE POLICY "tracking_runs_select_own" ON tracking_runs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = tracking_runs.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "tracking_runs_insert_own" ON tracking_runs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = tracking_runs.client_id AND clients.user_id = auth.uid())
  );

-- ─── recommendations ─────────────────────────────────────────────────────────
CREATE POLICY "recommendations_select_own" ON recommendations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = recommendations.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "recommendations_insert_own" ON recommendations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = recommendations.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "recommendations_update_own" ON recommendations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = recommendations.client_id AND clients.user_id = auth.uid())
  );
