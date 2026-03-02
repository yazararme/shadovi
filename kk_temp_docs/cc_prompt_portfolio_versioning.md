# Claude Code Prompt — Portfolio Versioning Implementation
*Migration 010 · March 2026*

---

## Context: Why This Matters

Every dashboard metric in Shadovi — BVI scores, unaided visibility trends, brand knowledge accuracy, competitive displacement — assumes the underlying query portfolio is stable across time. When a client edits their portfolio mid-tracking (adds queries, removes brand facts, swaps competitors), the longitudinal integrity of every trend line is silently corrupted.

The onboarding spec explicitly allows post-activation editing of Brand DNA, Competitors, Personas, and Brand Facts. Without versioning, every regeneration creates a structural break in the data that no dashboard currently detects or communicates.

This migration adds portfolio versioning so data integrity is preserved and dashboard calculations can segment correctly across version boundaries.

---

## Step 1 — Migration: `010_portfolio_versioning.sql`

### 1.1 New table: `portfolio_versions`

```sql
CREATE TABLE IF NOT EXISTS public.portfolio_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  version_number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL,
  change_summary jsonb,
  query_count integer NOT NULL DEFAULT 0,
  fact_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT portfolio_versions_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_versions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id)
);
```

Column notes:
- `version_number` — incrementing counter per client (0, 1, 2…). Compute as MAX(version_number) + 1 WHERE client_id = $1.
- `trigger` — what caused the version: `'onboarding_activation'`, `'manual_regeneration'`, `'settings_edit'`, `'calibration_prompt'`, `'pre_versioning_backfill'`
- `change_summary` — machine-readable diff: `{ queries_added: N, queries_removed: N, facts_changed: [uuid], competitors_changed: [uuid] }`. Null for the first version.
- `is_active` — true for the current version. Only one active per client.

### 1.2 Add `version_id` to existing tables

Nullable because existing records predate versioning — null means pre-versioning era.

```sql
ALTER TABLE queries ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES portfolio_versions(id);
ALTER TABLE brand_facts ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES portfolio_versions(id);
ALTER TABLE tracking_runs ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES portfolio_versions(id);
ALTER TABLE brand_knowledge_scores ADD COLUMN IF NOT EXISTS version_id uuid REFERENCES portfolio_versions(id);
```

### 1.3 Soft-delete columns

The `queries` table already has a `status` column. Add deactivation tracking:

```sql
ALTER TABLE queries ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS deactivated_by_version uuid REFERENCES portfolio_versions(id);
```

For brand_facts, competitors, and personas — add status + deactivation:

```sql
ALTER TABLE brand_facts ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE brand_facts ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE competitors ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE competitors ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

ALTER TABLE personas ADD COLUMN IF NOT EXISTS status text DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE personas ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
```

