-- ─── Source Intelligence ──────────────────────────────────────────────────────
-- Tracks which domains/sources LLMs cite or attribute knowledge to,
-- per client, per model, per week. Feeds the Source Intelligence dashboard panels.
--
-- NOTE: 006 is gap_clusters — this is 007.

-- ─── Enum ─────────────────────────────────────────────────────────────────────

CREATE TYPE source_type AS ENUM (
  'official',     -- brand's own domain (beko.com)
  'competitor',   -- a direct competitor's domain
  'ugc',          -- user-generated content (reddit, forums)
  'editorial',    -- independent editorial/review (which.co.uk, techradar)
  'marketplace',  -- retail/marketplace listing (currys.co.uk, ao.com)
  'reference'     -- encyclopaedic or general reference (wikipedia.org), and default for unknowns
);

-- ─── canonical_domains ────────────────────────────────────────────────────────
-- One row per unique domain. The source processor creates rows here on first
-- encounter; humans classify and correct via source_type and normalized_name.

CREATE TABLE canonical_domains (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  domain                 TEXT        NOT NULL UNIQUE,           -- e.g. "currys.co.uk"
  normalized_name        TEXT        NOT NULL,                  -- e.g. "Currys"
  source_type            source_type NOT NULL DEFAULT 'reference',
  favicon_url            TEXT,
  classification_version TEXT        NOT NULL DEFAULT '1.0',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── domain_aliases ───────────────────────────────────────────────────────────
-- Maps free-text LLM strings ("official Beko website", "Currys.co.uk")
-- to a canonical domain. Confidence = 1.0 for manual entries, lower for auto.

CREATE TABLE domain_aliases (
  alias                TEXT        PRIMARY KEY,  -- exact string the LLM produced
  canonical_domain_id  UUID        NOT NULL REFERENCES canonical_domains(id) ON DELETE CASCADE,
  confidence           FLOAT       NOT NULL DEFAULT 1.0
                                   CHECK (confidence >= 0 AND confidence <= 1),
  override_flag        BOOLEAN     NOT NULL DEFAULT false,  -- human override trumps auto
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── run_sources ──────────────────────────────────────────────────────────────
-- One row per (tracking_run, canonical_domain) pair.
-- is_attributed = appeared in source_attribution
-- is_cited      = appeared in cited_sources
-- Both can be true if the domain showed up in both arrays.

CREATE TABLE run_sources (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID        NOT NULL REFERENCES tracking_runs(id) ON DELETE CASCADE,
  canonical_domain_id  UUID        NOT NULL REFERENCES canonical_domains(id) ON DELETE CASCADE,
  is_attributed        BOOLEAN     NOT NULL DEFAULT false,
  is_cited             BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, canonical_domain_id)  -- idempotent upserts
);

-- ─── domain_run_stats ─────────────────────────────────────────────────────────
-- Aggregated per canonical_domain / client / model / week.
-- Refreshed by recalc_domain_run_stats() after each source-processor run.

CREATE TABLE domain_run_stats (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_domain_id  UUID        NOT NULL REFERENCES canonical_domains(id) ON DELETE CASCADE,
  client_id            UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  model                TEXT        NOT NULL,
  time_bucket          DATE        NOT NULL,  -- ISO week start (Monday), e.g. "2025-02-24"
  runs_used_count      INTEGER     NOT NULL DEFAULT 0,  -- attributed appearances
  runs_cited_count     INTEGER     NOT NULL DEFAULT 0,  -- cited appearances
  total_runs           INTEGER     NOT NULL DEFAULT 0,  -- all runs for client+model+bucket
  model_weight         FLOAT       NOT NULL DEFAULT 0,  -- runs_used_count / total_across_models
  age_p25              TEXT,        -- 25th percentile content year, e.g. "2022"
  age_median           TEXT,        -- median content year
  age_p75              TEXT,        -- 75th percentile content year
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canonical_domain_id, client_id, model, time_bucket)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Fast lookup: "which runs referenced this domain?"
CREATE INDEX idx_run_sources_canonical ON run_sources (canonical_domain_id);
CREATE INDEX idx_run_sources_run       ON run_sources (run_id);

-- Dashboard query: "top domains for this client this week"
CREATE INDEX idx_domain_run_stats_client_bucket
  ON domain_run_stats (client_id, time_bucket DESC);

-- Alias lookup during source processing
CREATE INDEX idx_domain_aliases_canonical ON domain_aliases (canonical_domain_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE canonical_domains  ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_aliases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_sources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_run_stats   ENABLE ROW LEVEL SECURITY;

-- canonical_domains and domain_aliases are shared reference data.
-- Any authenticated user may read; writes come from the service role (bypasses RLS).
CREATE POLICY "canonical_domains_select_auth" ON canonical_domains
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "domain_aliases_select_auth" ON domain_aliases
  FOR SELECT USING (auth.role() = 'authenticated');

-- run_sources: scoped by client ownership via tracking_runs
CREATE POLICY "run_sources_select_own" ON run_sources
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tracking_runs tr
      JOIN clients c ON c.id = tr.client_id
      WHERE tr.id = run_sources.run_id
        AND c.user_id = auth.uid()
    )
  );

