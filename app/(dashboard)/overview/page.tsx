"use client";

import React, { useEffect, useState, Suspense } from "react";
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
import { InsightMetric } from "@/components/dashboard/InsightMetric";
import { ResponseDrawer } from "@/components/dashboard/ResponseDrawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, AlertTriangle, ExternalLink, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import type { Client, TrackingRun, Recommendation, LLMModel } from "@/types";

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

const MODEL_BADGE: Record<LLMModel, string> = {
  "gpt-4o": "bg-[rgba(16,163,127,0.08)] text-[#10a37f] border-[rgba(16,163,127,0.2)]",
  "claude-sonnet-4-6": "bg-[rgba(212,162,126,0.08)] text-[#b5804a] border-[rgba(212,162,126,0.2)]",
  "perplexity": "bg-[rgba(31,182,255,0.08)] text-[#1580c0] border-[rgba(31,182,255,0.2)]",
  "gemini": "bg-[rgba(66,133,244,0.08)] text-[#4285f4] border-[rgba(66,133,244,0.2)]",
  "deepseek": "bg-[rgba(99,102,241,0.08)] text-[#6366f1] border-[rgba(99,102,241,0.2)]",
};

// Initials rendered inside model avatars (Gemini/GPT both start with G — kept distinct by colour)
const MODEL_INITIALS: Record<LLMModel, string> = {
  "gpt-4o": "G",
  "claude-sonnet-4-6": "C",
  "perplexity": "P",
  "gemini": "Gm",
  "deepseek": "D",
};

const MODEL_AVATAR_STYLE: Record<LLMModel, { bg: string; border: string; text: string }> = {
  "gpt-4o": { bg: "bg-[rgba(16,163,127,0.12)]", border: "border-[rgba(16,163,127,0.35)]", text: "text-[#10a37f]" },
  "claude-sonnet-4-6": { bg: "bg-[rgba(212,162,126,0.12)]", border: "border-[rgba(212,162,126,0.35)]", text: "text-[#b5804a]" },
  "perplexity": { bg: "bg-[rgba(31,182,255,0.12)]", border: "border-[rgba(31,182,255,0.35)]", text: "text-[#1580c0]" },
  "gemini": { bg: "bg-[rgba(66,133,244,0.12)]", border: "border-[rgba(66,133,244,0.35)]", text: "text-[#4285f4]" },
  "deepseek": { bg: "bg-[rgba(99,102,241,0.12)]", border: "border-[rgba(99,102,241,0.35)]", text: "text-[#6366f1]" },
};

const TYPE_LABEL: Record<string, string> = {
  content_directive: "Content",
  entity_foundation: "Entity",
  placement_strategy: "Placement",
};

const TYPE_BADGE: Record<string, string> = {
  content_directive: "bg-[rgba(0,180,216,0.1)] text-[#0077A8]",
  entity_foundation: "bg-[rgba(123,94,167,0.1)] text-[#7B5EA7]",
  placement_strategy: "bg-[#F4F6F9] text-[#6B7280]",
};

const INTENT_LABEL: Record<string, string> = {
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
  problem_aware: "Awareness",
};

// Each intent gets a distinct colour token so the column reads at a glance
const INTENT_BADGE: Record<string, string> = {
  category: "bg-[rgba(13,4,55,0.06)]    text-[#0D0437]  border-[rgba(13,4,55,0.15)]",
  comparative: "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7]  border-[rgba(123,94,167,0.2)]",
  validation: "bg-[rgba(26,143,92,0.08)]  text-[#1A8F5C]  border-[rgba(26,143,92,0.2)]",
  problem_aware: "bg-[rgba(31,182,255,0.08)] text-[#1580c0]  border-[rgba(31,182,255,0.2)]",
  bait: "bg-[rgba(245,158,11,0.08)] text-[#B45309]  border-[rgba(245,158,11,0.2)]",
};

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  neutral:  "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
  negative: "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
};

function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