### 1.4 Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_queries_client_version_status ON queries(client_id, version_id, status);
CREATE INDEX IF NOT EXISTS idx_tracking_runs_client_version ON tracking_runs(client_id, version_id, ran_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_versions_client_active ON portfolio_versions(client_id, is_active);
CREATE INDEX IF NOT EXISTS idx_brand_facts_client_status ON brand_facts(client_id, status);
```

### 1.5 Backfill version 0

After creating the table and columns, backfill a version 0 for each client that has existing active data, then update all null version_id records:

```sql
-- Create version 0 for each active client
INSERT INTO portfolio_versions (client_id, version_number, trigger, is_active, query_count, fact_count)
SELECT c.id, 0, 'pre_versioning_backfill', true,
  (SELECT count(*) FROM queries WHERE client_id = c.id AND status = 'active'),
  (SELECT count(*) FROM brand_facts WHERE client_id = c.id)
FROM clients c WHERE c.status = 'active';

-- Backfill version_id on all existing records
UPDATE queries SET version_id = pv.id
FROM portfolio_versions pv
WHERE queries.client_id = pv.client_id AND queries.version_id IS NULL AND pv.version_number = 0;

UPDATE brand_facts SET version_id = pv.id
FROM portfolio_versions pv
WHERE brand_facts.client_id = pv.client_id AND brand_facts.version_id IS NULL AND pv.version_number = 0;

UPDATE tracking_runs SET version_id = pv.id
FROM portfolio_versions pv
WHERE tracking_runs.client_id = pv.client_id AND tracking_runs.version_id IS NULL AND pv.version_number = 0;

UPDATE brand_knowledge_scores SET version_id = pv.id
FROM portfolio_versions pv
WHERE brand_knowledge_scores.client_id = pv.client_id AND brand_knowledge_scores.version_id IS NULL AND pv.version_number = 0;
```

---

## Step 2 — Add TypeScript types

**File: `types/index.ts`**

Add:

```typescript
export type VersionTrigger = 'onboarding_activation' | 'manual_regeneration' | 'settings_edit' | 'calibration_prompt';

export interface PortfolioVersion {
  id: string;
  client_id: string;
  version_number: number;
  created_at: string;
  trigger: VersionTrigger;
  change_summary: {
    queries_added: number;
    queries_removed: number;
    facts_changed: string[];
    competitors_changed: string[];
  } | null;
  query_count: number;
  fact_count: number;
  is_active: boolean;
}
```

Add `version_id: string | null;` to the existing `Query`, `BrandFact`, `TrackingRun`, and `BrandKnowledgeScore` interfaces.

---

## Step 3 — Version creation utility

**Create: `lib/versioning/create-version.ts`**

Single function that creates a new portfolio version. Every trigger point calls this.

```typescript
export async function createPortfolioVersion(
  clientId: string,
  trigger: VersionTrigger,
  supabase: SupabaseClient
): Promise<{ versionId: string; versionNumber: number }>
```

The function:
1. Fetches the current active version for this client (if any).
2. Marks it as `is_active = false`.
3. Computes next `version_number` as (current + 1), or 1 if no previous version.
4. Counts currently active queries and brand facts.
5. If previous version exists, computes `change_summary` by diffing counts. Otherwise null.
6. Inserts a new `portfolio_versions` row with `is_active = true`.
7. Returns the new version's id and version_number.

**This function does NOT modify queries, brand_facts, or any other table.** It only creates the version record and deactivates the previous one. The caller stamps version_id on entities.

---

## Step 4 — Update query generation route

**File: `app/api/queries/generate/route.ts`**

Currently (lines 43–44), the route does a hard DELETE of all queries then inserts new ones. Change to soft-delete + versioning:

**Replace this:**
```typescript
await supabase.from('queries').delete().eq('client_id', clientId);
```

**With:**
1. Accept optional `trigger` in POST body: `{ clientId, trigger? }`. Default to `'manual_regeneration'`.
2. Call `createPortfolioVersion(clientId, trigger, supabase)` to get new `versionId`.
3. Soft-deactivate old queries:
   ```typescript
   await supabase.from('queries')
     .update({ status: 'inactive', deactivated_at: new Date().toISOString(), deactivated_by_version: versionId })
     .eq('client_id', clientId)
     .in('status', ['pending_approval', 'active']);
   ```
4. Insert new queries with `version_id: versionId` (add to the map on line 51).
5. Update `portfolio_versions` row with accurate `query_count` after insert.

**IMPORTANT:** The query generator already stamps `is_bait`, `bait_type`, and `fact_id` correctly (`lib/synthetic-buyer/query-generator.ts` line 174–178). Do not change that logic. Just add `version_id` to the insert.

---

## Step 5 — Update activation flow

**File: `app/(onboarding)/configure/queries/page.tsx` — `handleActivate()` at line 158**

Currently, `handleActivate` sets queries to 'active' and client to 'active' directly from the client component (lines 170–178), then fires the first tracking run.

**Simplest approach:** Create a new API route `app/api/versioning/activate/route.ts` that:
1. Creates a portfolio version with trigger `'onboarding_activation'`.
2. Stamps `version_id` on all `pending_approval` queries for this client.
3. Sets queries to `status = 'active'`.
4. Sets `clients.status = 'active'`.
5. Returns the version info.

Then `handleActivate()` calls this route instead of doing direct Supabase updates.

**The important constraint:** Version creation must happen before the first tracking run fires (`fetch("/api/tracking/run", ...)` at line 187). The run needs queries that have a version_id so tracking_runs inherit it.

---

## Step 6 — Update runner to stamp version_id

**File: `lib/tracking/runner.ts`**

Change the query select at line 244 from:
```typescript
.select("id, text, intent, fact_id, is_bait")
```
To:
```typescript
.select("id, text, intent, fact_id, is_bait, version_id")
```

Add to the tracking_runs insert (line 332–349):
```typescript
version_id: query.version_id,
```

Add to the brand_knowledge_scores insert (line 377–388):
```typescript
version_id: query.version_id,
```

That's it. Tracking runs inherit the version from the query they ran against.

---

## Step 7 — Brand fact edit pattern

When a client edits a brand fact's claim text post-activation, treat as delete + create, never in-place update:

1. Set old `brand_facts` row to `status = 'inactive'`, `deactivated_at = now()`.
2. Insert new row with edited claim, `version_id = current active version`, `status = 'active'`.
3. Historical `tracking_runs` and `brand_knowledge_scores` linked to the old `fact_id` remain valid.

For removal: just set `status = 'inactive'`.
For addition: insert with `version_id = current active version`.

**No UI needed yet** — there is no Settings/Brand Profile section built. But the utility functions should support this pattern.

---

## Step 8 — Update dashboard queries

Every dashboard page that reads from `tracking_runs` needs to filter by the current active version.

**Files to update:**
- `app/(dashboard)/overview/page.tsx` — top-line metrics
- `app/(dashboard)/knowledge/page.tsx` — brand knowledge scores, BVI
- `app/(dashboard)/competitive/page.tsx` — unaided visibility
- `app/(dashboard)/narrative/page.tsx` — competitive gaps
- `app/(dashboard)/sources/page.tsx` — source intelligence

**Pattern for each page:**
1. Fetch active version: `SELECT id FROM portfolio_versions WHERE client_id = $1 AND is_active = true LIMIT 1`
2. Add `.eq('version_id', activeVersion.id)` to all `tracking_runs` and `brand_knowledge_scores` queries.

Start with simplest approach: filter everything to current active version. Cross-version comparison is a future enhancement.

---

## Step 9 — Version indicator in sidebar

**File: `components/layout/Sidebar.tsx`**

Add a subtle indicator below the navigation items or in the sidebar footer:

```
Portfolio v{version_number} · since {formatted date}
```

Non-interactive for now. Future: opens a changelog drawer.

---

## Step 10 — Verification

### Schema check:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'portfolio_versions'
ORDER BY ordinal_position;
-- Expected: id, client_id, version_number, created_at, trigger, change_summary, query_count, fact_count, is_active
```

### Backfill check:
```sql
SELECT COUNT(*) FROM queries WHERE version_id IS NULL;
-- Expected: 0

SELECT COUNT(*) FROM tracking_runs WHERE version_id IS NULL;
-- Expected: 0

SELECT client_id, version_number, query_count, fact_count
FROM portfolio_versions WHERE version_number = 0;
```

### Functional check:
Trigger a query regeneration for an existing client. Verify:
- Old queries: `status = 'inactive'`, `deactivated_at` set, `deactivated_by_version` set
- New queries: `version_id` pointing to new `portfolio_versions` row
- New version: `is_active = true`, previous version: `is_active = false`

---

## What NOT to Change

- Share-of-model calculations — validation exclusion fix confirmed in place
- BVI migration (005_bvi_fields.sql) — this adds to it, not modifies it
- Source Intelligence pipeline (source-processor.ts, backfill-sources.ts) — unaffected
- Enrichment calls or ENRICHMENT_ENABLED env flag — unaffected
- knowledge-scorer.ts logic — only change is adding version_id to score insert
- scorer.ts (primary response scorer) — no changes
- query-generator.ts (lib/synthetic-buyer/) — no changes to generation logic; version_id is stamped by the API route after generation
- gap-clusterer.ts — no changes for this phase

---

## Flags to Raise, Not Decide

- **Dashboard page performance:** If adding version_id filter to every dashboard query feels cumbersome, flag it. We can create a shared `useActiveVersion()` hook.
- **Source intelligence cross-version data:** The sources page may benefit from showing all versions rather than current only. Flag if current-version filter makes sources page look empty after regeneration.
- **RLS policies:** The new portfolio_versions table needs its own RLS policy (see 002_rls_policies.sql). Flag if unsure about the correct policy shape.
- **Activation route vs inline:** If creating a new API route for activation (Step 5) feels over-engineered, it's acceptable to keep activation in the client component and just add a fetch to create the version. The important thing is version creation happens before the first tracking run.

---

## Build Sequence

Execute in order. Each step independently verifiable.

1. Run migration 010_portfolio_versioning.sql
2. Add TypeScript types to types/index.ts
3. Create lib/versioning/create-version.ts
4. Update app/api/queries/generate/route.ts (soft-delete + versioning)
5. Update activation flow (create version 1 on first activation)
6. Update runner.ts (select + stamp version_id)
7. Update dashboard pages (filter by active version)
8. Add version indicator to sidebar
9. Run verification queries
