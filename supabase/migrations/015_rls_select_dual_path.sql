-- Migration 015: Dual-path SELECT policies for beta user access
--
-- Adds user_clients junction check to SELECT policies on all data tables.
-- Only SELECT is modified — writes go through API routes using service client (bypasses RLS).
--
-- Safe failure mode: if the helper function has a bug, beta users see nothing.
-- Admin uses service client (bypasses RLS). Inngest uses service role key.
--
-- NOTE: Originally numbered 013 in the design doc. Renumbered to 015 because
-- 013 and 014 are already taken by other migrations in this repo.

-- ── Helper function ──────────────────────────────────────────────────────────
-- Centralises the access check. Called from every SELECT policy.
-- SECURITY DEFINER so it can read user_clients regardless of calling context.

CREATE OR REPLACE FUNCTION public.user_has_client_access(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.clients
      WHERE id = p_client_id AND user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.user_clients
      WHERE client_id = p_client_id
        AND (user_id = auth.uid() OR email = (auth.jwt() ->> 'email'))
    );
$$;

-- ── clients ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients
  FOR SELECT USING (public.user_has_client_access(id));

-- ── queries ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "queries_select_own" ON public.queries;
CREATE POLICY "queries_select_own" ON public.queries
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── tracking_runs ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tracking_runs_select_own" ON public.tracking_runs;
CREATE POLICY "tracking_runs_select_own" ON public.tracking_runs
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── response_brand_mentions ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "response_brand_mentions_select_own" ON public.response_brand_mentions;
CREATE POLICY "response_brand_mentions_select_own" ON public.response_brand_mentions
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── recommendations ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "recommendations_select_own" ON public.recommendations;
CREATE POLICY "recommendations_select_own" ON public.recommendations
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── competitors ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "competitors_select_own" ON public.competitors;
CREATE POLICY "competitors_select_own" ON public.competitors
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── personas ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "personas_select_own" ON public.personas;
CREATE POLICY "personas_select_own" ON public.personas
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── brand_facts ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand_facts_select_own" ON public.brand_facts;
CREATE POLICY "brand_facts_select_own" ON public.brand_facts
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── brand_knowledge_scores ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "brand_knowledge_scores_select_own" ON public.brand_knowledge_scores;
CREATE POLICY "brand_knowledge_scores_select_own" ON public.brand_knowledge_scores
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── portfolio_versions ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "portfolio_versions_select_own" ON public.portfolio_versions;
CREATE POLICY "portfolio_versions_select_own" ON public.portfolio_versions
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── gap_clusters ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "gap_clusters_select_own" ON public.gap_clusters;
CREATE POLICY "gap_clusters_select_own" ON public.gap_clusters
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── domain_run_stats ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "domain_run_stats_select_own" ON public.domain_run_stats;
CREATE POLICY "domain_run_stats_select_own" ON public.domain_run_stats
  FOR SELECT USING (public.user_has_client_access(client_id));

-- ── run_sources (no client_id — join through tracking_runs) ──────────────────
DROP POLICY IF EXISTS "run_sources_select_own" ON public.run_sources;
CREATE POLICY "run_sources_select_own" ON public.run_sources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tracking_runs tr
      WHERE tr.id = run_sources.run_id
        AND public.user_has_client_access(tr.client_id)
    )
  );

-- ── gap_cluster_queries (no client_id — join through gap_clusters) ───────────
DROP POLICY IF EXISTS "gap_cluster_queries_select_own" ON public.gap_cluster_queries;
CREATE POLICY "gap_cluster_queries_select_own" ON public.gap_cluster_queries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.gap_clusters gc
      WHERE gc.id = gap_cluster_queries.cluster_id
        AND public.user_has_client_access(gc.client_id)
    )
  );

-- ── canonical_domains / domain_aliases ───────────────────────────────────────
-- These are shared reference data with no client_id.
-- If RLS is enabled on them, uncomment and run these policies.
-- Check first: SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
--
-- CREATE POLICY "canonical_domains_select_auth" ON public.canonical_domains
--   FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY "domain_aliases_select_auth" ON public.domain_aliases
--   FOR SELECT USING (auth.uid() IS NOT NULL);
