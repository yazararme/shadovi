-- Distinguish rows inserted by the one-time backfill script from rows inserted
-- by the live source-processor Inngest function. Useful for the verification
-- query and for auditing data provenance if normalization logic changes.

ALTER TABLE run_sources
  ADD COLUMN IF NOT EXISTS is_backfilled BOOLEAN NOT NULL DEFAULT false;
