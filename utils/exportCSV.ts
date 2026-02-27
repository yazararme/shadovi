import Papa from "papaparse";
import type { DrillDownRow } from "@/hooks/useDrillDownData";
import type { BrandFactCategory, LLMModel } from "@/types";

const CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Features",
  market: "Markets",
  pricing: "Pricing",
  messaging: "Messaging",
};

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

export function exportRowsAsCSV(rows: DrillDownRow[], filename: string) {
  const data = rows.map((r) => ({
    Category: CATEGORY_LABELS[r.fact_category] ?? r.fact_category,
    Model: MODEL_LABELS[r.model] ?? r.model,
    "Fact Claim": r.fact_claim,
    Bait: r.fact_is_true ? "No" : "Yes",
    Query: r.query_text,
    Accuracy: r.accuracy,
    Hallucination: r.hallucination ? "Yes" : "No",
    "Bait Triggered": r.bait_triggered ? "Yes" : "No",
    Notes: r.notes ?? "",
    "Scored At": r.scored_at,
  }));

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
