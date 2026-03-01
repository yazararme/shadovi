"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ResponseDrawer } from "@/components/dashboard/ResponseDrawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import Link from "next/link";
import type { Client, TrackingRun, LLMModel } from "@/types";

const PAGE_SIZE = 50;

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

const MODEL_BADGE_ACTIVE: Record<LLMModel, string> = {
  "gpt-4o": "bg-[#10a37f]  text-white border-[#10a37f]",
  "claude-sonnet-4-6": "bg-[#b5804a]  text-white border-[#b5804a]",
  perplexity: "bg-[#1580c0]  text-white border-[#1580c0]",
  gemini: "bg-[#4285f4]  text-white border-[#4285f4]",
  deepseek: "bg-[#6366f1]  text-white border-[#6366f1]",
};

const MODEL_BADGE: Record<LLMModel, string> = {
  "gpt-4o": "bg-[rgba(16,163,127,0.08)]  text-[#10a37f] border-[rgba(16,163,127,0.2)]",
  "claude-sonnet-4-6": "bg-[rgba(212,162,126,0.08)] text-[#b5804a] border-[rgba(212,162,126,0.2)]",
  perplexity: "bg-[rgba(31,182,255,0.08)]  text-[#1580c0] border-[rgba(31,182,255,0.2)]",
  gemini: "bg-[rgba(66,133,244,0.08)]  text-[#4285f4] border-[rgba(66,133,244,0.2)]",
  deepseek: "bg-[rgba(99,102,241,0.08)]  text-[#6366f1] border-[rgba(99,102,241,0.2)]",
};

const INTENT_LABEL: Record<string, string> = {
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
  problem_aware: "Awareness",
};

const INTENT_BADGE: Record<string, string> = {
  category: "bg-[rgba(13,4,55,0.06)]    text-[#0D0437]  border-[rgba(13,4,55,0.15)]",
  comparative: "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7]  border-[rgba(123,94,167,0.2)]",
  validation: "bg-[rgba(26,143,92,0.08)]  text-[#1A8F5C]  border-[rgba(26,143,92,0.2)]",
  problem_aware: "bg-[rgba(31,182,255,0.08)] text-[#1580c0]  border-[rgba(31,182,255,0.2)]",
  bait: "bg-[rgba(245,158,11,0.08)] text-[#B45309]  border-[rgba(245,158,11,0.2)]",
};

// Intent tabs in funnel order: Awareness → Category → Comparative → Validation
const INTENT_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "problem_aware", label: "Awareness" },
  { key: "category", label: "Category" },
  { key: "comparative", label: "Comparative" },
  { key: "validation", label: "Validation" },
];

const ALL_MODELS: LLMModel[] = ["gpt-4o", "claude-sonnet-4-6", "perplexity", "gemini", "deepseek"];

// ── Run status ─────────────────────────────────────────────────────────────────
// Derived from raw_response + brand_mentioned — no dedicated DB column.
// completed = response received and enrichment finished
// failed    = no usable response returned
// partial   = response exists but enrichment/scoring did not complete
type RunStatus = "completed" | "failed" | "partial";

function getRunStatus(run: TrackingRun): RunStatus {
  if (!run.raw_response) return "failed";
  // brand_mentioned is only semantically required for validation intent.
  // For comparative, category, and problem_aware runs, null means the brand
  // wasn't mentioned — that's a valid completed state, not a partial one.
  if (run.query_intent === "validation" && run.brand_mentioned === null) return "partial";
  return "completed";
}


