"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ResponseDrawer } from "@/components/dashboard/ResponseDrawer";
import { toast } from "sonner";
import { RefreshCw, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { Client, TrackingRun, Recommendation, LLMModel } from "@/types";
import { computeBVI, type BVIScoreInput } from "@/lib/bvi/compute-bvi";

// ── Constants ──────────────────────────────────────────────────────────────────

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

const INTENT_LABEL: Record<string, string> = {
  problem_aware: "Awareness",
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
};

const INTENT_BADGE: Record<string, string> = {
  problem_aware: "bg-[rgba(31,182,255,0.08)] text-[#1580c0]  border-[rgba(31,182,255,0.2)]",
  category: "bg-[rgba(13,4,55,0.06)]    text-[#0D0437]  border-[rgba(13,4,55,0.15)]",
  comparative: "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7]  border-[rgba(123,94,167,0.2)]",
  validation: "bg-[rgba(26,143,92,0.08)]  text-[#1A8F5C]  border-[rgba(26,143,92,0.2)]",
};

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-[rgba(26,143,92,0.08)]  text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  neutral: "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
  negative: "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
};

const TYPE_LABEL: Record<string, string> = {
  content_directive: "CONTENT",
  entity_foundation: "ENTITY",
  placement_strategy: "PLACEMENT",
};

const TYPE_BADGE: Record<string, string> = {
  content_directive: "bg-[rgba(0,180,216,0.1)]   text-[#0077A8] border-[rgba(0,180,216,0.2)]",
  entity_foundation: "bg-[rgba(123,94,167,0.1)]  text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
  placement_strategy: "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
};

// ── Traffic-light thresholds ───────────────────────────────────────────────────

