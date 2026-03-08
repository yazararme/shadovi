"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import { ModelIntentHeatmap, type HeatmapRow } from "@/components/dashboard/ModelIntentHeatmap";
import { NarrativePathway } from "@/components/dashboard/NarrativePathway";
import { ResponseDrawer, type RunOption } from "@/components/dashboard/ResponseDrawer";
import { MetricDetailDrawer, type MetricDetailRun } from "@/components/dashboard/MetricDetailDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import type {
  Client, TrackingRun, Competitor, LLMModel, QueryIntent, GapCluster, Recommendation,
} from "@/types";

// ── Constants ──────────────────────────────────────────────────────────────────

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o":            "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity":        "Perplexity",
  "gemini":            "Gemini",
  "deepseek":          "DeepSeek",
};

const MODEL_PILL: Record<LLMModel, string> = {
  "gpt-4o":            "bg-[rgba(16,163,127,0.1)] text-[#10a37f] border-[rgba(16,163,127,0.3)]",
  "claude-sonnet-4-6": "bg-[rgba(212,162,126,0.1)] text-[#b5804a] border-[rgba(212,162,126,0.3)]",
  "perplexity":        "bg-[rgba(31,182,255,0.1)] text-[#1580c0] border-[rgba(31,182,255,0.3)]",
  "gemini":            "bg-[rgba(66,133,244,0.1)] text-[#4285f4] border-[rgba(66,133,244,0.3)]",
  "deepseek":          "bg-[rgba(99,102,241,0.1)] text-[#6366f1] border-[rgba(99,102,241,0.3)]",
};

const INTENT_FILTER_OPTIONS: { value: QueryIntent | "all"; label: string }[] = [
  { value: "all",           label: "All" },
  { value: "problem_aware", label: "Problem-Aware" },
  { value: "category",      label: "Category" },
];