// ── CSV export column definitions ──────────────────────────────────────────────
const SELECTABLE_COLUMNS: { key: string; label: string; defaultOn: boolean }[] = [
  { key: "brand_mentioned", label: "Brand Mentioned", defaultOn: true },
  { key: "accuracy", label: "Accuracy Score", defaultOn: true },
  { key: "completeness", label: "Completeness Score", defaultOn: true },
  { key: "hallucination", label: "Hallucination Flag", defaultOn: true },
  { key: "brand_positioning", label: "Brand Positioning", defaultOn: true },
  { key: "mention_sentiment", label: "Sentiment", defaultOn: true },
  { key: "run_status", label: "Run Status", defaultOn: true },
  { key: "raw_response", label: "Response Text", defaultOn: false },
  { key: "is_bait", label: "Bait Query Flag", defaultOn: false },
  { key: "bait_triggered", label: "Bait Triggered Flag", defaultOn: false },
  { key: "citation_present", label: "Citation Present", defaultOn: false },
  { key: "source_attribution", label: "Source Attribution", defaultOn: false },
  { key: "content_age_estimate", label: "Content Age Estimate", defaultOn: false },
  { key: "competitor_mentions_unprompted", label: "Competitor Mentions Unprompted", defaultOn: false },
  { key: "scorer_model", label: "Scorer Model", defaultOn: false },
];

const DEFAULT_ON_COLUMNS = new Set(
  SELECTABLE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.key)
);

