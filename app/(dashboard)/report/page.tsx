"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { ModelIntentHeatmap, type HeatmapRow } from "@/components/dashboard/ModelIntentHeatmap";
import { InsightMetric } from "@/components/dashboard/InsightMetric";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import type {
  Client, TrackingRun, Competitor, Recommendation, LLMModel, QueryIntent,
  RecommendationType, BrandKnowledgeScore, BrandFact, BrandFactCategory, GapCluster,
} from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

const MODEL_COLORS: Record<LLMModel, string> = {
  "gpt-4o": "#10a37f",
  "claude-sonnet-4-6": "#d4a27e",
  perplexity: "#1fb6ff",
  gemini: "#4285f4",
  deepseek: "#6366f1",
};

const MODEL_BADGE: Record<LLMModel, string> = {
  "gpt-4o": "bg-[rgba(16,163,127,0.08)] text-[#10a37f] border-[rgba(16,163,127,0.2)]",
  "claude-sonnet-4-6": "bg-[rgba(212,162,126,0.08)] text-[#b5804a] border-[rgba(212,162,126,0.2)]",
  perplexity: "bg-[rgba(31,182,255,0.08)] text-[#1580c0] border-[rgba(31,182,255,0.2)]",
  gemini: "bg-[rgba(66,133,244,0.08)] text-[#4285f4] border-[rgba(66,133,244,0.2)]",
  deepseek: "bg-[rgba(99,102,241,0.08)] text-[#6366f1] border-[rgba(99,102,241,0.2)]",
};

const INTENT_LABELS: Record<string, string> = {
  problem_aware: "Problem-Aware",
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
};

const INTENT_BADGE: Record<string, string> = {
  category: "bg-[rgba(13,4,55,0.06)] text-[#0D0437] border-[rgba(13,4,55,0.15)]",
  comparative: "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
  validation: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  problem_aware: "bg-[rgba(31,182,255,0.08)] text-[#1580c0] border-[rgba(31,182,255,0.2)]",
};

const TYPE_CONFIG: Record<RecommendationType, { label: string; bg: string; text: string }> = {
  content_directive:  { label: "Content",   bg: "bg-[rgba(0,180,216,0.08)]",  text: "text-[#0077A8]" },
  entity_foundation:  { label: "Entity",    bg: "bg-[rgba(245,158,11,0.08)]", text: "text-[#B45309]" },
  placement_strategy: { label: "Placement", bg: "bg-[rgba(26,143,92,0.08)]",  text: "text-[#1A8F5C]" },
};

const CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Features", market: "Markets", pricing: "Pricing", messaging: "Messaging",
};

const ACCURACY_STYLES: Record<string, string> = {
  correct:   "bg-[rgba(26,143,92,0.1)]  text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  incorrect: "bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
  uncertain: "bg-[rgba(245,158,11,0.1)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]",
};

const SOURCE_TYPE_CONFIG: Record<string, { label: string; style: string }> = {
  official:    { label: "Official",    style: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]"   },
  competitor:  { label: "Competitor",  style: "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]" },
  ugc:         { label: "UGC",         style: "bg-[rgba(245,158,11,0.08)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]" },
  editorial:   { label: "Editorial",   style: "bg-[rgba(0,180,216,0.08)] text-[#0077A8] border-[rgba(0,180,216,0.2)]"   },
  marketplace: { label: "Marketplace", style: "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]" },
  reference:   { label: "Reference",   style: "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"                             },
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  reddit: "Reddit", g2: "G2", blog: "Blog", news: "News", official_docs: "Docs", other: "Other",
};

// Unaided visibility covers only unprompted discovery intents (mirrors competitive page)
const UNAIDED_INTENTS: QueryIntent[] = ["problem_aware", "category"];

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedRun = TrackingRun & { query_text: string; query_intent: QueryIntent };

interface EnrichedScore extends BrandKnowledgeScore {
  fact_claim: string;
  fact_category: BrandFactCategory;
  fact_is_true: boolean;
  query_text: string;
  model: LLMModel;
  raw_response: string | null;
}

interface StatRow {
  id: string;
  canonical_domain_id: string;
  model: string;
  time_bucket: string;
  runs_used_count: number;
  runs_cited_count: number;
  total_runs: number;
  age_median: string | null;
}

interface CanonicalRow {
  id: string;
  domain: string;
  normalized_name: string;
  source_type: string;
  favicon_url: string | null;
}

interface DomainStat {
  canonicalId: string;
  domain: string;
  normalizedName: string;
  sourceType: string;
  faviconUrl: string | null;
  usedPct: number;
  citedPct: number;
  ageMedian: string | null;
  N: number;
}

interface GroupedQueryRun {
  queryId: string;
  queryText: string;
  queryIntent: QueryIntent;
  models: LLMModel[];
  competitorsMentioned: string[];
  citedSources: NonNullable<EnrichedRun["cited_sources"]>;
}

interface FactModelGroup {
  key: string;
  fact_id: string | null;
  fact_claim: string;
  fact_category: BrandFactCategory;
  model: LLMModel;
  total: number;
  correctCount: number;
  hallucinatedCount: number;
}

interface ReportData {
  client: Client;
  enrichedRuns: EnrichedRun[];
  queries: { id: string; text: string; intent: string; is_bait: boolean }[];
  competitors: Competitor[];
  recommendations: Recommendation[];
  clusters: GapCluster[];
  clusterQueryMap: Map<string, Set<string>>;
  clusterSourceRuns: EnrichedRun[];
  knowledgeScores: EnrichedScore[];
  domainStats: StatRow[];
  canonicalMap: Map<string, CanonicalRow>;
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoursAgo(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function formatTimeAgo(iso: string): string {
  const h = hoursAgo(iso);
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function mentionColor(rate: number) {
  if (rate >= 60) return "#1A8F5C";
  if (rate >= 30) return "#F59E0B";
  return "#FF4B6E";
}

function fmtPct(n: number): string {
  if (n === 0) return "0%";
  if (n < 1) return "<1%";
  return `${Math.round(n)}%`;
}

// Groups gap runs by query_id — mirrors narrative page logic
function groupRunsByQuery(runs: EnrichedRun[]): GroupedQueryRun[] {
  const map = new Map<string, GroupedQueryRun>();
  for (const run of runs) {
    if (!map.has(run.query_id)) {
      map.set(run.query_id, {
        queryId: run.query_id,
        queryText: run.query_text,
        queryIntent: run.query_intent,
        models: [],
        competitorsMentioned: [],
        citedSources: [],
      });
    }
    const g = map.get(run.query_id)!;
    if (!g.models.includes(run.model)) g.models.push(run.model);
    for (const c of run.competitors_mentioned ?? []) {
      if (!g.competitorsMentioned.includes(c)) g.competitorsMentioned.push(c);
    }
    for (const s of run.cited_sources ?? []) {
      if (!g.citedSources.some((x) => x.url === s.url)) g.citedSources.push(s);
    }
  }
  return Array.from(map.values());
}

// Groups knowledge scores by fact × model — mirrors knowledge page logic
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
    return {
      key,
      fact_id: first.fact_id,
      fact_claim: first.fact_claim,
      fact_category: first.fact_category,
      model: first.model,
      total: runs.length,
      correctCount,
      hallucinatedCount: hallucinatedRuns.length,
    };
  });
}

