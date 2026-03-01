"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NarrativePathway } from "@/components/dashboard/NarrativePathway";
import { ResponseDrawer, type RunOption } from "@/components/dashboard/ResponseDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Client, TrackingRun, LLMModel, QueryIntent, GapCluster } from "@/types";

type EnrichedRun = TrackingRun & {
  query_text: string;
  query_intent: QueryIntent;
};

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "deepseek": "DeepSeek",
};

const MODEL_COLORS: Record<LLMModel, string> = {
  "gpt-4o": "bg-[#10a37f]/10 text-[#10a37f] border-[#10a37f]/30",
  "claude-sonnet-4-6": "bg-[#d4a27e]/10 text-[#d4a27e] border-[#d4a27e]/30",
  "perplexity": "bg-[#1fb6ff]/10 text-[#1fb6ff] border-[#1fb6ff]/30",
  "gemini": "bg-[#4285f4]/10 text-[#4285f4] border-[#4285f4]/30",
  "deepseek": "bg-[#6366f1]/10 text-[#6366f1] border-[#6366f1]/30",
};

const INTENT_BADGE: Record<QueryIntent, { label: string; cls: string }> = {
  problem_aware: {
    label: "Problem",
    cls: "bg-[rgba(139,92,246,0.08)] text-[#7C3AED] border-[rgba(139,92,246,0.2)]",
  },
  category: {
    label: "Category",
    cls: "bg-[rgba(59,130,246,0.08)] text-[#3B82F6] border-[rgba(59,130,246,0.2)]",
  },
  comparative: {
    label: "Comparative",
    cls: "bg-[rgba(245,158,11,0.08)] text-[#D97706] border-[rgba(245,158,11,0.2)]",
  },
  validation: {
    label: "Validation",
    cls: "bg-[rgba(16,185,129,0.08)] text-[#059669] border-[rgba(16,185,129,0.2)]",
  },
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  g2: "G2",
  blog: "Blog",
  news: "News",
  official_docs: "Docs",
  other: "Other",
};

interface DrawerState {
  runs: EnrichedRun[];
  queryText: string;
}

/** One card per unique query — aggregates all model runs for that query */
interface GroupedQueryRun {
  queryId: string;
  queryText: string;
  queryIntent: QueryIntent;
  models: LLMModel[];
  competitorsMentioned: string[];
  citedSources: NonNullable<EnrichedRun["cited_sources"]>;
  /** All gap runs for this query across all models — passed to the response drawer */
  allRuns: EnrichedRun[];
}

