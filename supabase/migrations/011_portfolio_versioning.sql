-- ─── Portfolio Versioning ─────────────────────────────────────────────────────
-- Preserves longitudinal data integrity when a client edits their query
-- portfolio post-activation. Without versioning, regeneration silently corrupts
-- every trend line by mixing data from incompatible query sets.
--
-- Note: spec referenced this as migration 010 but that number is taken by
-- 010_user_clients.sql — so this is filed as 011.

-- ── 1. New table: portfolio_versions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.portfolio_versions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  client_id      uuid        NOT NULL REFERENCES public.clients(id),
  version_number integer     NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- What triggered this version:
  --   'onboarding_activation'  — first activation at end of onboarding
  --   'manual_regeneration'    — user clicked "regenerate queries" post-activation
  --   'settings_edit'          — brand DNA / competitor change that forces new queries
  --   'calibration_prompt'     — AI-driven portfolio calibration
  --   'pre_versioning_backfill'— synthetic v0 created by this migration
  trigger        text        NOT NULL,
  -- Machine-readable diff from previous version; null for v0.
  change_summary jsonb,
  query_count    integer     NOT NULL DEFAULT 0,
  fact_count     integer     NOT NULL DEFAULT 0,
  -- Only one active version per client at a time
  is_active      boolean     NOT NULL DEFAULT true,
  CONSTRAINT portfolio_versions_pkey     PRIMARY KEY (id),
  CONSTRAINT portfolio_versions_trigger  CHECK (trigger IN (
    'onboarding_activation', 'manual_regeneration', 'settings_edit',
    'calibration_prompt', 'pre_versioning_backfill'
  ))
);

-- ── 2. Add version_id to linked tables ───────────────────────────────────────
-- Nullable: existing rows predate versioning (null = pre-versioning era).

ALTER TABLE public.queries               ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES public.portfolio_versions(id);
ALTER TABLE public.brand_facts           ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES public.portfolio_versions(id);
ALTER TABLE public.tracking_runs         ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES public.portfolio_versions(id);
ALTER TABLE public.brand_knowledge_scores ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES public.portfolio_versions(id);

-- ── 3. Soft-delete columns ────────────────────────────────────────────────────
-- queries already has status. Add deactivation tracking:
ALTER TABLE public.queries ADD COLUMN IF NOT EXISTS deactivated_at         timestamptz;
ALTER TABLE public.queries ADD COLUMN IF NOT EXISTS deactivated_by_version  uuid REFERENCES public.portfolio_versions(id);

-- brand_facts, competitors, personas need status + deactivated_at:
ALTER TABLE public.brand_facts  ADD COLUMN IF NOT EXISTS status         text DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE public.brand_facts  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE public.competitors  ADD COLUMN IF NOT EXISTS status         text DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE public.competitors  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE public.personas     ADD COLUMN IF NOT EXISTS status         text DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE public.personas     ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

-- ── 4. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_portfolio_versions_client_active ON public.portfolio_versions(client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_queries_client_version_status     ON public.queries(client_id, version_id, status);
CREATE INDEX IF NOT EXISTS idx_tracking_runs_client_version      ON public.tracking_runs(client_id, version_id, ran_at);
CREATE INDEX IF NOT EXISTS idx_brand_facts_client_status         ON public.brand_facts(client_id, status);

-- ── 5. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.portfolio_versions ENABLE ROW LEVEL SECURITY;

-- Access via client ownership (same pattern as 002_rls_policies.sql)
CREATE POLICY "portfolio_versions_select_own" ON public.portfolio_versions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.clients WHERE clients.id = portfolio_versions.client_id AND clients.user_id = auth.uid())
    -- Admin bypass
    OR (auth.jwt() ->> 'email') = 'yazararme@gmail.com'
  );

CREATE POLICY "portfolio_versions_insert_own" ON public.portfolio_versions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.clients WHERE clients.id = portfolio_versions.client_id AND clients.user_id = auth.uid())
  );

CREATE POLICY "portfolio_versions_update_own" ON public.portfolio_versions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.clients WHERE clients.id = portfolio_versions.client_id AND clients.user_id = auth.uid())
  );

-- ── 6. Backfill: synthetic version 0 for existing active clients ──────────────

-- Create one v0 row per active client.
-- query_count = currently active queries; fact_count = all brand facts.
INSERT INTO public.portfolio_versions (client_id, version_number, trigger, is_active, query_count, fact_count)
SELECT
  c.id,
  0,
  'pre_versioning_backfill',
  true,
  (SELECT count(*) FROM public.queries     WHERE client_id = c.id AND status = 'active'),
  (SELECT count(*) FROM public.brand_facts WHERE client_id = c.id)
FROM public.clients c
WHERE c.status = 'active'
ON CONFLICT DO NOTHING;

-- Stamp version_id = v0 on all existing null records
UPDATE public.queries SET version_id = pv.id
FROM public.portfolio_versions pv
WHERE public.queries.client_id = pv.client_id
  AND public.queries.version_id IS NULL
  AND pv.version_number = 0;

UPDATE public.brand_facts SET version_id = pv.id
FROM public.portfolio_versions pv
WHERE public.brand_facts.client_id = pv.client_id
  AND public.brand_facts.version_id IS NULL
  AND pv.version_number = 0;

UPDATE public.tracking_runs SET version_id = pv.id
FROM public.portfolio_versions pv
WHERE public.tracking_runs.client_id = pv.client_id
  AND public.tracking_runs.version_id IS NULL
  AND pv.version_number = 0;

UPDATE public.brand_knowledge_scores SET version_id = pv.id
FROM public.portfolio_versions pv
WHERE public.brand_knowledge_scores.client_id = pv.client_id
  AND public.brand_knowledge_scores.version_id IS NULL
  AND pv.version_number = 0;
