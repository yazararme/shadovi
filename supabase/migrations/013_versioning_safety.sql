-- Migration 013: Versioning safety constraints + name column
--
-- 1. Partial unique index: prevents more than one active version per client at the
--    DB level. Previously enforced only in application code (create-version.ts),
--    which had a race-condition window under concurrent writes.
--
-- 2. name column: optional human-readable label for a version (e.g. "Post-rebrand Q2").

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_versions_single_active
  ON public.portfolio_versions (client_id)
  WHERE is_active = true;

ALTER TABLE public.portfolio_versions ADD COLUMN IF NOT EXISTS name text;
