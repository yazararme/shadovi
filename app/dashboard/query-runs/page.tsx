"use client";

import React, { useEffect, useRef, useState, Suspense } from "react";
import { useClientContext } from "@/context/ClientContext";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Client, LLMModel, QueryIntent } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichedRun {
  id: string;
  query_id: string;
  query_text: string;
  query_intent: QueryIntent;
  model: LLMModel;
  ran_at: string;
  mention_sentiment: string | null;
  brand_mentioned: boolean | null;
  mention_position: string | null;
  brand_positioning: string | null;
  citation_present: boolean | null;
  share_of_model_score: number | null;
  competitors_mentioned: string[] | null;
  source_attribution: string[] | null;
  content_age_estimate: string | null;
  raw_response: string | null;
  bait_triggered: boolean;
}

// A group of runs sharing the same query text + model + calendar date
interface RunGroup {
  key: string;
  query_text: string;
  query_intent: QueryIntent;
  model: LLMModel;
  date: string;      // YYYY-MM-DD
  runs: EnrichedRun[];
  latestRanAt: string;
  latestSentiment: string | null;
  hasBait: boolean;
}

type IntentFilter = QueryIntent | "all";
type ModelFilter  = LLMModel | "all";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const INTENT_LABEL: Record<QueryIntent, string> = {
  problem_aware: "Problem-Aware",
  category:      "Category",
  comparative:   "Comparative",
  validation:    "Validation",
};

const INTENT_BADGE: Record<QueryIntent, string> = {
  problem_aware: "bg-[rgba(31,182,255,0.08)] text-[#1580c0] border-[rgba(31,182,255,0.2)]",
  category:      "bg-[rgba(13,4,55,0.06)] text-[#0D0437] border-[rgba(13,4,55,0.15)]",
  comparative:   "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
  validation:    "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
};

const MODEL_LABEL: Record<LLMModel, string> = {
  "gpt-4o":           "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity:          "Perplexity",
  gemini:              "Gemini",
  deepseek:            "DeepSeek",
};

const MODEL_BADGE: Record<LLMModel, string> = {
  "gpt-4o":           "bg-[#10a37f]/10 text-[#10a37f] border-[#10a37f]/30",
  "claude-sonnet-4-6": "bg-[#d4a27e]/10 text-[#d4a27e] border-[#d4a27e]/30",
  perplexity:          "bg-[#1fb6ff]/10 text-[#1fb6ff] border-[#1fb6ff]/30",
  gemini:              "bg-[#4285f4]/10 text-[#4285f4] border-[#4285f4]/30",
  deepseek:            "bg-[#6366f1]/10 text-[#6366f1] border-[#6366f1]/30",
};

const SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  neutral:  "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
  negative: "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
};

// Model filter tabs per spec — explicit list, no Claude tab
const MODEL_TAB_OPTIONS: Array<{ id: ModelFilter; label: string }> = [
  { id: "all",       label: "ALL" },
  { id: "gpt-4o",    label: "GPT-4O" },
  { id: "perplexity", label: "PERPLEXITY" },
  { id: "gemini",    label: "GEMINI" },
  { id: "deepseek",  label: "DEEPSEEK" },
];

const INTENT_TAB_OPTIONS: Array<{ id: IntentFilter; label: string }> = [
  { id: "all",          label: "ALL" },
  { id: "problem_aware", label: "PROBLEM-AWARE" },
  { id: "category",     label: "CATEGORY" },
  { id: "comparative",  label: "COMPARATIVE" },
  { id: "validation",   label: "VALIDATION" },
];

// ─── Utilities ────────────────────────────────────────────────────────────────