// Aggregates domain stats across all models and time buckets — mirrors sources page
function computeDomainStats(stats: StatRow[], canonicalMap: Map<string, CanonicalRow>): DomainStat[] {
  const aggMap = new Map<string, {
    used: number; cited: number; total: number; latestBucket: string; ageMedian: string | null;
  }>();
  for (const s of stats) {
    const ex = aggMap.get(s.canonical_domain_id);
    if (ex) {
      ex.used += s.runs_used_count;
      ex.cited += s.runs_cited_count;
      ex.total += s.total_runs;
      if (s.time_bucket > ex.latestBucket) { ex.latestBucket = s.time_bucket; ex.ageMedian = s.age_median; }
    } else {
      aggMap.set(s.canonical_domain_id, {
        used: s.runs_used_count, cited: s.runs_cited_count, total: s.total_runs,
        latestBucket: s.time_bucket, ageMedian: s.age_median,
      });
    }
  }
  return Array.from(aggMap.entries()).map(([canonicalId, agg]) => {
    const canonical = canonicalMap.get(canonicalId);
    if (!canonical) return null;
    const usedPct  = agg.total > 0 ? (agg.used  / agg.total) * 100 : 0;
    const citedPct = agg.total > 0 ? (agg.cited / agg.total) * 100 : 0;
    return { canonicalId, domain: canonical.domain, normalizedName: canonical.normalized_name,
      sourceType: canonical.source_type, faviconUrl: canonical.favicon_url,
      usedPct, citedPct, ageMedian: agg.ageMedian, N: agg.used } satisfies DomainStat;
  }).filter(Boolean) as DomainStat[];
}

function sortDomains(domains: DomainStat[]): DomainStat[] {
  return [...domains].sort((a, b) => {
    const aI = a.N < 10, bI = b.N < 10;
    if (aI && !bI) return 1;
    if (!aI && bI) return -1;
    return b.usedPct - a.usedPct;
  });
}

function getGapLabel(usedPct: number, citedPct: number, N: number): string {
  if (N < 10) return "Insufficient Data";
  if (usedPct > 3 * citedPct) return "Silent Influencer";
  if (citedPct > 2 * usedPct) return "Over-credited";
  return "Balanced";
}

function getVintageLabel(ageMedian: string | null): string {
  if (!ageMedian) return "Recent";
  const y = parseInt(ageMedian, 10);
  if (isNaN(y) || y >= 2024) return "Recent";
  if (y >= 2022) return `~${y} (aging)`;
  return "Old knowledge";
}

// ── Data loader ───────────────────────────────────────────────────────────────

function ReportInner() {
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client");
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      let q = supabase.from("clients").select("*").eq("status", "active");
      if (clientIdParam) q = q.eq("id", clientIdParam);
      const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);
      const client = clients?.[0];
      if (!client) { setError("No active client found."); setLoading(false); return; }

      // Parallel fetch of all data needed for the 7 report sections
      const [
        { data: runData },
        { data: queryData },
        { data: competitors },
        { data: recommendations },
        { data: rawClusters },
        { data: rawScores },
        { data: facts },
        { data: statsData },
      ] = await Promise.all([
        supabase.from("tracking_runs").select("*").eq("client_id", client.id)
          .order("ran_at", { ascending: false }).limit(10000),
        supabase.from("queries").select("id, text, intent, is_bait")
          .eq("client_id", client.id).limit(2000),
        supabase.from("competitors").select("*").eq("client_id", client.id).order("name"),
        supabase.from("recommendations").select("*").eq("client_id", client.id)
          .neq("status", "dismissed").order("priority"),
        supabase.from("gap_clusters").select("*").eq("client_id", client.id)
          .order("run_date", { ascending: false }).limit(20),
        supabase.from("brand_knowledge_scores").select("*").eq("client_id", client.id)
          .order("scored_at", { ascending: false }).limit(5000),
        supabase.from("brand_facts").select("*").eq("client_id", client.id),
        supabase.from("domain_run_stats").select(
          "id, canonical_domain_id, client_id, model, time_bucket, runs_used_count, runs_cited_count, total_runs, model_weight, age_median, updated_at"
        ).eq("client_id", client.id).order("time_bucket", { ascending: false }),
      ]);

      const queryMap = Object.fromEntries((queryData ?? []).map((q) => [q.id, q]));
      const enrichedRuns: EnrichedRun[] = (runData ?? []).map((r) => ({
        ...r,
        query_text: queryMap[r.query_id]?.text ?? "",
        query_intent: (queryMap[r.query_id]?.intent ?? "problem_aware") as QueryIntent,
      }));

      // ── Gap cluster two-step load (mirrors narrative page)
      let clusterQueryMap = new Map<string, Set<string>>();
      let clusterSourceRuns: EnrichedRun[] = [];
      let clusters: GapCluster[] = [];

      if (rawClusters && rawClusters.length > 0) {
        const latestDate = rawClusters[0].run_date;
        clusters = rawClusters.filter((c) => c.run_date === latestDate) as GapCluster[];
        const clusterIds = clusters.map((c) => c.id);
        const { data: joinRows } = await supabase
          .from("gap_cluster_queries").select("cluster_id, query_id")
          .in("cluster_id", clusterIds).limit(2000);
        const map = new Map<string, Set<string>>();
        for (const row of joinRows ?? []) {
          if (!map.has(row.cluster_id)) map.set(row.cluster_id, new Set());
          map.get(row.cluster_id)!.add(row.query_id);
        }
        clusterQueryMap = map;
        const allClusterQIds = Array.from(map.values()).flatMap((s) => Array.from(s));
        if (allClusterQIds.length > 0) {
          const { data: cRuns } = await supabase
            .from("tracking_runs").select("*").in("query_id", allClusterQIds)
            .eq("client_id", client.id).order("ran_at", { ascending: false }).limit(5000);
          clusterSourceRuns = (cRuns ?? []).map((r) => ({
            ...r,
            query_text: queryMap[r.query_id]?.text ?? "",
            query_intent: (queryMap[r.query_id]?.intent ?? "problem_aware") as QueryIntent,
          }));
        }
      }

      // ── Knowledge score enrichment (mirrors knowledge page)
      const factMap = new Map<string, BrandFact>();
      (facts ?? []).forEach((f: BrandFact) => factMap.set(f.id, f));
      type RunRow = { id: string; query_id: string; model: LLMModel; raw_response: string | null };
      const runMap = new Map<string, RunRow>();
      (runData ?? []).forEach((r) => runMap.set(r.id, r as RunRow));
      const queryTextMap = new Map<string, string>();
      (queryData ?? []).forEach((q) => queryTextMap.set(q.id, q.text));
      const knowledgeScores: EnrichedScore[] = (rawScores ?? [])
        .map((s: BrandKnowledgeScore) => {
          const fact = s.fact_id ? factMap.get(s.fact_id) : null;
          const run = runMap.get(s.tracking_run_id);
          if (!fact || !run) return null;
          return {
            ...s, fact_claim: fact.claim, fact_category: fact.category,
            fact_is_true: fact.is_true, query_text: queryTextMap.get(run.query_id) ?? "",
            model: run.model, raw_response: run.raw_response,
          } as EnrichedScore;
        }).filter(Boolean) as EnrichedScore[];

      // ── Domain stats two-step load (mirrors sources page)
      const allStats = (statsData ?? []) as StatRow[];
      const canonicalMap = new Map<string, CanonicalRow>();
      const canonicalIds = [...new Set(allStats.map((s) => s.canonical_domain_id))];
      if (canonicalIds.length > 0) {
        const { data: canonicalsData } = await supabase
          .from("canonical_domains").select("id, domain, normalized_name, source_type, favicon_url")
          .in("id", canonicalIds);
        (canonicalsData ?? []).forEach((c: CanonicalRow) => canonicalMap.set(c.id, c));
      }

      setData({
        client, enrichedRuns, queries: queryData ?? [],
        competitors: competitors ?? [], recommendations: recommendations ?? [],
        clusters, clusterQueryMap, clusterSourceRuns,
        knowledgeScores, domainStats: allStats, canonicalMap,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report data");
    } finally {
      setLoading(false);
    }
  }, [clientIdParam]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6 max-w-[794px] mx-auto pt-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-4 w-4 animate-spin text-[#6B7280]" />
          <p className="font-mono text-[11px] text-[#6B7280]">Compiling report…</p>
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4 max-w-[794px] mx-auto pt-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Report</h1>
        <p className="text-[13px] text-[#6B7280]">{error ?? "No data available."}</p>
      </div>
    );
  }

  if (data.enrichedRuns.length < 10) {
    return (
      <div className="space-y-4 max-w-[794px] mx-auto pt-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Report</h1>
        <p className="text-[13px] text-[#6B7280]">
          Need at least 10 tracking runs to generate a report. Run an audit from the Overview tab first.
        </p>
      </div>
    );
  }

  return <ReportDocument data={data} onRegenerate={loadData} />;
}

