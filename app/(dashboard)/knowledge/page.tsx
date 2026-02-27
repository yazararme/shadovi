"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { DrillDownSlideOver } from "@/components/brand-knowledge/DrillDownSlideOver";
import type { DrillDownFilters } from "@/hooks/useDrillDownData";
import type {
  Client,
  LLMModel,
  BrandFact,
  BrandKnowledgeScore,
  BrandFactCategory,
} from "@/types";

// A score row joined with its related fact and run data for display
interface EnrichedScore extends BrandKnowledgeScore {
  fact_claim: string;
  fact_category: BrandFactCategory;
  fact_is_true: boolean;
  query_text: string;
  model: LLMModel;
  raw_response: string | null;
}

// Aggregated group: one fact tested by one model across N query phrasings.
// The grouping key is fact_id + model — this is the unit of insight for the
// Hallucination Alerts panel ("AutoDose failed on GPT-4o 3/3 times").
interface FactModelGroup {
  key: string;
  fact_id: string | null;
  fact_claim: string;
  fact_category: BrandFactCategory;
  fact_is_true: boolean;
  model: LLMModel;
  runs: EnrichedScore[];
  total: number;
  correctCount: number;
  hallucinatedCount: number;
  hasHallucination: boolean;
  representativeRun: EnrichedScore;
  // Data integrity flag: all runs for a given fact share the same is_true value.
  // If this is ever true it means the fact changed bait status mid-dataset —
  // bait and true-fact failures tell different stories so we surface it rather
  // than silently merging.
  isMixedBait: boolean;
  // Total runs in this group where bait_triggered=true — surfaced at-a-glance
  // in the main table row so users don't need to expand to notice bait activity.
  baitTriggeredCount: number;
}

// Fact-level group: one claim tested across N models in the alerts panel.
interface AlertFactGroup {
  fact_id: string | null;
  fact_claim: string;
  fact_is_true: boolean;
  models: FactModelGroup[];
  totalHallucinations: number;
}

// Top-level category group for the 3-level alert hierarchy.
interface AlertCategoryGroup {
  category: BrandFactCategory;
  label: string;
  facts: AlertFactGroup[];
  totalHallucinations: number;
}

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

const CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Features",
  market: "Markets",
  pricing: "Pricing",
  messaging: "Messaging",
};

const ACCURACY_STYLES: Record<string, string> = {
  correct: "bg-[rgba(26,143,92,0.1)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  incorrect: "bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
  uncertain: "bg-[rgba(245,158,11,0.1)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]",
};

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-10 mb-3">
      <span className="text-[11px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

const ALERT_CATEGORIES: BrandFactCategory[] = ["feature", "market", "pricing", "messaging"];

function buildCategoryTree(alertGroups: FactModelGroup[]): AlertCategoryGroup[] {
  // Category → (factKey → models[])
  const catMap = new Map<BrandFactCategory, Map<string, FactModelGroup[]>>();
  for (const g of alertGroups) {
    if (!catMap.has(g.fact_category)) catMap.set(g.fact_category, new Map());
    const factMap = catMap.get(g.fact_category)!;
    const factKey = g.fact_id ?? g.fact_claim;
    const arr = factMap.get(factKey) ?? [];
    arr.push(g);
    factMap.set(factKey, arr);
  }

  return ALERT_CATEGORIES
    .filter((cat) => catMap.has(cat))
    .map((cat) => {
      const factMap = catMap.get(cat)!;
      const facts: AlertFactGroup[] = Array.from(factMap.values()).map((models) => {
        const first = models[0];
        const totalHallucinations = models.reduce((sum, m) => sum + m.hallucinatedCount, 0);
        return {
          fact_id: first.fact_id,
          fact_claim: first.fact_claim,
          fact_is_true: first.fact_is_true,
          models: models.sort((a, b) => b.hallucinatedCount - a.hallucinatedCount),
          totalHallucinations,
        };
      }).sort((a, b) => b.totalHallucinations - a.totalHallucinations);

      return {
        category: cat,
        label: CATEGORY_LABELS[cat],
        facts,
        totalHallucinations: facts.reduce((sum, f) => sum + f.totalHallucinations, 0),
      };
    });
}

