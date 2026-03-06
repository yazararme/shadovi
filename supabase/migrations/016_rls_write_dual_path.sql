-- Migration 016: Update INSERT/UPDATE/DELETE RLS policies to use dual-path ownership
--
-- Migration 015 updated SELECT policies to use user_has_client_access() (checks both
-- clients.user_id AND user_clients junction). But write policies from 002-011 still
-- only check clients.user_id = auth.uid(), causing silent write failures for shared
-- users (e.g., competitor edits on the settings page don't persist).
--
-- This migration updates every existing write policy to use user_has_client_access().
-- It does NOT create new policies — only replaces existing ones.
-- INSERT uses WITH CHECK, UPDATE/DELETE use USING.

-- ============================================================
-- clients — UPDATE only (INSERT/DELETE stay single-path)
-- ============================================================
DROP POLICY IF EXISTS "clients_update_own" ON public.clients;
CREATE POLICY "clients_update_own" ON public.clients
  FOR UPDATE USING (public.user_has_client_access(id));

-- ============================================================
-- competitors
-- ============================================================
DROP POLICY IF EXISTS "competitors_insert_own" ON public.competitors;
CREATE POLICY "competitors_insert_own" ON public.competitors
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "competitors_update_own" ON public.competitors;
CREATE POLICY "competitors_update_own" ON public.competitors
  FOR UPDATE USING (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "competitors_delete_own" ON public.competitors;
CREATE POLICY "competitors_delete_own" ON public.competitors
  FOR DELETE USING (public.user_has_client_access(client_id));

-- ============================================================
-- personas
-- ============================================================
DROP POLICY IF EXISTS "personas_insert_own" ON public.personas;
CREATE POLICY "personas_insert_own" ON public.personas
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "personas_update_own" ON public.personas;
CREATE POLICY "personas_update_own" ON public.personas
  FOR UPDATE USING (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "personas_delete_own" ON public.personas;
CREATE POLICY "personas_delete_own" ON public.personas
  FOR DELETE USING (public.user_has_client_access(client_id));

-- ============================================================
-- queries
-- ============================================================
DROP POLICY IF EXISTS "queries_insert_own" ON public.queries;
CREATE POLICY "queries_insert_own" ON public.queries
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "queries_update_own" ON public.queries;
CREATE POLICY "queries_update_own" ON public.queries
  FOR UPDATE USING (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "queries_delete_own" ON public.queries;
CREATE POLICY "queries_delete_own" ON public.queries
  FOR DELETE USING (public.user_has_client_access(client_id));

-- ============================================================
-- brand_facts
-- ============================================================
DROP POLICY IF EXISTS "brand_facts_insert_own" ON public.brand_facts;
CREATE POLICY "brand_facts_insert_own" ON public.brand_facts
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "brand_facts_update_own" ON public.brand_facts;
CREATE POLICY "brand_facts_update_own" ON public.brand_facts
  FOR UPDATE USING (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "brand_facts_delete_own" ON public.brand_facts;
CREATE POLICY "brand_facts_delete_own" ON public.brand_facts
  FOR DELETE USING (public.user_has_client_access(client_id));

-- ============================================================
-- tracking_runs (INSERT only — no UPDATE/DELETE policies exist)
-- ============================================================
DROP POLICY IF EXISTS "tracking_runs_insert_own" ON public.tracking_runs;
CREATE POLICY "tracking_runs_insert_own" ON public.tracking_runs
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

-- ============================================================
-- recommendations (INSERT + UPDATE — no DELETE policy exists)
-- ============================================================
DROP POLICY IF EXISTS "recommendations_insert_own" ON public.recommendations;
CREATE POLICY "recommendations_insert_own" ON public.recommendations
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "recommendations_update_own" ON public.recommendations;
CREATE POLICY "recommendations_update_own" ON public.recommendations
  FOR UPDATE USING (public.user_has_client_access(client_id));

-- ============================================================
-- brand_knowledge_scores (INSERT only — no UPDATE/DELETE policies exist)
-- ============================================================
DROP POLICY IF EXISTS "brand_knowledge_scores_insert_own" ON public.brand_knowledge_scores;
CREATE POLICY "brand_knowledge_scores_insert_own" ON public.brand_knowledge_scores
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

-- ============================================================
-- gap_clusters (INSERT + DELETE — no UPDATE policy exists)
-- ============================================================
DROP POLICY IF EXISTS "gap_clusters_insert_own" ON public.gap_clusters;
CREATE POLICY "gap_clusters_insert_own" ON public.gap_clusters
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "gap_clusters_delete_own" ON public.gap_clusters;
CREATE POLICY "gap_clusters_delete_own" ON public.gap_clusters
  FOR DELETE USING (public.user_has_client_access(client_id));

-- ============================================================
-- gap_cluster_queries (INSERT + DELETE — joins through gap_clusters)
-- ============================================================
DROP POLICY IF EXISTS "gap_cluster_queries_insert_own" ON public.gap_cluster_queries;
CREATE POLICY "gap_cluster_queries_insert_own" ON public.gap_cluster_queries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.gap_clusters
      WHERE gap_clusters.id = cluster_id
        AND public.user_has_client_access(gap_clusters.client_id)
    )
  );

DROP POLICY IF EXISTS "gap_cluster_queries_delete_own" ON public.gap_cluster_queries;
CREATE POLICY "gap_cluster_queries_delete_own" ON public.gap_cluster_queries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.gap_clusters
      WHERE gap_clusters.id = cluster_id
        AND public.user_has_client_access(gap_clusters.client_id)
    )
  );

-- ============================================================
-- portfolio_versions (INSERT + UPDATE — no DELETE policy exists)
-- ============================================================
DROP POLICY IF EXISTS "portfolio_versions_insert_own" ON public.portfolio_versions;
CREATE POLICY "portfolio_versions_insert_own" ON public.portfolio_versions
  FOR INSERT WITH CHECK (public.user_has_client_access(client_id));

DROP POLICY IF EXISTS "portfolio_versions_update_own" ON public.portfolio_versions;
CREATE POLICY "portfolio_versions_update_own" ON public.portfolio_versions
  FOR UPDATE USING (public.user_has_client_access(client_id));
