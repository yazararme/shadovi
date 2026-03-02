# Claude Code Prompt — BVI Composite Score
*March 2026*

---

## Context: What We're Building

The Brand Vulnerability Index (BVI) measures how susceptible LLMs are to asserting false claims about a brand when prompted with fabricated or misleading information. The raw data already exists — `bait_triggered` on `brand_knowledge_scores`, `is_bait` and `bait_type` on `queries`, and the full hallucination alerts panel on the Brand Knowledge page. What's missing is a **headline composite score** that non-technical buyers can glance at and immediately understand.

The BVI has four components: Frequency (F), Severity (S), Replication (R), Persistence (P). We are building **F and R now**. S requires client-configurable severity ratings on brand facts (not yet built). P requires two time periods of data — it will be greyed out with "available after 30 days of tracking."

---

## The BVI Score Formula

### Frequency (F) — 0 to 100
What percentage of bait queries triggered a hallucination?

```
F = (bait_triggered_count / total_bait_runs) × 100
```

Where:
- `bait_triggered_count` = count of `brand_knowledge_scores` rows where `bait_triggered = true`
- `total_bait_runs` = count of `brand_knowledge_scores` rows where the linked query has `is_bait = true`

Both filtered to the current active `version_id`.

If there are zero bait runs, F is null (show "—" not 0).

### Replication (R) — 0 to 100
Across how many models does the same false claim get confirmed?

For each bait fact (each `brand_facts` row where `is_true = false`):
1. Count how many distinct models have at least one `bait_triggered = true` score for this fact.
2. Divide by total models tracked (from `clients.selected_models`).
3. This gives a per-fact replication rate (0.0 to 1.0).

```
R = average(per_fact_replication_rates) × 100
```

If there are zero bait facts, R is null.

### Severity (S) — future, greyed out
Requires client-configurable severity ratings per brand fact (e.g. pricing claims are more severe than feature claims). Not built yet.

### Persistence (P) — future, greyed out
Requires comparing bait_triggered rates across at least two time periods. Not built yet.

### Composite BVI Score

For now, with only F and R available:

```
BVI = (F × 0.6) + (R × 0.4)
```

Frequency is weighted higher because "how often" matters more than "how widely" for a single-period snapshot. When S and P are added, the weights will be rebalanced to: F × 0.3, S × 0.3, R × 0.2, P × 0.2.

The score is 0–100 where **lower is better** (less vulnerable). This is the opposite of accuracy where higher is better. Make this clear in the UI — use language like "vulnerability" not "health."

Score interpretation:
- 0–15: Low vulnerability (green)
- 16–40: Moderate vulnerability (amber)  
- 41–100: High vulnerability (red/coral)

---

## Where the BVI Score Surfaces

### 1. Brand Knowledge page — new BVI panel

**File: `app/(dashboard)/knowledge/page.tsx`**

Add a new section between the existing "Knowledge Accuracy Score" metrics strip and the "Accuracy by Category" table. Use the existing `SubLabel` component for the section header.

```
BRAND VULNERABILITY INDEX
```

The panel contains:

**Left card — Composite BVI Score:**
- Large number (same styling as the existing "83%" accuracy score): the BVI score, 0–100
- Colour-coded: green (0–15), amber (16–40), coral (41+)
- Subtext: "Lower is better — measures how easily LLMs confirm false claims about your brand"
- Below: small "VIEW DETAILS →" link that scrolls to the existing Hallucination Alerts section

**Middle card — Frequency (F):**
- Label: "BAIT TRIGGER RATE"
- Value: F as percentage (e.g. "23%")
- Subtext: "{N} of {M} bait queries triggered a hallucination"
- Progress bar (inverted colour — higher = worse = more red)

**Right card — Replication (R):**
- Label: "CROSS-MODEL SPREAD"
- Value: R as percentage (e.g. "40%")
- Subtext: "Average % of models that confirm the same false claim"
- Progress bar (same inverted colour logic)

**Fourth card — Severity (S) — greyed out:**
- Label: "SEVERITY"
- Value: "—"
- Subtext: "Configure fact severity ratings to enable"
- Entire card at 50% opacity

**Fifth card — Persistence (P) — greyed out:**
- Label: "PERSISTENCE"
- Value: "—"  
- Subtext: "Available after 30 days of tracking"
- Entire card at 50% opacity

Use a `grid grid-cols-2 sm:grid-cols-5 gap-4` layout for the 5 cards. The two greyed-out cards signal that BVI gets richer over time — this is an intentional retention signal.

### 2. Overview page — BVI in the metrics strip

**File: `app/(dashboard)/overview/page.tsx`**

The overview already has top-line cards (Unaided Visibility, AI Favorability, Brand Knowledge, Source Attribution). Add a **fifth card** for BVI:

- Label: "BRAND VULNERABILITY"
- Value: BVI composite score (0–100)
- Colour: inverted (lower = green, higher = red)
- Subtext: "How easily LLMs confirm false claims"
- "VIEW DETAILS →" links to `/knowledge?client={id}`

If no bait queries exist for this client, show "—" with subtext "Add false claim tests in Brand Facts to enable."

### 3. Per-model BVI breakdown

In the Brand Knowledge page, below or alongside the existing "Accuracy by Model" table, add a **BVI by Model** table:

| Model | Bait Runs | Triggered | Trigger Rate | Unique Facts Triggered |
|-------|-----------|-----------|--------------|----------------------|
| GPT-4o | 15 | 4 | 27% | 3 of 5 |
| Perplexity | 15 | 2 | 13% | 2 of 5 |
| Claude | 15 | 1 | 7% | 1 of 5 |
| Gemini | 15 | 5 | 33% | 4 of 5 |

