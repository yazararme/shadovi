"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ModelIntentHeatmap, type HeatmapRow } from "@/components/dashboard/ModelIntentHeatmap";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Download, AlertTriangle } from "lucide-react";
import type {
  Client,
  TrackingRun,
  Competitor,
  Recommendation,
  LLMModel,
  QueryIntent,
  RecommendationType,
} from "@/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "deepseek": "DeepSeek",
};

const MODEL_COLORS: Record<LLMModel, string> = {
  "gpt-4o": "#10a37f",
  "claude-sonnet-4-6": "#d4a27e",
  "perplexity": "#1fb6ff",
  "gemini": "#4285f4",
  "deepseek": "#6366f1",
};

const INTENT_LABELS: Record<QueryIntent, string> = {
  problem_aware: "Problem-Aware",
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
};

const TYPE_LABELS: Record<RecommendationType, string> = {
  content_directive: "Content",
  entity_foundation: "Entity",
  placement_strategy: "Placement",
};

const TYPE_COLORS: Record<RecommendationType, { bg: string; text: string }> = {
  content_directive: { bg: "bg-[rgba(0,180,216,0.08)]", text: "text-[#0077A8]" },
  entity_foundation: { bg: "bg-[rgba(245,158,11,0.08)]", text: "text-[#B45309]" },
  placement_strategy: { bg: "bg-[rgba(26,143,92,0.08)]", text: "text-[#1A8F5C]" },
};

const PRIORITY_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: "bg-[rgba(0,180,216,0.1)]", text: "text-[#0077A8]" },
  2: { bg: "bg-[rgba(123,94,167,0.1)]", text: "text-[#7B5EA7]" },
  3: { bg: "bg-[#F4F6F9]", text: "text-[#6B7280]" },
};

// ── Types ─────────────────────────────────────────────────────────────────────

type EnrichedRun = TrackingRun & { query_text: string; query_intent: QueryIntent };

