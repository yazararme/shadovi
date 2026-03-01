"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import { ModelIntentHeatmap, type HeatmapRow } from "@/components/dashboard/ModelIntentHeatmap";
import { NarrativePathway } from "@/components/dashboard/NarrativePathway";
import { ResponseDrawer, type RunOption } from "@/components/dashboard/ResponseDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
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
  { value: "category",      label: "Category Search" },
];

// Non-validation intents used for share-of-voice analysis
const SOV_INTENTS: QueryIntent[] = ["problem_aware", "category", "comparative"];

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
    if (!g.models.includes(run.model)) {
      g.models.push(run.model);
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
  const { activeClientId: clientIdParam } = useClientContext();

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

  // UI
  const [intentFilter, setIntentFilter] = useState<QueryIntent | "all">("all");
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

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
      setLoading(true);
      const supabase = createClient();

      let q = supabase.from("clients").select("*").eq("status", "active");
      if (clientIdParam) q = q.eq("id", clientIdParam);
      const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);

      if (cancelled) return;
      const c = (clients?.[0] as Client) ?? null;
      setClient(c);

      if (!c) { setLoading(false); return; }

      // Parallel fetches
      const [
        { data: runData },
        { data: queryData },
        { data: compData },
        { data: rbmData },
        { data: clusterData },
        { data: recData },
      ] = await Promise.all([
        supabase.from("tracking_runs").select("*").eq("client_id", c.id)
          .order("ran_at", { ascending: false }).limit(10000),
        supabase.from("queries").select("id, text, intent").eq("client_id", c.id).limit(2000),
        supabase.from("competitors").select("*").eq("client_id", c.id).order("name"),
        supabase.from("response_brand_mentions")
          .select("query_id, model, brand_name, is_tracked_brand, query_intent")
          .eq("client_id", c.id).limit(20000),
        supabase.from("gap_clusters").select("*").eq("client_id", c.id)
          .order("run_date", { ascending: false }).limit(20),
        supabase.from("recommendations").select("id, query_id, type, title, status")
          .eq("client_id", c.id).eq("status", "open").order("priority"),
      ]);

      if (cancelled) return;

      const queryMap = Object.fromEntries((queryData ?? []).map((q) => [q.id, q]));
      const enriched = (runData ?? []).map((r) => ({
        ...(r as TrackingRun),
        query_text: (queryMap[r.query_id]?.text ?? "") as string,
      }));
      setRuns(enriched);

      const rbm = (rbmData ?? []) as RbmRow[];
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
          const { data: cRunData } = await supabase
            .from("tracking_runs").select("*").in("query_id", allCQIds)
            .eq("client_id", c.id).order("ran_at", { ascending: false }).limit(5000);
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
  }, [clientIdParam]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
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
      <div className="p-8 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#0D0437] mb-2">AI Share of Voice</h1>
        <p className="text-sm text-[#6B7280]">No active client found.</p>
      </div>
    );
  }

  if (runs.length < 10) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <h1 className="text-[28px] font-bold text-[#0D0437] mb-1">AI Share of Voice</h1>
        <p className="text-[12px] text-[#9CA3AF] font-mono mb-6">{client.brand_name ?? client.url}</p>
        <div className="border border-[#E2E8F0] rounded-xl p-8 bg-white text-center">
          <p className="text-[14px] text-[#0D0437] font-semibold">Not enough data yet</p>
          <p className="text-[13px] text-[#6B7280] mt-1">Run your first audit from Overview to see competitive intelligence.</p>
        </div>
      </div>
    );
  }

  // ── Derived: heatmap ───────────────────────────────────────────────────────

  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? "Your Brand";
  const trackedModels = (client.selected_models ?? []) as LLMModel[];

  // Non-validation runs only
  const sovRuns = runs.filter((r) => r.query_intent !== "validation");

  // Apply intent filter
  const filteredRuns =
    intentFilter === "all"
      ? sovRuns.filter((r) => SOV_INTENTS.includes((r.query_intent ?? "problem_aware") as QueryIntent))
      : sovRuns.filter((r) => r.query_intent === intentFilter);

  // Set of query_id:model pairs in the filtered scope
  const filteredQMPairs = new Set(filteredRuns.map((r) => `${r.query_id}:${r.model}`));

  // Filtered rbm rows — only those whose (query_id, model) appear in filteredRuns
  const filteredRbm = rbmRows.filter((r) => filteredQMPairs.has(`${r.query_id}:${r.model}`));

  // Build heatmap rows using rbm for cell values (spec requirement)
  const heatmapRows: HeatmapRow[] = [
    { name: brandName, isBrand: true, byModel: {} },
    ...competitors.map((c) => ({ name: c.name, isBrand: false, byModel: {} })),
  ];

  for (const model of trackedModels) {
    const modelRuns = filteredRuns.filter((r) => r.model === model);
    const total = modelRuns.length;
    if (total === 0) continue;

    const modelQueryIds = new Set(modelRuns.map((r) => r.query_id));

    // Brand row — count query_ids confirmed mentioned by rbm (is_tracked_brand=true)
    const brandMentionedQIds = new Set(
      filteredRbm.filter((r) => r.is_tracked_brand && r.model === model).map((r) => r.query_id)
    );
    const brandCount = modelRuns.filter((r) => brandMentionedQIds.has(r.query_id)).length;
    heatmapRows[0].byModel[model] = {
      mentionRate: total > 0 ? Math.round((brandCount / total) * 100) : 0,
      isPrimary: false,
      topQueries: modelRuns.filter((r) => brandMentionedQIds.has(r.query_id)).slice(0, 2).map((r) => r.query_text),
    };

    // Competitor rows
    competitors.forEach((comp, idx) => {
      const compQIds = new Set(
        filteredRbm.filter((r) => r.brand_name === comp.name && r.model === model).map((r) => r.query_id)
      );
      const compCount = modelRuns.filter((r) => compQIds.has(r.query_id) && modelQueryIds.has(r.query_id)).length;
      heatmapRows[idx + 1].byModel[model] = {
        mentionRate: total > 0 ? Math.round((compCount / total) * 100) : 0,
        isPrimary: false,
        topQueries: modelRuns.filter((r) => compQIds.has(r.query_id)).slice(0, 2).map((r) => r.query_text),
      };
    });

    // Crown: highest % per column
    let maxRate = 0; let primaryIdx = 0;
    heatmapRows.forEach((row, i) => { const rate = row.byModel[model]?.mentionRate ?? 0; if (rate > maxRate) { maxRate = rate; primaryIdx = i; } });
    if (maxRate > 0) heatmapRows[primaryIdx].byModel[model]!.isPrimary = true;
  }

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

  // ── Derived: Gap Clusters ─────────────────────────────────────────────────

  const clusterSource = clusterRuns.length > 0 ? clusterRuns : runs;

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
    <div className="p-8 max-w-5xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-2">
        <h1 className="text-[28px] font-bold text-[#0D0437] leading-tight">AI Share of Voice</h1>
        <p className="text-[12px] text-[#9CA3AF] font-mono mt-1">{brandName}</p>
      </div>

      {/* ─────────────── SECTION 1: SHARE OF MODEL HEATMAP ─────────────────── */}
      <SectionLabel>Share of Model Heatmap</SectionLabel>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap mb-4">
        {INTENT_FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setIntentFilter(value)}
            className={`rounded-full border px-4 py-1.5 text-[11px] font-bold transition-colors ${
              intentFilter === value
                ? "bg-[#0D0437] text-white border-[#0D0437]"
                : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-6">
        <ModelIntentHeatmap rows={heatmapRows} models={trackedModels} />
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
                      onViewResponse={() => setDrawer({ runs: g.allRuns, queryText: g.queryText })}
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
                  {["Competitor", "Displacement Count", "Models", "Sample Query"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]">
                      {h}
                    </th>
                  ))}
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
                      setDrawer({ runs: deduped.length > 0 ? deduped : [comp.sampleRun], queryText: comp.sampleQueryText });
                    }}
                  >
                    <td className="px-4 py-3 font-bold text-[13px] text-[#0D0437]">{comp.name}</td>
                    <td className="px-4 py-3">
                      <div className="w-8 h-8 rounded-full bg-[rgba(255,75,110,0.10)] text-[#FF4B6E] font-bold text-[12px] flex items-center justify-center">
                        {comp.displacementCount}
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