// Score columns require a join to brand_knowledge_scores
const SCORE_COLUMNS = new Set(["accuracy", "completeness", "hallucination", "bait_triggered", "scorer_model"]);

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function formatRunDate(isoDate: string): string {
  const d = new Date(isoDate);
  const h = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface DrawerState {
  run: TrackingRun;
  queryText: string;
}


function RunsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const clientIdParam = searchParams.get("client");

  // Initialise filter state from URL params so deep-links work out of the box
  const [intentFilter, setIntentFilter] = useState(searchParams.get("intent") ?? "all");
  const [selectedModel, setSelectedModel] = useState<LLMModel | "all">(
    (searchParams.get("model") as LLMModel) ?? "all"
  );

  const [client, setClient] = useState<Client | null>(null);
  // clientRef lets loadData read the current client without a stale closure
  const clientRef = useRef<Client | null>(null);
  const [runs, setRuns] = useState<TrackingRun[]>([]);
  const [queryMap, setQueryMap] = useState<Map<string, string>>(new Map());
  const [queryIsBaitMap, setQueryIsBaitMap] = useState<Map<string, boolean>>(new Map());
  // Per-intent and per-model counts for the whole client — unfiltered, used to label filter pills
  const [intentCounts, setIntentCounts] = useState<Record<string, number>>({});
  const [modelCounts, setModelCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const loadedOnceRef = useRef(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  // Export modal state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportColumns, setExportColumns] = useState<Set<string>>(new Set(DEFAULT_ON_COLUMNS));
  const [exporting, setExporting] = useState(false);

  // On client change: full reset and reload
  useEffect(() => {
    setPage(0);
    loadedOnceRef.current = false;
    loadData(0, intentFilter, selectedModel, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  // ── Data fetching ──────────────────────────────────────────────────────────
  async function loadData(
    targetPage: number,
    intent: string,
    model: LLMModel | "all",
    freshClient: boolean = false
  ) {
    if (loadedOnceRef.current) setPageLoading(true);
    else setLoading(true);

    const supabase = createClient();
    let activeClient: Client | null = freshClient ? null : clientRef.current;

    if (freshClient) {
      // Resolve the active client
      let q = supabase.from("clients").select("*").eq("status", "active");
      if (clientIdParam) q = q.eq("id", clientIdParam);
      const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);
      activeClient = clients?.[0] ?? null;
      setClient(activeClient);
      clientRef.current = activeClient;

      if (activeClient) {
        // Lightweight stats + query metadata — fetched once per client session.
        // Fetching model alongside query_intent avoids a second round-trip for model counts.
        const [{ data: statsData }, { data: queryData }] = await Promise.all([
          supabase
            .from("tracking_runs")
            .select("query_intent, model")
            .eq("client_id", activeClient.id),
          supabase
            .from("queries")
            .select("id, text, is_bait")
            .eq("client_id", activeClient.id),
        ]);

        const counts: Record<string, number> = {};
        const mCounts: Record<string, number> = {};
        (statsData ?? []).forEach((r: { query_intent: string | null; model: string | null }) => {
          const k = r.query_intent ?? "unknown";
          counts[k] = (counts[k] ?? 0) + 1;
          if (r.model) mCounts[r.model] = (mCounts[r.model] ?? 0) + 1;
        });
        setIntentCounts(counts);
        setModelCounts(mCounts);

        const map = new Map<string, string>();
        const baitMap = new Map<string, boolean>();
        (queryData ?? []).forEach((q: { id: string; text: string; is_bait: boolean }) => {
          map.set(q.id, q.text);
          baitMap.set(q.id, q.is_bait);
        });
        setQueryMap(map);
        setQueryIsBaitMap(baitMap);
      }
    }

    if (activeClient) {
      // Build filtered, paginated runs query
      const offset = targetPage * PAGE_SIZE;
      let runsQuery = supabase
        .from("tracking_runs")
        .select("*", { count: "exact" })
        .eq("client_id", activeClient.id)
        .order("ran_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (intent !== "all") runsQuery = runsQuery.eq("query_intent", intent);
      if (model !== "all") runsQuery = runsQuery.eq("model", model);


      const { data: runData, count } = await runsQuery;
      setRuns(runData ?? []);
      setTotalCount(count ?? 0);
    }

    loadedOnceRef.current = true;
    setLoading(false);
    setPageLoading(false);
  }

  // ── Filter helpers ─────────────────────────────────────────────────────────

  // Persist active filters in URL so filtered views are shareable/deep-linkable
  function pushFilters(overrides: { intent?: string; model?: LLMModel | "all" }) {
    const sp = new URLSearchParams();
    if (clientIdParam) sp.set("client", clientIdParam);
    const intent = overrides.intent ?? intentFilter;
    if (intent !== "all") sp.set("intent", intent);
    const model = overrides.model ?? selectedModel;
    if (model !== "all") sp.set("model", model);
    // replace (not push) so filter clicks don't pollute browser history
    router.replace(`/runs?${sp.toString()}`, { scroll: false });
  }

  function handleIntentChange(intent: string) {
    setIntentFilter(intent);
    setPage(0);
    pushFilters({ intent });
    loadData(0, intent, selectedModel);
  }

  function handleModelChange(model: LLMModel | "all") {
    setSelectedModel(model);
    setPage(0);
    pushFilters({ model });
    loadData(0, intentFilter, model);
  }

  function goToPage(newPage: number) {
    setPage(newPage);
    loadData(newPage, intentFilter, selectedModel);
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

  // ── CSV Export ─────────────────────────────────────────────────────────────
  async function handleExport() {
    if (!client) return;
    setExporting(true);
    try {
      const supabase = createClient();

      // Fetch all matching runs without pagination (export applies to full filtered view)
      let runsQuery = supabase
        .from("tracking_runs")
        .select("*")
        .eq("client_id", client.id)
        .order("ran_at", { ascending: false })
        .limit(10000);

      if (intentFilter !== "all") runsQuery = runsQuery.eq("query_intent", intentFilter);
      if (selectedModel !== "all") runsQuery = runsQuery.eq("model", selectedModel);

      const { data: allRuns } = await runsQuery;
      if (!allRuns) throw new Error("No data returned");

      // Fetch scores only if any score-sourced column is selected
      type ScoreRow = {
        tracking_run_id: string;
        accuracy: string;
        completeness: string;
        hallucination: boolean;
        bait_triggered: boolean;
        scorer_model: string | null;
      };
      const scoreMap = new Map<string, ScoreRow>();
      const needsScores = [...SCORE_COLUMNS].some((k) => exportColumns.has(k));
      if (needsScores) {
        const runIds = allRuns.map((r: TrackingRun) => r.id);
        const { data: scores } = await supabase
          .from("brand_knowledge_scores")
          .select("tracking_run_id, accuracy, completeness, hallucination, bait_triggered, scorer_model")
          .in("tracking_run_id", runIds);
        (scores ?? []).forEach((s: ScoreRow) => scoreMap.set(s.tracking_run_id, s));
      }

      // Build CSV
      const ALWAYS_HEADERS = ["Query Text", "Intent", "Model", "Run Date", "Run Time"];
      const selectedCols = SELECTABLE_COLUMNS.filter((c) => exportColumns.has(c.key));
      const headers = [...ALWAYS_HEADERS, ...selectedCols.map((c) => c.label)];

      const csvRows = allRuns.map((run: TrackingRun) => {
        const queryText = queryMap.get(run.query_id) ?? "";
        const score = scoreMap.get(run.id);
        const status = getRunStatus(run);
        const ranAt = new Date(run.ran_at);
        const runDate = ranAt.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", year: "numeric" });
        const runTime = ranAt.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

        const fixed = [
          csvEscape(queryText),
          run.query_intent ?? "",
          MODEL_LABELS[run.model] ?? run.model,
          runDate,
          runTime,
        ];

        const optional = selectedCols.map(({ key }) => {
          switch (key) {
            case "brand_mentioned":
              return run.brand_mentioned === null ? "" : run.brand_mentioned ? "true" : "false";
            case "accuracy": return score?.accuracy ?? "";
            case "completeness": return score?.completeness ?? "";
            case "hallucination": return score ? String(score.hallucination) : "";
            case "brand_positioning": return run.brand_positioning ?? "";
            case "mention_sentiment": return run.mention_sentiment ?? "";
            case "run_status": return status;
            case "raw_response": return csvEscape(run.raw_response ?? "");
            case "is_bait": return String(queryIsBaitMap.get(run.query_id) ?? false);
            case "bait_triggered": return score ? String(score.bait_triggered) : "";
            case "citation_present": return run.citation_present === null ? "" : String(run.citation_present);
            case "source_attribution": return csvEscape((run.source_attribution ?? []).join("; "));
            case "content_age_estimate": return csvEscape(run.content_age_estimate ?? "");
            case "competitor_mentions_unprompted":
              return csvEscape(
                (run.competitor_mentions_unprompted ?? []).map((c) => c.competitor).join("; ")
              );
            case "scorer_model": return score?.scorer_model ?? "";
            default: return "";
          }
        });

        return [...fixed, ...optional].join(",");
      });

      const csv = [headers.join(","), ...csvRows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shadovi-runs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      toast.success("Export downloaded");
    } catch {
      toast.error("Export failed — try again");
    } finally {
      setExporting(false);
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Query Runs</h1>
            <Skeleton className="h-3 w-32 mt-2" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
          <div className="border-b bg-[#F4F6F9] px-4 py-3 flex gap-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6 w-20 rounded-full" />)}
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-5 w-20 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-16 shrink-0" />
              <Skeleton className="h-5 w-16 shrink-0" />
              <Skeleton className="h-3 w-10 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── No client ──────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Query Runs</h1>
        <p className="text-sm text-[#6B7280]">
          No active client.{" "}
          <Link href="/discover" className="underline underline-offset-4 text-[#0D0437]">
            Start onboarding →
          </Link>
        </p>
      </div>
    );
  }

  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const totalIntentCount = Object.values(intentCounts).reduce((a, b) => a + b, 0);

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Query Runs
          </h1>
          <p className="font-mono text-[11px] text-[#6B7280] mt-1">
            {client.brand_name ?? client.url}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowExportModal(true)}
            variant="outline"
            size="sm"
            className="border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437]"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export CSV
          </Button>
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
      </div>

      {/* ── Filter bar — Row 1: Intent tabs ───────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {INTENT_TABS.filter(({ key }) =>
          key === "all" || (intentCounts[key] ?? 0) > 0
        ).map(({ key, label }) => {
          const count = key === "all" ? totalIntentCount : (intentCounts[key] ?? 0);
          const active = intentFilter === key;
          return (
            <button
              key={key}
              onClick={() => handleIntentChange(key)}
              className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-full border transition-colors ${active
                ? "bg-[#0D0437] text-white border-[#0D0437]"
                : "bg-white text-[#6B7280] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                }`}
            >
              {label}
              <span className={`text-[8px] font-bold tabular-nums ${active ? "text-white/60" : "text-[#9CA3AF]"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Filter bar — Row 2: Model pills + Status filter ────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {/* Model pills — single selection; "All" = no model filter */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => handleModelChange("all")}
            className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-full border transition-colors ${selectedModel === "all"
              ? "bg-[#0D0437] text-white border-[#0D0437]"
              : "bg-white text-[#6B7280] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
              }`}
          >
            All
            <span className={`text-[8px] font-bold tabular-nums ${selectedModel === "all" ? "text-white/60" : "text-[#9CA3AF]"}`}>
              {Object.values(modelCounts).reduce((a, b) => a + b, 0)}
            </span>
          </button>
          {ALL_MODELS.filter((m) => (modelCounts[m] ?? 0) > 0).map((model) => {
            const active = selectedModel === model;
            return (
              <button
                key={model}
                onClick={() => handleModelChange(model)}
                className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-full border transition-colors ${active
                  ? MODEL_BADGE_ACTIVE[model]
                  : "bg-white text-[#6B7280] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                  }`}
              >
                {MODEL_LABELS[model]}
                <span className={`text-[8px] font-bold tabular-nums ${active ? "text-white/60" : "text-[#9CA3AF]"}`}>
                  {modelCounts[model]}
                </span>
              </button>
            );
          })}
        </div>

      </div>

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {totalCount === 0 && !pageLoading ? (
        <div className="border border-[#E2E8F0] rounded-lg p-12 text-center bg-[#F4F6F9]">
          {totalIntentCount === 0 ? (
            <>
              <p className="text-sm font-semibold text-[#0D0437]">No query runs yet</p>
              <p className="text-[12px] text-[#6B7280] mt-1 mb-4">
                Run your first audit to see results here.
              </p>
              <Button
                onClick={handleRunNow}
                disabled={running}
                size="sm"
                className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${running ? "animate-spin" : ""}`} />
                {running ? "Queuing…" : "Run First Audit"}
              </Button>
            </>
          ) : (
            <p className="text-sm text-[#6B7280]">
              No runs match the active filters.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* ── Table ─────────────────────────────────────────────────────────── */}
          <div className={`border border-[#E2E8F0] rounded-lg overflow-hidden bg-white transition-opacity ${pageLoading ? "opacity-50" : "opacity-100"}`}>
            <table className="w-full">
              <thead>
                <tr className="border-b bg-[#F4F6F9]">
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Intent</th>
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Query</th>
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] hidden sm:table-cell">Model</th>
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Sentiment</th>
                  <th className="text-right px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Date</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const queryText = queryMap.get(run.query_id) ?? "";
                  const intent = run.query_intent ?? "";
                  const isBait = queryIsBaitMap.get(run.query_id) ?? false;
                  return (
                    <tr
                      key={run.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                      onClick={() => setDrawer({ run, queryText })}
                      tabIndex={0}
                      role="button"
                      aria-label={`View response for: ${queryText || "query"}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setDrawer({ run, queryText });
                        }
                      }}
                    >
                      {/* Intent */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5 items-start">
                          {intent && (
                            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${INTENT_BADGE[intent] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                              {INTENT_LABEL[intent] ?? intent}
                            </span>
                          )}
                          {isBait && (
                            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${INTENT_BADGE.bait}`}>
                              Bait
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Query — full text in title attr for native hover tooltip */}
                      <td className="px-4 py-3 max-w-[320px]" title={queryText}>
                        <p className="text-[12px] text-[#1A1A2E] italic line-clamp-1 leading-snug">
                          {queryText
                            ? `"${queryText}"`
                            : <span className="not-italic text-[#9CA3AF]">—</span>}
                        </p>
                      </td>

                      {/* Model */}
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={`text-[9px] font-bold tracking-wide uppercase px-2 py-0.5 rounded border whitespace-nowrap ${MODEL_BADGE[run.model] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                          {MODEL_LABELS[run.model] ?? run.model}
                        </span>
                      </td>

                      {/* Sentiment */}
                      <td className="px-4 py-3">
                        {run.mention_sentiment && run.mention_sentiment !== "not_mentioned" ? (
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                            run.mention_sentiment === "positive"
                              ? "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]"
                              : run.mention_sentiment === "negative"
                              ? "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]"
                              : "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"
                          }`}>
                            {run.mention_sentiment}
                          </span>
                        ) : (
                          <span className="text-[#9CA3AF] text-[11px]">—</span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[10px] text-[#9CA3AF]">
                          {formatRunDate(run.ran_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ──────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mt-4">
            <span className="font-mono text-[11px] text-[#9CA3AF]">
              Showing {start}–{end} of {totalCount}
            </span>
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 0 || pageLoading}
                  className="h-8 px-3 text-[11px] border-[#E2E8F0]"
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToPage(page + 1)}
                  disabled={end >= totalCount || pageLoading}
                  className="h-8 px-3 text-[11px] border-[#E2E8F0]"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Response drawer ───────────────────────────────────────────────────── */}
      {drawer && (
        <ResponseDrawer
          queryText={drawer.queryText}
          runs={[{
            model: drawer.run.model,
            rawResponse: drawer.run.raw_response,
            competitorsMentioned: drawer.run.competitors_mentioned ?? [],
          }]}
          brandName={client.brand_name ?? client.url}
          onClose={() => setDrawer(null)}
        />
      )}

      {/* ── Export CSV modal ───────────────────────────────────────────────────── */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => setShowExportModal(false)}
          />

          {/* Modal panel */}
          <div className="relative bg-white rounded-xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden border border-[#E2E8F0]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0]">
              <div>
                <h2 className="text-[13px] font-bold text-[#0D0437]">Export CSV</h2>
                <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                  {totalCount} run{totalCount !== 1 ? "s" : ""} matching current filters
                </p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-[#9CA3AF] hover:text-[#0D0437] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Always-included columns — these are never toggleable */}
            <div className="px-5 pt-4 pb-3">
              <p className="text-[9px] font-bold uppercase tracking-[2px] text-[#9CA3AF] mb-2">
                Always Included
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  "Query Text", "Intent", "Model", "Run Date", "Run Time",
                  ...SELECTABLE_COLUMNS.filter((c) => c.defaultOn).map((c) => c.label),
                ].map((col) => (
                  <span
                    key={col}
                    className="text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded border bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </div>

            {/* Selectable columns header with select/clear all */}
            <div className="px-5 py-2.5 border-t border-[#E2E8F0] flex items-center justify-between">
              <p className="text-[9px] font-bold uppercase tracking-[2px] text-[#9CA3AF]">
                Optional Columns
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setExportColumns(new Set(SELECTABLE_COLUMNS.map((c) => c.key)))}
                  className="text-[9px] font-bold uppercase tracking-wide text-[#5B3FE0] hover:underline"
                >
                  Select all
                </button>
                <span className="text-[#E2E8F0] text-[10px]">|</span>
                <button
                  onClick={() => setExportColumns(new Set(DEFAULT_ON_COLUMNS))}
                  className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437]"
                >
                  Clear all
                </button>
              </div>
            </div>

            {/* Column checklist — only optional columns appear here */}
            <div className="overflow-y-auto flex-1 px-5 pb-2">
              <div className="divide-y divide-[#F4F6F9]">
                {SELECTABLE_COLUMNS.filter((c) => !c.defaultOn).map(({ key, label }) => {
                  const checked = exportColumns.has(key);
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-3 py-2.5 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setExportColumns((prev) => {
                            const next = new Set(prev);
                            next.has(key) ? next.delete(key) : next.add(key);
                            return next;
                          });
                        }}
                        className="h-3.5 w-3.5 rounded border-[#E2E8F0] accent-[#0D0437]"
                      />
                      <span className="flex-1 text-[12px] text-[#374151] group-hover:text-[#0D0437] transition-colors">
                        {label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-5 py-4 border-t border-[#E2E8F0] flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#9CA3AF]">
                {exportColumns.size + 4} columns · {totalCount} rows
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowExportModal(false)}
                  className="border-[#E2E8F0] text-[#6B7280] text-[11px] h-8"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleExport}
                  disabled={exporting || exportColumns.size === 0}
                  className="bg-[#0D0437] hover:bg-[#1a1150] text-white text-[11px] h-8"
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  {exporting ? "Exporting…" : "Download CSV"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense>
      <RunsInner />
    </Suspense>
  );
}
