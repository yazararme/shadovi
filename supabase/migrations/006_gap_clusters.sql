-- ─── Gap Clusters ─────────────────────────────────────────────────────────────
-- One clustering result per client per run_date.
-- Reruns on the same date are idempotent (gap-clusterer deletes by client_id + run_date
-- before inserting) but previous dates are preserved for trend analysis.

CREATE TABLE gap_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  cluster_name TEXT NOT NULL,
  cluster_type TEXT NOT NULL CHECK (cluster_type IN ('displaced', 'open')),
  persona_label TEXT NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  competitors_present JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Links each gap cluster to the specific query IDs it contains
CREATE TABLE gap_cluster_queries (
  cluster_id UUID REFERENCES gap_clusters(id) ON DELETE CASCADE,
  query_id UUID REFERENCES queries(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, query_id)
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE gap_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE gap_cluster_queries ENABLE ROW LEVEL SECURITY;

-- gap_clusters: access via client ownership
CREATE POLICY "gap_clusters_select_own" ON gap_clusters
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = gap_clusters.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "gap_clusters_insert_own" ON gap_clusters
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = gap_clusters.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "gap_clusters_delete_own" ON gap_clusters
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM clients WHERE clients.id = gap_clusters.client_id AND clients.user_id = auth.uid())
  );

-- gap_cluster_queries: access via cluster → client ownership chain
CREATE POLICY "gap_cluster_queries_select_own" ON gap_cluster_queries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM gap_clusters
      JOIN clients ON clients.id = gap_clusters.client_id
      WHERE gap_clusters.id = gap_cluster_queries.cluster_id
        AND clients.user_id = auth.uid()
    )
  );

CREATE POLICY "gap_cluster_queries_insert_own" ON gap_cluster_queries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM gap_clusters
      JOIN clients ON clients.id = gap_clusters.client_id
      WHERE gap_clusters.id = gap_cluster_queries.cluster_id
        AND clients.user_id = auth.uid()
    )
  );

CREATE POLICY "gap_cluster_queries_delete_own" ON gap_cluster_queries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM gap_clusters
      JOIN clients ON clients.id = gap_clusters.client_id
      WHERE gap_clusters.id = gap_cluster_queries.cluster_id
        AND clients.user_id = auth.uid()
    )
  );

-- Useful index for the common fetch pattern: "latest clusters for a client"
CREATE INDEX idx_gap_clusters_client_date ON gap_clusters (client_id, run_date DESC);