This uses the same table styling as the existing "Accuracy by Category" and "Accuracy by Model" tables. Rows are clickable and open the existing DrillDownSlideOver with a bait-specific filter.

---

## Implementation

### Computation utility

**Create: `lib/bvi/compute-bvi.ts`**

```typescript
export interface BVIResult {
  frequency: number | null;       // 0–100, null if no bait runs
  replication: number | null;     // 0–100, null if no bait facts
  severity: null;                 // future
  persistence: null;              // future
  composite: number | null;       // 0–100, null if F and R are both null
  baitRunsTotal: number;
  baitTriggeredCount: number;
  baitFactsTotal: number;
  perModel: Record<string, {
    baitRuns: number;
    triggered: number;
    triggerRate: number;
    uniqueFactsTriggered: number;
    totalBaitFacts: number;
  }>;
  perFact: Record<string, {
    factClaim: string;
    modelsTriggered: string[];
    totalModels: number;
    replicationRate: number;
  }>;
}

export function computeBVI(
  scores: BrandKnowledgeScore[],
  queries: Pick<Query, 'id' | 'is_bait' | 'fact_id'>[],
  facts: BrandFact[],
  selectedModels: string[]
): BVIResult
```

The function:
1. Identifies all bait queries (where `is_bait = true`) and their linked fact_ids.
2. Filters scores to only those linked to bait queries (join via tracking_run → query).
3. Computes F: `bait_triggered_count / total_bait_scores`.
4. For R: groups bait-triggered scores by fact_id × model, computes per-fact replication, averages.
5. Computes composite: `F × 0.6 + R × 0.4` (null if either is null).
6. Builds the perModel and perFact breakdowns.

**This is a pure computation function with no DB calls.** The calling page fetches the data; this function crunches it. This keeps it testable and reusable across overview and knowledge pages.

### Knowledge page integration

**File: `app/(dashboard)/knowledge/page.tsx`**

The page already fetches `brand_knowledge_scores`, `brand_facts`, and `queries` in `loadData()`. The data needed for BVI is already in memory. Call `computeBVI()` with the existing data and render the panel.

For the per-model table, the page already has a `modelStats` computation pattern (around line 320 in the existing code). Follow the same pattern for BVI by model.

The page already has `buildFactModelGroups()` which groups scores by fact × model. The BVI computation can reuse these groups to get per-fact replication data.

### Overview page integration

**File: `app/(dashboard)/overview/page.tsx`**

The overview already fetches `tracking_runs` and computes `factAccuracyPct`. It also fetches `queries` with `is_bait`. To compute BVI for the overview card:

1. The page already fetches `brand_knowledge_scores` for the accuracy metric. If it doesn't currently, add it to the parallel fetch.
2. Fetch `brand_facts` for the bait fact list.
3. Call `computeBVI()` and use `composite` for the card value.

If the overview page doesn't currently fetch `brand_knowledge_scores`, it's acceptable to compute a simpler version for the overview card only: just use the `bait_triggered` count from scores already fetched, divided by total bait runs. The full breakdown lives on the knowledge page.

---

## Styling Guidance

Match the existing Shadovi design system exactly:
- Card borders: `border border-[#E2E8F0] rounded-lg p-5 bg-white`
- Section labels: use the existing `SubLabel` component
- Metric numbers: `text-[36px] font-bold leading-none`
- Metric sublabels: `text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2`
- Subtext: `text-[11px] text-[#6B7280] mt-2`
- Progress bars: `h-[5px] w-full bg-[#E2E8F0] rounded-full overflow-hidden`
- Table headers: `text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]`
- Colour coding: green `#1A8F5C`, amber `#F59E0B`, coral `#FF4B6E`
- Greyed-out cards: `opacity-50` on the entire card container

**BVI uses INVERTED colour logic** compared to accuracy:
- Low score (0–15) = green = good = low vulnerability
- High score (41+) = coral = bad = high vulnerability

This is the opposite of accuracy where high = green. Get this right — it's the single most likely source of colour-coding bugs.

---

## What NOT to Change

- Existing Hallucination Alerts panel — BVI adds a score above it, doesn't replace it
- Existing accuracy calculations — BVI is separate from accuracy
- The knowledge-scorer.ts logic — `bait_triggered` is already computed correctly there
- Share-of-model calculations — validation exclusion remains in place
- Portfolio versioning — the version_id filter should already be in place from the previous migration

---

## Flags to Raise, Not Decide

- **If the overview page doesn't currently fetch brand_knowledge_scores:** flag it — we can either add the fetch or compute a simpler BVI proxy from data already available.
- **If the 5-column grid feels cramped on mobile:** flag it — we can stack differently on small screens or drop the greyed-out cards on mobile.
- **If you can't easily get the is_bait flag on scores without an extra join:** the knowledge page already resolves `fact_is_true` on each enriched score. A score where `fact_is_true = false` is equivalent to `is_bait = true` on the query. Use whichever is more convenient.
- **If the BVI card on the overview conflicts with the existing 4-card grid layout:** flag it — we can either make it a 5-card grid, put BVI in a separate row, or replace one of the existing cards.

---

## Build Sequence

1. Create `lib/bvi/compute-bvi.ts` — pure computation, no DB calls.
2. Add BVI panel to the Brand Knowledge page (5 cards: composite, F, R, S greyed, P greyed).
3. Add BVI by Model table to the Brand Knowledge page.
4. Add BVI card to the Overview page.
5. Verify colour coding is inverted (low = green, high = red).
6. Verify greyed-out cards show correct "not yet available" messaging.