function groupRunsByQuery(
  runs: EnrichedRun[],
  brandMentionedQM: Set<string> = new Set()
): GroupedQueryRun[] {
  const map = new Map<string, GroupedQueryRun>();

  // runs are ordered ran_at DESC — first encounter = latest run per query
  for (const run of runs) {
    // Exclude models where extraction confirmed the tracked brand was present,
    // even if brand_mentioned was incorrectly set to false by the scorer.
    if (brandMentionedQM.has(`${run.query_id}:${run.model}`)) continue;

    if (!map.has(run.query_id)) {
      map.set(run.query_id, {
        queryId: run.query_id,
        queryText: run.query_text,
        queryIntent: run.query_intent,
        models: [],
        competitorsMentioned: [],
        citedSources: [],
        allRuns: [],
      });
    }
    const g = map.get(run.query_id)!;
    if (!g.models.includes(run.model)) {
      g.models.push(run.model);
      // Keep one run per model (first = latest, since runs are ran_at DESC)
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

// ── Section heading ──────────────────────────────────────────────────────────────

function SectionHeading({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
      {count !== undefined && (
        <span className="font-mono text-[11px] text-[#9CA3AF] whitespace-nowrap shrink-0">
          {count}
        </span>
      )}
    </div>
  );
}

// ── Compact cluster grid card ────────────────────────────────────────────────────

function ClusterGridCard({
  cluster,
  displaced,
  open,
  isActive,
  onClick,
}: {
  cluster: GapCluster;
  displaced: number;
  open: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border bg-white transition-all ${
        isActive
          ? "border-[#0D0437] shadow-md ring-1 ring-[#0D0437]/10"
          : "border-[#E2E8F0] hover:border-[#C7CEE0] hover:shadow-sm"
      }`}
    >
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] font-bold text-[#0D0437] leading-snug">
            {cluster.cluster_name}
          </p>
          {isActive ? (
            <ChevronUp className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0 mt-0.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-[#9CA3AF] shrink-0 mt-0.5" />
          )}
        </div>

        <p className="text-[12px] text-[#6B7280]">
          {cluster.query_count} {cluster.query_count === 1 ? "query" : "queries"}
        </p>

        {(displaced > 0 || open > 0) && (
          <div className="flex gap-1.5 flex-wrap">
            {displaced > 0 && (
              <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-[rgba(255,75,110,0.10)] text-[#FF4B6E] border-[rgba(255,75,110,0.25)]">
                Displaced {displaced}
              </span>
            )}
            {open > 0 && (
              <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase bg-[rgba(0,175,150,0.10)] text-[#00AF96] border-[rgba(0,175,150,0.25)]">
                Open {open}
              </span>
            )}
          </div>
        )}

        {(cluster.competitors_present ?? []).length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {cluster.competitors_present.slice(0, 3).map((c) => (
              <span
                key={c}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]"
              >
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
      </div>
    </button>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────────

function NarrativeInner() {
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client");
  const [client, setClient] = useState<Client | null>(null);
  const [enrichedRuns, setEnrichedRuns] = useState<EnrichedRun[]>([]);
  // Targeted fetch for cluster cards — guarantees coverage even if a query's
  // runs fall outside the general enrichedRuns window (10k rows by ran_at DESC).
  const [clusterEnrichedRuns, setClusterEnrichedRuns] = useState<EnrichedRun[]>([]);
  const [clusters, setClusters] = useState<GapCluster[]>([]);
  // Map of cluster_id → set of query_ids in that cluster
  const [clusterQueryMap, setClusterQueryMap] = useState<Map<string, Set<string>>>(new Map());
  // Total non-validation queries for the denominator — from queries table, not tracking_runs,
  // to avoid the Supabase 1000-row default limit skewing the headline fraction.
  const [totalQueryCount, setTotalQueryCount] = useState(0);
  // "query_id:model" pairs confirmed by response_brand_mentions as is_tracked_brand=true.
  // Catches runs where brand_mentioned was incorrectly set to false by the scorer.
  const [brandMentionedQM, setBrandMentionedQM] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  // Which cluster card is currently expanded (null = all collapsed)
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  async function loadData() {
    const supabase = createClient();
    let query = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) query = query.eq("id", clientIdParam);
    const { data: clients } = await query
      .order("created_at", { ascending: false })
      .limit(1);

    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (activeClient) {
      const [{ data: runs }, { data: queries }, { data: rawClusters }, { data: rbmRows }] =
        await Promise.all([
          supabase
            .from("tracking_runs")
            .select("*")
            .eq("client_id", activeClient.id)
            .order("ran_at", { ascending: false })
            .limit(10000),
          supabase
            .from("queries")
            .select("id, text, intent")
            .eq("client_id", activeClient.id)
            .limit(2000),
          // Fetch the latest run_date's clusters only
          supabase
            .from("gap_clusters")
            .select("*")
            .eq("client_id", activeClient.id)
            .order("run_date", { ascending: false })
            .limit(20), // cap at 20 clusters per page load
          // "query_id:model" pairs where Claude extraction confirmed the tracked brand was present.
          // Used to suppress model tags for runs where brand_mentioned was incorrectly set to false.
          supabase
            .from("response_brand_mentions")
            .select("query_id, model")
            .eq("client_id", activeClient.id)
            .eq("is_tracked_brand", true)
            .limit(10000),
        ]);

      const qmSet = new Set(
        (rbmRows ?? []).filter((r) => r.query_id && r.model).map((r) => `${r.query_id}:${r.model}`)
      );
      setBrandMentionedQM(qmSet);

      const queryMap = Object.fromEntries((queries ?? []).map((q) => [q.id, q]));
      const enriched = (runs ?? []).map((r) => ({
        ...r,
        query_text: queryMap[r.query_id]?.text ?? "",
        query_intent: (queryMap[r.query_id]?.intent ?? "problem_aware") as QueryIntent,
      }));
      setEnrichedRuns(enriched);
      // Count non-validation queries from the queries table — more reliable than
      // counting from tracking_runs which hits Supabase's 1000-row default limit.
      setTotalQueryCount((queries ?? []).filter((q) => q.intent !== "validation").length);

      // If we have clusters, load their query membership
      if (rawClusters && rawClusters.length > 0) {
        // Filter to only the most recent run_date
        const latestDate = rawClusters[0].run_date;
        const latestClusters = rawClusters.filter((c) => c.run_date === latestDate);
        setClusters(latestClusters as GapCluster[]);

        const clusterIds = latestClusters.map((c) => c.id);
        const { data: joinRows } = await supabase
          .from("gap_cluster_queries")
          .select("cluster_id, query_id")
          .in("cluster_id", clusterIds)
          .limit(2000); // max ~20 clusters × ~100 queries each

        const map = new Map<string, Set<string>>();
        for (const row of joinRows ?? []) {
          if (!map.has(row.cluster_id)) map.set(row.cluster_id, new Set());
          map.get(row.cluster_id)!.add(row.query_id);
        }
        setClusterQueryMap(map);

        // Targeted run fetch keyed to cluster query_ids — the general enrichedRuns
        // window (10k by ran_at DESC) can miss older query_ids, causing cards to
        // disappear. This fetch guarantees coverage for all cluster members.
        const allClusterQIds = Array.from(map.values()).flatMap((s) => Array.from(s));
        if (allClusterQIds.length > 0) {
          const { data: cRuns } = await supabase
            .from("tracking_runs")
            .select("*")
            .in("query_id", allClusterQIds)
            .eq("client_id", activeClient.id)
            .order("ran_at", { ascending: false })
            .limit(5000);
          setClusterEnrichedRuns(
            (cRuns ?? []).map((r) => ({
              ...r,
              query_text: queryMap[r.query_id]?.text ?? "",
              query_intent: (queryMap[r.query_id]?.intent ?? "problem_aware") as QueryIntent,
            }))
          );
        }
      }
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Competitive Gaps
        </h1>
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-xl p-5 bg-white space-y-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="border border-[#E2E8F0] rounded-xl p-5 space-y-3 bg-white">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (!client || enrichedRuns.length < 10) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Competitive Gaps
        </h1>
        <p className="text-sm text-[#6B7280]">
          {enrichedRuns.length === 0
            ? "Run your first audit from the Overview tab to see perception gaps."
            : "Need 10+ tracking runs to surface perception patterns."}
        </p>
      </div>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────────

  // Validation intent belongs to Brand Knowledge — exclude from perception gap analysis.
  // brand_mentioned === false is the primary gate; brandMentionedQM catches runs where the
  // scorer incorrectly set brand_mentioned=false but extraction confirmed the brand was present.
  const gapRuns = enrichedRuns.filter(
    (r) =>
      r.brand_mentioned === false &&
      r.query_intent !== "validation" &&
      !brandMentionedQM.has(`${r.query_id}:${r.model}`)
  );

  // All gap queries grouped by queryId, sorted by model count desc (most models missing = most urgent)
  const allGapGrouped = groupRunsByQuery(gapRuns, brandMentionedQM).sort(
    (a, b) => b.models.length - a.models.length
  );

  // Hero stats
  const totalGapQueries = allGapGrouped.length;
  const displacedTotal = allGapGrouped.filter((g) => g.competitorsMentioned.length > 0).length;
  const openTotal = allGapGrouped.filter(
    (g) => g.competitorsMentioned.length === 0 && g.citedSources.length === 0
  ).length;
  const pctAffected =
    totalQueryCount > 0 ? Math.round((totalGapQueries / totalQueryCount) * 100) : 0;

  // Use the targeted cluster fetch when available — it's guaranteed to contain
  // runs for all cluster query_ids regardless of the general enrichedRuns window.
  const clusterSourceRuns = clusterEnrichedRuns.length > 0 ? clusterEnrichedRuns : enrichedRuns;

  // Per-cluster displaced/open counts for the grid cards — computed from run data, not the
  // cluster's competitors_present field, so the badges reflect actual gap analysis.
  const clusterStats = new Map<string, { displaced: number; open: number }>();
  for (const cluster of clusters) {
    const memberIds = clusterQueryMap.get(cluster.id) ?? new Set();
    const cRuns = clusterSourceRuns.filter(
      (r) => memberIds.has(r.query_id) && r.brand_mentioned === false
    );
    const grouped = groupRunsByQuery(cRuns, brandMentionedQM);
    clusterStats.set(cluster.id, {
      displaced: grouped.filter((g) => g.competitorsMentioned.length > 0).length,
      open: grouped.filter(
        (g) => g.citedSources.length === 0 && g.competitorsMentioned.length === 0
      ).length,
    });
  }

  // Active cluster — data for the full-width expansion panel
  const activeCluster = activeClusterId
    ? clusters.find((c) => c.id === activeClusterId) ?? null
    : null;
  const activeClusterGrouped = activeCluster
    ? (() => {
        const memberIds = clusterQueryMap.get(activeCluster.id) ?? new Set();
        const cRuns = clusterSourceRuns.filter(
          (r) => memberIds.has(r.query_id) && r.brand_mentioned === false
        );
        return groupRunsByQuery(cRuns, brandMentionedQM);
      })()
    : [];

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
    .slice(0, 10);
  const totalCitedGaps = sourcesTable.reduce((s, [, v]) => s + v.count, 0);

  const brandLabel = client.brand_name ?? client.url;

  return (
    <div className="space-y-8">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
          Competitive Gaps
        </h1>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          Where competitors appear in LLM responses instead of {brandLabel}
        </p>
      </div>

      {/* ── Hero stat bar ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            value: totalGapQueries,
            label: "Gap Queries",
            sub: "queries without brand",
            color: "#0D0437",
          },
          {
            value: displacedTotal,
            label: "Displaced",
            sub: "competitor appeared instead",
            color: "#FF4B6E",
          },
          {
            value: openTotal,
            label: "Open",
            sub: "no brand or competitor",
            color: "#F59E0B",
          },
          {
            value: `${pctAffected}%`,
            label: "Query Set",
            sub: "of non-validation queries",
            color: "#0D0437",
          },
        ].map(({ value, label, sub, color }) => (
          <div key={label} className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4">
            <p
              className="text-[30px] font-black leading-none tracking-tight"
              style={{ color }}
            >
              {value}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#6B7280] mt-2">
              {label}
            </p>
            <p className="text-[11px] text-[#9CA3AF] mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Gap Clusters ──────────────────────────────────────────────────────── */}
      <section>
        <SectionHeading count={clusters.length > 0 ? clusters.length : undefined}>
          Gap Clusters
        </SectionHeading>

        {clusters.length === 0 ? (
          <div className="border border-[#E2E8F0] rounded-xl p-8 text-center bg-white">
            <p className="text-[13px] text-[#6B7280]">
              Run an audit to see how your gap queries cluster into buyer patterns.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 3-column card grid */}
            <div className="grid grid-cols-3 gap-3">
              {clusters.map((cluster) => {
                const stats = clusterStats.get(cluster.id) ?? { displaced: 0, open: 0 };
                return (
                  <ClusterGridCard
                    key={cluster.id}
                    cluster={cluster}
                    displaced={stats.displaced}
                    open={stats.open}
                    isActive={activeClusterId === cluster.id}
                    onClick={() =>
                      setActiveClusterId((prev) =>
                        prev === cluster.id ? null : cluster.id
                      )
                    }
                  />
                );
              })}
            </div>

            {/* Full-width expansion panel — shows the selected cluster's gap queries */}
            {activeCluster && (
              <div className="border border-[#0D0437]/15 rounded-xl bg-white overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-[#E2E8F0] bg-[#F4F6F9] flex items-center justify-between">
                  <p className="text-[12px] font-bold text-[#0D0437]">
                    {activeCluster.cluster_name}
                  </p>
                  <span className="font-mono text-[11px] text-[#9CA3AF]">
                    {activeClusterGrouped.length}{" "}
                    {activeClusterGrouped.length === 1 ? "gap query" : "gap queries"}
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
                        onViewResponse={() =>
                          setDrawer({ runs: g.allRuns, queryText: g.queryText })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-5 py-4 text-[12px] text-[#9CA3AF] italic">
                    No run data available for these queries.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── All Gap Queries table ─────────────────────────────────────────────── */}
      {allGapGrouped.length > 0 && (
        <section>
          <SectionHeading count={allGapGrouped.length}>All Gap Queries</SectionHeading>
          <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F4F6F9]">
                  <th className="px-4 py-3 text-left text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] w-[38%]">
                    Query
                  </th>
                  <th className="px-4 py-3 text-left text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] w-[10%]">
                    Intent
                  </th>
                  <th className="px-4 py-3 text-left text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] w-[27%]">
                    Models Missing {brandLabel}
                  </th>
                  <th className="px-4 py-3 text-left text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] w-[25%]">
                    Competitors Present
                  </th>
                </tr>
              </thead>
              <tbody>
                {allGapGrouped.filter((g) => g.competitorsMentioned.length > 0).map((g) => (
                  <tr
                    key={g.queryId}
                    onClick={() => setDrawer({ runs: g.allRuns, queryText: g.queryText })}
                    className="border-b border-[#E2E8F0] last:border-0 hover:bg-[rgba(244,246,249,0.7)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="text-[12px] text-[#374151] leading-snug line-clamp-2">
                        &ldquo;{g.queryText}&rdquo;
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${INTENT_BADGE[g.queryIntent].cls}`}
                      >
                        {INTENT_BADGE[g.queryIntent].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {g.models.map((m) => (
                          <span
                            key={m}
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${MODEL_COLORS[m]}`}
                          >
                            {MODEL_LABELS[m]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {g.competitorsMentioned.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {g.competitorsMentioned.map((c) => (
                            <span
                              key={c}
                              className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-[#9CA3AF] italic">none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Source Breakdown ─────────────────────────────────────────────────── */}
      {sourcesTable.length > 0 && (
        <section>
          <SectionHeading>Source Breakdown</SectionHeading>
          <div className="border border-[#E2E8F0] rounded-xl overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[#F4F6F9]">
                  {["Domain", "Type", "Appearances", "% of Gaps"].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] ${
                        h === "Appearances" || h === "% of Gaps" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sourcesTable.map(([domain, { type, count }]) => (
                  <tr
                    key={domain}
                    className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)]"
                  >
                    <td className="px-4 py-3 font-semibold text-[#0D0437] text-[12px]">
                      {domain}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280]">
                        {SOURCE_TYPE_LABELS[type] ?? type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-[#0D0437]">
                      {count}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-[#6B7280]">
                      {totalCitedGaps > 0
                        ? `${Math.round((count / totalCitedGaps) * 100)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
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
          brandName={brandLabel}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

export default function NarrativePage() {
  return (
    <Suspense>
      <NarrativeInner />
    </Suspense>
  );
}
