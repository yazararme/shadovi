"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, ArrowRight } from "lucide-react";
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

interface ModelEntry {
  model: LLMModel;
  runs: EnrichedScore[];
  total: number;
  correctCount: number;
  hallucinatedCount: number;
  baitTriggeredCount: number;
}

interface FactGroup {
  key: string;           // fact_id ?? fact_claim — stable row key
  fact_id: string | null;
  fact_claim: string;
  fact_category: BrandFactCategory;
  fact_is_true: boolean;
  models: ModelEntry[];
  totalRuns: number;
  totalCorrect: number;
  totalHallucinations: number;
  totalBaitTriggered: number;
  accuracyPct: number;   // pre-computed for sort
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

function buildFactGroups(scores: EnrichedScore[]): FactGroup[] {
  // Group by fact_id first, then by model within each fact
  const factMap = new Map<string, Map<LLMModel, EnrichedScore[]>>();
  const factMeta = new Map<string, Pick<EnrichedScore, "fact_claim" | "fact_category" | "fact_is_true" | "fact_id">>();

  for (const s of scores) {
    const fKey = s.fact_id ?? s.fact_claim;
    if (!factMap.has(fKey)) {
      factMap.set(fKey, new Map());
      factMeta.set(fKey, {
        fact_id: s.fact_id,
        fact_claim: s.fact_claim,
        fact_category: s.fact_category,
        fact_is_true: s.fact_is_true,
      });
    }
    const modelMap = factMap.get(fKey)!;
    const arr = modelMap.get(s.model) ?? [];
    arr.push(s);
    modelMap.set(s.model, arr);
  }

  return Array.from(factMap.entries()).map(([fKey, modelMap]) => {
    const meta = factMeta.get(fKey)!;
    const models: ModelEntry[] = Array.from(modelMap.entries()).map(([model, runs]) => ({
      model,
      runs,
      total: runs.length,
      correctCount: runs.filter((r) => r.accuracy === "correct").length,
      hallucinatedCount: runs.filter((r) => r.hallucination || r.bait_triggered).length,
      baitTriggeredCount: runs.filter((r) => r.bait_triggered).length,
    }));

    const totalRuns = models.reduce((s, m) => s + m.total, 0);
    const totalCorrect = models.reduce((s, m) => s + m.correctCount, 0);
    const totalHallucinations = models.reduce((s, m) => s + m.hallucinatedCount, 0);
    const totalBaitTriggered = models.reduce((s, m) => s + m.baitTriggeredCount, 0);

    return {
      key: fKey,
      ...meta,
      models,
      totalRuns,
      totalCorrect,
      totalHallucinations,
      totalBaitTriggered,
      accuracyPct: totalRuns > 0 ? totalCorrect / totalRuns : 1,
    };
  });
}

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
  const { activeClientId: clientIdParam, loading: contextLoading } = useClientContext();
  const [client, setClient] = useState<Client | null>(null);
  const [scores, setScores] = useState<EnrichedScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [expandedTableGroups, setExpandedTableGroups] = useState<Set<string>>(new Set());
  const [expandedFacts, setExpandedFacts] = useState<Set<string>>(new Set());
  const [expandedFactModels, setExpandedFactModels] = useState<Set<string>>(new Set());
  const [expandedRunResponses, setExpandedRunResponses] = useState<Set<string>>(new Set());
  const [catFilter, setCatFilter] = useState<BrandFactCategory[] | null>(null);  // null = show all
  const [modelFilter, setModelFilter] = useState<LLMModel[] | null>(null);       // null = show all
  const [tableHighlighted, setTableHighlighted] = useState(false);
  // Level 3→4 expand in Hallucination Alerts: keyed by run.id
  const [expandedAlertRuns, setExpandedAlertRuns] = useState<Set<string>>(new Set());
  // "Show full response" within Level 4: keyed by run.id
  const [expandedAlertFullResponses, setExpandedAlertFullResponses] = useState<Set<string>>(new Set());

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