function formatTimeAgo(isoDate: string): string {
  const h = hoursAgo(isoDate);
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

interface DrawerState {
  run: TrackingRun;
  queryText: string;
}

function OverviewInner() {
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client");
  const [client, setClient] = useState<Client | null>(null);
  const [runs, setRuns] = useState<TrackingRun[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [queryMap, setQueryMap] = useState<Map<string, string>>(new Map());
  const [queryIntentMap, setQueryIntentMap] = useState<Map<string, string>>(new Map());
  const [queryIsBaitMap, setQueryIsBaitMap] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [factAccuracyPct, setFactAccuracyPct] = useState<number | null>(null);
  const [factAccuracyCount, setFactAccuracyCount] = useState(0);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  async function loadData() {
    const supabase = createClient();
    let query = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) {
      query = query.eq("id", clientIdParam);
    }
    const { data: clients } = await query
      .order("created_at", { ascending: false })
      .limit(1);

    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (activeClient) {
      const [{ data: runData }, { data: recData }, { data: queryData }, { data: knowledgeData }] = await Promise.all([
        supabase
          .from("tracking_runs")
          .select("*")
          .eq("client_id", activeClient.id)
          .order("ran_at", { ascending: false })
          .limit(10000),
        supabase
          .from("recommendations")
          .select("*")
          .eq("client_id", activeClient.id)
          .eq("status", "open")
          .order("priority")
          .limit(3),
        supabase
          .from("queries")
          .select("id, text, intent, is_bait")
          .eq("client_id", activeClient.id),
        supabase
          .from("brand_knowledge_scores")
          .select("accuracy")
          .eq("client_id", activeClient.id),
      ]);
      setRuns(runData ?? []);
      setRecommendations(recData ?? []);
      const map = new Map<string, string>();
      const intentMap = new Map<string, string>();
      const isBaitMap = new Map<string, boolean>();
      (queryData ?? []).forEach((q: { id: string; text: string; intent: string; is_bait: boolean }) => {
        map.set(q.id, q.text);
        intentMap.set(q.id, q.intent);
        isBaitMap.set(q.id, q.is_bait);
      });
      setQueryMap(map);
      setQueryIntentMap(intentMap);
      setQueryIsBaitMap(isBaitMap);

      // Fact accuracy from brand_knowledge_scores (all-time, all models)
      const kRows = knowledgeData ?? [];
      const kTotal = kRows.length;
      const kCorrect = kRows.filter((r: { accuracy: string }) => r.accuracy === "correct").length;
      setFactAccuracyPct(kTotal > 0 ? Math.round((kCorrect / kTotal) * 100) : null);
      setFactAccuracyCount(kTotal);
    }
    setLoading(false);
  }

  async function handleRunNow() {
    if (!client) return;
    setRunning(true);
    try {
      const res = await fetch("/api/tracking/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Tracking run queued — check back in a few minutes.");
      } else {
        toast.error(data.error ?? "Failed to queue run");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Overview</h1>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg p-5 space-y-3 bg-white">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-[5px] w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Overview</h1>
        <p className="text-sm text-[#6B7280]">
          No active client.{" "}
          <Link href="/discover" className="underline underline-offset-4 text-[#0D0437]">
            Start onboarding →
          </Link>
        </p>
      </div>
    );
  }

  if (runs.length < 10) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Overview</h1>
            <p className="font-mono text-[11px] text-[#6B7280] mt-1">
              {client.brand_name ?? client.url}
            </p>
          </div>
          <Button
            onClick={handleRunNow}
            disabled={running}
            size="sm"
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Queuing…" : "Run First Audit"}
          </Button>
        </div>
        <div className="border border-[#E2E8F0] rounded-lg p-8 space-y-4 bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437] text-center">
            {runs.length === 0
              ? "No tracking data yet — run your first audit above"
              : `${runs.length} run${runs.length > 1 ? "s" : ""} collected — need 10+ for full dashboard`}
          </p>
          {[
            { label: "LLM Mention Rate", desc: "% of queries where your brand appears across all models" },
            { label: "Fact Accuracy", desc: "% of brand facts correctly stated by LLMs" },
            { label: "Visibility Gaps", desc: "% of queries where no model surfaces your brand" },
            { label: "Trend Lines", desc: "Weekly mention rate per model" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-4 p-4 bg-white border border-[#E2E8F0] rounded-lg">
              <Skeleton className="h-10 w-20 rounded-lg shrink-0" />
              <div>
                <p className="text-sm font-bold text-[#0D0437]">{item.label}</p>
                <p className="text-xs text-[#6B7280] mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Validation intent runs are excluded — they always mention the brand by name which inflates share-of-model.
  const nonValidationRuns = runs.filter((r) => queryIntentMap.get(r.query_id) !== "validation");
  const total = nonValidationRuns.length;
  const positiveMentions = nonValidationRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative");
  const mentioned = positiveMentions.length;
  const mentionRate = total > 0 ? Math.round((mentioned / total) * 100) : 0;


  const queryMentioned = new Map<string, boolean>();
  nonValidationRuns.forEach((r) => {
    if (!queryMentioned.has(r.query_id)) queryMentioned.set(r.query_id, false);
    if (r.brand_mentioned && r.mention_sentiment !== "negative") queryMentioned.set(r.query_id, true);
  });
  const zeroMentionQueries = [...queryMentioned.values()].filter((v) => !v).length;
  const totalDistinctQueries = queryMentioned.size;

  const lastAudited: Record<string, string> = {};
  const modelRunCounts: Partial<Record<LLMModel, number>> = {};
  const modelBreakdown: Partial<Record<LLMModel, { category: number; comparative: number; validation: number; bait: number }>> = {};
  runs.forEach((r) => {
    if (!lastAudited[r.model] || r.ran_at > lastAudited[r.model]) {
      lastAudited[r.model] = r.ran_at;
    }
    modelRunCounts[r.model] = (modelRunCounts[r.model] ?? 0) + 1;
    if (!modelBreakdown[r.model]) modelBreakdown[r.model] = { category: 0, comparative: 0, validation: 0, bait: 0 };
    const intent = queryIntentMap.get(r.query_id);
    if (intent === "category") modelBreakdown[r.model]!.category++;
    else if (intent === "comparative") modelBreakdown[r.model]!.comparative++;
    else if (intent === "validation") modelBreakdown[r.model]!.validation++;
    if (queryIsBaitMap.get(r.query_id)) modelBreakdown[r.model]!.bait++;
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
      ...Object.fromEntries(
        Object.entries(models).map(([model, stats]) => [
          model,
          Math.round((stats.mentioned / stats.total) * 100),
        ])
      ),
    }));

  const trackedModels = (client.selected_models ?? []) as LLMModel[];

  const mentionInsight =
    trendData.length < 2
      ? "Insufficient data — run more queries to establish a baseline."
      : mentionRate >= 60
        ? `Strong LLM visibility — brand appears in ${mentionRate}% of queries.`
        : mentionRate >= 30
          ? `Moderate visibility — ${zeroMentionQueries} of ${totalDistinctQueries} queries return no mention.`
          : `Critical gap — brand absent from ${100 - mentionRate}% of LLM responses.`;

  const gapPct = totalDistinctQueries > 0
    ? Math.round((zeroMentionQueries / totalDistinctQueries) * 100)
    : 0;

  const factAccuracyInsight =
    factAccuracyPct === null
      ? "No knowledge-validation runs yet — run the Brand Knowledge audit to see results."
      : factAccuracyPct >= 80
        ? `LLMs accurately describe ${factAccuracyPct}% of your brand facts — strong knowledge coverage.`
        : factAccuracyPct >= 50
          ? `${factAccuracyPct}% accuracy across ${factAccuracyCount} scored facts — some are misrepresented or uncertain.`
          : `Only ${factAccuracyPct}% accurate — LLMs frequently misstate your brand facts.`;

  const visibilityGapInsight =
    zeroMentionQueries === 0
      ? "Brand appears in every tracked query — complete coverage."
      : `${zeroMentionQueries} of ${totalDistinctQueries} queries return zero mentions across all models.`;

  // Citation rate: how often LLMs include source links (excludes validation queries to match other metrics)
  const citationPct = total > 0
    ? Math.round((nonValidationRuns.filter((r) => r.citation_present).length / total) * 100)
    : 0;
  const citationInsight =
    citationPct >= 40
      ? `${citationPct}% of LLM responses include source citations.`
      : citationPct >= 20
        ? `${citationPct}% citation rate — most responses lack source attribution.`
        : `Only ${citationPct}% of responses cite sources — low attribution across LLMs.`;

  // Maps recommendation type → destination page
  function getRecDestination(type: string): string {
    const map: Record<string, string> = {
      content_directive: "/knowledge",
      entity_foundation: "/narrative",
    };
    return map[type] ?? "/knowledge";
  }

  // Auto-narrative: plain-English verdict bridging KPIs → recommendations
  const visibilityLevel = mentionRate >= 70 ? "strong" : mentionRate >= 40 ? "moderate" : "low";
  const narrativeGapClause = zeroMentionQueries > 0
    ? ` ${zeroMentionQueries} ${zeroMentionQueries === 1 ? "query returns" : "queries return"} no brand mentions.`
    : "";
  const narrativeAccuracyClause = (() => {
    if (factAccuracyPct === null) return "";
    if (factAccuracyPct >= 80) {
      const correctCount = Math.round((factAccuracyPct / 100) * factAccuracyCount);
      return ` ${correctCount} brand ${correctCount === 1 ? "fact is" : "facts are"} described correctly by LLMs.`;
    }
    const inaccuratePct = 100 - factAccuracyPct;
    return ` ${inaccuratePct}% of brand facts are described incorrectly — review Brand Knowledge for details.`;
  })();

  return (
    <div>
      {/* ── 1. Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Overview
          </h1>
          <p className="font-mono text-[11px] text-[#6B7280] mt-1">
            {client.brand_name ?? client.url}
          </p>
        </div>
        <Button
          onClick={handleRunNow}
          disabled={running}
          size="sm"
          className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${running ? "animate-spin" : ""}`} />
          {running ? "Queuing…" : "Run now"}
        </Button>
      </div>

      {/* ── 2. Audit Coverage Bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-x-2.5 py-2 mb-6 flex-wrap">
        <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap shrink-0">
          Audit Coverage
        </span>
        <div className="h-3 w-px bg-[#E2E8F0] shrink-0" />
        {/* Per-model name + last-run timestamp, dot-separated */}
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {trackedModels
            .filter((m) => (modelRunCounts[m] ?? 0) > 0)
            .map((model, i) => {
              const ts = lastAudited[model];
              // Flag stale runs (>48 h) in red so data-freshness issues are obvious
              const stale = ts ? hoursAgo(ts) > 48 : true;
              return (
                <React.Fragment key={model}>
                  {i > 0 && (
                    <span className="text-[#D1D5DB] text-[10px] select-none" aria-hidden>·</span>
                  )}
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <span className="text-[11px] font-semibold text-[#374151]">
                      {MODEL_LABELS[model]}
                    </span>
                    <span className={`text-[10px] ${stale ? "text-[#FF4B6E]" : "text-[#9CA3AF]"}`}>
                      {ts ? formatTimeAgo(ts) : "no data"}
                    </span>
                  </span>
                </React.Fragment>
              );
            })}
        </div>
        {/* Total query + model count — quick audit-scope summary */}
        <span className="text-[10px] text-[#9CA3AF] font-mono whitespace-nowrap shrink-0">
          {queryMap.size} {queryMap.size !== 1 ? "queries" : "query"}
          {" · "}
          {trackedModels.filter((m) => (modelRunCounts[m] ?? 0) > 0).length} model{trackedModels.filter((m) => (modelRunCounts[m] ?? 0) > 0).length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── 3. Visibility Metrics strip ───────────────────────────────────────── */}
      <SubLabel>Visibility Metrics</SubLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <InsightMetric
          label="LLM Mention Rate"
          value={`${mentionRate}%`}
          barPercent={mentionRate}
          insight={mentionInsight}
          sentiment={mentionRate >= 60 ? "positive" : mentionRate >= 30 ? "neutral" : "negative"}
          navLink={{ href: "/narrative", label: "See how you compare" }}
        />
        <InsightMetric
          label="Fact Accuracy"
          value={factAccuracyPct !== null ? `${factAccuracyPct}%` : "—"}
          barPercent={factAccuracyPct}
          insight={factAccuracyInsight}
          sentiment={factAccuracyPct === null ? "neutral" : factAccuracyPct >= 80 ? "positive" : factAccuracyPct >= 50 ? "neutral" : "negative"}
          navLink={{ href: "/knowledge", label: "View brand knowledge" }}
        />
        <InsightMetric
          label="Visibility Gaps"
          value={`${gapPct}%`}
          insight={visibilityGapInsight}
          sentiment={zeroMentionQueries === 0 ? "positive" : gapPct <= 30 ? "neutral" : "negative"}
        />
        <InsightMetric
          label="Source Attribution"
          value={`${citationPct}%`}
          barPercent={citationPct}
          insight={citationInsight}
          sentiment={citationPct >= 40 ? "positive" : citationPct >= 20 ? "neutral" : "negative"}
          navLink={{ href: "/sources", label: "View source intelligence" }}
        />
      </div>

      {/* ── 4. Narrative Sentence ─────────────────────────────────────────────── */}
      <p className="text-[14px] text-[#374151] leading-relaxed mt-6 mb-5">
        <span className="font-semibold text-[#0D0437]">{client.brand_name ?? client.url}</span>
        {" "}has <span className="font-semibold text-[#0D0437]">{visibilityLevel}</span> AI visibility.
        {narrativeGapClause}
        {narrativeAccuracyClause}
      </p>

      {/* ── 5. Top Priorities (moved above chart) ─────────────────────────────── */}
      {recommendations.length > 0 && (
        <>
          <SubLabel>Top Priorities</SubLabel>
          <div className="space-y-2 mb-6">
            {recommendations.map((rec) => (
              <Link
                key={rec.id}
                href={getRecDestination(rec.type)}
                className="bg-white border border-[#E2E8F0] rounded-lg p-4 flex items-start gap-3 cursor-pointer hover:border-[#0D0437]/20 hover:bg-[#F9FAFB] transition-colors"
              >
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded shrink-0 mt-0.5 ${TYPE_BADGE[rec.type] ?? "bg-[#F4F6F9] text-[#6B7280]"
                    }`}
                >
                  {TYPE_LABEL[rec.type] ?? rec.type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#0D0437] truncate">{rec.title}</p>
                  <p className="text-[11px] text-[#6B7280] mt-0.5 line-clamp-1">{rec.description}</p>
                </div>
                <span className="text-xs text-[#6B7280] shrink-0 mt-0.5 flex items-center gap-1">
                  Fix <ExternalLink className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── 6. Trend Chart (moved below priorities) ───────────────────────────── */}
      <SubLabel>Mention Rate Over Time</SubLabel>
      <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white mb-6">
        <p className="text-[11px] text-[#6B7280] mb-4">
          % of queries where your brand was mentioned, per model per day
        </p>
        {trendData.length < 2 ? (
          <div className="h-40 flex items-center justify-center text-sm text-[#6B7280]">
            Insufficient data — run tracking across multiple days to see trends.
          </div>
        ) : (
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
                formatter={(value: number) => [`${value}%`, ""]}
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #E2E8F0",
                  borderRadius: "6px",
                  fontSize: 11,
                }}
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
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── 7. Latest Activity ─────────────────────────────────────────────────── */}
      <SubLabel>Latest Activity</SubLabel>
      <div className="mb-6">
        {runs.length === 0 ? (
          <p className="text-[12px] text-[#6B7280] py-2">No runs yet — click <strong className="text-[#0D0437]">Run now</strong> above to start.</p>
        ) : (
          runs.slice(0, 5).map((run) => {
            const queryText = queryMap.get(run.query_id) ?? "";
            const intent = queryIntentMap.get(run.query_id) ?? "";
            const isBait = queryIsBaitMap.get(run.query_id) ?? false;
            return (
              <div
                key={run.id}
                className="flex items-center gap-3 py-2.5 border-b border-[#F0F0F0] cursor-pointer hover:bg-[rgba(244,246,249,0.6)] transition-colors -mx-1 px-1 rounded"
                onClick={() => setDrawer({ run, queryText })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer({ run, queryText }); } }}
                aria-label={`View response for: ${queryText || "query"}`}
              >
                {/* Intent badge(s) — clickable deep-link to /runs filtered by intent.
                    stopPropagation prevents the row's drawer from opening on badge click. */}
                <div className="flex flex-col gap-0.5 shrink-0 w-[78px]">
                  {intent && (
                    <Link
                      href={`/runs?intent=${intent}&client=${client.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="w-fit hover:opacity-75 transition-opacity"
                    >
                      <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border w-fit ${INTENT_BADGE[intent] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                        {INTENT_LABEL[intent] ?? intent}
                      </span>
                    </Link>
                  )}
                  {isBait && (
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border w-fit ${INTENT_BADGE.bait}`}>
                      Bait
                    </span>
                  )}
                </div>

                {/* Query text */}
                <p className="text-[12px] text-[#1A1A2E] italic flex-1 min-w-0 truncate leading-snug">
                  {queryText ? `"${queryText}"` : <span className="not-italic text-[#9CA3AF]">—</span>}
                </p>

                {/* Model badge */}
                <span className={`text-[9px] font-bold tracking-wide uppercase px-2 py-0.5 rounded border whitespace-nowrap shrink-0 hidden sm:inline ${MODEL_BADGE[run.model] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                  {MODEL_LABELS[run.model] ?? run.model}
                </span>

                {/* Mentioned indicator */}
                {run.brand_mentioned
                  ? <CheckCircle2 className="h-4 w-4 text-[#1A8F5C] shrink-0" />
                  : <XCircle className="h-4 w-4 text-[#FF4B6E] shrink-0" />}

                {/* Sentiment badge — only shown when brand is mentioned and has a non-trivial sentiment */}
                {run.mention_sentiment && run.mention_sentiment !== "not_mentioned" && (
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 hidden sm:inline ${SENTIMENT_BADGE[run.mention_sentiment] ?? ""}`}>
                    {run.mention_sentiment}
                  </span>
                )}
                {/* Positioning badge — only shown when a clear position has been scored */}
                {run.brand_positioning && run.brand_positioning !== "unclear" && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 hidden md:inline bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]">
                    {run.brand_positioning}
                  </span>
                )}
              </div>
            );
          })
        )}
        {runs.length > 0 && (
          <div className="flex justify-end mt-2">
            <Link
              href={`/runs?client=${client.id}`}
              className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors"
            >
              View all query runs
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      {/* Response drawer */}
      {drawer && (
        <ResponseDrawer
          queryText={drawer.queryText}
          runs={[{
            model: drawer.run.model,
            rawResponse: drawer.run.raw_response,
            competitorsMentioned: drawer.run.competitors_mentioned ?? [],
          }]}
          brandName={client.brand_name ?? client.url}
          mentionSentiment={drawer.run.mention_sentiment}
          brandPositioning={drawer.run.brand_positioning}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense>
      <OverviewInner />
    </Suspense>
  );
}