// Unaided Visibility uses relative comparison against highest competitor rate
const VISIBILITY_RELATIVE_MARGIN = 10; // pp below top competitor before turning red
const FAVORABILITY_THRESHOLDS = { red: 50, green: 75 } as const;
const KNOWLEDGE_THRESHOLDS = { red: 70, green: 85 } as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return "Today";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function computeNextRunDate(lastRunAt: string, frequency: string): string {
  const days = frequency === "weekly" ? 7 : 30;
  const next = new Date(new Date(lastRunAt).getTime() + days * 86_400_000);
  return next.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatTimeAgo(iso: string): string {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

// Strip diacritics + lowercase for accent-insensitive competitor name matching
function normalizeForMatch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function trafficLight(value: number, thresholds: { red: number; green: number }): string {
  if (value >= thresholds.green) return "text-[#1A8F5C]";
  if (value >= thresholds.red) return "text-[#F59E0B]";
  return "text-[#FF4B6E]";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-10 mb-4">
      <span className="text-[10px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

function MetricCard({
  label, value, interpretation, loading, href, valueColor,
}: {
  label: string; value: string; interpretation: string; loading: boolean;
  href?: string; valueColor?: string;
}) {
  if (loading) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 flex flex-col">
      <p className="text-[10px] font-bold uppercase tracking-[2px] text-[#9CA3AF] mb-3">{label}</p>
      <p className={`text-[32px] font-bold leading-none mb-3 ${valueColor ?? "text-[#0D0437]"}`}>{value}</p>
      <p className="text-[12px] text-[#6B7280] leading-snug flex-1">{interpretation}</p>
      {href && (
        <div className="flex justify-end mt-3 pt-3 border-t border-[#F4F6F9]">
          <Link href={href} className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors flex items-center gap-1">
            View details
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface DrawerState {
  run: TrackingRun;
  queryText: string;
}

// ── Main component ─────────────────────────────────────────────────────────────

function OverviewInner() {
  const { activeClientId, isAdmin } = useClientContext();
  const searchParams = useSearchParams();
  // Prefer the URL ?client= param — it's set synchronously before render and is
  // always correct. The context's activeClientId resolves asynchronously and may
  // still be null on the first render after navigating from the onboarding flow.
  const clientIdParam = searchParams.get("client") ?? activeClientId;

  // Client
  const [client, setClient] = useState<Client | null>(null);
  const [clientLoading, setClientLoading] = useState(true);

  // Section loading states — each resolves independently
  const [runsLoading, setRunsLoading] = useState(true);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [prioritiesLoading, setPrioritiesLoading] = useState(true);
  const [nssLoading, setNssLoading] = useState(true);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [competitorRateLoading, setCompetitorRateLoading] = useState(true);
  const [bviLoading, setBviLoading] = useState(true);

  // Data
  const [runs, setRuns] = useState<TrackingRun[]>([]);
  const [queryMap, setQueryMap] = useState<Map<string, string>>(new Map());
  const [knowledgeCorrect, setKnowledgeCorrect] = useState(0);
  const [knowledgeTotal, setKnowledgeTotal] = useState(0);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [trackedModels, setTrackedModels] = useState<LLMModel[]>([]);
  const [nss, setNss] = useState<number | null>(null);
  const [nssTotal, setNssTotal] = useState(0);
  const [sourceCount, setSourceCount] = useState(0);
  // Competitors sorted by unaided mention count desc (name = display name from response_brand_mentions)
  const [competitorRanks, setCompetitorRanks] = useState<{ name: string; mentions: number }[]>([]);
  const [bviComposite, setBviComposite] = useState<number | null>(null);
  const [bviBaitRunsTotal, setBviBaitRunsTotal] = useState(0);

  // UI state
  const [running, setRunning] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  // ── Load data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function loadClient() {
      setClientLoading(true);
      const supabase = createClient();

      const q = supabase.from("clients").select("*").eq("status", "active");
      const { data } = await (clientIdParam ? q.eq("id", clientIdParam) : q)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const c = (data?.[0] as Client) ?? null;
      setClient(c);
      setClientLoading(false);

      if (!c) {
        setRunsLoading(false);
        setKnowledgeLoading(false);
        setPrioritiesLoading(false);
        setNssLoading(false);
        setSourceLoading(false);
        setCompetitorRateLoading(false);
        setBviLoading(false);
        return;
      }

      setTrackedModels((c.selected_models ?? []) as LLMModel[]);

      // Fetch the active portfolio version before firing data queries so we can
      // filter tracking_runs and brand_knowledge_scores to the current version.
      // Null means no version exists yet (pre-versioning client) — show all data.
      const { data: versionRow } = await supabase
        .from("portfolio_versions")
        .select("id")
        .eq("client_id", c.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      const activeVersionId = versionRow?.id ?? null;
      if (cancelled) return;

      // Fire all section queries in parallel — each updates its own state
      const supabase2 = createClient();

      // Runs + queries (feeds: metrics, sentiment, chart, activity)
      let runsQ = supabase2
        .from("tracking_runs")
        .select("*")
        .eq("client_id", c.id);
      if (activeVersionId) runsQ = runsQ.eq("version_id", activeVersionId);
      runsQ
        .order("ran_at", { ascending: false })
        .limit(5000)
        .then(({ data: runData }) => {
          if (cancelled) return;
          setRuns((runData as TrackingRun[]) ?? []);
          setRunsLoading(false);
        });

      // Query text map (for activity feed labels)
      supabase2
        .from("queries")
        .select("id, text")
        .eq("client_id", c.id)
        .then(({ data: qData }) => {
          if (cancelled) return;
          const m = new Map<string, string>();
          (qData ?? []).forEach((q: { id: string; text: string }) => m.set(q.id, q.text));
          setQueryMap(m);
        });

      // Brand knowledge scores (feeds: fact accuracy card)
      let kScoresQ = supabase2
        .from("brand_knowledge_scores")
        .select("accuracy")
        .eq("client_id", c.id);
      if (activeVersionId) kScoresQ = kScoresQ.eq("version_id", activeVersionId);
      kScoresQ.then(({ data: kData }) => {
        if (cancelled) return;
        const rows = (kData ?? []) as { accuracy: string }[];
        setKnowledgeCorrect(rows.filter((r) => r.accuracy === "correct").length);
        setKnowledgeTotal(rows.length);
        setKnowledgeLoading(false);
      });

      // Recommendations (feeds: top priorities)
      supabase2
        .from("recommendations")
        .select("*")
        .eq("client_id", c.id)
        .eq("status", "open")
        .order("priority")
        .limit(3)
        .then(({ data: recData }) => {
          if (cancelled) return;
          setRecommendations((recData as Recommendation[]) ?? []);
          setPrioritiesLoading(false);
        });

      // AI Favorability NSS (comparative intent, own brand only)
      supabase2
        .from("response_brand_mentions")
        .select("mention_sentiment")
        .eq("client_id", c.id)
        .eq("query_intent", "comparative")
        .eq("is_tracked_brand", true)
        .not("mention_sentiment", "is", null)
        .then(({ data: sentData }) => {
          if (cancelled) return;
          let pos = 0, neu = 0, neg = 0;
          for (const r of (sentData ?? []) as { mention_sentiment: string }[]) {
            if (r.mention_sentiment === "positive") pos++;
            else if (r.mention_sentiment === "neutral") neu++;
            else if (r.mention_sentiment === "negative") neg++;
          }
          const denom = pos + neu + neg;
          setNss(denom > 0 ? Math.round(((pos - neg) / denom) * 100) : null);
          setNssTotal(denom);
          setNssLoading(false);
        });

      // Source attribution count (distinct attributed domains across all runs)
      // Fetches run IDs first, then chunks run_sources queries to stay within URL limits
      (async () => {
        let runIdQ = supabase2.from("tracking_runs").select("id").eq("client_id", c.id);
        if (activeVersionId) runIdQ = runIdQ.eq("version_id", activeVersionId);
        const { data: runIdData } = await runIdQ;
        if (cancelled || !runIdData?.length) { setSourceLoading(false); return; }

        const allRunIds = (runIdData as { id: string }[]).map((r) => r.id);
        const domainSet = new Set<string>();
        const CHUNK = 400;
        for (let i = 0; i < allRunIds.length; i += CHUNK) {
          const { data: srcData } = await supabase2
            .from("run_sources")
            .select("canonical_domain_id")
            .in("run_id", allRunIds.slice(i, i + CHUNK))
            .eq("is_attributed", true);
          if (srcData) {
            for (const s of srcData as { canonical_domain_id: string }[]) {
              domainSet.add(s.canonical_domain_id);
            }
          }
        }
        if (!cancelled) {
          setSourceCount(domainSet.size);
          setSourceLoading(false);
        }
      })();

      // Competitor unaided mention rates (for relative visibility colour)
      // Fetches selected competitors + their distinct-run mention counts in parallel
      (async () => {
        const [compNamesResult, compMentionsResult] = await Promise.all([
          supabase2.from("competitors").select("name").eq("client_id", c.id),
          supabase2
            .from("response_brand_mentions")
            .select("brand_name, tracking_run_id")
            .eq("client_id", c.id)
            .in("query_intent", ["problem_aware", "category"])
            .eq("is_tracked_brand", false),
        ]);
        if (cancelled) return;

        const competitorNameSet = new Set(
          (compNamesResult.data ?? []).map((r: { name: string }) => normalizeForMatch(r.name))
        );

        // Count distinct tracking_run_ids per competitor; keep first-seen display name
        const runsByComp = new Map<string, { displayName: string; runs: Set<string> }>();
        for (const row of (compMentionsResult.data ?? []) as { brand_name: string; tracking_run_id: string }[]) {
          const norm = normalizeForMatch(row.brand_name);
          if (!competitorNameSet.has(norm)) continue;
          if (!runsByComp.has(norm)) runsByComp.set(norm, { displayName: row.brand_name, runs: new Set() });
          runsByComp.get(norm)!.runs.add(row.tracking_run_id);
        }

        // Sort descending by mention count so index 0 is the top competitor
        const sorted = Array.from(runsByComp.values())
          .map(({ displayName, runs }) => ({ name: displayName, mentions: runs.size }))
          .sort((a, b) => b.mentions - a.mentions);
        setCompetitorRanks(sorted);
        setCompetitorRateLoading(false);
      })();

      // BVI — 3 parallel fetches, all scoped to active version for consistency with other metrics.
      (async () => {
        let bviScoresQ = supabase2
          .from("brand_knowledge_scores")
          .select("fact_id, bait_triggered, tracking_run_id")
          .eq("client_id", c.id);
        if (activeVersionId) bviScoresQ = bviScoresQ.eq("version_id", activeVersionId);

        let bviRunsQ = supabase2.from("tracking_runs").select("id, model").eq("client_id", c.id);
        if (activeVersionId) bviRunsQ = bviRunsQ.eq("version_id", activeVersionId);

        const [{ data: bviScores }, { data: bviFacts }, { data: bviRunModels }] = await Promise.all([
          bviScoresQ,
          supabase2.from("brand_facts").select("id, is_true, claim").eq("client_id", c.id),
          bviRunsQ,
        ]);
        if (cancelled) return;

        const factLookup = new Map<string, { is_true: boolean; claim: string }>();
        (bviFacts ?? []).forEach((f: { id: string; is_true: boolean; claim: string }) =>
          factLookup.set(f.id, { is_true: f.is_true, claim: f.claim })
        );
        const runModelLookup = new Map<string, LLMModel>();
        (bviRunModels ?? []).forEach((r: { id: string; model: LLMModel }) =>
          runModelLookup.set(r.id, r.model)
        );

        const bviInputs = (bviScores ?? [])
          .map((s: { fact_id: string | null; bait_triggered: boolean; tracking_run_id: string }): BVIScoreInput | null => {
            if (!s.fact_id) return null;
            const fact = factLookup.get(s.fact_id);
            const model = runModelLookup.get(s.tracking_run_id);
            if (!fact || !model) return null;
            return {
              fact_id: s.fact_id,
              fact_is_true: fact.is_true,
              fact_claim: fact.claim,
              bait_triggered: s.bait_triggered,
              model,
            };
          })
          .filter((x): x is BVIScoreInput => x !== null);

        const bviResult = computeBVI(bviInputs, (c.selected_models ?? []) as string[]);
        setBviComposite(bviResult.composite);
        setBviBaitRunsTotal(bviResult.baitRunsTotal);
        setBviLoading(false);
      })();
    }

    loadClient();
    return () => { cancelled = true; };
  }, [clientIdParam]);

  // ── Run now ────────────────────────────────────────────────────────────────

  async function handleRunNow() {
    if (!client) return;
    setRunning(true);
    try {
      const res = await fetch("/api/tracking/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const body = await res.json();
      if (res.ok) {
        toast.success("Tracking run queued — check back in a few minutes.");
      } else {
        toast.error(body.error ?? "Failed to queue run");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRunning(false);
    }
  }

  // ── Loading: client not resolved yet ──────────────────────────────────────

  if (clientLoading) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── No active client ───────────────────────────────────────────────────────

  if (!client) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto">
        <h1 className="text-2xl font-bold text-[#0D0437] mb-2">Overview</h1>
        <p className="text-sm text-[#6B7280]">
          No active client.{" "}
          <Link href="/discover" className="underline underline-offset-4 text-[#0D0437]">
            Start onboarding →
          </Link>
        </p>
      </div>
    );
  }

  // ── Derived data (computed once runs are available) ────────────────────────

  const nonValidation = runs.filter((r) => r.query_intent !== "validation");
  const nvTotal = nonValidation.length;

  // Hero metrics
  // Card 1: Unaided Visibility — problem_aware + category only (matches Share of Voice page logic)
  const unaidedRuns = runs.filter((r) => r.query_intent === "problem_aware" || r.query_intent === "category");
  const unaidedMentioned = unaidedRuns.filter((r) => r.brand_mentioned === true).length;
  const unaidedRate = pct(unaidedMentioned, unaidedRuns.length);

  const factAccuracyPct = knowledgeTotal > 0 ? pct(knowledgeCorrect, knowledgeTotal) : null;

  // NSS display values
  const nssValue = nss !== null ? (nss >= 0 ? `+${nss}` : `${nss}`) : "—";

  // Traffic light colours — only applied when data is loaded and present
  // Unaided Visibility: relative to highest competitor rate (same intent, same period)
  const competitorHighestRate =
    !runsLoading && !competitorRateLoading && unaidedRuns.length > 0
      ? (competitorRanks.length > 0 ? pct(competitorRanks[0].mentions, unaidedRuns.length) : 0)
      : null;
  const visibilityColor =
    competitorHighestRate !== null
      ? (() => {
        const diff = unaidedRate - competitorHighestRate;
        if (diff > 0) return "text-[#1A8F5C]";
        if (diff >= -VISIBILITY_RELATIVE_MARGIN) return "text-[#F59E0B]";
        return "text-[#FF4B6E]";
      })()
      : undefined;
  const favorabilityColor = (!nssLoading && nss !== null)
    ? trafficLight(nss, FAVORABILITY_THRESHOLDS) : undefined;
  const knowledgeColor = (!knowledgeLoading && factAccuracyPct !== null)
    ? trafficLight(factAccuracyPct, KNOWLEDGE_THRESHOLDS) : undefined;

  const nssInterp = nssLoading ? "" : nss !== null
    ? `${nssTotal} scored mentions from comparative queries`
    : "No comparative mention data yet";

  // Trend chart data: group by date × model (uses non-validation runs)
  const dailyStats: Record<string, Record<string, { total: number; mentioned: number }>> = {};
  nonValidation.forEach((r) => {
    const date = r.ran_at.slice(0, 10);
    if (!dailyStats[date]) dailyStats[date] = {};
    if (!dailyStats[date][r.model]) dailyStats[date][r.model] = { total: 0, mentioned: 0 };
    dailyStats[date][r.model].total++;
    if (r.brand_mentioned === true) dailyStats[date][r.model].mentioned++;
  });
  const trendData = Object.entries(dailyStats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => ({
      date: date.slice(5), // MM-DD
      ...Object.fromEntries(
        Object.entries(models).map(([m, s]) => [m, pct(s.mentioned, s.total)])
      ),
    }));

  // Models that actually appear in run data
  const activeModels = trackedModels.filter((m) =>
    runs.some((r) => r.model === m)
  );

  // Card interpretations
  // Rank = 1 + number of competitors with strictly higher unaided rate than the client
  const clientRank = !runsLoading && !competitorRateLoading && unaidedRuns.length > 0
    ? 1 + competitorRanks.filter((c) => pct(c.mentions, unaidedRuns.length) > unaidedRate).length
    : null;
  const topCompetitorName = competitorRanks[0]?.name ?? null;
  const rankSuffix = clientRank !== null && competitorRanks.length > 0
    ? clientRank === 1
      ? " · #1 in your competitor set"
      : ` · #${clientRank} in your competitor set (behind ${topCompetitorName})`
    : "";
  const unaidedInterp =
    unaidedRuns.length === 0 ? "No awareness/category queries run yet"
      : `${unaidedMentioned} of ${unaidedRuns.length} queries return a mention${rankSuffix}`;

  const factInterp =
    factAccuracyPct === null ? "No knowledge scores yet"
      : `${knowledgeCorrect} of ${knowledgeTotal} facts described correctly`;

  // ── No data / first run not complete ──────────────────────────────────────

  const hasNoData = !runsLoading && runs.length === 0;

  // Daily run limit: blocked when non-daily client already has a run today.
  // Admin bypasses this restriction entirely.
  const todayStartUTC = new Date();
  todayStartUTC.setUTCHours(0, 0, 0, 0);
  const isBlockedByDailyLimit =
    !isAdmin &&
    !runsLoading &&
    client.tracking_frequency !== "daily" &&
    runs.some((r) => new Date(r.ran_at) >= todayStartUTC);
  const lastRunAt = runs[0]?.ran_at ?? null;

  // Run history: dedupe by calendar date, up to 3 entries
  const seenDates = new Set<string>();
  const recentRunDates: string[] = [];
  for (const run of runs) {
    const dk = run.ran_at.slice(0, 10);
    if (!seenDates.has(dk)) {
      seenDates.add(dk);
      recentRunDates.push(run.ran_at);
      if (recentRunDates.length === 3) break;
    }
  }

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-[28px] font-bold text-[#0D0437] leading-tight">Overview</h1>
          <p className="text-[12px] text-[#9CA3AF] font-mono mt-1">
            {client.brand_name ?? client.url}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button
            onClick={handleRunNow}
            disabled={running || isBlockedByDailyLimit}
            size="sm"
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Queuing…" : "Run now"}
          </Button>
          {isBlockedByDailyLimit && lastRunAt && (
            <p className="text-[11px] text-[#9CA3AF] text-right max-w-[280px] leading-relaxed">
              Today&apos;s analysis is complete. Next run:{" "}
              <span className="font-medium text-[#6B7280]">
                {computeNextRunDate(lastRunAt, client.tracking_frequency)}
              </span>
              {" — or "}
              <Link
                href={`/dashboard/settings${clientIdParam ? `?client=${clientIdParam}` : ""}`}
                className="underline underline-offset-2 hover:text-[#0D0437] transition-colors"
              >
                switch to daily
              </Link>
              {" for continuous monitoring."}
            </p>
          )}
        </div>
      </div>

      {/* ── Run history indicator ───────────────────────────────────────────── */}
      {!runsLoading && recentRunDates.length > 0 && (
        <p className="text-[11px] text-[#9CA3AF] mb-6 -mt-1">
          Last {recentRunDates.length} run{recentRunDates.length !== 1 ? "s" : ""}:{" "}
          {recentRunDates.map((d, i) => (
            <React.Fragment key={d}>
              {i > 0 && <span className="mx-1.5 opacity-50">·</span>}
              {formatRunDate(d)}
            </React.Fragment>
          ))}
        </p>
      )}

      {/* ── Empty state: no runs yet ──────────────────────────────────────── */}
      {hasNoData ? (
        <div className="border border-[#E2E8F0] rounded-xl p-10 bg-white text-center">
          <p className="text-[15px] font-semibold text-[#0D0437] mb-1">
            Your first audit is running
          </p>
          <p className="text-[13px] text-[#6B7280]">Results start appearing in about 30 minutes.</p>
        </div>
      ) : (
        <>
          {/* ── Hero Metrics ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-2">
            <MetricCard
              label="Unaided Visibility"
              value={runsLoading ? "—" : `${unaidedRate}%`}
              interpretation={runsLoading ? "" : unaidedInterp}
              loading={runsLoading}
              href={`/dashboard/share-of-voice${clientIdParam ? `?client=${clientIdParam}` : ""}`}
              valueColor={visibilityColor}
            />
            <MetricCard
              label="AI Favorability"
              value={nssLoading ? "—" : nssValue}
              interpretation={nssLoading ? "" : nssInterp}
              loading={nssLoading}
              href={`/dashboard/tone-of-voice${clientIdParam ? `?client=${clientIdParam}` : ""}`}
              valueColor={favorabilityColor}
            />
            <MetricCard
              label="Brand Knowledge"
              value={knowledgeLoading ? "—" : factAccuracyPct !== null ? `${factAccuracyPct}%` : "—"}
              interpretation={knowledgeLoading ? "" : factInterp}
              loading={knowledgeLoading}
              href={`/dashboard/brand-knowledge${clientIdParam ? `?client=${clientIdParam}` : ""}`}
              valueColor={knowledgeColor}
            />
            <MetricCard
              label="Source Attribution"
              value={sourceLoading ? "—" : `${sourceCount}`}
              interpretation={sourceLoading ? "" : "Domains influencing AI answers about your brand"}
              loading={sourceLoading}
              href={`/dashboard/source-intelligence${clientIdParam ? `?client=${clientIdParam}` : ""}`}
            />
            {/* BVI — inverted: lower score = less vulnerable = green */}
            <MetricCard
              label="Brand Vulnerability"
              value={bviLoading ? "—" : bviBaitRunsTotal > 0 && bviComposite !== null ? `${bviComposite}` : "—"}
              interpretation={
                bviLoading ? "" :
                  bviBaitRunsTotal === 0
                    ? "Add false claim tests in Brand Facts to enable."
                    : bviComposite !== null && bviComposite <= 15
                      ? "Low vulnerability — LLMs rarely confirm false claims."
                      : bviComposite !== null && bviComposite <= 40
                        ? "Moderate vulnerability — some false claims confirmed."
                        : "High vulnerability — LLMs frequently confirm false claims."
              }
              loading={bviLoading}
              href={`/dashboard/brand-knowledge${clientIdParam ? `?client=${clientIdParam}` : ""}`}
              valueColor={
                !bviLoading && bviComposite !== null && bviBaitRunsTotal > 0
                  ? bviComposite <= 15 ? "text-[#1A8F5C]"
                    : bviComposite <= 40 ? "text-[#F59E0B]"
                      : "text-[#FF4B6E]"
                  : undefined
              }
            />
          </div>

          {/* ── Mention Rate Over Time Chart ─────────────────────────────────── */}
          <SectionLabel>Mention Rate Over Time</SectionLabel>
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
            {runsLoading ? (
              <div className="h-[200px] flex items-center justify-center">
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            ) : trendData.length < 2 ? (
              <div className="h-[200px] flex items-center justify-center text-sm text-[#9CA3AF]">
                Insufficient data — run tracking across multiple days to see trends.
              </div>
            ) : (
              <>
                <p className="text-[11px] text-[#9CA3AF] mb-4">
                  % of queries where brand was mentioned, per model per day
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#9CA3AF" }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value}%`, MODEL_LABELS[name as LLMModel] ?? name]}
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #E2E8F0",
                        borderRadius: "8px",
                        fontSize: 11,
                      }}
                    />
                    {activeModels.map((m) => (
                      <Line
                        key={m}
                        type="monotone"
                        dataKey={m}
                        name={m}
                        stroke={MODEL_COLORS[m]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                {/* Model legend */}
                <div className="flex flex-wrap gap-3 mt-4">
                  {activeModels.map((m) => (
                    <span key={m} className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ background: MODEL_COLORS[m] }}
                      />
                      {MODEL_LABELS[m]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── Top Priorities ───────────────────────────────────────────────── */}
          <SectionLabel>Top Priorities</SectionLabel>
          {prioritiesLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex gap-3">
                  <Skeleton className="h-5 w-16 rounded shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 text-center">
              <p className="text-[13px] text-[#9CA3AF]">No open recommendations — you're all caught up.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex items-start gap-3 hover:border-[#0D0437]/20 hover:bg-[#FAFAFA] transition-colors"
                >
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded border shrink-0 mt-0.5 ${TYPE_BADGE[rec.type] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}
                  >
                    {TYPE_LABEL[rec.type] ?? rec.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#0D0437] truncate">{rec.title}</p>
                    <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">{rec.description}</p>
                  </div>
                  <Link
                    href={`/dashboard/roadmap?highlight=${rec.id}`}
                    className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-[#0D0437] hover:text-[#FF4B6E] transition-colors whitespace-nowrap mt-0.5"
                  >
                    Fix
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* ── Latest Activity ──────────────────────────────────────────────── */}
          <SectionLabel>Latest Activity</SectionLabel>
          {runsLoading ? (
            <div className="space-y-0">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3 border-b border-[#F0F2F5]">
                  <Skeleton className="h-4 w-16 rounded" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-4 w-14 rounded" />
                  <Skeleton className="h-4 w-10 rounded" />
                </div>
              ))}
            </div>
          ) : runs.length === 0 ? (
            <p className="text-[13px] text-[#9CA3AF] py-2">
              No runs yet — click <strong className="text-[#0D0437]">Run now</strong> above to start.
            </p>
          ) : (
            <div>
              {runs.slice(0, 5).map((run) => {
                const queryText = queryMap.get(run.query_id) ?? "";
                const intent = run.query_intent ?? "";
                return (
                  <div
                    key={run.id}
                    className="flex items-center gap-3 py-2.5 border-b border-[#F0F2F5] cursor-pointer hover:bg-[#FAFAFA] transition-colors -mx-1 px-1 rounded"
                    onClick={() => setDrawer({ run, queryText })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDrawer({ run, queryText });
                      }
                    }}
                    aria-label={`View response for: ${queryText || "query"}`}
                  >
                    {/* Intent badge */}
                    {intent && (
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${INTENT_BADGE[intent] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}
                      >
                        {INTENT_LABEL[intent] ?? intent}
                      </span>
                    )}

                    {/* Query text */}
                    <p className="text-[12px] text-[#374151] italic flex-1 min-w-0 truncate">
                      {queryText ? `"${queryText}"` : <span className="not-italic text-[#9CA3AF]">—</span>}
                    </p>

                    {/* Model badge */}
                    <span
                      className={`text-[9px] font-bold tracking-wide uppercase px-2 py-0.5 rounded border whitespace-nowrap shrink-0 hidden sm:inline ${MODEL_BADGE[run.model] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}
                    >
                      {MODEL_LABELS[run.model] ?? run.model}
                    </span>

                    {/* Sentiment badge */}
                    {run.mention_sentiment && run.mention_sentiment !== "not_mentioned" && (
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 hidden sm:inline ${SENTIMENT_BADGE[run.mention_sentiment] ?? ""}`}
                      >
                        {run.mention_sentiment}
                      </span>
                    )}

                    {/* Relative timestamp */}
                    <span className="text-[10px] text-[#9CA3AF] whitespace-nowrap shrink-0">
                      {formatTimeAgo(run.ran_at)}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-end mt-3">
                <Link
                  href={`/dashboard/query-runs${client ? `?client=${client.id}` : ""}`}
                  className="text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors flex items-center gap-1"
                >
                  View all query runs
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          )}
        </>
      )}

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
