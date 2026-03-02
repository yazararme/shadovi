"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import type {
  Client,
  LLMModel,
  BrandFact,
  BrandKnowledgeScore,
  BrandFactCategory,
} from "@/types";
import { computeBVI, bviColor } from "@/lib/bvi/compute-bvi";

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
  isMixedBait: boolean;
  baitTriggeredCount: number;
}

interface AlertFactGroup {
  fact_id: string | null;
  fact_claim: string;
  fact_is_true: boolean;
  models: FactModelGroup[];
  totalHallucinations: number;
}

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

// Thresholds: ≥80% green, 50–79% amber, <50% red
function accuracyColor(rate: number): string {
  if (rate >= 80) return "#1A8F5C";
  if (rate >= 50) return "#F59E0B";
  return "#FF4B6E";
}

function accuracyBadgeClass(rate: number): string {
  if (rate >= 80)
    return "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]";
  if (rate >= 50)
    return "bg-[rgba(245,158,11,0.08)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]";
  return "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]";
}

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

    // If a fact has mixed bait/non-bait runs, flag it — the two failure modes
    // tell different stories and should not be silently merged.
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

function BrandKnowledgeInner() {
  const { activeClientId: clientIdParam } = useClientContext();
  const [client, setClient] = useState<Client | null>(null);
  const [scores, setScores] = useState<EnrichedScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [expandedTableGroups, setExpandedTableGroups] = useState<Set<string>>(new Set());

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
      // Fetch active version first (lightweight) so we can scope queries to the
      // current portfolio snapshot. Null = pre-versioning client, show all data.
      const { data: versionRow } = await supabase
        .from("portfolio_versions")
        .select("id")
        .eq("client_id", activeClient.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      const activeVersionId = (versionRow as { id?: string } | null)?.id ?? null;

      // Build queries conditionally — version filter applied when version exists
      let scoresQ = supabase
        .from("brand_knowledge_scores")
        .select("*")
        .eq("client_id", activeClient.id)
        .order("scored_at", { ascending: false })
        .limit(5000);
      if (activeVersionId) scoresQ = scoresQ.eq("version_id", activeVersionId);

      let runsQ = supabase
        .from("tracking_runs")
        .select("id, query_id, model, raw_response")
        .eq("client_id", activeClient.id)
        .limit(10000);
      if (activeVersionId) runsQ = runsQ.eq("version_id", activeVersionId);

      const [{ data: rawScores }, { data: facts }, { data: runs }, { data: queries }] =
        await Promise.all([
          scoresQ,
          supabase
            .from("brand_facts")
            .select("*")
            .eq("client_id", activeClient.id),
          runsQ,
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
      <div className="p-8 max-w-[1000px] mx-auto space-y-6">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Brand Knowledge</h1>
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
      <div className="p-8 max-w-[1000px] mx-auto space-y-4">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Brand Knowledge</h1>
        <p className="text-sm text-[#6B7280]">No active client.</p>
      </div>
    );
  }

  if (scores.length === 0) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-4">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Brand Knowledge</h1>
        <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437]">No knowledge scores yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">
            Scores are generated when validation queries run against LLMs.
            Trigger a tracking run from Overview to populate this section.
          </p>
        </div>
      </div>
    );
  }

  // ── Metrics ─────────────────────────────────────────────────────────────────
  // Exclude bait_triggered rows from the main accuracy calculation — false-claim
  // confirmations are surfaced separately in Hallucination Alerts so they don't
  // inflate the failure rate alongside honest model errors.
  const mainScores = scores.filter((s) => !s.bait_triggered);
  const mainTotal = mainScores.length;
  const mainCorrect = mainScores.filter((s) => s.accuracy === "correct").length;
  const accuracyRate = mainTotal > 0 ? Math.round((mainCorrect / mainTotal) * 100) : 0;

  const allGroups = buildFactModelGroups(scores);
  const alertGroups = allGroups
    .filter((g) => g.hasHallucination)
    .sort((a, b) => b.hallucinatedCount - a.hallucinatedCount || b.total - a.total);

  const categoryTree = buildCategoryTree(alertGroups);

  // Category / model stats derived from mainScores only
  const CATEGORIES: BrandFactCategory[] = ["feature", "market", "pricing", "messaging"];
  const categoryStats = CATEGORIES.map((cat) => {
    const catScores = mainScores.filter((s) => s.fact_category === cat);
    const catCorrect = catScores.filter((s) => s.accuracy === "correct").length;
    const rate = catScores.length > 0 ? Math.round((catCorrect / catScores.length) * 100) : null;
    return { cat, total: catScores.length, correct: catCorrect, rate };
  }).filter((c) => c.total > 0);

  const trackedModels = (client.selected_models ?? []) as LLMModel[];
  const modelStats = trackedModels.map((model) => {
    const modelScores = mainScores.filter((s) => s.model === model);
    const modelCorrect = modelScores.filter((s) => s.accuracy === "correct").length;
    const rate = modelScores.length > 0 ? Math.round((modelCorrect / modelScores.length) * 100) : null;
    return { model, total: modelScores.length, correct: modelCorrect, rate };
  }).filter((m) => m.total > 0);

  // BVI computation — uses enriched scores (fact_is_true, bait_triggered, model all present)
  const bviResult = computeBVI(
    scores.map((s) => ({
      fact_id: s.fact_id,
      fact_is_true: s.fact_is_true,
      fact_claim: s.fact_claim,
      bait_triggered: s.bait_triggered,
      model: s.model,
    })),
    trackedModels
  );

  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? client.url;

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight leading-tight">
          Brand Knowledge
        </h1>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          Are AI models hallucinating false pricing, outdated policies, or damaging narratives about {brandName}?
        </p>
      </div>

      {/* Knowledge Accuracy Score */}
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
              style={{ width: `${accuracyRate}%`, backgroundColor: accuracyColor(accuracyRate) }}
            />
          </div>
          <p className="text-[11px] text-[#6B7280] mt-2">
            {mainCorrect} of {mainTotal} validation runs scored correctly
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

      {/* Brand Vulnerability Index panel */}
      <SubLabel>Brand Vulnerability Index</SubLabel>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">

        {/* Composite BVI Score */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">BVI Score</p>
          {bviResult.composite !== null ? (
            <>
              <p className="text-[36px] font-bold leading-none" style={{ color: bviColor(bviResult.composite) }}>
                {bviResult.composite}
              </p>
              <div className="mt-3 h-[5px] w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${bviResult.composite}%`, backgroundColor: bviColor(bviResult.composite) }}
                />
              </div>
            </>
          ) : (
            <p className="text-[36px] font-bold text-[#9CA3AF] leading-none">—</p>
          )}
          <p className="text-[11px] text-[#6B7280] mt-2">
            Lower is better — measures how easily LLMs confirm false claims about your brand
          </p>
          <button
            onClick={() => document.getElementById("bvi-alerts")?.scrollIntoView({ behavior: "smooth" })}
            className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-2 transition-colors w-fit"
          >
            View details →
          </button>
        </div>

        {/* Frequency */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Bait Trigger Rate</p>
          {bviResult.frequency !== null ? (
            <>
              <p className="text-[36px] font-bold leading-none" style={{ color: bviColor(bviResult.frequency) }}>
                {bviResult.frequency}%
              </p>
              <div className="mt-3 h-[5px] w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${bviResult.frequency}%`, backgroundColor: bviColor(bviResult.frequency) }}
                />
              </div>
            </>
          ) : (
            <p className="text-[36px] font-bold text-[#9CA3AF] leading-none">—</p>
          )}
          <p className="text-[11px] text-[#6B7280] mt-2">
            {bviResult.baitRunsTotal > 0
              ? `${bviResult.baitTriggeredCount} of ${bviResult.baitRunsTotal} bait queries triggered a hallucination`
              : "No bait queries found"}
          </p>
        </div>

        {/* Replication */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Cross-Model Spread</p>
          {bviResult.replication !== null ? (
            <>
              <p className="text-[36px] font-bold leading-none" style={{ color: bviColor(bviResult.replication) }}>
                {bviResult.replication}%
              </p>
              <div className="mt-3 h-[5px] w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${bviResult.replication}%`, backgroundColor: bviColor(bviResult.replication) }}
                />
              </div>
            </>
          ) : (
            <p className="text-[36px] font-bold text-[#9CA3AF] leading-none">—</p>
          )}
          <p className="text-[11px] text-[#6B7280] mt-2">
            Average % of models that confirm the same false claim
          </p>
        </div>

        {/* Severity — future, greyed out */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white opacity-50">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Severity</p>
          <p className="text-[36px] font-bold text-[#9CA3AF] leading-none">—</p>
          <p className="text-[11px] text-[#6B7280] mt-2">Configure fact severity ratings to enable</p>
        </div>

        {/* Persistence — future, greyed out */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white opacity-50">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Persistence</p>
          <p className="text-[36px] font-bold text-[#9CA3AF] leading-none">—</p>
          <p className="text-[11px] text-[#6B7280] mt-2">Available after 30 days of tracking</p>
        </div>

      </div>

      {/* Accuracy by Category */}
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
              <tr key={cat} className="border-b last:border-0">
                <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">
                  {CATEGORY_LABELS[cat]}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{total}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#1A8F5C]">{correct}</td>
                <td className="px-4 py-3">
                  {rate !== null ? (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${accuracyBadgeClass(rate)}`}>
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
                        backgroundColor: accuracyColor(rate ?? 0),
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Accuracy by Model */}
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
              <tr key={model} className="border-b last:border-0">
                <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">
                  {MODEL_LABELS[model] ?? model}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{total}</td>
                <td className="px-4 py-3 font-mono text-[12px] text-[#1A8F5C]">{correct}</td>
                <td className="px-4 py-3">
                  {rate !== null ? (
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${accuracyBadgeClass(rate)}`}>
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
                        backgroundColor: accuracyColor(rate ?? 0),
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* BVI by model */}
      <SubLabel>Vulnerability by Model</SubLabel>
      <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-[#F4F6F9]">
              {["Model", "Bait Runs", "Triggered", "Trigger Rate", "Unique Facts Triggered"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trackedModels.filter((model) => (bviResult.perModel[model]?.baitRuns ?? 0) > 0).map((model) => {
              const stats = bviResult.perModel[model];
              return (
                <tr key={model} className="border-b last:border-0">
                  <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">{MODEL_LABELS[model] ?? model}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{stats.baitRuns}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#FF4B6E]">{stats.triggered}</td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[11px] font-bold px-2 py-0.5 rounded border"
                      style={{
                        color: bviColor(stats.triggerRate),
                        backgroundColor: `${bviColor(stats.triggerRate)}18`,
                        borderColor: `${bviColor(stats.triggerRate)}33`,
                      }}
                    >
                      {stats.triggerRate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">
                    {stats.uniqueFactsTriggered} of {stats.totalBaitFacts}
                  </td>
                </tr>
              );
            })}
            {trackedModels.every((m) => (bviResult.perModel[m]?.baitRuns ?? 0) === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-[12px] text-[#9CA3AF]">
                  No bait query data yet — add false claim tests in Brand Facts to enable
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Hallucination Alerts — 3-level: Category → Fact → LLM → Variants */}
      {alertGroups.length > 0 && (
        <>
          <div id="bvi-alerts" />
          <SubLabel>Hallucination Alerts</SubLabel>
          <div className="space-y-8 mb-6">
            {categoryTree.map((catGroup) => (
              <div key={catGroup.category}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-[2.5px] text-[#0D0437]">
                    {catGroup.label}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                    {catGroup.totalHallucinations} hallucination{catGroup.totalHallucinations !== 1 ? "s" : ""}
                  </span>
                  <div className="flex-1 h-px bg-[#E2E8F0]" />
                </div>

                {/* Fact/claim cards */}
                <div className="space-y-3">
                  {catGroup.facts.map((factGroup) => (
                    <div
                      key={factGroup.fact_id ?? factGroup.fact_claim}
                      className="border border-[rgba(255,75,110,0.15)] rounded-lg overflow-hidden"
                    >
                      {/* Claim header */}
                      <div className="px-4 py-3 bg-[rgba(255,75,110,0.03)] border-b border-[rgba(255,75,110,0.1)] flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-[#FF4B6E] shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-bold text-[#0D0437] leading-snug">
                            {factGroup.fact_claim}
                          </p>
                          {/* fact_is_true=false means this is a deliberately false claim used as bait */}
                          {!factGroup.fact_is_true && (
                            <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                              FALSE CLAIM
                            </span>
                          )}
                        </div>
                      </div>

                      {/* LLM rows */}
                      <div className="divide-y divide-[#E2E8F0] bg-white">
                        {factGroup.models.map((group) => {
                          const isExpanded = expandedAlerts.has(group.key);
                          const modelAccRate =
                            group.total > 0
                              ? Math.round((group.correctCount / group.total) * 100)
                              : 0;
                          const rep = group.representativeRun;

                          return (
                            <div key={group.key}>
                              {group.isMixedBait && (
                                <div className="px-4 py-2 bg-[rgba(245,158,11,0.08)] border-b border-[rgba(245,158,11,0.2)]">
                                  <p className="text-[10px] font-bold text-[#F59E0B]">
                                    Mixed bait/non-bait runs detected — failures represent distinct findings.
                                  </p>
                                </div>
                              )}

                              <div className="px-4 py-3 space-y-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    {MODEL_LABELS[group.model] ?? group.model}
                                  </span>
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.12)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    Failed {group.hallucinatedCount} of {group.total} variant{group.total !== 1 ? "s" : ""}
                                  </span>
                                  <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${accuracyBadgeClass(modelAccRate)}`}>
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

                              {/* Expand toggle */}
                              <button
                                onClick={() => toggleAlert(group.key)}
                                className="w-full flex items-center gap-1.5 px-4 py-2 border-t border-[#E2E8F0] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:bg-[#F4F6F9] transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                                {isExpanded ? "Hide" : "View"} query variants ({group.total})
                              </button>

                              {/* Expanded query variants */}
                              {isExpanded && (
                                <div className="border-t border-[#E2E8F0] bg-[rgba(244,246,249,0.5)]">
                                  <div className="divide-y divide-[#E2E8F0]">
                                    {group.runs.map((run) => (
                                      <div key={run.id} className="px-6 py-2.5 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span
                                            className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[run.accuracy] ?? ""}`}
                                          >
                                            {run.accuracy}
                                          </span>
                                          {run.hallucination && !run.bait_triggered && (
                                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                              hallucination
                                            </span>
                                          )}
                                          {/* bait_triggered = LLM confirmed a false claim — clearer label than "bait triggered" */}
                                          {run.bait_triggered && (
                                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.12)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                              FALSE CLAIM CONFIRMED
                                            </span>
                                          )}
                                        </div>
                                        {run.query_text && (
                                          <p className="text-[11px] text-[#6B7280] italic">
                                            &ldquo;{run.query_text}&rdquo;
                                          </p>
                                        )}
                                        {run.notes && (
                                          <p className="text-[11px] text-[#9CA3AF]">{run.notes}</p>
                                        )}
                                      </div>
                                    ))}
                                  </div>

                                  {/* Source intelligence deep-link — connects claim failures to source data */}
                                  {group.fact_id && (
                                    <div className="px-6 py-3 flex justify-end border-t border-[#E2E8F0]">
                                      <Link
                                        href={`/dashboard/source-intelligence?claim_fact_id=${group.fact_id}`}
                                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#7B5EA7] hover:text-[#6D28D9] transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        Sources cited in queries testing this claim
                                        <ArrowRight className="h-3 w-3" />
                                      </Link>
                                    </div>
                                  )}
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

      {/* All Scored Runs — sorted by hallucinations DESC, then accuracy ASC */}
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
              .sort((a, b) => {
                if (b.hallucinatedCount !== a.hallucinatedCount)
                  return b.hallucinatedCount - a.hallucinatedCount;
                // Secondary: accuracy ascending (worst accuracy first)
                const aRate = a.total > 0 ? a.correctCount / a.total : 1;
                const bRate = b.total > 0 ? b.correctCount / b.total : 1;
                return aRate - bRate;
              })
              .map((group) => {
                const rate =
                  group.total > 0 ? Math.round((group.correctCount / group.total) * 100) : 0;
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
                          {!group.fact_is_true && " · false claim"}
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
                          className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${accuracyBadgeClass(rate)}`}
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

                    {/* Expanded individual run rows */}
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
                              className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[run.accuracy] ?? ""}`}
                            >
                              {run.accuracy}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1 flex-wrap">
                              {run.hallucination && !run.bait_triggered && (
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                  hallucination
                                </span>
                              )}
                              {run.bait_triggered && (
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                  FALSE CLAIM
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

export default function BrandKnowledgePage() {
  return (
    <Suspense>
      <BrandKnowledgeInner />
    </Suspense>
  );
}