-- domain_run_stats: directly has client_id
CREATE POLICY "domain_run_stats_select_own" ON domain_run_stats
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clients
      WHERE clients.id = domain_run_stats.client_id
        AND clients.user_id = auth.uid()
    )
  );

-- ─── Helper: extract a calendar year from free-text content_age_estimate ──────
-- "primarily 2022–2023" → 2022 (first year found); "unclear" → NULL.
-- IMMUTABLE so Postgres can inline it into aggregation queries.

CREATE OR REPLACE FUNCTION extract_content_year(age_text TEXT)
RETURNS INTEGER AS $$
DECLARE
  years INTEGER[];
BEGIN
  IF age_text IS NULL OR age_text ILIKE '%unclear%' THEN
    RETURN NULL;
  END IF;

  SELECT ARRAY(
    SELECT m[1]::integer
    FROM regexp_matches(age_text, '\b(20[12]\d)\b', 'g') AS m
  ) INTO years;

  IF years IS NULL OR array_length(years, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Average when a range is given ("2022–2023" → 2022), round to nearest year.
  RETURN (SELECT ROUND(AVG(v))::integer FROM unnest(years) v);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── RPC: recalc_domain_run_stats ─────────────────────────────────────────────
-- Called by source-processor.ts after writing run_sources for a client.
-- Re-derives all aggregate counts, model_weight, and age percentiles from scratch.
-- Idempotent: safe to call multiple times.

CREATE OR REPLACE FUNCTION recalc_domain_run_stats(p_client_id UUID)
RETURNS void AS $$
BEGIN
  -- ── Step 1: upsert counts and model_weight ──────────────────────────────────
  INSERT INTO domain_run_stats (
    canonical_domain_id, client_id, model, time_bucket,
    runs_used_count, runs_cited_count, total_runs, model_weight,
    updated_at
  )
  WITH run_counts AS (
    -- Attributed/cited appearances per domain+model+week for this client
    SELECT
      rs.canonical_domain_id,
      tr.model,
      date_trunc('week', tr.ran_at)::date            AS time_bucket,
      COUNT(*) FILTER (WHERE rs.is_attributed)       AS runs_used_count,
      COUNT(*) FILTER (WHERE rs.is_cited)            AS runs_cited_count
    FROM run_sources rs
    JOIN tracking_runs tr ON tr.id = rs.run_id
    WHERE tr.client_id = p_client_id
    GROUP BY rs.canonical_domain_id, tr.model, date_trunc('week', tr.ran_at)::date
  ),
  total_per_model_bucket AS (
    -- Total runs per model+week for this client (denominator for model_weight)
    SELECT
      model,
      date_trunc('week', ran_at)::date AS time_bucket,
      COUNT(*)                         AS total_runs
    FROM tracking_runs
    WHERE client_id = p_client_id
    GROUP BY model, date_trunc('week', ran_at)::date
  ),
  cross_model_totals AS (
    -- Total attributed appearances across ALL models per domain+week (model_weight denominator)
    SELECT
      canonical_domain_id,
      time_bucket,
      SUM(runs_used_count) AS total_across_models
    FROM run_counts
    GROUP BY canonical_domain_id, time_bucket
  )
  SELECT
    rc.canonical_domain_id,
    p_client_id,
    rc.model,
    rc.time_bucket,
    rc.runs_used_count,
    rc.runs_cited_count,
    COALESCE(tm.total_runs, 0)  AS total_runs,
    CASE
      WHEN COALESCE(cmt.total_across_models, 0) > 0
        THEN rc.runs_used_count::float / cmt.total_across_models
      ELSE 0
    END                         AS model_weight,
    now()
  FROM run_counts rc
  LEFT JOIN total_per_model_bucket tm
         ON tm.model = rc.model AND tm.time_bucket = rc.time_bucket
  LEFT JOIN cross_model_totals cmt
         ON cmt.canonical_domain_id = rc.canonical_domain_id
        AND cmt.time_bucket = rc.time_bucket
  ON CONFLICT (canonical_domain_id, client_id, model, time_bucket)
  DO UPDATE SET
    runs_used_count = EXCLUDED.runs_used_count,
    runs_cited_count = EXCLUDED.runs_cited_count,
    total_runs       = EXCLUDED.total_runs,
    model_weight     = EXCLUDED.model_weight,
    updated_at       = now();

  -- ── Step 2: age percentiles from content_age_estimate ─────────────────────
  -- Collect all content_age_estimate values for runs that referenced each
  -- domain, extract a year, then compute Postgres ordered-set percentiles.
  UPDATE domain_run_stats drs
  SET
    age_p25    = age_data.p25::text,
    age_median = age_data.p50::text,
    age_p75    = age_data.p75::text
  FROM (
    SELECT
      rs.canonical_domain_id,
      tr.model,
      date_trunc('week', tr.ran_at)::date AS time_bucket,
      ROUND(
        percentile_cont(0.25) WITHIN GROUP (
          ORDER BY extract_content_year(tr.content_age_estimate)::float
        )
      )::integer AS p25,
      ROUND(
        percentile_cont(0.50) WITHIN GROUP (
          ORDER BY extract_content_year(tr.content_age_estimate)::float
        )
      )::integer AS p50,
      ROUND(
        percentile_cont(0.75) WITHIN GROUP (
          ORDER BY extract_content_year(tr.content_age_estimate)::float
        )
      )::integer AS p75
    FROM run_sources rs
    JOIN tracking_runs tr ON tr.id = rs.run_id
    WHERE tr.client_id = p_client_id
      AND extract_content_year(tr.content_age_estimate) IS NOT NULL
    GROUP BY rs.canonical_domain_id, tr.model, date_trunc('week', tr.ran_at)::date
  ) age_data
  WHERE drs.client_id           = p_client_id
    AND drs.canonical_domain_id = age_data.canonical_domain_id
    AND drs.model               = age_data.model
    AND drs.time_bucket         = age_data.time_bucket;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Seed data ────────────────────────────────────────────────────────────────
-- Known domains from Beko tracking data. source_type classified manually.
-- Add further entries or update source_type via direct SQL as new domains emerge.

INSERT INTO canonical_domains (domain, normalized_name, source_type) VALUES
  ('beko.com',        'Beko',         'official'),
  ('currys.co.uk',    'Currys',        'marketplace'),
  ('ao.com',          'AO.com',        'marketplace'),
  ('johnlewis.com',   'John Lewis',    'marketplace'),
  ('reddit.com',      'Reddit',        'ugc'),
  ('wikipedia.org',   'Wikipedia',     'reference'),
  ('which.co.uk',     'Which?',        'editorial')
ON CONFLICT (domain) DO NOTHING;

-- Seed aliases for the most common free-text strings seen in source_attribution
INSERT INTO domain_aliases (alias, canonical_domain_id, confidence) VALUES
  ('beko.com',              (SELECT id FROM canonical_domains WHERE domain = 'beko.com'), 1.0),
  ('official Beko website', (SELECT id FROM canonical_domains WHERE domain = 'beko.com'), 1.0),
  ('Beko official site',    (SELECT id FROM canonical_domains WHERE domain = 'beko.com'), 1.0),
  ('currys.co.uk',          (SELECT id FROM canonical_domains WHERE domain = 'currys.co.uk'), 1.0),
  ('Currys',                (SELECT id FROM canonical_domains WHERE domain = 'currys.co.uk'), 0.9),
  ('ao.com',                (SELECT id FROM canonical_domains WHERE domain = 'ao.com'), 1.0),
  ('johnlewis.com',         (SELECT id FROM canonical_domains WHERE domain = 'johnlewis.com'), 1.0),
  ('John Lewis',            (SELECT id FROM canonical_domains WHERE domain = 'johnlewis.com'), 0.9),
  ('reddit.com',            (SELECT id FROM canonical_domains WHERE domain = 'reddit.com'), 1.0),
  ('Wikipedia',             (SELECT id FROM canonical_domains WHERE domain = 'wikipedia.org'), 1.0),
  ('wikipedia.org',         (SELECT id FROM canonical_domains WHERE domain = 'wikipedia.org'), 1.0),
  ('Which?',                (SELECT id FROM canonical_domains WHERE domain = 'which.co.uk'), 1.0),
  ('which.co.uk',           (SELECT id FROM canonical_domains WHERE domain = 'which.co.uk'), 1.0),
  ('Which? magazine',       (SELECT id FROM canonical_domains WHERE domain = 'which.co.uk'), 1.0)
ON CONFLICT (alias) DO NOTHING;