function buildFactModelGroups(scores: EnrichedScore[]): FactModelGroup[] {
  const groupMap = new Map<string, EnrichedScore[]>();
  for (const s of scores) {
    const key = `${s.fact_id ?? "none"}::${s.model}`;
    const arr = groupMap.get(key) ?? [];
    arr.push(s);
    groupMap.set(key, arr);
  }

  return Array.from(groupMap.entries()).map(([key, runs]) => {
    const first = runs[0];
    const correctCount = runs.filter((r) => r.accuracy === "correct").length;
    const hallucinatedRuns = runs.filter((r) => r.hallucination || r.bait_triggered);
    const hasHallucination = hallucinatedRuns.length > 0;

    // Most representative failure: prefer bait-triggered (clearest signal),
    // then any hallucination, then any incorrect result.
    const representativeRun =
      hallucinatedRuns.find((r) => r.bait_triggered) ??
      hallucinatedRuns[0] ??
      runs.find((r) => r.accuracy === "incorrect") ??
      runs[0];

    // All runs for a given fact_id share the same fact.is_true. If mixed, flag it —
    // bait failures and true-fact failures are different findings.
    const isMixedBait = new Set(runs.map((r) => r.fact_is_true)).size > 1;

    return {
      key,
      fact_id: first.fact_id,
      fact_claim: first.fact_claim,
      fact_category: first.fact_category,
      fact_is_true: first.fact_is_true,
      model: first.model,
      runs,
      total: runs.length,
      correctCount,
      hallucinatedCount: hallucinatedRuns.length,
      hasHallucination,
      representativeRun,
      isMixedBait,
      baitTriggeredCount: runs.filter((r) => r.bait_triggered).length,
    };
  });
}

