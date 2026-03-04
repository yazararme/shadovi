-- Migration 014: Recommendations V2 — batch-based enriched context
--
-- Adds batch grouping and enriched context columns to the recommendations table.
-- Each recommendation now belongs to a batch (one UUID per generateRecommendations call),
-- enabling the 3-section roadmap UI (In Progress / Current / Previous batches).
--
-- No data is destroyed — existing rows get a synthetic batch_id backfill.

-- New columns
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS batch_id             UUID;
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS source_query_text    TEXT;
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS source_cluster_name  TEXT;
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS mention_rate_at_generation NUMERIC(5, 2);
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS version_id           UUID REFERENCES public.portfolio_versions(id);
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS generated_from_run_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recommendations_batch_id
  ON public.recommendations (batch_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_client_status
  ON public.recommendations (client_id, status);

-- Backfill: group pre-existing rows into synthetic batches by client + truncated minute.
-- Rows created within the same minute for the same client are assumed to belong to
-- the same generation call and receive a shared batch_id.
WITH synthetic_batches AS (
  SELECT
    id,
    gen_random_uuid() OVER (
      PARTITION BY client_id, date_trunc('minute', created_at)
      ORDER BY created_at
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS assigned_batch_id
  FROM public.recommendations
  WHERE batch_id IS NULL
)
UPDATE public.recommendations r
SET batch_id = sb.assigned_batch_id
FROM synthetic_batches sb
WHERE r.id = sb.id
  AND r.batch_id IS NULL;