const DATE_OPTIONS: { value: "7d" | "30d" | "all"; label: string }[] = [
  { value: "7d",  label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

// Non-validation intents used for share-of-voice analysis
const SOV_INTENTS: QueryIntent[] = ["problem_aware", "category"];

// Coral for own brand (matches heatmap brand-row border); then a distinct palette for competitors
const ENTITY_COLORS = [
  "#FF6B6B", // own brand
  "#10a37f", "#4285f4", "#f59e0b", "#7B5EA7",
  "#00B4D8", "#6366f1", "#d4a27e", "#e11d48",
];

/** Format "YYYY-MM-DD" → "27 Feb" using UTC to avoid timezone shifts */
function formatTrendDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type EnrichedRun = TrackingRun & { query_text: string };

interface GroupedQuery {
  queryId: string;
  queryText: string;
  queryIntent: QueryIntent;
  models: LLMModel[];
  competitorsMentioned: string[];
  citedSources: NonNullable<TrackingRun["cited_sources"]>;
  allRuns: EnrichedRun[];
}

/** Group gap runs by query — keeps one run per model (latest). */
function groupRunsByQuery(
  runs: EnrichedRun[],
  excludeQMPairs: Set<string> = new Set()
): GroupedQuery[] {
  const map = new Map<string, GroupedQuery>();
  for (const run of runs) {
    if (excludeQMPairs.has(`${run.query_id}:${run.model}`)) continue;
    if (!map.has(run.query_id)) {
      map.set(run.query_id, {
        queryId: run.query_id,
        queryText: run.query_text,
        queryIntent: (run.query_intent ?? "problem_aware") as QueryIntent,
        models: [],
        competitorsMentioned: [],
        citedSources: [],
        allRuns: [],
      });
    }
    const g = map.get(run.query_id)!;
    const hasComps = (run.competitors_mentioned ?? []).length > 0;
    if (!g.models.includes(run.model)) {
      // Only include model in the badge list if its run actually mentions competitors
      if (hasComps) g.models.push(run.model);
      g.allRuns.push(run);
    }
    for (const c of run.competitors_mentioned ?? []) {
      if (!g.competitorsMentioned.includes(c)) g.competitorsMentioned.push(c);
    }
    for (const s of run.cited_sources ?? []) {
      if (!g.citedSources.some((x) => x.url === s.url)) g.citedSources.push(s);
    }
  }
  return Array.from(map.values());
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-3 mt-10 mb-4">
      <span className="text-[10px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
        {children}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[11px] text-[#9CA3AF] shrink-0">{count}</span>
      )}
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

function VelocityBadge({ dir, pct }: { dir: "up" | "down" | "same"; pct: number }) {
  if (dir === "same") return <span className="text-[11px] text-[#9CA3AF]">—</span>;
  if (dir === "up")
    return <span className="text-[10px] font-bold text-[#FF4B6E] whitespace-nowrap">↑ {pct}%</span>;
  return <span className="text-[10px] font-bold text-[#1A8F5C] whitespace-nowrap">↓ {pct}%</span>;
}

function ClusterCard({
  cluster,
  displaced,
  open,
  isActive,
  roadmapHref,
  onClick,
}: {
  cluster: GapCluster;
  displaced: number;
  open: number;
  isActive: boolean;
  roadmapHref: string;
  onClick: () => void;
}) {
  return (
    <div
      className={`w-full text-left p-4 rounded-xl border bg-white transition-all flex flex-col gap-2.5 ${
        isActive
          ? "border-[#0D0437] shadow-md ring-1 ring-[#0D0437]/10"
          : "border-[#E2E8F0] hover:border-[#C7CEE0] hover:shadow-sm"
      }`}
    >
      {/* Header: clickable to toggle */}
      <button onClick={onClick} className="flex items-start justify-between gap-2 w-full text-left">
        <p className="text-[13px] font-bold text-[#0D0437] leading-snug">{cluster.cluster_name}</p>
        {isActive
          ? <ChevronUp className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0 mt-0.5" />
          : <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0 mt-0.5" />}
      </button>

      <p className="text-[12px] text-[#6B7280]">
        {cluster.query_count} {cluster.query_count === 1 ? "query" : "queries"}
      </p>

      {/* DISPLACED / OPEN badges */}
      {(displaced > 0 || open > 0) && (
        <div className="flex gap-1.5 flex-wrap">
          {displaced > 0 && (
            <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-[rgba(255,75,110,0.10)] text-[#FF4B6E] border-[rgba(255,75,110,0.25)]">
              Displaced {displaced}
            </span>
          )}
          {open > 0 && (
            <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-[rgba(245,158,11,0.10)] text-[#D97706] border-[rgba(245,158,11,0.25)]">
              Open {open}
            </span>
          )}
        </div>
      )}

      {/* Competitor pills */}
      {(cluster.competitors_present ?? []).length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {cluster.competitors_present.slice(0, 3).map((c) => (
            <span key={c} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">
              {c}
            </span>
          ))}
          {cluster.competitors_present.length > 3 && (
            <span className="text-[10px] text-[#9CA3AF] self-center">
              +{cluster.competitors_present.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Roadmap CTA — pinned to card bottom */}
      <Link
        href={roadmapHref}
        onClick={(e) => e.stopPropagation()}
        className="mt-auto pt-2 border-t border-[#F1F5F9] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#FF4B6E] transition-colors flex items-center gap-1 w-fit"
      >
        View recommendation →
      </Link>
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface DrawerState {
  runs: EnrichedRun[];
  queryText: string;
}

interface RbmRow {
  query_id: string;
  model: string;
  brand_name: string;
  is_tracked_brand: boolean;
  query_intent: string | null;
}

// ── Main component ─────────────────────────────────────────────────────────────

function ShareOfVoiceInner() {
  const { activeClientId: clientIdParam, loading: contextLoading } = useClientContext();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  // Section data
  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [rbmRows, setRbmRows] = useState<RbmRow[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [clusters, setClusters] = useState<GapCluster[]>([]);
  const [clusterQueryMap, setClusterQueryMap] = useState<Map<string, Set<string>>>(new Map());
  const [clusterRuns, setClusterRuns] = useState<EnrichedRun[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  // "query_id:model" confirmed by rbm as is_tracked_brand=true
  const [brandQMSet, setBrandQMSet] = useState<Set<string>>(new Set());

  // UI — filter bar
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "all">("all");
  const [intentFilter, setIntentFilter] = useState<QueryIntent | "all">("all");
  // null = all models selected; Set = explicit selection
  const [selectedModels, setSelectedModels] = useState<Set<LLMModel> | null>(null);

  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [heatmapDrawer, setHeatmapDrawer] = useState<{
    entityName: string;
    model: LLMModel;
    isBrand: boolean;
    isSpecialRow: boolean;
  } | null>(null);

  const gapClustersRef = useRef<HTMLDivElement>(null);

  // When navigated here via #gap-clusters hash, scroll that section to vertical center
  useEffect(() => {
    if (loading) return;
    if (window.location.hash === "#gap-clusters") {
      setTimeout(() => {
        gapClustersRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [loading]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Guard: wait for ClientContext to resolve — prevents fetching without a client filter
      if (!clientIdParam) return;
      setLoading(true);
      const supabase = createClient();

      const { data: clients } = await supabase.from("clients").select("*").eq("status", "active")
        .eq("id", clientIdParam)
        .order("created_at", { ascending: false }).limit(1);

      if (cancelled) return;
      const c = (clients?.[0] as Client) ?? null;
      setClient(c);

      if (!c) { setLoading(false); return; }

      // Fetch active version (lightweight) to scope tracking_runs to current portfolio
      const { data: versionRow } = await supabase
        .from("portfolio_versions")
        .select("id")
        .eq("client_id", c.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      const activeVersionId = (versionRow as { id?: string } | null)?.id ?? null;

      let runsQ = supabase.from("tracking_runs").select("*").eq("client_id", c.id)
        .order("ran_at", { ascending: false }).limit(10000);
      if (activeVersionId && !c.show_all_versions) runsQ = runsQ.or(`version_id.eq.${activeVersionId},version_id.is.null`);

      // Parallel fetches (rbm excluded — needs run query_ids for version scoping)
      const [
        { data: runData },
        { data: queryData },
        { data: compData },
        { data: clusterData },
        { data: recData },
      ] = await Promise.all([
        runsQ,
        supabase.from("queries").select("id, text, intent").eq("client_id", c.id).limit(2000),
        supabase.from("competitors").select("*").eq("client_id", c.id).order("name"),
        supabase.from("gap_clusters").select("*").eq("client_id", c.id)
          .order("run_date", { ascending: false }).limit(20),
        supabase.from("recommendations").select("id, query_id, type, title, status")
          .eq("client_id", c.id).eq("status", "open").order("priority"),
      ]);

      if (cancelled) return;

      // Fetch rbm scoped to version-filtered runs, paginated to bypass PostgREST 1000-row cap
      const runQueryIds = [...new Set((runData ?? []).map((r: { query_id: string }) => r.query_id))];
      const allRbm: RbmRow[] = [];
      if (runQueryIds.length > 0) {
        const PAGE_SIZE = 1000;
        let from = 0;
        while (true) {
          const { data } = await supabase
            .from("response_brand_mentions")
            .select("query_id, model, brand_name, is_tracked_brand, query_intent")
            .eq("client_id", c.id)
            .in("query_id", runQueryIds)
            .range(from, from + PAGE_SIZE - 1);
          const page = (data ?? []) as RbmRow[];
          allRbm.push(...page);
          if (page.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
      }
      const rbmData = allRbm;

      const queryMap = Object.fromEntries((queryData ?? []).map((q) => [q.id, q]));
      const enriched = (runData ?? []).map((r) => ({
        ...(r as TrackingRun),
        query_text: (queryMap[r.query_id]?.text ?? "") as string,
      }));
      setRuns(enriched);

      const rbm = rbmData;
      setRbmRows(rbm);
      setBrandQMSet(new Set(rbm.filter((r) => r.is_tracked_brand).map((r) => `${r.query_id}:${r.model}`)));

      setCompetitors((compData ?? []) as Competitor[]);
      setRecommendations((recData ?? []) as Recommendation[]);

      // Gap clusters
      if (clusterData && clusterData.length > 0) {
        const latestDate = clusterData[0].run_date;
        const latest = (clusterData as GapCluster[]).filter((c) => c.run_date === latestDate);
        setClusters(latest);

        const clusterIds = latest.map((c) => c.id);
        const { data: joinRows } = await supabase
          .from("gap_cluster_queries").select("cluster_id, query_id")
          .in("cluster_id", clusterIds).limit(2000);
        if (cancelled) return;

        const cqMap = new Map<string, Set<string>>();
        for (const row of joinRows ?? []) {
          if (!cqMap.has(row.cluster_id)) cqMap.set(row.cluster_id, new Set());
          cqMap.get(row.cluster_id)!.add(row.query_id);
        }
        setClusterQueryMap(cqMap);

        // Targeted run fetch for cluster queries
        const allCQIds = Array.from(cqMap.values()).flatMap((s) => Array.from(s));
        if (allCQIds.length > 0) {
          let cRunQ = supabase.from("tracking_runs").select("*").in("query_id", allCQIds)
            .eq("client_id", c.id).order("ran_at", { ascending: false }).limit(5000);
          if (activeVersionId && !c.show_all_versions) cRunQ = cRunQ.or(`version_id.eq.${activeVersionId},version_id.is.null`);
          const { data: cRunData } = await cRunQ;
          if (cancelled) return;
          setClusterRuns((cRunData ?? []).map((r) => ({
            ...(r as TrackingRun),
            query_text: (queryMap[r.query_id]?.text ?? "") as string,
          })));
        }
      }

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [clientIdParam, contextLoading]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto">
        <h1 className="text-2xl font-bold text-[#0D0437] mb-2">AI Share of Voice</h1>
        <p className="text-sm text-[#6B7280]">No active client found.</p>
      </div>
    );
  }

  if (runs.length < 10) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto">
        <h1 className="text-[28px] font-bold text-[#0D0437] mb-1">AI Share of Voice</h1>
        <p className="text-[12px] text-[#9CA3AF] font-mono mb-6">{client.brand_name ?? client.url}</p>
        <div className="border border-[#E2E8F0] rounded-xl p-8 bg-white text-center">
          <p className="text-[14px] text-[#0D0437] font-semibold">Not enough data yet</p>
          <p className="text-[13px] text-[#6B7280] mt-1">Run your first audit from Overview to see competitive intelligence.</p>
        </div>
      </div>
    );
  }

  // ── Derived: filter bar ────────────────────────────────────────────────────

  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? "Your Brand";

  // Derive models from actual run data — not client.selected_models — so the heatmap
  // shows every model that has ever been tracked, regardless of current config.
  const allRunModels = Array.from(new Set(runs.map((r) => r.model as LLMModel)));
  const trackedModels = allRunModels;
  const availableModels = allRunModels;

  // Effective model set: null state = all available
  const effectiveModelSet: Set<LLMModel> = selectedModels ?? new Set(availableModels);

  // Date cutoff — ISO string "YYYY-MM-DD", null = no cutoff
  const dateThreshold: string | null =
    dateRange === "7d"  ? new Date(Date.now() - 7  * 86_400_000).toISOString().slice(0, 10) :
    dateRange === "30d" ? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) :
    null;

  // Base runs: apply date + model filter before any section-specific logic
  const baseRuns = runs.filter((r) => {
    if (dateThreshold && r.ran_at.slice(0, 10) < dateThreshold) return false;
    if (!effectiveModelSet.has(r.model as LLMModel)) return false;
    return true;
  });

  // Columns shown in heatmap (respects model selection)
  const filteredModels = trackedModels.filter((m) => effectiveModelSet.has(m));

  // Toggle a single model pill — reset to null (all) if all re-selected
  function toggleModel(model: LLMModel) {
    setSelectedModels((prev) => {
      const base = new Set(prev ?? availableModels);
      if (base.has(model)) { base.delete(model); } else { base.add(model); }
      return base.size === availableModels.length ? null : base;
    });
  }

  // ── Derived: heatmap ───────────────────────────────────────────────────────

  // Non-validation runs only
  const sovRuns = baseRuns.filter((r) => r.query_intent !== "validation");

  // Apply intent filter
  const filteredRuns =
    intentFilter === "all"
      ? sovRuns.filter((r) => r.query_intent !== null && SOV_INTENTS.includes(r.query_intent as QueryIntent))
      : sovRuns.filter((r) => r.query_intent === intentFilter);

  // Set of query_id:model pairs in the filtered scope
  const filteredQMPairs = new Set(filteredRuns.map((r) => `${r.query_id}:${r.model}`));

  // Filtered rbm rows — only those whose (query_id, model) appear in filteredRuns
  const filteredRbm = rbmRows.filter((r) => filteredQMPairs.has(`${r.query_id}:${r.model}`));

  // Build heatmap rows — "No Brand Visible" is a special meta-row appended last
  const heatmapRows: HeatmapRow[] = [
    { name: brandName, isBrand: true, byModel: {} },
    ...competitors.map((c) => ({ name: c.name, isBrand: false, byModel: {} })),
    { name: "No Brand Visible", isBrand: false, isSpecialRow: true, byModel: {} },
  ];
  const noBrandRowIdx = heatmapRows.length - 1;
  const lowerBrandName = brandName.toLowerCase();

  for (const model of trackedModels) {
    const modelRuns = filteredRuns.filter((r) => r.model === model);
    const total = modelRuns.length;
    if (total === 0) continue;

    // Brand row — count ALL mentions (any sentiment) by matching brand name, not just is_tracked_brand
    const brandMentionedQIds = new Set(
      filteredRbm.filter((r) => r.brand_name.toLowerCase() === lowerBrandName && r.model === model).map((r) => r.query_id)
    );
    const brandCount = modelRuns.filter((r) => brandMentionedQIds.has(r.query_id)).length;
    heatmapRows[0].byModel[model] = {
      mentionRate: total > 0 ? Math.round((brandCount / total) * 100) : 0,
      isPrimary: false,
      topQueries: modelRuns.filter((r) => brandMentionedQIds.has(r.query_id)).slice(0, 2).map((r) => r.query_text),
    };

    // Competitor rows — use tracking_runs.competitors_mentioned (stamped at run time, always populated)
    // rather than response_brand_mentions which may have coverage gaps for older runs.
    // Use normalized substring matching: LLMs may abbreviate names (e.g. "Johnson & Johnson" vs
    // "Johnson & Johnson personal care brands"), so we match if either string contains the other.
    competitors.forEach((comp, idx) => {
      const lowerCompName = comp.name.toLowerCase().trim();
      const compQIds = new Set(
        modelRuns.filter((r) =>
          (r.competitors_mentioned ?? []).some((m) => {
            const lowerM = m.toLowerCase().trim();
            return lowerM === lowerCompName || lowerCompName.includes(lowerM) || lowerM.includes(lowerCompName);
          })
        ).map((r) => r.query_id)
      );
      const compCount = modelRuns.filter((r) => compQIds.has(r.query_id)).length;
      heatmapRows[idx + 1].byModel[model] = {
        mentionRate: total > 0 ? Math.round((compCount / total) * 100) : 0,
        isPrimary: false,
        topQueries: modelRuns.filter((r) => compQIds.has(r.query_id)).slice(0, 2).map((r) => r.query_text),
      };
    });

    // No Brand Visible row — runs where no entity appears in rbm AND no competitors_mentioned
    // (competitors use tracking_runs.competitors_mentioned which may have data not in rbm)
    const anyEntityQIds = new Set(filteredRbm.filter((r) => r.model === model).map((r) => r.query_id));
    const noEntityVisible = (r: typeof modelRuns[number]) =>
      !anyEntityQIds.has(r.query_id) && (r.competitors_mentioned ?? []).length === 0;
    const noBrandCount = modelRuns.filter(noEntityVisible).length;
    heatmapRows[noBrandRowIdx].byModel[model] = {
      mentionRate: total > 0 ? Math.round((noBrandCount / total) * 100) : 0,
      isPrimary: false,
      topQueries: modelRuns.filter(noEntityVisible).slice(0, 2).map((r) => r.query_text),
    };

    // Crown: highest % per column — skip special rows
    let maxRate = 0; let primaryIdx = 0;
    heatmapRows.forEach((row, i) => {
      if (row.isSpecialRow) return;
      const rate = row.byModel[model]?.mentionRate ?? 0;
      if (rate > maxRate) { maxRate = rate; primaryIdx = i; }
    });
    if (maxRate > 0) heatmapRows[primaryIdx].byModel[model]!.isPrimary = true;
  }

  // Remove competitors with zero presence across all tracked models — collect their names for the footnote.
  // Only filters non-brand, non-special rows so the brand row and "No Brand Visible" are always shown.
  const zeroPresenceNames: string[] = [];
  const visibleHeatmapRows = heatmapRows.filter((row) => {
    if (row.isBrand || row.isSpecialRow) return true;
    const totalRate = trackedModels.reduce((sum, m) => sum + (row.byModel[m]?.mentionRate ?? 0), 0);
    if (totalRate === 0) { zeroPresenceNames.push(row.name); return false; }
    return true;
  });

  // ── Derived: Heatmap drawer data ─────────────────────────────────────────
  // Plain derivation (not useMemo) — only computes when drawer is open, and
  // avoids hook-ordering issues with early returns above.
  const heatmapDrawerData = (() => {
    if (!heatmapDrawer) return null;
    const { entityName, model, isBrand, isSpecialRow } = heatmapDrawer;

    const modelRuns = filteredRuns.filter((r) => r.model === model);
    const total = modelRuns.length;

    let mentionedRuns: EnrichedRun[];
    let notMentionedRuns: EnrichedRun[];

    if (isBrand) {
      // Brand row: use rbm-based matching (same as heatmap builder)
      const brandMentionedQIds = new Set(
        filteredRbm
          .filter((r) => r.brand_name.toLowerCase() === lowerBrandName && r.model === model)
          .map((r) => r.query_id)
      );
      mentionedRuns = modelRuns.filter((r) => brandMentionedQIds.has(r.query_id));
      notMentionedRuns = modelRuns.filter((r) => !brandMentionedQIds.has(r.query_id));

    } else if (isSpecialRow) {
      // "No Brand Visible" — runs where no entity appears in rbm AND no competitors_mentioned
      const anyEntityQIds = new Set(
        filteredRbm.filter((r) => r.model === model).map((r) => r.query_id)
      );
      mentionedRuns = modelRuns.filter(
        (r) => !anyEntityQIds.has(r.query_id) && (r.competitors_mentioned ?? []).length === 0
      );
      notMentionedRuns = modelRuns.filter(
        (r) => anyEntityQIds.has(r.query_id) || (r.competitors_mentioned ?? []).length > 0
      );

    } else {
      // Competitor row: normalized substring matching (same as heatmap builder)
      const lowerCompName = entityName.toLowerCase().trim();
      const isCompMentioned = (r: EnrichedRun) =>
        (r.competitors_mentioned ?? []).some((m) => {
          const lowerM = m.toLowerCase().trim();
          return lowerM === lowerCompName || lowerCompName.includes(lowerM) || lowerM.includes(lowerCompName);
        });
      mentionedRuns = modelRuns.filter(isCompMentioned);
      notMentionedRuns = modelRuns.filter((r) => !isCompMentioned(r));
    }

    const rate = total > 0 ? Math.round((mentionedRuns.length / total) * 100) : 0;
    const modelLabel = MODEL_LABELS[model] ?? model;

    const toDrawerRun = (r: EnrichedRun, wasMentioned: boolean): MetricDetailRun => ({
      id: r.id,
      queryText: r.query_text,
      queryIntent: r.query_intent ?? "problem_aware",
      model: r.model,
      mentionSentiment: wasMentioned ? "positive" : "not_mentioned",
      ranAt: r.ran_at,
      rawResponse: r.raw_response ?? undefined,
      isBait: false,
      baitTriggered: false,
      competitorsMentioned: r.competitors_mentioned ?? [],
    });

    const drawerRuns = [
      ...mentionedRuns.map((r) => toDrawerRun(r, true)),
      ...notMentionedRuns.map((r) => toDrawerRun(r, false)),
    ];

    return {
      title: isSpecialRow
        ? `No Brand Visible on ${modelLabel}`
        : `${entityName} on ${modelLabel}`,
      metricValue: `${rate}%`,
      metricColor: isBrand
        ? (rate >= 40 ? "#1A8F5C" : rate >= 20 ? "#F59E0B" : "#FF4B6E")
        : "#0D0437",
      subtitle: `${mentionedRuns.length} mentioned · ${notMentionedRuns.length} not mentioned · ${total} total queries`,
      runs: drawerRuns,
      csvPrefix: `${brandName}_${entityName.replace(/\s+/g, "_")}_${model}_sov`,
    };
  })();

  // ── Derived: Visibility Trend ─────────────────────────────────────────────
  // problem_aware + category only; date + model filter already applied via baseRuns
  const trendRuns = baseRuns.filter(
    (r) => r.query_intent === "problem_aware" || r.query_intent === "category"
  );
  const trendDailyMap = new Map<string, EnrichedRun[]>();
  for (const r of trendRuns) {
    const date = r.ran_at.slice(0, 10); // YYYY-MM-DD
    if (!trendDailyMap.has(date)) trendDailyMap.set(date, []);
    trendDailyMap.get(date)!.push(r);
  }
  const trendDates = Array.from(trendDailyMap.keys()).sort();

  // One entry per entity: own brand first, then competitors in order
  const trendEntities = [
    { key: brandName, label: brandName, color: ENTITY_COLORS[0] },
    ...competitors.map((comp, i) => ({
      key: comp.name,
      label: comp.name,
      color: ENTITY_COLORS[(i + 1) % ENTITY_COLORS.length],
    })),
  ];

  const trendData = trendDates.map((date) => {
    const dayRuns = trendDailyMap.get(date)!;
    const total = dayRuns.length;
    const entry: Record<string, number | string> = { date: formatTrendDate(date) };
    // Own brand: brand_mentioned = true
    const brandCount = dayRuns.filter((r) => r.brand_mentioned === true).length;
    entry[brandName] = total > 0 ? Math.round((brandCount / total) * 100) : 0;
    // Competitors: normalised substring match (same logic as heatmap)
    for (const comp of competitors) {
      const lowerCompName = comp.name.toLowerCase().trim();
      const compCount = dayRuns.filter((r) =>
        (r.competitors_mentioned ?? []).some((m) => {
          const lowerM = m.toLowerCase().trim();
          return lowerM === lowerCompName || lowerCompName.includes(lowerM) || lowerM.includes(lowerCompName);
        })
      ).length;
      entry[comp.name] = total > 0 ? Math.round((compCount / total) * 100) : 0;
    }
    return entry;
  });

  const trendDateRange =
    trendDates.length >= 2
      ? `${formatTrendDate(trendDates[0])} – ${formatTrendDate(trendDates[trendDates.length - 1])}`
      : trendDates.length === 1 ? formatTrendDate(trendDates[0]) : "";

  // ── Derived: Competitor Displacement ──────────────────────────────────────

  type CompGap = {
    name: string;
    displacementCount: number;
    models: LLMModel[];
    sampleQueryText: string;
    sampleRun: EnrichedRun | null;
  };

  const compGapMap: Record<string, CompGap> = {};
  // Use all non-validation runs for displacement (not filtered by heatmap intent)
  const gapRuns = sovRuns.filter(
    (r) => r.brand_mentioned === false && !brandQMSet.has(`${r.query_id}:${r.model}`)
  );

  gapRuns.forEach((r) => {
    (r.competitors_mentioned ?? []).forEach((comp) => {
      if (!compGapMap[comp]) {
        compGapMap[comp] = { name: comp, displacementCount: 0, models: [], sampleQueryText: "", sampleRun: null };
      }
      compGapMap[comp].displacementCount++;
      if (!compGapMap[comp].models.includes(r.model as LLMModel)) {
        compGapMap[comp].models.push(r.model as LLMModel);
      }
      if (!compGapMap[comp].sampleRun) {
        compGapMap[comp].sampleRun = r;
        compGapMap[comp].sampleQueryText = r.query_text;
      }
    });
  });
  const displacementRows = Object.values(compGapMap).sort((a, b) => b.displacementCount - a.displacementCount);

  // ── Derived: Velocity per competitor (date-over-date, uses all runs for stability) ──
  const velocityDateMap = new Map<string, Map<string, number>>();
  for (const r of runs) {
    if (r.brand_mentioned !== false) continue;
    if (brandQMSet.has(`${r.query_id}:${r.model}`)) continue;
    const date = r.ran_at.slice(0, 10);
    if (!velocityDateMap.has(date)) velocityDateMap.set(date, new Map());
    const dateMap = velocityDateMap.get(date)!;
    for (const comp of (r.competitors_mentioned ?? [])) {
      dateMap.set(comp, (dateMap.get(comp) ?? 0) + 1);
    }
  }
  const velocityDates = Array.from(velocityDateMap.keys()).sort().reverse(); // newest first
  const hasVelocityData = velocityDates.length >= 2;

  function getCompVelocity(compName: string): { dir: "up" | "down" | "same"; pct: number } {
    if (!hasVelocityData) return { dir: "same", pct: 0 };
    const latest = velocityDateMap.get(velocityDates[0])?.get(compName) ?? 0;
    const prev   = velocityDateMap.get(velocityDates[1])?.get(compName) ?? 0;
    if (prev === 0 && latest === 0) return { dir: "same", pct: 0 };
    if (prev === 0) return { dir: "up", pct: 100 };
    const pct = Math.round(((latest - prev) / prev) * 100);
    if (pct > 0) return { dir: "up",   pct };
    if (pct < 0) return { dir: "down", pct: Math.abs(pct) };
    return { dir: "same", pct: 0 };
  }

  // ── Derived: Gap Clusters ─────────────────────────────────────────────────

  // Apply model filter to cluster source (date filter not applied — clusters are keyed by run_date)
  const rawClusterSource = clusterRuns.length > 0 ? clusterRuns : runs;
  const clusterSource = rawClusterSource.filter((r) => effectiveModelSet.has(r.model as LLMModel));

  const clusterStats = new Map<string, { displaced: number; open: number }>();
  for (const cluster of clusters) {
    const memberIds = clusterQueryMap.get(cluster.id) ?? new Set();
    const cRuns = clusterSource.filter((r) => memberIds.has(r.query_id) && r.brand_mentioned === false);
    const grouped = groupRunsByQuery(cRuns, brandQMSet);
    clusterStats.set(cluster.id, {
      displaced: grouped.filter((g) => g.competitorsMentioned.length > 0).length,
      open: grouped.filter((g) => g.competitorsMentioned.length === 0 && g.citedSources.length === 0).length,
    });
  }

  // Active cluster expansion
  const activeCluster = activeClusterId ? clusters.find((c) => c.id === activeClusterId) ?? null : null;
  const activeClusterGrouped = activeCluster
    ? (() => {
        const memberIds = clusterQueryMap.get(activeCluster.id) ?? new Set();
        const cRuns = clusterSource.filter((r) => memberIds.has(r.query_id) && r.brand_mentioned === false);
        return groupRunsByQuery(cRuns, brandQMSet).sort((a, b) => b.models.length - a.models.length);
      })()
    : [];

  // Match recommendation per cluster (first rec whose query_id is in the cluster's queries)
  const recQIdMap = new Map(recommendations.map((r) => [r.query_id ?? "", r.id]));
  function getClusterRoadmapHref(clusterId: string): string {
    const clientQ = clientIdParam ? `&client=${clientIdParam}` : "";
    const memberIds = clusterQueryMap.get(clusterId) ?? new Set();
    for (const qId of memberIds) {
      if (recQIdMap.has(qId)) return `/dashboard/roadmap?highlight=${recQIdMap.get(qId)}${clientQ}`;
    }
    return `/dashboard/roadmap${clientIdParam ? `?client=${clientIdParam}` : ""}`;
  }

  return (
    <div>
      {/* ── Sticky filter bar ─────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-[#E2E8F0]">
        <div className="max-w-[1000px] mx-auto px-8 py-3 flex items-center gap-4 flex-wrap">

          {/* Period */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF] mr-0.5 shrink-0">Period</span>
            {DATE_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDateRange(value)}
                className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                  dateRange === value
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[#E2E8F0] shrink-0" />

          {/* Intent */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF] mr-0.5 shrink-0">Intent</span>
            {INTENT_FILTER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setIntentFilter(value)}
                className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                  intentFilter === value
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {availableModels.length > 0 && (
            <>
              <div className="h-4 w-px bg-[#E2E8F0] shrink-0" />

              {/* Model — multi-select */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF] mr-0.5 shrink-0">Model</span>
                {availableModels.map((m) => {
                  const active = effectiveModelSet.has(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => toggleModel(m)}
                      className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                        active
                          ? MODEL_PILL[m] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"
                          : "border-[#E2E8F0] text-[#C4C9D4] bg-white"
                      }`}
                    >
                      {MODEL_LABELS[m]}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <div className="p-8 max-w-[1000px] mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-2">
        <h1 className="text-[28px] font-bold text-[#0D0437] leading-tight">AI Share of Voice</h1>
        <p className="text-[13px] text-[#6B7280] mt-1">
          How often your brand appears when AI answers questions your buyers are asking
        </p>
        <p className="text-[12px] text-[#9CA3AF] mt-1 leading-relaxed">
          Based on problem-awareness and category queries — the intents where buyers are researching solutions, not yet comparing brands.
        </p>
      </div>

      {/* ─────────────── SECTION 1: SHARE OF MODEL HEATMAP ─────────────────── */}
      <SectionLabel>Share of Model Heatmap</SectionLabel>

      <div className="mb-2">
        <ModelIntentHeatmap
          rows={visibleHeatmapRows}
          models={filteredModels}
          onCellClick={(entityName, model, isBrand, isSpecialRow) => {
            setDrawer(null);
            setHeatmapDrawer({ entityName, model, isBrand, isSpecialRow });
          }}
        />
      </div>

      {zeroPresenceNames.length > 0 && (
        <p className="text-[11px] text-[#9CA3AF] mb-6 leading-relaxed">
          <span className="font-medium">Not found in any LLM responses:</span>{" "}
          {zeroPresenceNames.join(", ")}
        </p>
      )}

      {/* ─────────────── SECTION 1.5: VISIBILITY TREND ──────────────────────── */}
      <SectionLabel>Visibility Trend</SectionLabel>
      <div className="border border-[#E2E8F0] rounded-xl bg-white p-6 mb-8">
        {trendDateRange && (
          <p className="text-[11px] text-[#9CA3AF] mb-4">{trendDateRange}</p>
        )}
        {trendData.length < 2 ? (
          /* Empty state: muted placeholder with fake gridlines */
          <div className="relative h-[240px] rounded-lg overflow-hidden bg-[#F9FAFB] border border-dashed border-[#E5E7EB]">
            {[75, 50, 25].map((pct) => (
              <div
                key={pct}
                className="absolute w-full border-t border-dashed border-[#E5E7EB]"
                style={{ top: `${100 - pct}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-[#9CA3AF]">
                Trend data available after 2 tracking runs
              </p>
            </div>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [`${value}%`, name]}
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    fontSize: 11,
                  }}
                />
                {trendEntities.map((entity) => (
                  <Line
                    key={entity.key}
                    type="monotone"
                    dataKey={entity.key}
                    name={entity.label}
                    stroke={entity.color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {/* Entity legend */}
            <div className="flex flex-wrap gap-3 mt-4">
              {trendEntities.map((entity) => (
                <span key={entity.key} className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ background: entity.color }}
                  />
                  {entity.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ─────────────── SECTION 2: GAP CLUSTERS ───────────────────────────── */}
      <div id="gap-clusters" ref={gapClustersRef}>
      <SectionLabel count={clusters.length > 0 ? clusters.length : undefined}>
        Gap Clusters
      </SectionLabel>

      {clusters.length === 0 ? (
        <div className="border border-[#E2E8F0] rounded-xl p-8 bg-white text-center">
          <p className="text-[13px] text-[#6B7280]">
            Run an audit to see how gap queries cluster into buyer intent patterns.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 3-col cluster grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clusters.map((cluster) => {
              const stats = clusterStats.get(cluster.id) ?? { displaced: 0, open: 0 };
              return (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  displaced={stats.displaced}
                  open={stats.open}
                  isActive={activeClusterId === cluster.id}
                  roadmapHref={getClusterRoadmapHref(cluster.id)}
                  onClick={() => setActiveClusterId((prev) => (prev === cluster.id ? null : cluster.id))}
                />
              );
            })}
          </div>

          {/* Full-width expansion panel */}
          {activeCluster && (
            <div className="border border-[#0D0437]/15 rounded-xl bg-white overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-[#E2E8F0] bg-[#F4F6F9] flex items-center justify-between">
                <p className="text-[12px] font-bold text-[#0D0437]">{activeCluster.cluster_name}</p>
                <span className="font-mono text-[11px] text-[#9CA3AF]">
                  {activeClusterGrouped.length} {activeClusterGrouped.length === 1 ? "gap query" : "gap queries"}
                </span>
              </div>
              {activeClusterGrouped.length > 0 ? (
                <div className="p-4 space-y-2.5">
                  {activeClusterGrouped.map((g) => (
                    <NarrativePathway
                      key={g.queryId}
                      queryText={g.queryText}
                      models={g.models}
                      intent={g.queryIntent}
                      citedSources={g.citedSources}
                      competitorsMentioned={g.competitorsMentioned}
                      clientId={client.id}
                      onViewResponse={() => { setHeatmapDrawer(null); setDrawer({ runs: g.allRuns, queryText: g.queryText }); }}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-5 py-4 text-[12px] text-[#9CA3AF] italic">
                  No run data available for these queries yet.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {/* ── Competitor Displacement ──────────────────────────────────────────── */}
      {displacementRows.length > 0 && (
        <>
          <SectionLabel>Competitor Displacement</SectionLabel>
          <div className="border border-[#E2E8F0] rounded-xl overflow-x-auto bg-white mb-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F4F6F9]">
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Competitor</th>
                  <th
                    className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]"
                    title={!hasVelocityData ? "Velocity available after 2 tracking runs" : undefined}
                  >
                    Displacement Count
                  </th>
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Models</th>
                  <th className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">Sample Query</th>
                </tr>
              </thead>
              <tbody>
                {displacementRows.map((comp) => (
                  <tr
                    key={comp.name}
                    className="border-b border-[#E2E8F0] last:border-0 hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                    onClick={() => {
                      if (!comp.sampleRun) return;
                      const compModelSet = new Set(comp.models);
                      const seen = new Set<LLMModel>();
                      const deduped = sovRuns.filter((r) => {
                        if (r.query_id !== comp.sampleRun!.query_id) return false;
                        if (!compModelSet.has(r.model as LLMModel)) return false;
                        if (seen.has(r.model)) return false;
                        seen.add(r.model); return true;
                      });
                      setHeatmapDrawer(null);
                      setDrawer({ runs: deduped.length > 0 ? deduped : [comp.sampleRun], queryText: comp.sampleQueryText });
                    }}
                  >
                    <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">{comp.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-[rgba(255,75,110,0.10)] text-[#FF4B6E] font-bold text-[12px] flex items-center justify-center shrink-0">
                          {comp.displacementCount}
                        </div>
                        {hasVelocityData && <VelocityBadge {...getCompVelocity(comp.name)} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {comp.models.map((m) => (
                          <span key={m} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${MODEL_PILL[m] ?? "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]"}`}>
                            {MODEL_LABELS[m]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[11px] text-[#6B7280] italic line-clamp-2">
                        &ldquo;{comp.sampleQueryText}&rdquo;
                      </p>
                      {comp.sampleRun && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const compModelSet = new Set(comp.models);
                            const seen = new Set<LLMModel>();
                            const deduped = sovRuns.filter((r) => {
                              if (r.query_id !== comp.sampleRun!.query_id) return false;
                              if (!compModelSet.has(r.model as LLMModel)) return false;
                              if (seen.has(r.model)) return false;
                              seen.add(r.model); return true;
                            });
                            setHeatmapDrawer(null);
                            setDrawer({ runs: deduped.length > 0 ? deduped : [comp.sampleRun!], queryText: comp.sampleQueryText });
                          }}
                          className="mt-1.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors"
                        >
                          VIEW RESPONSE →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Response drawer */}
      {drawer && (
        <ResponseDrawer
          queryText={drawer.queryText}
          runs={drawer.runs.map((r): RunOption => ({
            model: r.model,
            rawResponse: r.raw_response,
            competitorsMentioned: r.competitors_mentioned ?? [],
          }))}
          brandName={brandName}
          onClose={() => setDrawer(null)}
        />
      )}

      {/* Heatmap drill-down drawer */}
      {heatmapDrawer && heatmapDrawerData && (
        <MetricDetailDrawer
          title={heatmapDrawerData.title}
          metricValue={heatmapDrawerData.metricValue}
          metricColor={heatmapDrawerData.metricColor}
          subtitle={heatmapDrawerData.subtitle}
          runs={heatmapDrawerData.runs}
          brandName={brandName}
          csvFilenamePrefix={heatmapDrawerData.csvPrefix}
          onClose={() => setHeatmapDrawer(null)}
        />
      )}
      </div>
    </div>
  );
}

export default function ShareOfVoicePage() {
  return (
    <Suspense>
      <ShareOfVoiceInner />
    </Suspense>
  );
}
