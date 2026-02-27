import { useMemo } from "react";
import type { BrandFactCategory, LLMModel } from "@/types";

// Shared row type for the drill-down slide-over. Defined here so both the hook
// and the slide-over component can import it without touching page internals.
export interface DrillDownRow {
  id: string;
  fact_claim: string;
  fact_category: BrandFactCategory;
  fact_is_true: boolean;
  model: LLMModel;
  query_text: string;
  accuracy: "correct" | "incorrect" | "uncertain";
  hallucination: boolean;
  bait_triggered: boolean;
  raw_response: string | null;
  notes: string | null;
  scored_at: string;
}

export interface DrillDownFilters {
  category?: BrandFactCategory;
  model?: LLMModel;
}

// Filters and sorts a pre-loaded array of DrillDownRow. No Supabase calls —
// the page already fetches all scores and this runs client-side in useMemo.
export function useDrillDownData(
  rows: DrillDownRow[],
  filters: DrillDownFilters
): DrillDownRow[] {
  return useMemo(() => {
    let result = rows;
    if (filters.category) result = result.filter((r) => r.fact_category === filters.category);
    if (filters.model) result = result.filter((r) => r.model === filters.model);

    // Hallucinations first (strongest signal), then bait, then alphabetical by fact
    return [...result].sort((a, b) => {
      const aScore = (a.hallucination ? 2 : 0) + (a.bait_triggered ? 1 : 0);
      const bScore = (b.hallucination ? 2 : 0) + (b.bait_triggered ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return a.fact_claim.localeCompare(b.fact_claim);
    });
  }, [rows, filters.category, filters.model]);
}
