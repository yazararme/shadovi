"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NarrativePathway } from "@/components/dashboard/NarrativePathway";
import { ResponseDrawer, type RunOption } from "@/components/dashboard/ResponseDrawer";
import { Badge } from "@/components/ui/badge";
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

const SOURCE_TYPE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  g2: "G2",
  blog: "Blog",
  news: "News",
  official_docs: "Docs",
  other: "Other",
};

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 my-6">
      <span className="text-[9px] font-bold tracking-[2.5px] uppercase text-[#6B7280] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

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

function groupRunsByQuery(runs: EnrichedRun[]): GroupedQueryRun[] {
  const map = new Map<string, GroupedQueryRun>();
  // runs are ordered ran_at DESC — first encounter = latest run per query
  for (const run of runs) {
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

// ─── Cluster card ──────────────────────────────────────────────────────────────

interface ClusterCardProps {
  cluster: GapCluster;
  /** All gap runs whose query_id is in this cluster — grouped internally by query */
  runs: EnrichedRun[];
  clientId: string;
  onOpenDrawer: (runs: EnrichedRun[], queryText: string) => void;
}

function ClusterCard({ cluster, runs, clientId, onOpenDrawer }: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false);

  const grouped = groupRunsByQuery(runs);

  // Count queries displaced (competitor appeared) vs open (no source, no competitor)
  const displacedCount = grouped.filter(
    (g) => g.competitorsMentioned.length > 0
  ).length;
  const openCount = grouped.filter(
    (g) => g.citedSources.length === 0 && g.competitorsMentioned.length === 0
  ).length;

  const competitorLine =
    displacedCount > 0
      ? ` — ${cluster.competitors_present.slice(0, 4).join(", ")} present`
      : "";

  return (
    <div className="border border-[#E2E8F0] rounded-xl bg-white overflow-hidden">
      {/* Card header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-[rgba(244,246,249,0.6)] transition-colors"
      >
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[14px] font-bold text-[#0D0437] leading-snug">
              {cluster.cluster_name}
            </span>
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
          <p className="text-[11px] font-mono text-[#9CA3AF]">
            {cluster.query_count} {cluster.query_count === 1 ? "query" : "queries"}
            {competitorLine}
          </p>
        </div>
        <div className="shrink-0 mt-1 text-[#9CA3AF]">
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </button>

      {/* Expanded query cards — one per unique query, showing all gap models */}
      {expanded && grouped.length > 0 && (
        <div className="border-t border-[#E2E8F0] px-5 py-4 space-y-3 bg-[rgba(244,246,249,0.35)]">
          {grouped.map((g) => (
            <NarrativePathway
              key={g.queryId}
              queryText={g.queryText}
              models={g.models}
              intent={g.queryIntent}
              citedSources={g.citedSources}
              competitorsMentioned={g.competitorsMentioned}
              clientId={clientId}
              onViewResponse={() => onOpenDrawer(g.allRuns, g.queryText)}
            />
          ))}
        </div>
      )}

      {expanded && grouped.length === 0 && (
        <div className="border-t border-[#E2E8F0] px-5 py-4">
          <p className="text-[12px] text-[#9CA3AF] italic">No run data available for these queries.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

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
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

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
      const [{ data: runs }, { data: queries }, { data: rawClusters }] =
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
        ]);

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
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Competitive Gaps</h1>
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
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Competitive Gaps</h1>
        <p className="text-sm text-[#6B7280]">
          {enrichedRuns.length === 0
            ? "Run your first audit from the Overview tab to see perception gaps."
            : "Need 10+ tracking runs to surface perception patterns."}
        </p>
      </div>
    );
  }

  // Validation intent belongs to Brand Knowledge — exclude from perception gap analysis
  const gapRuns = enrichedRuns.filter((r) => !r.brand_mentioned && r.query_intent !== "validation");

  // Query IDs that are clustered (problem_aware + category only)
  const clusteredQueryIds = new Set(
    Array.from(clusterQueryMap.values()).flatMap((s) => Array.from(s))
  );

  // Comparative gaps always stay in the ungrouped section.
  // Non-comparative (problem_aware/category) gaps only appear here if they weren't
  // assigned to a cluster — e.g. on first load before any clustering has run.
  const ungroupedGapRuns = gapRuns.filter(
    (r) => r.query_intent === "comparative" || !clusteredQueryIds.has(r.query_id)
  );

  const byModel: Partial<Record<LLMModel, EnrichedRun[]>> = {};
  ungroupedGapRuns.forEach((r) => {
    if (!byModel[r.model]) byModel[r.model] = [];
    byModel[r.model]!.push(r);
  });

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

  const trackedModels = (client.selected_models ?? []) as LLMModel[];

  // ── Cluster section ────────────────────────────────────────────────────────
  // Use the targeted cluster fetch when available — it's guaranteed to contain
  // runs for all cluster query_ids regardless of the general enrichedRuns window.
  // We want ALL runs per query (not just the latest) so ClusterCard can show
  // all models that produced a gap for each query.
  const clusterSourceRuns = clusterEnrichedRuns.length > 0 ? clusterEnrichedRuns : enrichedRuns;

  return (
    <div className="space-y-2">
      <div className="mb-2">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
          Competitive Gaps
        </h1>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          {clusters.length > 0
            ? clusters.reduce((sum, c) => sum + c.query_count, 0)
            : new Set(gapRuns.map((r) => r.query_id)).size
          } of {totalQueryCount} non-validation queries absent from LLM responses across all personas and intents
        </p>
      </div>

      {/* ── Gap Clusters ────────────────────────────────────────────────────── */}
      {clusters.length === 0 ? (
        <>
          <SubLabel>Gap Clusters</SubLabel>
          <div className="border border-[#E2E8F0] rounded-xl p-8 text-center bg-white">
            <p className="text-[13px] text-[#6B7280]">
              Run an audit to see how your gap queries cluster into buyer patterns.
            </p>
          </div>
        </>
      ) : (
        <>
          <SubLabel>Gap Clusters</SubLabel>
          <div className="space-y-3">
            {clusters.map((cluster) => {
              const memberIds = clusterQueryMap.get(cluster.id) ?? new Set();
              // Pass ALL runs for this cluster's queries — ClusterCard groups them by
              // query_id internally so each card shows every model that produced a gap
              const clusterRuns = clusterSourceRuns.filter(
                (r) => memberIds.has(r.query_id) && !r.brand_mentioned
              );
              return (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  runs={clusterRuns}
                  clientId={client.id}
                  onOpenDrawer={(runs, queryText) => setDrawer({ runs, queryText })}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── Ungrouped gap queries (comparative + any slipped through) ───────── */}
      {ungroupedGapRuns.length === 0 ? (
        gapRuns.length > 0 && clusters.length > 0 ? null : (
          <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-white">
            <p className="text-sm font-bold text-[#1A8F5C]">
              Zero narrative gaps — your brand appears in every tracked query.
            </p>
          </div>
        )
      ) : (
        <>
          <SubLabel>Comparative Gap Queries</SubLabel>
          <div className="space-y-6">
            {trackedModels.map((model) => {
              const modelGaps = byModel[model] ?? [];
              if (modelGaps.length === 0) return null;
              return (
                <div key={model} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[13px] font-bold text-[#0D0437]">{MODEL_LABELS[model]}</h2>
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-0"
                    >
                      {modelGaps.length} gap{modelGaps.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {modelGaps.slice(0, 20).map((run) => (
                      <NarrativePathway
                        key={run.id}
                        queryText={run.query_text}
                        models={[run.model]}
                        intent={run.query_intent}
                        citedSources={run.cited_sources ?? []}
                        competitorsMentioned={run.competitors_mentioned ?? []}
                        clientId={client.id}
                        onViewResponse={() => setDrawer({ runs: [run], queryText: run.query_text })}
                      />
                    ))}
                    {modelGaps.length > 20 && (
                      <p className="text-[11px] text-[#6B7280] text-center py-2">
                        +{modelGaps.length - 20} more gaps not shown
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Source breakdown ─────────────────────────────────────────────────── */}
      {sourcesTable.length > 0 && (
        <>
          <SubLabel>Source Breakdown</SubLabel>
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
          brandName={client.brand_name ?? client.url}
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