interface ReportData {
  client: Client;
  runs: EnrichedRun[];
  competitors: Competitor[];
  recommendations: Recommendation[];
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hoursAgo(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mentionColor(rate: number) {
  if (rate >= 60) return "#1A8F5C";
  if (rate >= 30) return "#F59E0B";
  return "#FF4B6E";
}

function intentState(rate: number): "win" | "partial" | "loss" {
  if (rate >= 60) return "win";
  if (rate >= 30) return "partial";
  return "loss";
}

// ── Main component ────────────────────────────────────────────────────────────

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

      let query = supabase.from("clients").select("*").eq("status", "active");
      if (clientIdParam) query = query.eq("id", clientIdParam);
      const { data: clients } = await query
        .order("created_at", { ascending: false })
        .limit(1);

      const client = clients?.[0];
      if (!client) {
        setError("No active client found.");
        setLoading(false);
        return;
      }

      const [
        { data: runs },
        { data: queries },
        { data: competitors },
        { data: recommendations },
      ] = await Promise.all([
        supabase
          .from("tracking_runs")
          .select("*")
          .eq("client_id", client.id)
          .order("ran_at", { ascending: false })
          .limit(10000),
        supabase
          .from("queries")
          .select("id, text, intent")
          .eq("client_id", client.id),
        supabase
          .from("competitors")
          .select("*")
          .eq("client_id", client.id)
          .order("name"),
        supabase
          .from("recommendations")
          .select("*")
          .eq("client_id", client.id)
          .neq("status", "dismissed")
          .order("priority"),
      ]);

      const queryMap = Object.fromEntries((queries ?? []).map((q) => [q.id, q]));

      const enrichedRuns: EnrichedRun[] = (runs ?? []).map((r) => ({
        ...r,
        query_text: queryMap[r.query_id]?.text ?? "",
        query_intent: (queryMap[r.query_id]?.intent ?? "problem_aware") as QueryIntent,
      }));

      setData({
        client,
        runs: enrichedRuns,
        competitors: competitors ?? [],
        recommendations: recommendations ?? [],
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report data");
    } finally {
      setLoading(false);
    }
    // clientIdParam in deps so report re-fetches when the company switcher changes
  }, [clientIdParam]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <RefreshCw className="h-4 w-4 animate-spin text-[#6B7280]" />
          <p className="font-mono text-[11px] text-[#6B7280]">Compiling report…</p>
        </div>
        {[0, 1, 2, 3].map((i) => (
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
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Report</h1>
        <p className="text-[13px] text-[#6B7280]">{error ?? "No data available."}</p>
      </div>
    );
  }

  if (data.runs.length < 10) {
    return (
      <div className="space-y-4">
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

// ── Report document ───────────────────────────────────────────────────────────

function ReportDocument({
  data,
  onRegenerate,
}: {
  data: ReportData;
  onRegenerate: () => void;
}) {
  const { client, runs, competitors, recommendations } = data;
  const trackedModels = (client.selected_models ?? []) as LLMModel[];
  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? client.url;

  // ── Metrics ──────────────────────────────────────────────────────────────
  // Positive mentions exclude negative-sentiment runs (e.g. "Brand X does not support this")
  // so that unfavourable citations don't inflate visibility scores.
  const total = runs.length;
  const positiveMentions = runs.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative");
  const mentioned = positiveMentions.length;
  const mentionRate = total > 0 ? Math.round((mentioned / total) * 100) : 0;

  // Share of Model Score = mention_rate × avg_position_weight_of_positive_mentions
  // Calculated at aggregation level so both frequency and prominence are reflected.
  const avgPositionWeight =
    mentioned > 0
      ? positiveMentions.reduce((s, r) => s + (r.share_of_model_score ?? 0), 0) / mentioned
      : 0;
  const avgScore = total > 0 ? Math.round((mentioned / total) * avgPositionWeight * 100) : 0;

  const queryMentioned = new Map<string, boolean>();
  runs.forEach((r) => {
    if (!queryMentioned.has(r.query_id)) queryMentioned.set(r.query_id, false);
    if (r.brand_mentioned && r.mention_sentiment !== "negative") queryMentioned.set(r.query_id, true);
  });
  const zeroMentionQueries = [...queryMentioned.values()].filter((v) => !v).length;
  const totalDistinctQueries = queryMentioned.size;

  // Last audited per model
  const lastAudited: Record<string, string> = {};
  runs.forEach((r) => {
    if (!lastAudited[r.model] || r.ran_at > lastAudited[r.model]) {
      lastAudited[r.model] = r.ran_at;
    }
  });

  // Per-model mention rates (positive mentions only)
  const modelStats = trackedModels.map((model) => {
    const modelRuns = runs.filter((r) => r.model === model);
    const rate =
      modelRuns.length > 0
        ? Math.round(
          (modelRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative").length /
            modelRuns.length) *
          100
        )
        : 0;
    return { model, label: MODEL_LABELS[model], rate };
  });

  // Trend data
  const dailyStats: Record<string, Record<string, { total: number; mentioned: number }>> = {};
  runs.forEach((r) => {
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
      ...Object.fromEntries(
        Object.entries(models).map(([m, s]) => [m, Math.round((s.mentioned / s.total) * 100)])
      ),
    }));

  // Narrative gaps
  const gapRuns = runs.filter((r) => !r.brand_mentioned);
  const gapsByModel: Partial<Record<LLMModel, EnrichedRun[]>> = {};
  gapRuns.forEach((r) => {
    if (!gapsByModel[r.model]) gapsByModel[r.model] = [];
    gapsByModel[r.model]!.push(r);
  });

  // Narrative Theft
  const theftCounts: Record<string, number> = {};
  gapRuns.forEach((r) => {
    (r.competitors_mentioned ?? []).forEach((comp) => {
      const key = `${comp}|${r.model}|${r.query_intent}`;
      theftCounts[key] = (theftCounts[key] ?? 0) + 1;
    });
  });
  const theftAlerts = Object.entries(theftCounts)
    .filter(([, c]) => c > 3)
    .map(([key, count]) => {
      const [competitor, model, intent] = key.split("|");
      return { competitor, model: model as LLMModel, intent: intent as QueryIntent, count };
    })
    .sort((a, b) => b.count - a.count);

  // Source breakdown
  const domainStats: Record<string, { type: string; count: number }> = {};
  gapRuns.forEach((r) => {
    (r.cited_sources ?? []).forEach((s) => {
      if (!domainStats[s.domain]) domainStats[s.domain] = { type: s.type, count: 0 };
      domainStats[s.domain].count++;
    });
  });
  const sourcesTable = Object.entries(domainStats)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 15);
  const totalCitedGaps = sourcesTable.reduce((s, [, v]) => s + v.count, 0);

  // Competitive heatmap rows
  const heatmapRows: HeatmapRow[] = [
    { name: brandName, isBrand: true, byModel: {} },
    ...competitors.map((c) => ({ name: c.name, isBrand: false, byModel: {} })),
  ];
  for (const model of trackedModels) {
    const modelRuns = runs.filter((r) => r.model === model);
    const tot = modelRuns.length;
    if (tot === 0) continue;
    const bm = modelRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative").length;
    heatmapRows[0].byModel[model] = {
      mentionRate: Math.round((bm / tot) * 100),
      isPrimary: false,
      topQueries: modelRuns
        .filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative")
        .slice(0, 2)
        .map((r) => r.query_text),
    };
    competitors.forEach((comp, idx) => {
      const cr = modelRuns.filter((r) => (r.competitors_mentioned ?? []).includes(comp.name));
      heatmapRows[idx + 1].byModel[model] = {
        mentionRate: Math.round((cr.length / tot) * 100),
        isPrimary: false,
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

  // Competitor wins
  const compGaps: Record<string, { winCount: number; queries: string[]; models: string[] }> = {};
  runs.forEach((r) => {
    if (r.brand_mentioned) return;
    (r.competitors_mentioned ?? []).forEach((comp) => {
      if (!compGaps[comp]) compGaps[comp] = { winCount: 0, queries: [], models: [] };
      compGaps[comp].winCount++;
      if (!compGaps[comp].queries.includes(r.query_text)) compGaps[comp].queries.push(r.query_text);
      if (!compGaps[comp].models.includes(r.model)) compGaps[comp].models.push(r.model);
    });
  });
  const compGapList = Object.entries(compGaps)
    .sort(([, a], [, b]) => b.winCount - a.winCount)
    .slice(0, 10);

  // Recommendations grouped
  const recGrouped: Partial<Record<RecommendationType, Recommendation[]>> = {};
  recommendations.forEach((r) => {
    if (!recGrouped[r.type]) recGrouped[r.type] = [];
    recGrouped[r.type]!.push(r);
  });
  const recTypeOrder: RecommendationType[] = [
    "content_directive",
    "entity_foundation",
    "placement_strategy",
  ];

  // Intent distribution — only count positive mentions (not negative sentiment)
  const intentCounts: Partial<Record<QueryIntent, { total: number; mentioned: number }>> = {};
  runs.forEach((r) => {
    if (!intentCounts[r.query_intent])
      intentCounts[r.query_intent] = { total: 0, mentioned: 0 };
    intentCounts[r.query_intent]!.total++;
    if (r.brand_mentioned && r.mention_sentiment !== "negative")
      intentCounts[r.query_intent]!.mentioned++;
  });
  const intentData = (
    Object.entries(intentCounts) as [QueryIntent, { total: number; mentioned: number }][]
  ).map(([intent, s]) => ({
    intent,
    label: INTENT_LABELS[intent],
    rate: Math.round((s.mentioned / s.total) * 100),
    total: s.total,
  }));

  // Executive summary paragraph
  const topComp = compGapList.length > 0 ? compGapList[0][0] : null;
  const execSummary = [
    `${brandName} has a ${mentionRate}% LLM mention rate across ${total} tracked responses spanning ${trackedModels.length} model${trackedModels.length > 1 ? "s" : ""}.`,
    `The brand's Share of Model Score is ${avgScore}%, combining positive mention frequency (${mentionRate}%) with average citation prominence.`,
    zeroMentionQueries > 0
      ? `${zeroMentionQueries} of ${totalDistinctQueries} tracked queries (${Math.round((zeroMentionQueries / totalDistinctQueries) * 100)}%) return no brand mention — these represent the highest-priority AEO gaps.`
      : `The brand appears in every tracked query — complete query portfolio coverage achieved.`,
    topComp
      ? `${topComp} is the most frequently co-mentioned competitor, displacing ${brandName} in ${compGapList[0][1].winCount} query responses.`
      : `No competitors were detected displacing the brand in tracked responses.`,
    recommendations.length > 0
      ? `${recommendations.length} AEO action item${recommendations.length > 1 ? "s" : ""} generated — ${recGrouped.content_directive?.length ?? 0} content directives, ${recGrouped.entity_foundation?.length ?? 0} entity foundations, ${recGrouped.placement_strategy?.length ?? 0} placement strategies.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-break { page-break-before: always; break-before: page; }
          .print-avoid-break { page-break-inside: avoid; break-inside: avoid; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          html, body { height: auto !important; overflow: visible !important; }
          div[class*="h-screen"] { height: auto !important; overflow: visible !important; display: block !important; }
          main { height: auto !important; overflow: visible !important; padding: 24px !important; }
        }
      `}</style>

      {/* Action bar — hidden on print */}
      <div className="no-print flex items-center justify-between mb-8 sticky top-0 bg-white/95 backdrop-blur border-b border-[#E2E8F0] py-3 -mx-8 px-8 z-10">
        <div>
          <h1 className="font-serif text-[18px] font-semibold text-[#0D0437]">AEO Intelligence Report</h1>
          <p className="font-mono text-[11px] text-[#6B7280]">
            Generated {formatDateTime(data.generatedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded border border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437] transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Regenerate
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-2 rounded bg-[#0D0437] text-white hover:bg-[#1a1150] transition-colors"
          >
            <Download className="h-3 w-3" />
            Download PDF
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          REPORT DOCUMENT
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="max-w-5xl mx-auto" id="report-document">

        {/* ── COVER ──────────────────────────────────────────────────────── */}
        <section className="print-avoid-break rounded-2xl print:rounded-none overflow-hidden mb-8">
          {/* Dark cover with grid pattern */}
          <div className="dark-grid relative bg-[#0D0437] px-10 py-12">
            {/* Top row: logo + report badge */}
            <div className="flex items-center justify-between mb-10">
              <span className="font-exo2 font-black text-[20px] leading-none tracking-tight text-white/80">
                Shadovi
              </span>
              <span className="font-mono text-[9px] font-bold tracking-[2px] uppercase text-white/40 border border-white/10 px-3 py-1 rounded-full">
                AEO Intelligence Report
              </span>
            </div>

            {/* Eyebrow */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-px bg-[#FF4B6E]" />
              <span className="font-mono text-[9px] font-bold tracking-[2.5px] uppercase text-[#FF4B6E]">
                Generated Report
              </span>
            </div>

            {/* Brand name */}
            <h1 className="font-serif text-[64px] font-semibold text-white leading-[0.95] tracking-[-2px] mb-2">
              {brandName}
            </h1>
            <p className="font-mono text-[12px] text-white/35 mb-10">{client.url}</p>

            {/* 3 cover metrics */}
            <div className="grid grid-cols-3 gap-4 mb-8">
              <CoverMetric
                label="LLM Mention Rate"
                value={`${mentionRate}%`}
                color={mentionColor(mentionRate)}
              />
              <CoverMetric
                label="Share of Model Score"
                value={`${avgScore}%`}
                color={mentionColor(avgScore)}
              />
              <CoverMetric
                label="Zero-mention Queries"
                value={zeroMentionQueries === 0 ? "None" : `${zeroMentionQueries} / ${totalDistinctQueries}`}
                color={zeroMentionQueries === 0 ? "#1A8F5C" : zeroMentionQueries / Math.max(totalDistinctQueries, 1) > 0.3 ? "#FF4B6E" : "#F59E0B"}
              />
            </div>

            {/* Live indicator + date row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="live-dot" />
                <span className="font-mono text-[11px] text-white/40">Data is live</span>
              </div>
              <div className="flex items-center gap-4 font-mono text-[10px] text-white/30">
                <span>{formatDate(data.generatedAt)}</span>
                <span>·</span>
                <span>{total} responses</span>
                <span>·</span>
                <span>{trackedModels.map((m) => MODEL_LABELS[m]).join(", ")}</span>
              </div>
            </div>
          </div>

          {/* Executive summary — below the dark cover */}
          <div className="bg-white border border-t-0 border-[#E2E8F0] rounded-b-2xl print:rounded-none px-10 py-6">
            <p className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] mb-3">
              Executive Summary
            </p>
            <p className="text-[14px] leading-[1.75] text-[#1A1A2E]">{execSummary}</p>
          </div>
        </section>

        {/* ── SECTION 1: LLM Visibility ──────────────────────────────────── */}
        <section className="print-break pt-8 pb-8 space-y-8">
          <ReportSectionHeader number="01" title="LLM Visibility" />

          {/* Model performance cards */}
          <div className="print-avoid-break space-y-3">
            <SubLabel>Model Performance</SubLabel>
            <div className={`grid gap-4 ${trackedModels.length === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"}`}>
              {modelStats.map(({ model, rate }) => {
                const lastCheck = lastAudited[model];
                const stale = lastCheck ? hoursAgo(lastCheck) > 48 : true;
                return (
                  <div key={model} className="border border-[#E2E8F0] rounded-lg bg-white p-5">
                    <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-3">
                      {MODEL_LABELS[model]}
                    </p>
                    <p
                      className="font-serif text-[40px] font-bold leading-none mb-3"
                      style={{ color: mentionColor(rate) }}
                    >
                      {rate}%
                    </p>
                    {/* Gradient progress bar */}
                    <div className="h-[5px] bg-[#F4F6F9] rounded-full mb-2">
                      <div
                        className="h-full rounded-full grad-bar transition-all"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                    <p className="font-mono text-[10px] text-[#6B7280] leading-snug">
                      {lastCheck ? formatDateTime(lastCheck) : "Not yet run"}
                    </p>
                    {stale && (
                      <span className="text-[8px] font-bold tracking-wider text-[#FF4B6E] mt-0.5 block">
                        STALE
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Intent breakdown cards */}
          {intentData.length > 0 && (
            <div className="print-avoid-break space-y-3">
              <SubLabel>Performance by Query Intent</SubLabel>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {intentData.map(({ intent, label, rate, total: t }) => {
                  const state = intentState(rate);
                  const stateMap = {
                    win: { bar: "#1A8F5C", text: "#1A8F5C" },
                    partial: { bar: "#F59E0B", text: "#B45309" },
                    loss: { bar: "#FF4B6E", text: "#FF4B6E" },
                  };
                  const colors = stateMap[state];
                  return (
                    <div
                      key={intent}
                      className="border border-[#E2E8F0] rounded-lg bg-white p-5"
                      style={{ borderBottom: `3px solid ${colors.bar}` }}
                    >
                      <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
                        {label}
                      </p>
                      <p
                        className="font-serif text-[32px] font-bold leading-none mb-1"
                        style={{ color: colors.text }}
                      >
                        {rate}%
                      </p>
                      <p className="font-mono text-[10px] text-[#6B7280]">{t} queries</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trend chart */}
          {trendData.length >= 2 && (
            <div className="print-avoid-break space-y-3">
              <SubLabel>Mention Rate Trend</SubLabel>
              <div className="border border-[#E2E8F0] rounded-lg bg-white p-5">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6B7280" }} />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #E2E8F0",
                        borderRadius: "8px",
                        fontSize: "11px",
                      }}
                      formatter={(v: number) => [`${v}%`, ""]}
                    />
                    {trackedModels.map((model) => (
                      <Line
                        key={model}
                        type="monotone"
                        dataKey={model}
                        name={MODEL_LABELS[model]}
                        stroke={MODEL_COLORS[model]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </section>

        {/* ── SECTION 2: Perception Intelligence ──────────────────────────── */}
        <section className="print-break pt-8 pb-8 space-y-8">
          <ReportSectionHeader number="02" title="Perception Intelligence" />

          <p className="text-[13px] text-[#374151] leading-[1.75]">
            Perception gaps are queries where <strong className="text-[#0D0437]">{brandName}</strong> was
            absent from the LLM response. Each gap represents a missed opportunity to influence the
            buyer&apos;s research journey. There are{" "}
            <strong className="text-[#0D0437]">{gapRuns.length} total gap responses</strong> across all
            models.
          </p>

          {/* Narrative Theft Alerts */}
          {theftAlerts.length > 0 && (
            <div className="print-avoid-break space-y-3">
              <SubLabel>Perception Theft Alerts</SubLabel>
              <div className="space-y-2">
                {theftAlerts.map(({ competitor, model, intent, count }) => (
                  <div
                    key={`${competitor}|${model}|${intent}`}
                    className="flex items-start gap-3 border border-[rgba(255,75,110,0.18)] bg-[rgba(255,75,110,0.04)] border-l-4 border-l-[#FF4B6E] rounded-[0_8px_8px_0] p-4"
                  >
                    <AlertTriangle className="h-4 w-4 text-[#FF4B6E] shrink-0 mt-0.5" />
                    <div className="text-[13px] leading-[1.65] text-[#1A1A2E]">
                      <strong className="text-[#FF4B6E]">{competitor}</strong>
                      {" "}appears in{" "}
                      <strong className="text-[#0D0437]">{count} queries</strong>
                      {" "}where you are absent — on{" "}
                      <strong className="text-[#0D0437]">{MODEL_LABELS[model]}</strong>
                      {" "}for{" "}
                      <strong className="text-[#0D0437]">{INTENT_LABELS[intent]}</strong>
                      {" "}intent.
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gap list per model */}
          {trackedModels.map((model) => {
            const modelGaps = gapsByModel[model] ?? [];
            if (modelGaps.length === 0) return null;
            return (
              <div key={model} className="print-avoid-break space-y-3">
                <SubLabel>
                  {MODEL_LABELS[model]} — {modelGaps.length} Gap{modelGaps.length !== 1 ? "s" : ""}
                </SubLabel>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-[#F4F6F9]">
                        {["Query", "Intent", "Competitor cited", "Source cited"].map((h) => (
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
                      {modelGaps.slice(0, 30).map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)]">
                          <td className="px-4 py-3 text-[11px] text-[#1A1A2E] italic max-w-[260px]">
                            <span className="line-clamp-2">&ldquo;{r.query_text}&rdquo;</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280] whitespace-nowrap">
                              {INTENT_LABELS[r.query_intent]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[12px]">
                            {(r.competitors_mentioned ?? []).length > 0 ? (
                              <span className="text-[#FF4B6E] font-semibold">
                                {(r.competitors_mentioned ?? []).join(", ")}
                              </span>
                            ) : (
                              <span className="text-[#6B7280]">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[11px] text-[#6B7280]">
                            {(r.cited_sources ?? []).length > 0
                              ? (r.cited_sources ?? [])[0].domain
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Source breakdown */}
          {sourcesTable.length > 0 && (
            <div className="print-avoid-break space-y-3">
              <SubLabel>Third-Party Sources Cited in Gap Responses</SubLabel>
              <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[#F4F6F9]">
                      {["Domain", "Type", "Appearances", "% of Gaps"].map((h) => (
                        <th
                          key={h}
                          className={`px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] ${h === "Appearances" || h === "% of Gaps" ? "text-right" : "text-left"
                            }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sourcesTable.map(([domain, { type, count }]) => (
                      <tr key={domain} className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)]">
                        <td className="px-4 py-3 font-semibold text-[#0D0437] text-[12px]">{domain}</td>
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280]">
                            {type}
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
        </section>

        {/* ── SECTION 3: Competitive Intelligence ────────────────────────── */}
        <section className="print-break pt-8 pb-8 space-y-8">
          <ReportSectionHeader number="03" title="Competitive Intelligence" />

          <p className="text-[13px] text-[#374151] leading-[1.75]">
            The heatmap shows LLM mention rates for{" "}
            <strong className="text-[#0D0437]">{brandName}</strong> and each tracked competitor
            across all models. A crown indicates the entity with the highest mention rate for that model.
          </p>

          {/* Heatmap */}
          <div className="print-avoid-break">
            <SubLabel>Share of Model Heatmap</SubLabel>
            <ModelIntentHeatmap rows={heatmapRows} models={trackedModels} />
          </div>

          {/* Competitor wins table */}
          {compGapList.length > 0 && (
            <div className="print-avoid-break space-y-3">
              <SubLabel>Competitor Displacement</SubLabel>
              <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto bg-white">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[#F4F6F9]">
                      {["Competitor", "Displacement Count", "Models", "Sample Query"].map((h) => (
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
                    {compGapList.map(([name, { winCount, queries, models }]) => (
                      <tr key={name} className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)]">
                        <td className="px-4 py-3 font-bold text-[14px] text-[#0D0437]">{name}</td>
                        <td className="px-4 py-3">
                          <div className="w-8 h-8 rounded-full bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] font-bold text-[12px] flex items-center justify-center">
                            {winCount}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {models.map((m) => (
                              <span
                                key={m}
                                className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#0D0437] border border-[#E2E8F0]"
                              >
                                {MODEL_LABELS[m as LLMModel] ?? m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[#6B7280] italic hidden md:table-cell max-w-xs truncate">
                          &ldquo;{queries[0]}&rdquo;
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* ── SECTION 4: AEO Roadmap ────────────────────────────────────── */}
        {recommendations.length > 0 && (
          <section className="print-break pt-8 pb-8 space-y-8">
            <ReportSectionHeader number="04" title="AEO Roadmap" />

            <p className="text-[13px] text-[#374151] leading-[1.75]">
              {recommendations.length} action item{recommendations.length > 1 ? "s" : ""} generated
              from tracking data. Each task directly addresses a detected gap in LLM visibility.
              Priorities are ranked 1–{recommendations.length} (1 = highest urgency).
            </p>

            <div className="print-avoid-break space-y-3">
              {recTypeOrder.map((type) => {
                const tasks = recGrouped[type];
                if (!tasks || tasks.length === 0) return null;
                return (
                  <div key={type} className="space-y-3">
                    <SubLabel>{TYPE_LABELS[type]} Actions</SubLabel>
                    {tasks.map((task) => {
                      const priColors = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS[3];
                      const typeColors = TYPE_COLORS[task.type];
                      return (
                        <div
                          key={task.id}
                          className="border border-[#E2E8F0] rounded-lg bg-white p-5"
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <span
                              className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${priColors.bg} ${priColors.text}`}
                            >
                              P{task.priority}
                            </span>
                            <span
                              className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${typeColors.bg} ${typeColors.text}`}
                            >
                              {TYPE_LABELS[task.type]}
                            </span>
                          </div>
                          <p className="text-[15px] font-bold text-[#0D0437] leading-snug mb-2">
                            {task.title}
                          </p>
                          <p className="text-[13px] text-[#374151] leading-[1.75] mb-3">
                            {task.description}
                          </p>
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
              })}
            </div>
          </section>
        )}

        {/* ── SECTION 5: Full Query Portfolio ─────────────────────────────── */}
        <section className="print-break pt-8 pb-8 space-y-8">
          <ReportSectionHeader number="05" title="Full Query Portfolio" />

          <p className="text-[13px] text-[#374151] leading-[1.75]">
            All {totalDistinctQueries} tracked queries with their aggregated brand mention status
            across all models.
          </p>

          {(["problem_aware", "category", "comparative", "validation"] as QueryIntent[]).map(
            (intent) => {
              const intentRuns = runs.filter((r) => r.query_intent === intent);
              const qMap = new Map<string, { text: string; mentionedOn: string[]; missedOn: string[] }>();
              intentRuns.forEach((r) => {
                if (!qMap.has(r.query_id)) {
                  qMap.set(r.query_id, { text: r.query_text, mentionedOn: [], missedOn: [] });
                }
                const q = qMap.get(r.query_id)!;
                if (r.brand_mentioned && r.mention_sentiment !== "negative") q.mentionedOn.push(r.model);
                else q.missedOn.push(r.model);
              });
              if (qMap.size === 0) return null;

              return (
                <div key={intent} className="print-avoid-break space-y-3">
                  <SubLabel>
                    {INTENT_LABELS[intent]} ({qMap.size} queries)
                  </SubLabel>
                  <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-[#F4F6F9]">
                          {["Query", "Mentioned on", "Absent on"].map((h) => (
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
                        {[...qMap.values()].map((q, i) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)]">
                            <td className="px-4 py-3 text-[11px] text-[#1A1A2E] italic max-w-xs">
                              <span className="line-clamp-2">&ldquo;{q.text}&rdquo;</span>
                            </td>
                            <td className="px-4 py-3 text-[11px]">
                              {q.mentionedOn.length > 0 ? (
                                <span className="text-[#1A8F5C] font-semibold">
                                  {q.mentionedOn.map((m) => MODEL_LABELS[m as LLMModel] ?? m).join(", ")}
                                </span>
                              ) : (
                                <span className="text-[#6B7280]">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-[11px]">
                              {q.missedOn.length > 0 ? (
                                <span className="text-[#FF4B6E] font-semibold">
                                  {q.missedOn.map((m) => MODEL_LABELS[m as LLMModel] ?? m).join(", ")}
                                </span>
                              ) : (
                                <span className="text-[#6B7280]">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }
          )}
        </section>

        {/* ── Methodology ─────────────────────────────────────────────────── */}
        <section className="print-break rounded-2xl print:rounded-none overflow-hidden mt-4 mb-8">
          <div className="dark-grid relative bg-[#0D0437] px-10 py-12">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-px bg-[#00B4D8]" />
              <span className="font-mono text-[9px] font-bold tracking-[2.5px] uppercase text-[#00B4D8]">
                Methodology
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                {
                  title: "Data Collection",
                  body: "Each tracked query was submitted verbatim to the selected LLMs. Responses are recorded as-is with no summarisation.",
                },
                {
                  title: "Brand Detection",
                  body: "Case-insensitive string matching detects brand presence. Mention position is calculated as first-index / response-length.",
                },
                {
                  title: "Share of Model Score",
                  body: "mention_rate × avg_position_weight. Mention rate = positive mentions / total runs. Position weights: 1.0 first-third, 0.6 middle, 0.3 last-third. Negative-sentiment mentions excluded from both components.",
                },
                {
                  title: "Sentiment",
                  body: "Keyword heuristics in a 200-char window around the brand mention. Upgrade to Claude-based sentiment analysis is planned.",
                },
                {
                  title: "Competitor Detection",
                  body: "Competitor names as configured in onboarding are checked for presence. Results represent co-mentions, not comparisons.",
                },
                {
                  title: "Recommendations",
                  body: "Generated by Claude after each tracking run. Classified as Content Directive, Entity Foundation, or Placement Strategy.",
                },
              ].map(({ title, body }) => (
                <div key={title} className="border border-white/8 rounded-lg p-5 bg-white/3">
                  <p className="text-[9px] font-bold tracking-[2px] uppercase text-white/40 mb-2">
                    {title}
                  </p>
                  <p className="text-[12px] text-white/60 leading-[1.7]">{body}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-white/8 mt-8 pt-6 flex items-center justify-between">
              <p className="font-mono text-[10px] text-white/25">
                Generated by Shadovi · {formatDate(data.generatedAt)} · {data.client.id}
              </p>
              <span className="font-exo2 font-black text-[16px] leading-none tracking-tight text-white/30">
                Shadovi
              </span>
            </div>
          </div>
        </section>

      </div>
    </>
  );
}

// ── Small shared layout components ────────────────────────────────────────────

function ReportSectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-4 pb-4 border-b-2 border-[#0D0437]">
      <span className="font-serif text-[38px] font-bold text-[#0D0437] opacity-[0.09] leading-none select-none">
        {number}
      </span>
      <h2 className="font-serif text-[28px] font-semibold text-[#0D0437] leading-tight">
        {title}
      </h2>
    </div>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 my-5">
      <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

function CoverMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex-1 border border-white/8 bg-white/5 rounded-lg p-6">
      <p className="font-serif text-[36px] font-bold leading-none mb-2" style={{ color }}>
        {value}
      </p>
      <p className="font-mono text-[10px] text-white/40 uppercase tracking-wider leading-snug">
        {label}
      </p>
    </div>
  );
}