function KnowledgeInner() {
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client");
  const [client, setClient] = useState<Client | null>(null);
  const [scores, setScores] = useState<EnrichedScore[]>([]);
  const [loading, setLoading] = useState(true);

  // Expand/collapse state for hallucination alert cards
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  // Expand/collapse state for grouped table rows
  const [expandedTableGroups, setExpandedTableGroups] = useState<Set<string>>(new Set());

  // Drill-down slide-over state
  const [drillDown, setDrillDown] = useState<{
    open: boolean;
    title: string;
    baseFilters: DrillDownFilters;
  }>({ open: false, title: "", baseFilters: {} });

  function toggleAlert(key: string) {
    setExpandedAlerts((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleTableGroup(key: string) {
    setExpandedTableGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  async function loadData() {
    const supabase = createClient();
    let q = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) q = q.eq("id", clientIdParam);
    const { data: clients } = await q
      .order("created_at", { ascending: false })
      .limit(1);

    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (activeClient) {
      const [{ data: rawScores }, { data: facts }, { data: runs }, { data: queries }] =
        await Promise.all([
          supabase
            .from("brand_knowledge_scores")
            .select("*")
            .eq("client_id", activeClient.id)
            .order("scored_at", { ascending: false })
            .limit(5000),
          supabase
            .from("brand_facts")
            .select("*")
            .eq("client_id", activeClient.id),
          supabase
            .from("tracking_runs")
            .select("id, query_id, model, raw_response")
            .eq("client_id", activeClient.id)
            .limit(10000),
          supabase
            .from("queries")
            .select("id, text")
            .eq("client_id", activeClient.id),
        ]);

      const factMap = new Map<string, BrandFact>();
      (facts ?? []).forEach((f: BrandFact) => factMap.set(f.id, f));

      type RunRow = { id: string; query_id: string; model: LLMModel; raw_response: string | null };
      const runMap = new Map<string, RunRow>();
      (runs ?? []).forEach((r: RunRow) => runMap.set(r.id, r));

      const queryTextMap = new Map<string, string>();
      (queries ?? []).forEach((q: { id: string; text: string }) => queryTextMap.set(q.id, q.text));

      const enriched: EnrichedScore[] = (rawScores ?? [])
        .map((s: BrandKnowledgeScore) => {
          const fact = s.fact_id ? factMap.get(s.fact_id) : null;
          const run = runMap.get(s.tracking_run_id);
          if (!fact || !run) return null;
          return {
            ...s,
            fact_claim: fact.claim,
            fact_category: fact.category,
            fact_is_true: fact.is_true,
            query_text: queryTextMap.get(run.query_id) ?? "",
            model: run.model,
            raw_response: run.raw_response,
          } satisfies EnrichedScore;
        })
        .filter(Boolean) as EnrichedScore[];

      setScores(enriched);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Brand Knowledge
        </h1>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg p-5 bg-white space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Brand Knowledge
        </h1>
        <p className="text-sm text-[#6B7280]">No active client.</p>
      </div>
    );
  }

  if (scores.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Brand Knowledge
        </h1>
        <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437]">No knowledge scores yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">
            Scores are generated automatically when validation queries run against LLMs.
            Trigger a tracking run from the Overview tab to populate this section.
          </p>
        </div>
      </div>
    );
  }

  // ── Metrics ────────────────────────────────────────────────────────────────
  const totalScored = scores.length;
  const correctCount = scores.filter((s) => s.accuracy === "correct").length;
  const accuracyRate = totalScored > 0 ? Math.round((correctCount / totalScored) * 100) : 0;

  // Grouped view: one group per fact × model
  const allGroups = buildFactModelGroups(scores);
  const alertGroups = allGroups
    .filter((g) => g.hasHallucination)
    .sort((a, b) => b.hallucinatedCount - a.hallucinatedCount || b.total - a.total);

  const categoryTree = buildCategoryTree(alertGroups);

  // Coverage by category
  const CATEGORIES: BrandFactCategory[] = ["feature", "market", "pricing", "messaging"];
  const categoryStats = CATEGORIES.map((cat) => {
    const catScores = scores.filter((s) => s.fact_category === cat);
    const catCorrect = catScores.filter((s) => s.accuracy === "correct").length;
    const rate = catScores.length > 0 ? Math.round((catCorrect / catScores.length) * 100) : null;
    return { cat, total: catScores.length, correct: catCorrect, rate };
  }).filter((c) => c.total > 0);

  // Model comparison
  const trackedModels = (client.selected_models ?? []) as LLMModel[];
  const modelStats = trackedModels.map((model) => {
    const modelScores = scores.filter((s) => s.model === model);
    const modelCorrect = modelScores.filter((s) => s.accuracy === "correct").length;
    const rate =
      modelScores.length > 0 ? Math.round((modelCorrect / modelScores.length) * 100) : null;
    return { model, total: modelScores.length, correct: modelCorrect, rate };
  }).filter((m) => m.total > 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-2">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
          Brand Knowledge
        </h1>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          How accurately LLMs represent {client.brand_name ?? client.url}&apos;s features, markets,
          pricing, and messaging
        </p>
      </div>

      {/* Top-line accuracy score */}
      <SubLabel>Knowledge Accuracy Score</SubLabel>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Overall Accuracy
          </p>
          <p className="text-[36px] font-bold text-[#0D0437] leading-none">{accuracyRate}%</p>
          <div className="mt-3 h-[5px] w-full bg-[#E2E8F0] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${accuracyRate}%`,
                backgroundColor:
                  accuracyRate >= 70 ? "#1A8F5C" : accuracyRate >= 40 ? "#F59E0B" : "#FF4B6E",
              }}
            />
          </div>
          <p className="text-[11px] text-[#6B7280] mt-2">
            {correctCount} of {totalScored} validation runs scored correctly
          </p>
        </div>

        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Hallucination Alerts
          </p>
          <p
            className="text-[36px] font-bold leading-none"
            style={{ color: alertGroups.length > 0 ? "#FF4B6E" : "#1A8F5C" }}
          >
            {alertGroups.length}
          </p>
          <p className="text-[11px] text-[#6B7280] mt-2">
            {alertGroups.length === 0
              ? "No hallucinations detected"
              : `${alertGroups.length} fact–model combination${alertGroups.length !== 1 ? "s" : ""} with hallucinations`}
          </p>
        </div>

        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Facts Tested
          </p>
          <p className="text-[36px] font-bold text-[#0D0437] leading-none">
            {new Set(scores.map((s) => s.fact_id)).size}
          </p>
          <p className="text-[11px] text-[#6B7280] mt-2">
            unique claims evaluated across {trackedModels.length} model
            {trackedModels.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Accuracy by category */}
      <SubLabel>Accuracy by Category</SubLabel>
      <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[#F4F6F9]">
              {["Category", "Tested", "Correct", "Accuracy", ""].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categoryStats.map(({ cat, total, correct, rate }) => (
              <tr
                key={cat}
                className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                onClick={() =>
                  setDrillDown({
                    open: true,
                    title: `${CATEGORY_LABELS[cat]} — All Models`,
                    baseFilters: { category: cat },
                  })
                }
              >
                <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">
                  {CATEGORY_LABELS[cat]}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{total}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#1A8F5C]">{correct}</td>
                <td className="px-4 py-3">
                  {rate !== null ? (
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded border ${rate >= 70
                          ? "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]"
                          : rate >= 40
                            ? "bg-[rgba(245,158,11,0.08)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]"
                            : "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]"
                        }`}
                    >
                      {rate}%
                    </span>
                  ) : (
                    <span className="text-[#9CA3AF] text-[11px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 w-32">
                  <div className="h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${rate ?? 0}%`,
                        backgroundColor:
                          (rate ?? 0) >= 70
                            ? "#1A8F5C"
                            : (rate ?? 0) >= 40
                              ? "#F59E0B"
                              : "#FF4B6E",
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Model comparison */}
      <SubLabel>Accuracy by Model</SubLabel>
      <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[#F4F6F9]">
              {["Model", "Runs Scored", "Correct", "Accuracy", ""].map((h) => (
                <th
                  key={h}
                  className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modelStats.map(({ model, total, correct, rate }) => (
              <tr
                key={model}
                className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                onClick={() =>
                  setDrillDown({
                    open: true,
                    title: `${MODEL_LABELS[model] ?? model} — All Categories`,
                    baseFilters: { model },
                  })
                }
              >
                <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">
                  {MODEL_LABELS[model] ?? model}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{total}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#1A8F5C]">{correct}</td>
                <td className="px-4 py-3">
                  {rate !== null ? (
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded border ${ACCURACY_STYLES[
                        rate >= 70 ? "correct" : rate >= 40 ? "uncertain" : "incorrect"
                        ]
                        }`}
                    >
                      {rate}%
                    </span>
                  ) : (
                    <span className="text-[#9CA3AF] text-[11px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 w-32">
                  <div className="h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${rate ?? 0}%`,
                        backgroundColor:
                          (rate ?? 0) >= 70
                            ? "#1A8F5C"
                            : (rate ?? 0) >= 40
                              ? "#F59E0B"
                              : "#FF4B6E",
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hallucination alerts — 3-level hierarchy: Category → Query → LLM → Variants */}
      {alertGroups.length > 0 && (
        <>
          <SubLabel>Hallucination Alerts</SubLabel>
          <div className="space-y-8 mb-6">
            {categoryTree.map((catGroup) => (
              <div key={catGroup.category}>
                {/* Category header row */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-[2.5px] text-[#0D0437]">
                    {catGroup.label}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                    {catGroup.totalHallucinations} hallucination{catGroup.totalHallucinations !== 1 ? "s" : ""}
                  </span>
                  <div className="flex-1 h-px bg-[#E2E8F0]" />
                </div>

                {/* Fact/Query cards */}
                <div className="space-y-3">
                  {catGroup.facts.map((factGroup) => (
                    <div
                      key={factGroup.fact_id ?? factGroup.fact_claim}
                      className="border border-[rgba(255,75,110,0.15)] rounded-lg overflow-hidden"
                    >
                      {/* Query (fact claim) header */}
                      <div className="px-4 py-3 bg-[rgba(255,75,110,0.03)] border-b border-[rgba(255,75,110,0.1)] flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-[#FF4B6E] shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-[#0D0437] leading-snug">
                            {factGroup.fact_claim}
                          </p>
                          {!factGroup.fact_is_true && (
                            <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                              Bait
                            </span>
                          )}
                        </div>
                      </div>

                      {/* LLM rows */}
                      <div className="divide-y divide-[#E2E8F0] bg-white">
                        {factGroup.models.map((group) => {
                          const isExpanded = expandedAlerts.has(group.key);
                          const modelAccRate = group.total > 0
                            ? Math.round((group.correctCount / group.total) * 100)
                            : 0;
                          const rep = group.representativeRun;

                          return (
                            <div key={group.key}>
                              {/* Mixed-bait data integrity warning */}
                              {group.isMixedBait && (
                                <div className="px-4 py-2 bg-[rgba(245,158,11,0.08)] border-b border-[rgba(245,158,11,0.2)]">
                                  <p className="text-[10px] font-bold text-[#F59E0B]">
                                    ⚠ Mixed bait/non-bait runs for this fact — failures are distinct findings.
                                  </p>
                                </div>
                              )}

                              {/* LLM row */}
                              <div className="px-4 py-3 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    {MODEL_LABELS[group.model] ?? group.model}
                                  </span>
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.12)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    Failed {group.hallucinatedCount} of {group.total} variant{group.total !== 1 ? "s" : ""}
                                  </span>
                                  <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${modelAccRate >= 70 ? ACCURACY_STYLES.correct : modelAccRate >= 40 ? ACCURACY_STYLES.uncertain : ACCURACY_STYLES.incorrect
                                    }`}>
                                    {modelAccRate}% accurate
                                  </span>
                                </div>
                                {rep.raw_response && (
                                  <div className="p-3 bg-[#F4F6F9] border border-[#E2E8F0] rounded text-[11px] text-[#6B7280] leading-relaxed line-clamp-3">
                                    {rep.raw_response.slice(0, 300)}
                                    {rep.raw_response.length > 300 && "…"}
                                  </div>
                                )}
                              </div>

                              {/* Expand toggle for query variants */}
                              {group.total > 1 && (
                                <button
                                  onClick={() => toggleAlert(group.key)}
                                  className="w-full flex items-center gap-1.5 px-4 py-2 border-t border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:bg-[#F4F6F9] transition-colors"
                                >
                                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                  {isExpanded ? "Hide" : "View"} query variants ({group.total})
                                </button>
                              )}

                              {/* Expanded query variants */}
                              {isExpanded && (
                                <div className="border-t border-[#E2E8F0] divide-y divide-[#E2E8F0] bg-[rgba(244,246,249,0.5)]">
                                  {group.runs.map((run) => (
                                    <div key={run.id} className="px-6 py-2.5 space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[run.accuracy] ?? ""}`}>
                                          {run.accuracy}
                                        </span>
                                        {run.hallucination && (
                                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                            hallucination
                                          </span>
                                        )}
                                        {run.bait_triggered && (
                                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                            bait triggered
                                          </span>
                                        )}
                                      </div>
                                      {run.query_text && (
                                        <p className="text-[11px] text-[#6B7280] italic">&ldquo;{run.query_text}&rdquo;</p>
                                      )}
                                      {run.notes && (
                                        <p className="text-[11px] text-[#9CA3AF]">{run.notes}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Drill-down slide-over — shared by both category and model table rows */}
      <DrillDownSlideOver
        open={drillDown.open}
        onClose={() => setDrillDown((prev) => ({ ...prev, open: false }))}
        title={drillDown.title}
        allRows={scores}
        baseFilters={drillDown.baseFilters}
        brandName={client.brand_name ?? client.url}
      />

      {/* All scored runs */}
      <SubLabel>All Scored Runs</SubLabel>

      <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-[#F4F6F9]">
                {["Claim", "Model", "Variants", "Accuracy", "Hallucinations", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allGroups
                .sort((a, b) => b.hallucinatedCount - a.hallucinatedCount)
                .map((group) => {
                  const rate =
                    group.total > 0
                      ? Math.round((group.correctCount / group.total) * 100)
                      : 0;
                  const isExpanded = expandedTableGroups.has(group.key);

                  return (
                    <React.Fragment key={group.key}>
                      <tr
                        className="border-b hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                        onClick={() => toggleTableGroup(group.key)}
                      >
                        <td className="px-4 py-3 max-w-[260px]">
                          <p className="text-[11px] text-[#1A1A2E] line-clamp-2 leading-snug">
                            {group.fact_claim}
                          </p>
                          <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                            {CATEGORY_LABELS[group.fact_category]}
                            {!group.fact_is_true && " · bait"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">
                            {MODEL_LABELS[group.model] ?? group.model}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">
                          {group.total}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${ACCURACY_STYLES[
                              rate >= 70 ? "correct" : rate >= 40 ? "uncertain" : "incorrect"
                              ]
                              }`}
                          >
                            {rate}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {group.hallucinatedCount > 0 ? (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                {group.hallucinatedCount}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9CA3AF]">—</span>
                            )}
                            {group.baitTriggeredCount > 0 && (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                Bait Alert
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#9CA3AF]">
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </td>
                      </tr>

                      {/* Expanded individual runs as child rows */}
                      {isExpanded &&
                        group.runs.map((run) => (
                          <tr
                            key={run.id}
                            className="border-b bg-[rgba(244,246,249,0.4)] last:border-0"
                          >
                            <td className="pl-8 pr-4 py-2 max-w-[260px]">
                              <p className="text-[10px] text-[#6B7280] italic line-clamp-2">
                                &ldquo;{run.query_text}&rdquo;
                              </p>
                            </td>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2">
                              <span
                                className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[run.accuracy] ?? ""
                                  }`}
                              >
                                {run.accuracy}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex gap-1">
                                {run.hallucination && (
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    hallucination
                                  </span>
                                )}
                                {run.bait_triggered && (
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                    bait
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2" />
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
            </tbody>
          </table>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense>
      <KnowledgeInner />
    </Suspense>
  );
}