  function toggleFact(key: string) {
    setExpandedFacts((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleFactModel(key: string) {
    setExpandedFactModels((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleRunResponse(id: string) {
    setExpandedRunResponses((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAlertRun(id: string) {
    setExpandedAlertRuns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAlertFullResponse(id: string) {
    setExpandedAlertFullResponses((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Filter helpers ─────────────────────────────────────────────────────────

  function updateCatFilter(cats: BrandFactCategory[] | null) {
    setCatFilter(cats);
    const params = new URLSearchParams(window.location.search);
    if (!cats) params.delete("category");
    else params.set("category", cats.join(","));
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  function updateModelFilter(models: LLMModel[] | null) {
    setModelFilter(models);
    const params = new URLSearchParams(window.location.search);
    if (!models) params.delete("model");
    else params.set("model", models.join(","));
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  function toggleCatPill(cat: BrandFactCategory, available: BrandFactCategory[]) {
    const current = catFilter ?? available;
    const isActive = current.includes(cat);
    if (isActive) {
      const next = current.filter((c) => c !== cat);
      // Deselecting the last pill → reset to all
      updateCatFilter(next.length === 0 || next.length === available.length ? null : next);
    } else {
      const next = [...current, cat];
      updateCatFilter(next.length === available.length ? null : next);
    }
  }

  function toggleModelPill(model: LLMModel, available: LLMModel[]) {
    const current = modelFilter ?? available;
    const isActive = current.includes(model);
    if (isActive) {
      const next = current.filter((m) => m !== model);
      updateModelFilter(next.length === 0 || next.length === available.length ? null : next);
    } else {
      const next = [...current, model];
      updateModelFilter(next.length === available.length ? null : next);
    }
  }

  useEffect(() => {
    // Read URL filter params and apply on load / client switch
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    const urlCats = params.get("category")?.split(",").filter(Boolean) as BrandFactCategory[] | undefined;
    const urlModels = params.get("model")?.split(",").filter(Boolean) as LLMModel[] | undefined;
    setCatFilter(urlCats?.length ? urlCats : null);
    setModelFilter(urlModels?.length ? urlModels : null);
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam, contextLoading]);

  async function loadData() {
    // Guard: wait for ClientContext to resolve — prevents fetching without a client filter
    if (!clientIdParam) return;
    const supabase = createClient();
    const { data: clients } = await supabase.from("clients").select("*").eq("status", "active")
      .eq("id", clientIdParam)
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
      if (activeVersionId && !activeClient.show_all_versions) scoresQ = scoresQ.or(`version_id.eq.${activeVersionId},version_id.is.null`);

      let runsQ = supabase
        .from("tracking_runs")
        .select("id, query_id, model, raw_response")
        .eq("client_id", activeClient.id)
        .limit(10000);
      if (activeVersionId && !activeClient.show_all_versions) runsQ = runsQ.or(`version_id.eq.${activeVersionId},version_id.is.null`);

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

  const factGroups = buildFactGroups(scores).sort((a, b) => {
    if (b.totalHallucinations !== a.totalHallucinations)
      return b.totalHallucinations - a.totalHallucinations;
    return a.accuracyPct - b.accuracyPct; // worst accuracy first
  });

  // Available filter options — derived from actual data in factGroups
  const availableCategories = Array.from(
    new Set(
      factGroups
        .map((fg) => fg.fact_category)
        .filter((c): c is BrandFactCategory => !!c && c in CATEGORY_LABELS)
    )
  );

  const availableModels = Array.from(
    new Set(factGroups.flatMap((fg) => fg.models.map((m) => m.model)))
  ) as LLMModel[];

  // Apply active filters to factGroups for the table
  const visibleFactGroups = factGroups.filter((fg) => {
    const catOk = catFilter === null || catFilter.includes(fg.fact_category);
    const modelOk = modelFilter === null || fg.models.some((me) => modelFilter.includes(me.model));
    return catOk && modelOk;
  });

  // Category / model stats derived from mainScores only
  const CATEGORIES: BrandFactCategory[] = ["feature", "market", "pricing", "messaging"];
  const categoryStats = CATEGORIES.map((cat) => {
    const catScores = mainScores.filter((s) => s.fact_category === cat);
    const catCorrect = catScores.filter((s) => s.accuracy === "correct").length;
    const rate = catScores.length > 0 ? Math.round((catCorrect / catScores.length) * 100) : null;
    return { cat, total: catScores.length, correct: catCorrect, rate };
  }).filter((c) => c.total > 0);

  // Derive from score data — show every model ever tracked
  const trackedModels = Array.from(new Set(scores.map((s) => s.model as LLMModel)));
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
              <tr
                key={cat}
                className="border-b last:border-0 cursor-pointer hover:bg-[rgba(244,246,249,0.7)] transition-colors"
                onClick={() => {
                  updateCatFilter([cat]);
                  document.getElementById("all-scored-runs")?.scrollIntoView({ behavior: "smooth" });
                  setTableHighlighted(true);
                  setTimeout(() => setTableHighlighted(false), 1200);
                }}
              >
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
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${rate ?? 0}%`,
                          backgroundColor: accuracyColor(rate ?? 0),
                        }}
                      />
                    </div>
                    <ArrowRight className="h-3 w-3 text-[#9CA3AF] shrink-0" />
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

      {/* Hallucination Alerts — 4-level: Category → Claim → Model → Query → Response */}
      {alertGroups.length > 0 && (
        <>
          <div id="bvi-alerts" />
          <SubLabel>Hallucination Alerts</SubLabel>
          <div className="space-y-8 mb-6">
            {categoryTree.map((catGroup) => (
              <div key={catGroup.category}>
                {/* Category header — unchanged */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-[2.5px] text-[#0D0437]">
                    {catGroup.label}
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                    {catGroup.totalHallucinations} hallucination{catGroup.totalHallucinations !== 1 ? "s" : ""}
                  </span>
                  <div className="flex-1 h-px bg-[#E2E8F0]" />
                </div>

                {/* Level 1: Claim cards */}
                <div className="space-y-3">
                  {catGroup.facts.map((factGroup) => (
                    <div
                      key={factGroup.fact_id ?? factGroup.fact_claim}
                      className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white"
                      style={{ borderLeft: "3px solid #0D0437" }}
                    >
                      {/* Claim header */}
                      <div className="px-4 py-3">
                        <p className="text-[13px] font-bold text-[#0D0437] leading-snug">
                          {factGroup.fact_claim}
                        </p>
                        {/* fact_is_true=false means this is a deliberately false claim used as bait */}
                        {!factGroup.fact_is_true && (
                          <span className="inline-block mt-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                            FALSE CLAIM
                          </span>
                        )}
                        <p className="text-[11px] text-[#9CA3AF] mt-1.5">
                          {factGroup.models.length} model{factGroup.models.length !== 1 ? "s" : ""} tested
                          {" · "}
                          {factGroup.totalHallucinations} hallucination{factGroup.totalHallucinations !== 1 ? "s" : ""}
                        </p>
                      </div>

                      {/* Level 2: Model rows — attached directly below claim header */}
                      <div className="border-t border-[#E2E8F0] divide-y divide-[#E2E8F0]">
                        {factGroup.models.map((group, idx) => {
                          const isLast = idx === factGroup.models.length - 1;
                          const isExpanded = expandedAlerts.has(group.key);
                          const modelAccRate =
                            group.total > 0
                              ? Math.round((group.correctCount / group.total) * 100)
                              : 0;

                          return (
                            <div key={group.key}>
                              {group.isMixedBait && (
                                <div className="pl-4 pr-4 py-2 bg-[rgba(245,158,11,0.08)] border-b border-[rgba(245,158,11,0.2)]">
                                  <p className="text-[10px] font-bold text-[#F59E0B]">
                                    Mixed bait/non-bait runs detected — failures represent distinct findings.
                                  </p>
                                </div>
                              )}

                              {/* Model row with left-rail connector */}
                              <div
                                className="relative flex items-center gap-3 pl-4 pr-4 py-2.5 bg-[#F8F9FB] cursor-pointer hover:bg-[#f1f2f6] transition-colors"
                                onClick={() => toggleAlert(group.key)}
                              >
                                {/* Vertical rail: full height for non-last rows, top-half only for last */}
                                <div
                                  className={`absolute left-2 top-0 w-px bg-[#E2E8F0] ${isLast ? "h-1/2" : "h-full"}`}
                                />
                                {/* Horizontal tick: 8px, at vertical midpoint */}
                                <div className="absolute left-2 top-1/2 w-2 h-px bg-[#E2E8F0] -translate-y-px" />

                                {/* Content — pl-4 puts it past the tick */}
                                <div className="flex items-center gap-2 flex-1 flex-wrap">
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#EDEFF2] text-[#6B7280] border border-[#E2E8F0]">
                                    {MODEL_LABELS[group.model] ?? group.model}
                                  </span>
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    {group.hallucinatedCount} of {group.total} failed
                                  </span>
                                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${accuracyBadgeClass(modelAccRate)}`}>
                                    {modelAccRate}%
                                  </span>
                                </div>
                                <div className="flex-shrink-0 text-[#9CA3AF]">
                                  {isExpanded
                                    ? <ChevronUp className="h-3.5 w-3.5" />
                                    : <ChevronDown className="h-3.5 w-3.5" />}
                                </div>
                              </div>

                              {/* Level 3: Query variants */}
                              {isExpanded && (
                                <div className="divide-y divide-[#ECEEF2] bg-white">
                                  {group.runs.map((run, runIdx) => {
                                    const isRunLast = runIdx === group.runs.length - 1;
                                    const isRunExpanded = expandedAlertRuns.has(run.id);
                                    const isFullShown = expandedAlertFullResponses.has(run.id);

                                    return (
                                      <div key={run.id}>
                                        {/* Query variant row with Level 3 connector */}
                                        <div
                                          className={`relative flex items-start gap-3 pl-8 pr-4 py-2 transition-colors ${run.raw_response ? "cursor-pointer hover:bg-[#FAFAFA]" : ""}`}
                                          onClick={() => { if (run.raw_response) toggleAlertRun(run.id); }}
                                        >
                                          {/* Level 3 vertical rail at x=24 (16px Level-2 zone + 8px offset) */}
                                          <div
                                            className={`absolute top-0 w-px bg-[#ECEEF2] ${isRunLast ? "h-1/2" : "h-full"}`}
                                            style={{ left: "24px" }}
                                          />
                                          {/* Horizontal tick */}
                                          <div
                                            className="absolute h-px bg-[#ECEEF2]"
                                            style={{ left: "24px", width: "8px", top: "50%" }}
                                          />

                                          {/* Run content — starts after pl-8 = 32px */}
                                          <div className="flex-1 min-w-0 space-y-0.5">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[run.accuracy] ?? ""}`}>
                                                {run.accuracy}
                                              </span>
                                              {run.hallucination && !run.bait_triggered && (
                                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                                  hallucination
                                                </span>
                                              )}
                                              {/* bait_triggered = LLM confirmed a false claim */}
                                              {run.bait_triggered && (
                                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                                  FALSE CLAIM CONFIRMED
                                                </span>
                                              )}
                                            </div>
                                            {run.query_text && (
                                              <p className="text-[11px] text-[#6B7280] italic leading-snug">
                                                &ldquo;{run.query_text}&rdquo;
                                              </p>
                                            )}
                                          </div>

                                          {/* Expand chevron for response — only shown when raw_response exists */}
                                          {run.raw_response && (
                                            <div className="flex-shrink-0 mt-0.5 text-[#9CA3AF]">
                                              {isRunExpanded
                                                ? <ChevronUp className="h-3 w-3" />
                                                : <ChevronDown className="h-3 w-3" />}
                                            </div>
                                          )}
                                        </div>

                                        {/* Level 4: Response text — leaf node, no connector */}
                                        {isRunExpanded && run.raw_response && (() => {
                                          const lines = run.raw_response.split("\n");
                                          const isTruncated = lines.length > 5;
                                          const displayed = isTruncated && !isFullShown
                                            ? lines.slice(0, 5).join("\n")
                                            : run.raw_response;
                                          return (
                                            <div className="pl-12 pr-4 pb-2.5 space-y-1">
                                              <pre className="text-[10px] text-[#6B7280] leading-relaxed whitespace-pre-wrap font-sans bg-[#F4F6F9] border border-[#E2E8F0] rounded p-2">
                                                {displayed}
                                                {isTruncated && !isFullShown && "…"}
                                              </pre>
                                              {isTruncated && (
                                                <button
                                                  type="button"
                                                  onClick={(e) => { e.stopPropagation(); toggleAlertFullResponse(run.id); }}
                                                  className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors"
                                                >
                                                  {isFullShown ? "↑ Show less" : "Show full response →"}
                                                </button>
                                              )}
                                              {run.notes && (
                                                <p className="text-[10px] text-[#9CA3AF]">{run.notes}</p>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    );
                                  })}
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

      {/* All Scored Runs — Level 1: fact, Level 2: model, Level 3: individual runs */}
      <div id="all-scored-runs" className="scroll-mt-6">
        <SubLabel>All Scored Runs</SubLabel>
      </div>

      {/* Filter pills */}
      {(availableCategories.length > 1 || availableModels.length > 1) && (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          {availableCategories.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">Category</span>
              {availableCategories.map((cat) => {
                const isActive = catFilter === null || catFilter.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCatPill(cat, availableCategories)}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                      isActive
                        ? "bg-[#0D0437] text-white border-[#0D0437]"
                        : "bg-white text-[#9CA3AF] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                    }`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          )}
          {availableModels.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">Model</span>
              {availableModels.map((model) => {
                const isActive = modelFilter === null || modelFilter.includes(model);
                return (
                  <button
                    key={model}
                    type="button"
                    onClick={() => toggleModelPill(model, availableModels)}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                      isActive
                        ? "bg-[#0D0437] text-white border-[#0D0437]"
                        : "bg-white text-[#9CA3AF] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                    }`}
                  >
                    {MODEL_LABELS[model] ?? model}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className={`border rounded-lg overflow-x-auto bg-white transition-all duration-300 ${tableHighlighted ? "border-[#0D0437] ring-2 ring-[#0D0437] ring-offset-2" : "border-[#E2E8F0]"}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[#F4F6F9]">
              {["Claim", "Models", "Total Runs", "Accuracy", "Hallucinations", ""].map((h) => (
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
            {visibleFactGroups.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[12px] text-[#9CA3AF]">
                  No results match the current filters.
                </td>
              </tr>
            )}
            {visibleFactGroups.map((fg) => {
              const factExpanded = expandedFacts.has(fg.key);
              const rate = Math.round(fg.accuracyPct * 100);

              return (
                <React.Fragment key={fg.key}>
                  {/* ── Level 1: Fact row ─────────────────────────── */}
                  <tr
                    className="border-b hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                    onClick={() => toggleFact(fg.key)}
                  >
                    <td className="px-4 py-3 max-w-[260px]">
                      <p className="text-[11px] text-[#1A1A2E] line-clamp-2 leading-snug">{fg.fact_claim}</p>
                      <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                        {CATEGORY_LABELS[fg.fact_category]}
                        {!fg.fact_is_true && " · false claim"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{fg.models.length}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{fg.totalRuns}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${accuracyBadgeClass(rate)}`}>
                        {rate}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        {fg.totalHallucinations > 0 ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                            {fg.totalHallucinations}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#9CA3AF]">—</span>
                        )}
                        {fg.totalBaitTriggered > 0 && (
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                            Bait Alert
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#9CA3AF]">
                      {factExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </td>
                  </tr>

                  {/* ── Level 2: Model sub-rows ───────────────────── */}
                  {factExpanded && (modelFilter === null ? fg.models : fg.models.filter((me) => modelFilter.includes(me.model))).map((me) => {
                    const mKey = `${fg.key}::${me.model}`;
                    const modelExpanded = expandedFactModels.has(mKey);
                    const mRate = me.total > 0 ? Math.round((me.correctCount / me.total) * 100) : 0;

                    return (
                      <React.Fragment key={mKey}>
                        <tr
                          className="border-b bg-[rgba(244,246,249,0.4)] hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                          onClick={() => toggleFactModel(mKey)}
                        >
                          <td className="pl-8 pr-4 py-2 max-w-[260px]">
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">
                              {MODEL_LABELS[me.model] ?? me.model}
                            </span>
                          </td>
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2 font-mono text-[11px] text-[#6B7280]">{me.total}</td>
                          <td className="px-4 py-2">
                            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${accuracyBadgeClass(mRate)}`}>
                              {mRate}%
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {me.hallucinatedCount > 0 ? (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                {me.hallucinatedCount}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9CA3AF]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-[#9CA3AF]">
                            {modelExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </td>
                        </tr>

                        {/* ── Level 3: Individual run rows ─────────── */}
                        {modelExpanded && me.runs.map((run) => {
                          const responseExpanded = expandedRunResponses.has(run.id);
                          const responseLines = run.raw_response?.split("\n") ?? [];
                          const isTruncated = responseLines.length > 6;
                          const displayedResponse = isTruncated && !responseExpanded
                            ? responseLines.slice(0, 6).join("\n")
                            : run.raw_response ?? "";

                          return (
                            <tr key={run.id} className="border-b bg-[rgba(244,246,249,0.2)] last:border-0">
                              <td colSpan={5} className="pl-12 pr-4 py-2.5 space-y-1.5">
                                {/* Query text */}
                                {run.query_text && (
                                  <p className="text-[10px] text-[#6B7280] italic">
                                    &ldquo;{run.query_text}&rdquo;
                                  </p>
                                )}
                                {/* Accuracy + hallucination badges */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[run.accuracy] ?? ""}`}>
                                    {run.accuracy}
                                  </span>
                                  {run.hallucination && !run.bait_triggered && (
                                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                      hallucination
                                    </span>
                                  )}
                                  {run.bait_triggered && (
                                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                      FALSE CLAIM CONFIRMED
                                    </span>
                                  )}
                                </div>
                                {/* raw_response — capped at 6 lines */}
                                {displayedResponse && (
                                  <div className="space-y-0.5">
                                    <pre className="text-[10px] text-[#6B7280] leading-relaxed whitespace-pre-wrap font-sans bg-[#F4F6F9] border border-[#E2E8F0] rounded p-2">
                                      {displayedResponse}
                                      {isTruncated && !responseExpanded && "…"}
                                    </pre>
                                    {isTruncated && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); toggleRunResponse(run.id); }}
                                        className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors"
                                      >
                                        {responseExpanded ? "↑ Show less" : "Show full response →"}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {/* Notes */}
                                {run.notes && (
                                  <p className="text-[10px] text-[#9CA3AF]">{run.notes}</p>
                                )}
                              </td>
                              <td className="px-4 py-2" />
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
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