function computeNextRunDate(lastRunAt: string, frequency: string): string {
  const days = frequency === "weekly" ? 7 : 30;
  const next = new Date(new Date(lastRunAt).getTime() + days * 86_400_000);
  return next.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function relativeDate(dateStr: string): string {
  const diffMs   = Date.now() - new Date(dateStr).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// ─── Export field definitions ─────────────────────────────────────────────────

const EXPORT_FIELDS: Array<{ key: string; label: string; always?: boolean }> = [
  { key: "query_text",           label: "Query",                always: true },
  { key: "query_intent",         label: "Intent",               always: true },
  { key: "model",                label: "Model",                always: true },
  { key: "ran_at",               label: "Date",                 always: true },
  { key: "mention_sentiment",    label: "Sentiment" },
  { key: "brand_mentioned",      label: "Brand Mentioned" },
  { key: "mention_position",     label: "Mention Position" },
  { key: "brand_positioning",    label: "Brand Positioning" },
  { key: "citation_present",     label: "Citation Present" },
  { key: "share_of_model_score", label: "Share of Voice Score" },
  { key: "competitors_mentioned", label: "Competitors Mentioned" },
  { key: "source_attribution",   label: "Source Attribution" },
  { key: "content_age_estimate", label: "Content Age Est." },
  { key: "bait_triggered",       label: "Bait Triggered" },
  { key: "raw_response",         label: "Raw Response" },
];

// Default: all optional fields except raw_response (can be very large)
const DEFAULT_EXPORT_FIELDS = new Set(
  EXPORT_FIELDS.filter((f) => !f.always && f.key !== "raw_response").map((f) => f.key)
);

function serializeField(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) {
    const joined = val
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .join("; ");
    return `"${joined.replace(/"/g, '""')}"`;
  }
  if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCsv(runs: EnrichedRun[], selectedKeys: Set<string>) {
  const fields = EXPORT_FIELDS.filter((f) => f.always || selectedKeys.has(f.key));
  const header = fields.map((f) => f.label).join(",");
  const rows   = runs.map((run) =>
    fields.map((f) => serializeField(run[f.key as keyof EnrichedRun])).join(",")
  );
  const csv  = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "query-runs.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Group enriched runs by query_text + model + calendar date
function groupRuns(runs: EnrichedRun[]): RunGroup[] {
  const map = new Map<string, RunGroup>();
  for (const run of runs) {
    const date = run.ran_at.split("T")[0];
    const key  = `${run.query_text}::${run.model}::${date}`;
    const existing = map.get(key);
    if (existing) {
      existing.runs.push(run);
      if (run.ran_at > existing.latestRanAt) {
        existing.latestRanAt     = run.ran_at;
        existing.latestSentiment = run.mention_sentiment;
      }
      if (run.bait_triggered) existing.hasBait = true;
    } else {
      map.set(key, {
        key,
        query_text:      run.query_text,
        query_intent:    run.query_intent,
        model:           run.model,
        date,
        runs:            [run],
        latestRanAt:     run.ran_at,
        latestSentiment: run.mention_sentiment,
        hasBait:         run.bait_triggered,
      });
    }
  }
  // Sort groups by latestRanAt descending (most recent first)
  return Array.from(map.values()).sort((a, b) => b.latestRanAt.localeCompare(a.latestRanAt));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <span className="text-[10px] text-[#9CA3AF]">—</span>;
  const style = SENTIMENT_BADGE[sentiment] ?? SENTIMENT_BADGE.neutral;
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${style}`}>
      {sentiment}
    </span>
  );
}

function FilterTab<T extends string>({
  options,
  counts,
  value,
  onChange,
}: {
  options: { id: T | "all"; label: string }[];
  counts: Map<T | "all", number>;
  value: T | "all";
  onChange: (v: T | "all") => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => {
        const count  = counts.get(opt.id as T | "all") ?? 0;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id as T | "all")}
            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors ${
              active
                ? "bg-[#0D0437] text-white"
                : "bg-white border border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437]"
            }`}
          >
            {opt.label} {count > 0 && <span className={active ? "opacity-70" : ""}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Page inner ───────────────────────────────────────────────────────────────

function QueryRunsInner() {
  const { activeClientId: clientIdParam, isAdmin } = useClientContext();

  const [client,  setClient]  = useState<Client | null>(null);
  const [allRuns, setAllRuns] = useState<EnrichedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all");
  const [modelFilter,  setModelFilter]  = useState<ModelFilter>("all");
  const [page,         setPage]         = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  // Export field picker
  const [exportOpen,   setExportOpen]   = useState(false);
  const [exportFields, setExportFields] = useState<Set<string>>(new Set(DEFAULT_EXPORT_FIELDS));
  const exportRef = useRef<HTMLDivElement>(null);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [intentFilter, modelFilter]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [exportOpen]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    let q = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) q = q.eq("id", clientIdParam);
    const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);
    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (activeClient) {
      // Fetch active version first to scope runs to current portfolio
      const { data: versionRow } = await supabase
        .from("portfolio_versions")
        .select("id")
        .eq("client_id", activeClient.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      const activeVersionId = (versionRow as { id?: string } | null)?.id ?? null;

      let runsQ = supabase
        .from("tracking_runs")
        .select("id, query_id, model, ran_at, mention_sentiment, query_intent, brand_mentioned, mention_position, brand_positioning, citation_present, share_of_model_score, competitors_mentioned, source_attribution, content_age_estimate, raw_response")
        .eq("client_id", activeClient.id)
        .order("ran_at", { ascending: false })
        .limit(5000);
      if (activeVersionId && !activeClient.show_all_versions) runsQ = runsQ.or(`version_id.eq.${activeVersionId},version_id.is.null`);

      const [{ data: runsData }, { data: queriesData }, { data: baitRows }] = await Promise.all([
        runsQ,
        supabase
          .from("queries")
          .select("id, text, intent")
          .eq("client_id", activeClient.id)
          .limit(2000),
        // Fetch only the run IDs that had bait_triggered=true — lightweight join
        supabase
          .from("brand_knowledge_scores")
          .select("tracking_run_id")
          .eq("client_id", activeClient.id)
          .eq("bait_triggered", true),
      ]);

      const baitRunIds = new Set(
        (baitRows ?? []).map((s: { tracking_run_id: string }) => s.tracking_run_id)
      );

      const queryMap = new Map<string, { text: string; intent: string }>();
      (queriesData ?? []).forEach((q: { id: string; text: string; intent: string }) =>
        queryMap.set(q.id, q)
      );

      const enriched: EnrichedRun[] = (runsData ?? []).map((r: {
        id: string; query_id: string; model: LLMModel; ran_at: string;
        mention_sentiment: string | null; query_intent: string | null; brand_mentioned: boolean | null;
        mention_position: string | null; brand_positioning: string | null;
        citation_present: boolean | null; share_of_model_score: number | null;
        competitors_mentioned: string[] | null; source_attribution: string[] | null;
        content_age_estimate: string | null; raw_response: string | null;
      }) => ({
        id:                    r.id,
        query_id:              r.query_id,
        query_text:            queryMap.get(r.query_id)?.text ?? r.query_id,
        query_intent:          (r.query_intent ?? queryMap.get(r.query_id)?.intent ?? "problem_aware") as QueryIntent,
        model:                 r.model,
        ran_at:                r.ran_at,
        mention_sentiment:     r.mention_sentiment,
        brand_mentioned:       r.brand_mentioned,
        mention_position:      r.mention_position,
        brand_positioning:     r.brand_positioning,
        citation_present:      r.citation_present,
        share_of_model_score:  r.share_of_model_score,
        competitors_mentioned: r.competitors_mentioned,
        source_attribution:    r.source_attribution,
        content_age_estimate:  r.content_age_estimate,
        raw_response:          r.raw_response,
        bait_triggered:        baitRunIds.has(r.id),
      }));

      setAllRuns(enriched);
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
      const body = await res.json();
      if (res.ok) toast.success("Tracking run queued — check back in a few minutes.");
      else toast.error(body.error ?? "Failed to queue run");
    } catch {
      toast.error("Network error — try again");
    } finally {
      setRunning(false);
    }
  }

  function toggleGroup(key: string) {
    setExpandedKeys((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  // ── Compute filter counts and apply filters ────────────────────────────
  if (loading) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg px-4 py-3 bg-white flex items-center gap-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Query Runs</h1>
        <p className="text-sm text-[#6B7280] mt-2">No active client.</p>
      </div>
    );
  }

  // Intent tab counts (all models)
  const intentCounts = new Map<IntentFilter | "all", number>();
  intentCounts.set("all", allRuns.length);
  for (const intent of ["problem_aware", "category", "comparative", "validation"] as QueryIntent[]) {
    intentCounts.set(intent, allRuns.filter((r) => r.query_intent === intent).length);
  }

  // Apply intent filter
  const intentFiltered = intentFilter === "all"
    ? allRuns
    : allRuns.filter((r) => r.query_intent === intentFilter);

  // Model tab counts (after intent filter)
  const modelCounts = new Map<ModelFilter | "all", number>();
  modelCounts.set("all", intentFiltered.length);
  for (const model of ["gpt-4o", "perplexity", "gemini", "deepseek"] as LLMModel[]) {
    modelCounts.set(model, intentFiltered.filter((r) => r.model === model).length);
  }

  // Apply model filter
  const filtered = modelFilter === "all"
    ? intentFiltered
    : intentFiltered.filter((r) => r.model === modelFilter);

  // Group filtered runs
  const groups   = groupRuns(filtered);
  const total    = groups.length;
  const pageGroups = groups.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rangeStart = page * PAGE_SIZE + 1;
  const rangeEnd   = Math.min((page + 1) * PAGE_SIZE, total);

  // Daily run limit — allRuns is sorted desc, so [0] is most recent.
  // Admin bypasses this restriction entirely.
  const todayStartUTC = new Date();
  todayStartUTC.setUTCHours(0, 0, 0, 0);
  const isBlockedByDailyLimit =
    !isAdmin &&
    client?.tracking_frequency !== "daily" &&
    allRuns.some((r) => new Date(r.ran_at) >= todayStartUTC);
  const lastRunAt = allRuns[0]?.ran_at ?? null;

  if (allRuns.length === 0) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight">Query Runs</h1>
            <p className="text-[12px] text-[#9CA3AF] font-mono mt-0.5">No runs yet</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunNow}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold bg-[#0D0437] text-white hover:bg-[#1a1150] disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
              {running ? "Queuing…" : "Run now"}
            </button>
          </div>
        </div>
        <div className="border border-[#E2E8F0] rounded-lg p-10 text-center bg-white">
          <p className="text-[13px] font-semibold text-[#0D0437]">No tracking runs yet</p>
          <p className="text-[12px] text-[#6B7280] mt-1">Click &ldquo;Run now&rdquo; to trigger your first run.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight leading-tight">
            Query Runs
          </h1>
          <p className="text-[12px] text-[#9CA3AF] font-mono mt-0.5">
            {allRuns.length.toLocaleString()} total runs
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
          {/* Export CSV with field picker */}
          <div className="relative" ref={exportRef}>
            <button
              onClick={() => setExportOpen((o) => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold border border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437] transition-colors"
            >
              <Download className="h-3 w-3" />
              Export CSV
              <ChevronDown className={`h-3 w-3 transition-transform ${exportOpen ? "rotate-180" : ""}`} />
            </button>

            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-[#E2E8F0] rounded-lg shadow-lg z-20 p-3">
                <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF] mb-2.5">
                  Include in export
                </p>
                <div className="space-y-1.5">
                  {EXPORT_FIELDS.map((f) => {
                    if (f.always) {
                      // Required fields — shown greyed out, non-interactive
                      return (
                        <div key={f.key} className="flex items-center gap-2 px-0.5 opacity-40">
                          <div className="h-3.5 w-3.5 rounded border border-[#D1D5DB] bg-[#F4F6F9] shrink-0 flex items-center justify-center">
                            <div className="h-1.5 w-1.5 rounded-sm bg-[#9CA3AF]" />
                          </div>
                          <span className="text-[11px] text-[#6B7280]">{f.label}</span>
                        </div>
                      );
                    }
                    const checked = exportFields.has(f.key);
                    return (
                      <div
                        key={f.key}
                        className="flex items-center gap-2 px-0.5 cursor-pointer group"
                        onClick={() => setExportFields((prev) => {
                          const n = new Set(prev);
                          n.has(f.key) ? n.delete(f.key) : n.add(f.key);
                          return n;
                        })}
                      >
                        <div
                          className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                            checked
                              ? "bg-[#0D0437] border-[#0D0437]"
                              : "border-[#D1D5DB] group-hover:border-[#0D0437]"
                          }`}
                        >
                          {checked && (
                            <svg viewBox="0 0 10 8" className="h-2 w-2 fill-none stroke-white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1,4 3.5,6.5 9,1" />
                            </svg>
                          )}
                        </div>
                        <span className={`text-[11px] transition-colors select-none ${checked ? "text-[#0D0437]" : "text-[#6B7280] group-hover:text-[#0D0437]"}`}>
                          {f.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-2.5 border-t border-[#E2E8F0]">
                  <button
                    onClick={() => { exportCsv(allRuns, exportFields); setExportOpen(false); }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold bg-[#0D0437] text-white hover:bg-[#1a1150] transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={handleRunNow}
            disabled={running || isBlockedByDailyLimit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold bg-[#0D0437] text-white hover:bg-[#1a1150] disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
            {running ? "Queuing…" : "Run now"}
          </button>
          </div>
          {isBlockedByDailyLimit && lastRunAt && (
            <p className="text-[11px] text-[#9CA3AF] text-right max-w-[280px] leading-relaxed">
              Today&apos;s analysis is complete. Next run:{" "}
              <span className="font-medium text-[#6B7280]">
                {computeNextRunDate(lastRunAt, client?.tracking_frequency ?? "weekly")}
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

      {/* Filter row 1 — Intent */}
      <div className="space-y-2 mb-5">
        <FilterTab<QueryIntent>
          options={INTENT_TAB_OPTIONS}
          counts={intentCounts}
          value={intentFilter}
          onChange={(v) => setIntentFilter(v as IntentFilter)}
        />
        {/* Filter row 2 — Model */}
        <FilterTab<LLMModel>
          options={MODEL_TAB_OPTIONS}
          counts={modelCounts}
          value={modelFilter}
          onChange={(v) => setModelFilter(v as ModelFilter)}
        />
      </div>

      {/* Table */}
      {pageGroups.length === 0 ? (
        <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-white">
          <p className="text-sm text-[#6B7280]">No runs match this filter.</p>
        </div>
      ) : (
        <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-[#F4F6F9]">
                {["Intent", "Query", "Model", "Sentiment", "Date", ""].map((h) => (
                  <th
                    key={h}
                    className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageGroups.map((group) => {
                const isExpanded = expandedKeys.has(group.key);
                const hasVariants = group.runs.length > 1;
                const intentStyle = INTENT_BADGE[group.query_intent] ?? INTENT_BADGE.problem_aware;
                const modelStyle  = MODEL_BADGE[group.model] ?? "";

                return (
                  <React.Fragment key={group.key}>
                    {/* Parent / single row */}
                    <tr
                      className={`border-b transition-colors ${
                        hasVariants ? "hover:bg-[rgba(244,246,249,0.7)] cursor-pointer" : ""
                      }`}
                      onClick={hasVariants ? () => toggleGroup(group.key) : undefined}
                    >
                      {/* Intent */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${intentStyle}`}>
                            {INTENT_LABEL[group.query_intent]}
                          </span>
                          {group.hasBait && (
                            <span className="text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)] whitespace-nowrap">
                              Bait ✓
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Query */}
                      <td className="px-4 py-3 max-w-[280px]">
                        <p className="text-[12px] text-[#0D0437] leading-snug">
                          {truncate(group.query_text)}
                        </p>
                        {hasVariants && (
                          <p className="text-[10px] text-[#9CA3AF] mt-0.5">
                            {group.runs.length} variants
                          </p>
                        )}
                      </td>

                      {/* Model */}
                      <td className="px-4 py-3">
                        <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${modelStyle}`}>
                          {MODEL_LABEL[group.model] ?? group.model}
                        </span>
                      </td>

                      {/* Sentiment — most recent */}
                      <td className="px-4 py-3">
                        <SentimentBadge sentiment={group.latestSentiment} />
                      </td>

                      {/* Date — relative */}
                      <td className="px-4 py-3 text-[11px] text-[#9CA3AF] whitespace-nowrap">
                        {relativeDate(group.latestRanAt)}
                      </td>

                      {/* Chevron — only for multi-run groups */}
                      <td className="px-4 py-3 text-[#9CA3AF] w-8">
                        {hasVariants && (
                          isExpanded
                            ? <ChevronUp className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </td>
                    </tr>

                    {/* Expanded sub-rows — individual runs */}
                    {hasVariants && isExpanded && group.runs.map((run) => (
                      <tr
                        key={run.id}
                        className="border-b bg-[rgba(244,246,249,0.5)] last:border-0"
                      >
                        <td className="px-4 py-2">
                          {run.bait_triggered && (
                            <span className="text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)] whitespace-nowrap">
                              Bait ✓
                            </span>
                          )}
                        </td>
                        <td className="pl-8 pr-4 py-2">
                          <span className="text-[10px] text-[#9CA3AF]">
                            {new Date(run.ran_at).toLocaleString([], {
                              month: "short", day: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                        </td>
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2">
                          <SentimentBadge sentiment={run.mention_sentiment} />
                        </td>
                        <td className="px-4 py-2">
                          {run.brand_mentioned === true && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]">
                              Mentioned
                            </span>
                          )}
                          {run.brand_mentioned === false && (
                            <span className="text-[10px] text-[#9CA3AF]">Not mentioned</span>
                          )}
                          {run.brand_mentioned === null && (
                            <span className="text-[10px] text-[#9CA3AF]">—</span>
                          )}
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
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-[11px] text-[#9CA3AF]">
            Showing {rangeStart}–{rangeEnd} of {total}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437] disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437] disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function QueryRunsPage() {
  return (
    <Suspense>
      <QueryRunsInner />
    </Suspense>
  );
}