export default function ReportPage() {
  return (
    <Suspense>
      <ReportInner />
    </Suspense>
  );
}

// ── Report document ────────────────────────────────────────────────────────────

function ReportDocument({ data, onRegenerate }: { data: ReportData; onRegenerate: () => void }) {
  const { client, enrichedRuns, queries, competitors, recommendations,
    clusters, clusterQueryMap, clusterSourceRuns, knowledgeScores,
    domainStats, canonicalMap } = data;

  const trackedModels = (client.selected_models ?? []) as LLMModel[];
  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? client.url;

  // ── Overview metrics (mirrors overview page, excludes validation intent) ────
  const queryIntentMap = new Map(queries.map((q) => [q.id, q.intent]));
  const queryIsBaitMap = new Map(queries.map((q) => [q.id, q.is_bait]));
  const queryTextMap   = new Map(queries.map((q) => [q.id, q.text]));

  const nonValidationRuns = enrichedRuns.filter((r) => queryIntentMap.get(r.query_id) !== "validation");
  const total = nonValidationRuns.length;
  const positiveMentions = nonValidationRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative");
  const mentioned = positiveMentions.length;
  const mentionRate = total > 0 ? Math.round((mentioned / total) * 100) : 0;

  const queryMentioned = new Map<string, boolean>();
  nonValidationRuns.forEach((r) => {
    if (!queryMentioned.has(r.query_id)) queryMentioned.set(r.query_id, false);
    if (r.brand_mentioned && r.mention_sentiment !== "negative") queryMentioned.set(r.query_id, true);
  });
  const zeroMentionQueries  = [...queryMentioned.values()].filter((v) => !v).length;
  const totalDistinctQueries = queryMentioned.size;
  const gapPct = totalDistinctQueries > 0 ? Math.round((zeroMentionQueries / totalDistinctQueries) * 100) : 0;

  const lastAudited: Record<string, string> = {};
  const modelRunCounts: Partial<Record<LLMModel, number>> = {};
  enrichedRuns.forEach((r) => {
    if (!lastAudited[r.model] || r.ran_at > lastAudited[r.model]) lastAudited[r.model] = r.ran_at;
    modelRunCounts[r.model] = (modelRunCounts[r.model] ?? 0) + 1;
  });

  const dailyStats: Record<string, Record<string, { total: number; mentioned: number }>> = {};
  nonValidationRuns.forEach((r) => {
    const date = r.ran_at.split("T")[0];
    if (!dailyStats[date]) dailyStats[date] = {};
    if (!dailyStats[date][r.model]) dailyStats[date][r.model] = { total: 0, mentioned: 0 };
    dailyStats[date][r.model].total++;
    if (r.brand_mentioned && r.mention_sentiment !== "negative") dailyStats[date][r.model].mentioned++;
  });
  const trendData = Object.entries(dailyStats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => ({
      date: date.slice(5),
      ...Object.fromEntries(Object.entries(models).map(([m, s]) => [m, Math.round((s.mentioned / s.total) * 100)])),
    }));

  // Fact accuracy from knowledge scores (all-time baseline for overview)
  const kTotal   = knowledgeScores.length;
  const kCorrect = knowledgeScores.filter((s) => s.accuracy === "correct").length;
  const factAccuracyPct = kTotal > 0 ? Math.round((kCorrect / kTotal) * 100) : null;

  // Insight texts (mirrors overview page)
  const visibilityLevel = mentionRate >= 70 ? "strong" : mentionRate >= 40 ? "moderate" : "low";
  const mentionInsight =
    trendData.length < 2 ? "Insufficient data — run more queries to establish a baseline."
    : mentionRate >= 60 ? `Strong LLM visibility — brand appears in ${mentionRate}% of queries.`
    : mentionRate >= 30 ? `Moderate visibility — ${zeroMentionQueries} of ${totalDistinctQueries} queries return no mention.`
    : `Critical gap — brand absent from ${100 - mentionRate}% of LLM responses.`;
  const factAccuracyInsight =
    factAccuracyPct === null ? "No knowledge-validation runs yet."
    : factAccuracyPct >= 80 ? `LLMs accurately describe ${factAccuracyPct}% of your brand facts.`
    : factAccuracyPct >= 50 ? `${factAccuracyPct}% accuracy — some facts are misrepresented.`
    : `Only ${factAccuracyPct}% accurate — LLMs frequently misstate brand facts.`;
  const gapInsight =
    zeroMentionQueries === 0 ? "Brand appears in every tracked query — complete coverage."
    : `${zeroMentionQueries} of ${totalDistinctQueries} queries return zero mentions across all models.`;

  // ── Competitive gaps metrics (mirrors narrative page) ─────────────────────
  const gapRuns = enrichedRuns.filter((r) => !r.brand_mentioned && r.query_intent !== "validation");
  const clusteredQueryIds = new Set(Array.from(clusterQueryMap.values()).flatMap((s) => Array.from(s)));
  // Use targeted cluster runs when available (same as narrative page)
  const clusterSrc = clusterSourceRuns.length > 0 ? clusterSourceRuns : enrichedRuns;

  // Source breakdown from all gap runs
  const gapDomainStats: Record<string, { type: string; count: number }> = {};
  gapRuns.forEach((r) => {
    (r.cited_sources ?? []).forEach((s) => {
      if (!gapDomainStats[s.domain]) gapDomainStats[s.domain] = { type: s.type, count: 0 };
      gapDomainStats[s.domain].count++;
    });
  });
  const gapSourcesTable = Object.entries(gapDomainStats)
    // Filter out entries with undefined domain string or zero appearances
    .filter(([domain, { count }]) => domain && domain !== "undefined" && count > 0)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 8);
  const totalCitedGaps = gapSourcesTable.reduce((s, [, v]) => s + v.count, 0);

  // ── Unaided visibility metrics (mirrors competitive page) ─────────────────
  const unaidedRuns = enrichedRuns.filter((r) => UNAIDED_INTENTS.includes(r.query_intent));
  const heatmapRows: HeatmapRow[] = [
    { name: brandName, isBrand: true, byModel: {} },
    ...competitors.map((c) => ({ name: c.name, isBrand: false, byModel: {} })),
  ];
  for (const model of trackedModels) {
    const modelRuns = unaidedRuns.filter((r) => r.model === model);
    const tot = modelRuns.length;
    if (tot === 0) continue;
    const bm = modelRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative").length;
    heatmapRows[0].byModel[model] = {
      mentionRate: Math.round((bm / tot) * 100), isPrimary: false,
      topQueries: modelRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative").slice(0, 2).map((r) => r.query_text),
    };
    competitors.forEach((comp, idx) => {
      const cr = modelRuns.filter((r) => (r.competitors_mentioned ?? []).includes(comp.name));
      heatmapRows[idx + 1].byModel[model] = {
        mentionRate: Math.round((cr.length / tot) * 100), isPrimary: false,
        topQueries: cr.slice(0, 2).map((r) => r.query_text),
      };
    });
    let maxRate = 0, primaryIdx = 0;
    heatmapRows.forEach((row, i) => {
      const r = row.byModel[model]?.mentionRate ?? 0;
      if (r > maxRate) { maxRate = r; primaryIdx = i; }
    });
    if (maxRate > 0) heatmapRows[primaryIdx].byModel[model]!.isPrimary = true;
  }
  const compGaps: Record<string, { winCount: number; queries: string[]; models: string[] }> = {};
  unaidedRuns.forEach((r) => {
    if (r.brand_mentioned) return;
    (r.competitors_mentioned ?? []).forEach((comp) => {
      if (!compGaps[comp]) compGaps[comp] = { winCount: 0, queries: [], models: [] };
      compGaps[comp].winCount++;
      if (!compGaps[comp].queries.includes(r.query_text)) compGaps[comp].queries.push(r.query_text);
      if (!compGaps[comp].models.includes(r.model)) compGaps[comp].models.push(r.model);
    });
  });
  const compGapList = Object.entries(compGaps).sort(([, a], [, b]) => b.winCount - a.winCount).slice(0, 4);

  // ── Brand knowledge metrics (mirrors knowledge page) ──────────────────────
  const totalScored  = knowledgeScores.length;
  const correctCount = knowledgeScores.filter((s) => s.accuracy === "correct").length;
  const accuracyRate = totalScored > 0 ? Math.round((correctCount / totalScored) * 100) : 0;
  const allKnowledgeGroups = buildFactModelGroups(knowledgeScores);
  const alertGroupsCount   = allKnowledgeGroups.filter((g) => g.hallucinatedCount > 0).length;
  const CATEGORIES: BrandFactCategory[] = ["feature", "market", "pricing", "messaging"];
  const categoryStats = CATEGORIES.map((cat) => {
    const cs = knowledgeScores.filter((s) => s.fact_category === cat);
    const cc = cs.filter((s) => s.accuracy === "correct").length;
    return { cat, total: cs.length, correct: cc, rate: cs.length > 0 ? Math.round((cc / cs.length) * 100) : null };
  }).filter((c) => c.total > 0);
  const modelKnowledgeStats = trackedModels.map((model) => {
    const ms = knowledgeScores.filter((s) => s.model === model);
    const mc = ms.filter((s) => s.accuracy === "correct").length;
    return { model, total: ms.length, correct: mc, rate: ms.length > 0 ? Math.round((mc / ms.length) * 100) : null };
  }).filter((m) => m.total > 0);
  const scoredRunsPreview = [...allKnowledgeGroups]
    .sort((a, b) => b.hallucinatedCount - a.hallucinatedCount)
    .slice(0, 4);

  // ── Source intelligence metrics (mirrors sources page) ────────────────────
  const allDomainStats = computeDomainStats(domainStats, canonicalMap);
  const sortedDomainStats = sortDomains(allDomainStats).slice(0, 8);
  const officialSite = allDomainStats.find((d) => d.sourceType === "official") ?? null;
  const topDomain    = [...allDomainStats].filter((d) => d.N >= 10).sort((a, b) => b.usedPct - a.usedPct)[0] ?? null;
  const silentCount  = allDomainStats.filter((d) => d.N >= 10 && d.usedPct > 3 * d.citedPct).length;
  const domainsWithAge = allDomainStats.filter((d) => d.N >= 10 && d.ageMedian !== null);
  const staleCount   = domainsWithAge.filter((d) => { const y = parseInt(d.ageMedian!, 10); return !isNaN(y) && y <= 2022; }).length;
  const staleRate    = domainsWithAge.length > 0 ? Math.round((staleCount / domainsWithAge.length) * 100) : null;

  // ── Roadmap (mirrors blueprint page) ─────────────────────────────────────
  const recGrouped: Partial<Record<RecommendationType, Recommendation[]>> = {};
  recommendations.forEach((r) => {
    if (!recGrouped[r.type]) recGrouped[r.type] = [];
    recGrouped[r.type]!.push(r);
  });
  const recTypeOrder: RecommendationType[] = ["content_directive", "entity_foundation", "placement_strategy"];

  // ── Cover description paragraph ──────────────────────────────────────────
  const modelNamesList = trackedModels.map((m) => MODEL_LABELS[m]).join(", ");

  return (
    <>
      {/* ── Print + layout CSS ─────────────────────────────────────────────── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 14mm; }
          /* Force every section to start on a fresh page */
          .report-section {
            break-before: page; page-break-before: always;
            break-after: page;  page-break-after: always;
            padding-top: 4px !important;
          }
          /* Tighten vertical rhythm inside sections */
          .report-section > * + * { margin-top: 10px !important; }
          .space-y-6 > * + * { margin-top: 10px !important; }
          /* SubLabel row */
          .my-4 { margin-top: 6px !important; margin-bottom: 6px !important; }
          /* Cover hero */
          .py-12 { padding-top: 28px !important; padding-bottom: 28px !important; }
          .py-7  { padding-top: 14px !important; padding-bottom: 14px !important; }
          /* Remove top-gap on section wrappers (pt-10 = 40px) */
          .pt-10 { padding-top: 0 !important; }
          .print-avoid { page-break-inside: avoid; break-inside: avoid; }
          tr { page-break-inside: avoid; break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          html, body { height: auto !important; overflow: visible !important; }
          div[class*="h-screen"] { height: auto !important; overflow: visible !important; display: block !important; }
          main { height: auto !important; overflow: visible !important; padding: 0 !important; }
          /* Font density: 10pt table cells, 8pt column headers, 12pt section h2 */
          td { font-size: 10pt !important; padding-top: 4px !important; padding-bottom: 4px !important; }
          th { font-size: 8pt !important;  padding-top: 4px !important; padding-bottom: 4px !important; }
          h2 { font-size: 12pt !important; line-height: 1.3 !important; }
        }
        [contenteditable]:focus { outline: none; }
        [contenteditable] { caret-color: currentColor; }
      `}</style>

      {/* ── Floating action bar (screen only) ─────────────────────────────── */}
      <div className="no-print fixed bottom-6 right-6 flex gap-2 z-50">
        <button
          type="button"
          onClick={onRegenerate}
          className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded-lg border border-[#E2E8F0] bg-white text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437] shadow-lg transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 text-[11px] font-bold px-4 py-2 rounded-lg bg-[#0D0437] text-white hover:bg-[#1a1150] shadow-lg transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download PDF
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          REPORT DOCUMENT — A4 container
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="max-w-[794px] mx-auto py-6 print:py-0" id="report-document">

        {/* ── COVER ─────────────────────────────────────────────────────────── */}
        <div className="report-section print-avoid">
          {/* Dark hero */}
          <div className="dark-grid relative bg-[#0D0437] rounded-t-2xl print:rounded-none px-10 py-12">
            {/* Top bar: logo + badge */}
            <div className="flex items-center justify-between mb-12">
              <span className="font-exo2 font-black text-[20px] leading-none tracking-tight text-white/80">
                Shadovi
              </span>
              <span className="font-mono text-[9px] font-bold tracking-[2px] uppercase text-white/40 border border-white/10 px-3 py-1 rounded-full">
                AEO Intelligence Report
              </span>
            </div>

            {/* Eyebrow */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-px bg-[#FF4B6E]" />
              <span className="font-mono text-[9px] font-bold tracking-[2.5px] uppercase text-[#FF4B6E]">
                AI Visibility Intelligence Report
              </span>
            </div>

            {/* Brand name */}
            <h1 className="font-serif text-[56px] font-semibold text-white leading-[0.95] tracking-[-2px] mb-1">
              {brandName}
            </h1>
            <p className="font-mono text-[11px] text-white/30 mb-10">{client.url}</p>

            {/* 3 cover metrics */}
            <div className="grid grid-cols-3 gap-4 mb-10">
              <CoverMetric label="LLM Mention Rate"      value={`${mentionRate}%`} color={mentionColor(mentionRate)} />
              <CoverMetric label="Zero-mention Queries"  value={zeroMentionQueries === 0 ? "None" : `${zeroMentionQueries} / ${totalDistinctQueries}`} color={zeroMentionQueries === 0 ? "#1A8F5C" : gapPct > 30 ? "#FF4B6E" : "#F59E0B"} />
              <CoverMetric label="Facts Accuracy"        value={factAccuracyPct !== null ? `${factAccuracyPct}%` : "—"} color={factAccuracyPct === null ? "#6B7280" : mentionColor(factAccuracyPct)} />
            </div>

            {/* Prepared for + date */}
            <div className="flex items-end justify-between">
              <div className="space-y-1">
                <p className="font-mono text-[9px] font-bold tracking-[2.5px] uppercase text-white/40">
                  Prepared for
                </p>
                <div
                  contentEditable
                  suppressContentEditableWarning
                  className="text-[18px] font-semibold text-white border-b border-dashed border-white/25 min-w-[180px] inline-block pb-0.5 focus:border-white/60 transition-colors"
                >
                  Client Name
                </div>
              </div>
              <p className="font-mono text-[11px] text-white/30">
                {formatDate(new Date().toISOString())}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white border border-t-0 border-[#E2E8F0] rounded-b-2xl print:rounded-none px-10 py-7">
            <p className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] mb-3">
              About this report
            </p>
            <p className="text-[13px] leading-[1.8] text-[#374151]">
              This report summarises how <strong className="text-[#0D0437]">{brandName}</strong> is
              represented across {modelNamesList}. It covers visibility presence, competitive
              displacement, knowledge accuracy, source attribution, and query coverage.
            </p>
            <div className="mt-5 grid grid-cols-4 gap-3">
              {[
                { label: "Total Responses", value: enrichedRuns.length.toLocaleString() },
                { label: "Queries Tracked", value: totalDistinctQueries.toString() },
                { label: "Models", value: trackedModels.length.toString() },
                { label: "Competitors", value: competitors.length.toString() },
              ].map(({ label, value }) => (
                <div key={label} className="border border-[#E2E8F0] rounded-lg p-3 bg-[#F9FAFB]">
                  <p className="font-serif text-[22px] font-bold text-[#0D0437] leading-none">{value}</p>
                  <p className="font-mono text-[9px] text-[#9CA3AF] uppercase tracking-wide mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── SECTION 1: OVERVIEW ───────────────────────────────────────────── */}
        <div className="report-section pt-10 space-y-6">
          <SectionHeader number="01" title="Overview" />

          {/* Audit Coverage bar */}
          <div className="print-avoid">
            <SubLabel>Audit Coverage</SubLabel>
            <div className="flex items-center gap-x-2.5 py-2 flex-wrap bg-white border border-[#E2E8F0] rounded-lg px-4">
              <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap shrink-0">
                Models
              </span>
              <div className="h-3 w-px bg-[#E2E8F0] shrink-0" />
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {trackedModels
                  .filter((m) => (modelRunCounts[m] ?? 0) > 0)
                  .map((model, i) => {
                    const ts = lastAudited[model];
                    const stale = ts ? hoursAgo(ts) > 48 : true;
                    return (
                      <span key={model} className="flex items-center gap-1 whitespace-nowrap">
                        {i > 0 && <span className="text-[#D1D5DB] text-[10px]">·</span>}
                        <span className="text-[11px] font-semibold text-[#374151]">{MODEL_LABELS[model]}</span>
                        <span className={`text-[10px] ${stale ? "text-[#FF4B6E]" : "text-[#9CA3AF]"}`}>
                          {ts ? formatTimeAgo(ts) : "no data"}
                        </span>
                      </span>
                    );
                  })}
              </div>
              <span className="text-[10px] text-[#9CA3AF] font-mono whitespace-nowrap">
                {queries.length} queries · {trackedModels.filter((m) => (modelRunCounts[m] ?? 0) > 0).length} models
              </span>
            </div>
          </div>

          {/* Visibility Metrics */}
          <div className="print-avoid">
            <SubLabel>Visibility Metrics</SubLabel>
            <div className="grid grid-cols-3 gap-4">
              <InsightMetric
                label="LLM Mention Rate"
                value={`${mentionRate}%`}
                barPercent={mentionRate}
                insight={mentionInsight}
                sentiment={mentionRate >= 60 ? "positive" : mentionRate >= 30 ? "neutral" : "negative"}
              />
              <InsightMetric
                label="Fact Accuracy"
                value={factAccuracyPct !== null ? `${factAccuracyPct}%` : "—"}
                barPercent={factAccuracyPct}
                insight={factAccuracyInsight}
                sentiment={factAccuracyPct === null ? "neutral" : factAccuracyPct >= 80 ? "positive" : factAccuracyPct >= 50 ? "neutral" : "negative"}
              />
              <InsightMetric
                label="Visibility Gaps"
                value={`${gapPct}%`}
                insight={gapInsight}
                sentiment={zeroMentionQueries === 0 ? "positive" : gapPct <= 30 ? "neutral" : "negative"}
              />
            </div>
            <p className="text-sm text-[#374151] leading-relaxed mt-4">
              <span className="font-semibold text-[#0D0437]">{brandName}</span>{" "}
              has <span className="font-semibold text-[#0D0437]">{visibilityLevel}</span> AI visibility.
              {zeroMentionQueries > 0 && ` ${zeroMentionQueries} ${zeroMentionQueries === 1 ? "query returns" : "queries return"} no brand mentions.`}
              {factAccuracyPct !== null && factAccuracyPct >= 80 && ` ${Math.round((factAccuracyPct / 100) * kTotal)} brand facts are described correctly by LLMs.`}
              {factAccuracyPct !== null && factAccuracyPct < 80 && ` ${100 - factAccuracyPct}% of brand facts are described incorrectly.`}
            </p>
          </div>

          {/* Top Priorities */}
          {recommendations.slice(0, 3).length > 0 && (
            <div className="print-avoid">
              <SubLabel>Top Priorities</SubLabel>
              <div className="space-y-2">
                {recommendations.slice(0, 3).map((rec) => {
                  const tc = TYPE_CONFIG[rec.type];
                  return (
                    <div key={rec.id} className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex items-start gap-3">
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded shrink-0 mt-0.5 ${tc.bg} ${tc.text}`}>
                        {tc.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[#0D0437]">{rec.title}</p>
                        <p className="text-[11px] text-[#6B7280] mt-0.5 line-clamp-1">{rec.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Mention Rate Over Time */}
          {trendData.length >= 2 && (
            <div className="print-avoid">
              <SubLabel>Mention Rate Over Time</SubLabel>
              <div className="border border-[#E2E8F0] rounded-lg bg-white p-5">
                <p className="text-[11px] text-[#6B7280] mb-3">
                  % of queries where {brandName} was mentioned, per model per day
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6B7280" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#6B7280" }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "6px", fontSize: 11 }}
                      formatter={(v: number) => [`${v}%`, ""]}
                    />
                    {trackedModels.map((model) => (
                      <Line key={model} type="monotone" dataKey={model} name={MODEL_LABELS[model]}
                        stroke={MODEL_COLORS[model]} strokeWidth={2} dot={{ r: 3 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Latest Activity */}
          <div className="print-avoid">
            <SubLabel>Latest Activity</SubLabel>
            <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-[#F4F6F9]">
                    {["Intent", "Query", "Model", "Status"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enrichedRuns.slice(0, 4).map((run) => {
                    const intent = queryIntentMap.get(run.query_id) ?? "";
                    const isBait = queryIsBaitMap.get(run.query_id) ?? false;
                    const qText  = queryTextMap.get(run.query_id) ?? run.query_text;
                    return (
                      <tr key={run.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${INTENT_BADGE[intent] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                            {INTENT_LABELS[intent] ?? intent}
                          </span>
                          {isBait && (
                            <span className="ml-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(245,158,11,0.08)] text-[#B45309] border-[rgba(245,158,11,0.2)]">
                              Bait
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[#1A1A2E] italic max-w-[260px]">
                          <span className="line-clamp-1">{qText ? `"${qText}"` : "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${MODEL_BADGE[run.model] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                            {MODEL_LABELS[run.model] ?? run.model}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {run.brand_mentioned
                            ? <CheckCircle2 className="h-4 w-4 text-[#1A8F5C]" />
                            : <XCircle      className="h-4 w-4 text-[#FF4B6E]" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── SECTION 2: COMPETITIVE GAPS ───────────────────────────────────── */}
        <div className="report-section pt-10 space-y-6">
          <SectionHeader number="02" title="Competitive Gaps" />
          <p className="text-sm text-[#374151] leading-[1.75]">
            Queries where <strong className="text-[#0D0437]">{brandName}</strong> was absent from LLM
            responses. Each gap is a missed opportunity to influence the buyer&apos;s research journey.
            {gapRuns.length > 0 && ` ${gapRuns.length} total gap responses across all models.`}
          </p>

          {/* Gap Clusters — max 4; first expanded (3 queries shown), rest collapsed */}
          <SubLabel>Gap Clusters</SubLabel>
          {clusters.length === 0 ? (
            <div className="border border-[#E2E8F0] rounded-xl p-8 text-center bg-white">
              <p className="text-sm text-[#6B7280]">Run an audit to see how gap queries cluster into buyer patterns.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {clusters.slice(0, 4).map((cluster, idx) => {
                const memberIds = clusterQueryMap.get(cluster.id) ?? new Set();
                const clusterRuns = clusterSrc.filter((r) => memberIds.has(r.query_id) && !r.brand_mentioned);
                const grouped = groupRunsByQuery(clusterRuns);
                const displacedCount = grouped.filter((g) => g.competitorsMentioned.length > 0).length;
                const openCount = grouped.filter((g) => g.citedSources.length === 0 && g.competitorsMentioned.length === 0).length;
                // First cluster shown expanded with up to 3 queries; rest collapsed (header only)
                const isExpanded = idx === 0;

                return (
                  <div key={cluster.id} className="border border-[#E2E8F0] rounded-xl bg-white overflow-hidden print-avoid">
                    {/* Header */}
                    <div className="px-5 py-4 flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-sm font-bold text-[#0D0437]">{cluster.cluster_name}</span>
                          {displacedCount > 0 && (
                            <span className="inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-[rgba(255,75,110,0.10)] text-[#FF4B6E] border-[rgba(255,75,110,0.25)]">
                              Displaced {displacedCount}
                            </span>
                          )}
                          {openCount > 0 && (
                            <span className="inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-[rgba(0,175,150,0.10)] text-[#00AF96] border-[rgba(0,175,150,0.25)]">
                              Open {openCount}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#6B7280]">{cluster.persona_label}</p>
                        <p className="font-mono text-[11px] text-[#9CA3AF]">
                          {cluster.query_count} {cluster.query_count === 1 ? "query" : "queries"}
                          {displacedCount > 0 && ` — ${cluster.competitors_present.slice(0, 4).join(", ")} present`}
                        </p>
                      </div>
                      {!isExpanded && (
                        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] mt-1">
                          {grouped.length} queries
                        </span>
                      )}
                    </div>

                    {/* Expanded: first cluster shows up to 3 queries */}
                    {isExpanded && grouped.length > 0 && (
                      <div className="border-t border-[#E2E8F0] px-5 py-4 space-y-3 bg-[rgba(244,246,249,0.35)]">
                        {grouped.slice(0, 3).map((g) => (
                          <div key={g.queryId} className="bg-white border border-[#E2E8F0] rounded-lg p-4">
                            <p className="text-[11px] italic text-[#374151] mb-2">&ldquo;{g.queryText}&rdquo;</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {g.models.map((m) => (
                                <span key={m} className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${MODEL_BADGE[m] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                                  {MODEL_LABELS[m] ?? m}
                                </span>
                              ))}
                              {g.competitorsMentioned.length > 0 && (
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                  {g.competitorsMentioned.slice(0, 3).join(", ")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {grouped.length > 3 && (
                          <p className="text-[11px] text-[#9CA3AF] text-center">
                            +{grouped.length - 3} more queries in this cluster
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Source Breakdown */}
          {gapSourcesTable.length > 0 && (
            <div className="print-avoid">
              <SubLabel>Source Breakdown</SubLabel>
              <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[#F4F6F9]">
                      {["Domain", "Type", "Appearances", "% of Gaps"].map((h) => (
                        <th key={h} className={`px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] ${h === "Appearances" || h === "% of Gaps" ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gapSourcesTable.map(([domain, { type, count }]) => (
                      <tr key={domain} className="border-b last:border-0">
                        <td className="px-4 py-3 font-semibold text-[#0D0437] text-[12px]">{domain}</td>
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280]">
                            {SOURCE_TYPE_LABELS[type] ?? type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] text-[#0D0437]">{count}</td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] text-[#6B7280]">
                          {totalCitedGaps > 0 ? `${Math.round((count / totalCitedGaps) * 100)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 3: UNAIDED VISIBILITY ─────────────────────────────────── */}
        <div className="report-section pt-10 space-y-6">
          <SectionHeader number="03" title="Unaided Visibility" />
          <p className="text-sm text-[#374151] leading-[1.75]">
            LLM mention rates for unprompted discovery queries (Problem-Aware + Category intents) —
            your brand vs. competitors. Crown indicates the entity with the highest mention rate per model.
          </p>

          {/* Heatmap */}
          <div className="print-avoid">
            <SubLabel>Share of Model Heatmap</SubLabel>
            <ModelIntentHeatmap rows={heatmapRows} models={trackedModels} />
          </div>

          {/* Competitor Displacement */}
          {compGapList.length > 0 && (
            <div className="print-avoid">
              <SubLabel>Competitor Displacement</SubLabel>
              <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[#F4F6F9]">
                      {["Competitor", "Displacement Count", "Models", "Sample Query"].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compGapList.map(([name, { winCount, queries: qs, models: ms }]) => (
                      <tr key={name} className="border-b last:border-0">
                        <td className="px-4 py-3 font-bold text-sm text-[#0D0437]">{name}</td>
                        <td className="px-4 py-3">
                          <div className="w-8 h-8 rounded-full bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] font-bold text-[12px] flex items-center justify-center">
                            {winCount}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {ms.map((m) => (
                              <span key={m} className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#0D0437] border border-[#E2E8F0]">
                                {MODEL_LABELS[m as LLMModel] ?? m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[#6B7280] italic max-w-xs">
                          <span className="line-clamp-2">&ldquo;{qs[0]}&rdquo;</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 4: BRAND KNOWLEDGE ────────────────────────────────────── */}
        <div className="report-section pt-10 space-y-6">
          <SectionHeader number="04" title="Brand Knowledge" />
          <p className="text-sm text-[#374151] leading-[1.75]">
            How accurately LLMs represent {brandName}&apos;s features, markets, pricing, and messaging.
            Scored by testing brand facts (true statements) and bait facts (deliberately false claims).
          </p>

          {knowledgeScores.length === 0 ? (
            <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-[#F4F6F9]">
              <p className="text-sm text-[#6B7280]">No knowledge scores yet — trigger a tracking run from Overview to populate this section.</p>
            </div>
          ) : (
            <>
              {/* Knowledge Accuracy Score */}
              <div className="print-avoid">
                <SubLabel>Knowledge Accuracy Score</SubLabel>
                <div className="grid grid-cols-3 gap-4">
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Overall Accuracy</p>
                    <p className="text-[32px] font-bold text-[#0D0437] leading-none">{accuracyRate}%</p>
                    <div className="mt-3 h-[5px] w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${accuracyRate}%`, backgroundColor: accuracyRate >= 70 ? "#1A8F5C" : accuracyRate >= 40 ? "#F59E0B" : "#FF4B6E" }} />
                    </div>
                    <p className="text-[11px] text-[#6B7280] mt-2">{correctCount} of {totalScored} validation runs correct</p>
                  </div>
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Hallucination Alerts</p>
                    <p className="text-[32px] font-bold leading-none" style={{ color: alertGroupsCount > 0 ? "#FF4B6E" : "#1A8F5C" }}>
                      {alertGroupsCount}
                    </p>
                    <p className="text-[11px] text-[#6B7280] mt-2">
                      {alertGroupsCount === 0 ? "No hallucinations detected" : `fact–model combinations with hallucinations`}
                    </p>
                  </div>
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Facts Tested</p>
                    <p className="text-[32px] font-bold text-[#0D0437] leading-none">
                      {new Set(knowledgeScores.map((s) => s.fact_id)).size}
                    </p>
                    <p className="text-[11px] text-[#6B7280] mt-2">
                      unique claims across {trackedModels.length} model{trackedModels.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </div>

              {/* Accuracy by Category */}
              {categoryStats.length > 0 && (
                <div className="print-avoid">
                  <SubLabel>Accuracy by Category</SubLabel>
                  <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[#F4F6F9]">
                          {["Category", "Tested", "Correct", "Accuracy", ""].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {categoryStats.map(({ cat, total, correct, rate }) => (
                          <tr key={cat} className="border-b last:border-0">
                            <td className="px-4 py-3 font-bold text-sm text-[#0D0437]">{CATEGORY_LABELS[cat]}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{total}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#1A8F5C]">{correct}</td>
                            <td className="px-4 py-3">
                              {rate !== null ? (
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${rate >= 70 ? ACCURACY_STYLES.correct : rate >= 40 ? ACCURACY_STYLES.uncertain : ACCURACY_STYLES.incorrect}`}>
                                  {rate}%
                                </span>
                              ) : <span className="text-[#9CA3AF]">—</span>}
                            </td>
                            <td className="px-4 py-3 w-24">
                              <div className="h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${rate ?? 0}%`, backgroundColor: (rate ?? 0) >= 70 ? "#1A8F5C" : (rate ?? 0) >= 40 ? "#F59E0B" : "#FF4B6E" }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Accuracy by Model */}
              {modelKnowledgeStats.length > 0 && (
                <div className="print-avoid">
                  <SubLabel>Accuracy by Model</SubLabel>
                  <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[#F4F6F9]">
                          {["Model", "Runs Scored", "Correct", "Accuracy", ""].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {modelKnowledgeStats.map(({ model, total, correct, rate }) => (
                          <tr key={model} className="border-b last:border-0">
                            <td className="px-4 py-3 font-bold text-sm text-[#0D0437]">{MODEL_LABELS[model] ?? model}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{total}</td>
                            <td className="px-4 py-3 font-mono text-[12px] text-[#1A8F5C]">{correct}</td>
                            <td className="px-4 py-3">
                              {rate !== null ? (
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${rate >= 70 ? ACCURACY_STYLES.correct : rate >= 40 ? ACCURACY_STYLES.uncertain : ACCURACY_STYLES.incorrect}`}>
                                  {rate}%
                                </span>
                              ) : <span className="text-[#9CA3AF]">—</span>}
                            </td>
                            <td className="px-4 py-3 w-24">
                              <div className="h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${rate ?? 0}%`, backgroundColor: (rate ?? 0) >= 70 ? "#1A8F5C" : (rate ?? 0) >= 40 ? "#F59E0B" : "#FF4B6E" }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Scored Runs */}
              {scoredRunsPreview.length > 0 && (
                <div className="print-avoid">
                  <SubLabel>Scored Runs (sample)</SubLabel>
                  <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[#F4F6F9]">
                          {["Claim", "Model", "Variants", "Accuracy", "Hallucinations"].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {scoredRunsPreview.map((group) => {
                          const rate = group.total > 0 ? Math.round((group.correctCount / group.total) * 100) : 0;
                          return (
                            <tr key={group.key} className="border-b last:border-0">
                              <td className="px-4 py-3 max-w-[220px]">
                                <p className="text-[11px] text-[#1A1A2E] line-clamp-2 leading-snug">{group.fact_claim}</p>
                                <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                                  {CATEGORY_LABELS[group.fact_category]}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">
                                  {MODEL_LABELS[group.model] ?? group.model}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{group.total}</td>
                              <td className="px-4 py-3">
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${rate >= 70 ? ACCURACY_STYLES.correct : rate >= 40 ? ACCURACY_STYLES.uncertain : ACCURACY_STYLES.incorrect}`}>
                                  {rate}%
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {group.hallucinatedCount > 0 ? (
                                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                    {group.hallucinatedCount}
                                  </span>
                                ) : <span className="text-[#9CA3AF] text-[11px]">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── SECTION 5: SOURCE INTELLIGENCE ───────────────────────────────── */}
        <div className="report-section pt-10 space-y-6">
          <SectionHeader number="05" title="Source Intelligence" />
          <p className="text-sm text-[#374151] leading-[1.75]">
            Which sources shape AI responses about {brandName}, including domains that influence answers
            without being explicitly cited. Data is model-reported — treat as directional signals.
          </p>

          {domainStats.length === 0 ? (
            <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-[#F4F6F9]">
              <p className="text-sm text-[#6B7280]">Source intelligence is warming up — complete a tracking run to reveal influencing domains.</p>
            </div>
          ) : (
            <>
              {/* Attack Lines — At a Glance KPI cards */}
              <div className="print-avoid">
                <SubLabel>Attack Lines</SubLabel>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Card 1: Official Site Citation Rate */}
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Official Site Citation Rate</p>
                    {officialSite ? (
                      <>
                        <p className="text-[28px] font-bold text-[#0D0437] leading-none">{fmtPct(officialSite.citedPct)}</p>
                        <p className="text-[11px] text-[#6B7280] mt-2">of runs cite {officialSite.normalizedName}</p>
                      </>
                    ) : (
                      <><p className="text-[28px] font-bold text-[#9CA3AF] leading-none">—</p><p className="text-[11px] text-[#6B7280] mt-2">No official domain classified</p></>
                    )}
                  </div>
                  {/* Card 2: Top Influencing Domain */}
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Top Influencing Domain</p>
                    {topDomain ? (
                      <>
                        <p className="text-[13px] font-bold text-[#0D0437] truncate leading-tight mb-1">{topDomain.normalizedName}</p>
                        <p className="text-[28px] font-bold text-[#0D0437] leading-none">{fmtPct(topDomain.usedPct)}</p>
                        <p className="text-[10px] text-[#6B7280] mt-0.5">Influences answers</p>
                      </>
                    ) : (
                      <><p className="text-[28px] font-bold text-[#9CA3AF] leading-none">—</p><p className="text-[11px] text-[#6B7280] mt-2">Need N ≥ 10 to surface</p></>
                    )}
                  </div>
                  {/* Card 3: Silent Influencers */}
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Silent Influencers</p>
                    <p className="text-[28px] font-bold leading-none" style={{ color: silentCount > 0 ? "#B45309" : "#1A8F5C" }}>
                      {silentCount}
                    </p>
                    <p className="text-[11px] text-[#6B7280] mt-2">
                      {silentCount === 0 ? "No invisible influencers" : `domain${silentCount !== 1 ? "s" : ""} influencing without citation`}
                    </p>
                  </div>
                  {/* Card 4: Stale Knowledge Rate */}
                  <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">Stale Knowledge Rate</p>
                    {staleRate !== null ? (
                      <>
                        <p className="text-[28px] font-bold leading-none" style={{ color: staleRate >= 50 ? "#FF4B6E" : staleRate >= 25 ? "#F59E0B" : "#1A8F5C" }}>
                          {staleRate}%
                        </p>
                        <p className="text-[11px] text-[#6B7280] mt-2">of domains have 2022 or older knowledge</p>
                      </>
                    ) : (
                      <><p className="text-[28px] font-bold text-[#9CA3AF] leading-none">—</p><p className="text-[11px] text-[#6B7280] mt-2">Awaiting age data</p></>
                    )}
                  </div>
                </div>
              </div>

              {/* Domain Attribution */}
              {sortedDomainStats.length > 0 && (
                <div className="print-avoid">
                  <SubLabel>Domain Attribution</SubLabel>
                  <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[#F4F6F9]">
                          {["Domain", "Source Type", "Influences Answers", "Gets Credited", "Gap", "Vintage"].map((h) => (
                            <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDomainStats.map((d) => {
                          const srcCfg  = SOURCE_TYPE_CONFIG[d.sourceType] ?? SOURCE_TYPE_CONFIG.reference;
                          const gapLbl  = getGapLabel(d.usedPct, d.citedPct, d.N);
                          const gapStyle: Record<string, string> = {
                            "Silent Influencer":  "bg-[rgba(245,158,11,0.1)]  text-[#B45309] border-[rgba(245,158,11,0.25)]",
                            "Over-credited":      "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
                            "Balanced":           "bg-[rgba(26,143,92,0.08)]  text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
                            "Insufficient Data":  "bg-[#F4F6F9] text-[#9CA3AF] border-[#E2E8F0]",
                          };
                          return (
                            <tr key={d.canonicalId} className={`border-b last:border-0 ${d.N < 10 ? "opacity-40" : ""}`}>
                              <td className="px-4 py-3">
                                <p className="text-[12px] font-bold text-[#0D0437] truncate max-w-[140px]">{d.normalizedName}</p>
                                <p className="text-[10px] text-[#9CA3AF] truncate max-w-[140px]">{d.domain}</p>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${srcCfg.style}`}>
                                  {srcCfg.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 font-mono text-[12px] font-bold text-[#0D0437]">{fmtPct(d.usedPct)}</td>
                              <td className="px-4 py-3 font-mono text-[12px] text-[#6B7280]">{fmtPct(d.citedPct)}</td>
                              <td className="px-4 py-3">
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${gapStyle[gapLbl] ?? ""}`}>
                                  {gapLbl}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[10px] text-[#6B7280]">{getVintageLabel(d.ageMedian)}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── SECTION 6: QUERY COVERAGE ─────────────────────────────────────── */}
        <div className="report-section pt-10 space-y-6">
          {/* Group header + table together so the title is never orphaned on its own page */}
          <div className="print-avoid space-y-4">
            <SectionHeader number="06" title="Query Coverage" />
            <p className="text-sm text-[#374151] leading-[1.75]">
              Sample of tracked query runs showing intent, model, and brand mention status.
              Full export available from the Query Runs page.
            </p>

            <div>
            <SubLabel>Query Runs (first 8)</SubLabel>
            <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-[#F4F6F9]">
                    {["Intent", "Query", "Model", "Mentioned", "Sentiment"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {enrichedRuns.slice(0, 8).map((run) => (
                    <tr key={run.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${INTENT_BADGE[run.query_intent] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                          {INTENT_LABELS[run.query_intent] ?? run.query_intent}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-[#374151] italic max-w-[220px]">
                        <span className="line-clamp-1">{run.query_text ? `"${run.query_text}"` : "—"}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${MODEL_BADGE[run.model] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                          {MODEL_LABELS[run.model] ?? run.model}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {run.brand_mentioned
                          ? <CheckCircle2 className="h-4 w-4 text-[#1A8F5C]" />
                          : <XCircle      className="h-4 w-4 text-[#FF4B6E]" />}
                      </td>
                      <td className="px-4 py-2.5">
                        {run.mention_sentiment && run.mention_sentiment !== "not_mentioned" ? (
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                            run.mention_sentiment === "positive" ? "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]"
                            : run.mention_sentiment === "negative" ? "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]"
                            : "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"
                          }`}>
                            {run.mention_sentiment}
                          </span>
                        ) : <span className="text-[#9CA3AF] text-[11px]">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>{/* end SubLabel+table wrapper */}
          </div>{/* end print-avoid */}
        </div>

        {/* ── SECTION 7: ROADMAP ────────────────────────────────────────────── */}
        <div className="pt-10 pb-10 space-y-6">
          <SectionHeader number="07" title="AEO Roadmap" />
          <p className="text-sm text-[#374151] leading-[1.75]">
            {recommendations.length} action item{recommendations.length !== 1 ? "s" : ""} generated
            from tracking data. Each task directly addresses a detected gap in LLM visibility.
          </p>

          {recommendations.length === 0 ? (
            <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-white">
              <p className="text-sm text-[#0D0437] font-bold">No recommendations yet</p>
              <p className="text-[13px] text-[#6B7280] mt-1">Run a tracking audit — recommendations are generated automatically after each run.</p>
            </div>
          ) : (
            recTypeOrder.map((type) => {
              const tasks = recGrouped[type];
              if (!tasks || tasks.length === 0) return null;
              const tc = TYPE_CONFIG[type];
              return (
                <div key={type} className="print-avoid space-y-3">
                  <SubLabel>{tc.label} Actions</SubLabel>
                  {tasks.map((task) => {
                    const priColors: Record<number, { bg: string; text: string }> = {
                      1: { bg: "bg-[rgba(0,180,216,0.1)]",   text: "text-[#0077A8]" },
                      2: { bg: "bg-[rgba(123,94,167,0.1)]",  text: "text-[#7B5EA7]" },
                      3: { bg: "bg-[#F4F6F9]",               text: "text-[#6B7280]" },
                    };
                    const pc = priColors[task.priority] ?? priColors[3];
                    return (
                      <div key={task.id} className="border border-[#E2E8F0] rounded-lg bg-white p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <span className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${pc.bg} ${pc.text}`}>
                            P{task.priority}
                          </span>
                          <span className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${tc.bg} ${tc.text}`}>
                            {tc.label}
                          </span>
                          <span className="text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280]">
                            {task.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-[15px] font-bold text-[#0D0437] leading-snug mb-2">{task.title}</p>
                        <p className="text-sm text-[#374151] leading-[1.75] mb-3">{task.description}</p>
                        <div className="border-t border-[#E2E8F0] pt-3">
                          <p className="text-[12px] text-[#6B7280] leading-[1.65]">
                            <span className="font-bold text-[#9CA3AF]">Why: </span>
                            {task.rationale}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}

          {/* Footer */}
          <div className="mt-8 pt-6 border-t border-[#E2E8F0] flex items-center justify-between">
            <p className="font-mono text-[10px] text-[#9CA3AF]">
              Generated by Shadovi · {formatDate(data.generatedAt)} · {client.id}
            </p>
            <span className="font-exo2 font-black text-[16px] leading-none tracking-tight text-[#D1D5DB]">
              Shadovi
            </span>
          </div>
        </div>

      </div>
    </>
  );
}

// ── Shared layout components ───────────────────────────────────────────────────

function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 pb-4 border-b-2 border-[#0D0437]">
      <span className="font-serif text-[36px] font-bold text-[#0D0437] opacity-[0.09] leading-none select-none">
        {number}
      </span>
      <h2 className="font-serif text-[26px] font-semibold text-[#0D0437] leading-tight">
        {title}
      </h2>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

function CoverMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex-1 border border-white/8 bg-white/5 rounded-lg p-5">
      <p className="font-serif text-[32px] font-bold leading-none mb-2" style={{ color }}>
        {value}
      </p>
      <p className="font-mono text-[9px] text-white/40 uppercase tracking-wider leading-snug">
        {label}
      </p>
    </div>
  );
}
