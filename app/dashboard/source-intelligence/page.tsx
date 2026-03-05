"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useClientContext } from "@/context/ClientContext";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Info,
  ChevronDown,
  ChevronUp,
  Globe,
  X,
  Download,
} from "lucide-react";
import type { Client, LLMModel } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunSourceRow {
  run_id: string;
  canonical_domain_id: string;
  is_attributed: boolean;
  is_cited: boolean;
}

interface RunRow {
  id: string;
  query_id: string;
  model: LLMModel;
}

interface CanonicalRow {
  id: string;
  domain: string;
  normalized_name: string | null;
  source_type: string;
  favicon_url: string | null;
}

interface DomainStat {
  canonicalId: string;
  domain: string;
  normalizedName: string;
  sourceType: string;
  faviconUrl: string | null;
  attributedCount: number;
  citedCount: number;
  totalRuns: number;
  influencePct: number;
  creditedPct: number;
}

type ModelTab = "all" | "gpt-4o" | "claude-sonnet-4-6" | "perplexity" | "gemini";
type SourceFilter = "all" | "official" | "competitor" | "ugc" | "editorial" | "marketplace" | "reference";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_TABS: { id: ModelTab; label: string }[] = [
  { id: "all", label: "All (weighted)" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "perplexity", label: "Perplexity" },
  { id: "claude-sonnet-4-6", label: "Claude" },
  { id: "gemini", label: "Gemini" },
];

const SOURCE_FILTER_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "official", label: "Official" },
  { value: "competitor", label: "Competitor" },
  { value: "ugc", label: "UGC" },
  { value: "editorial", label: "Editorial" },
  { value: "marketplace", label: "Marketplace" },
  { value: "reference", label: "Reference" },
];

const SOURCE_TYPE_CONFIG: Record<string, { label: string; style: string }> = {
  official:    { label: "Official",    style: "bg-[rgba(26,143,92,0.08)]   text-[#1A8F5C] border-[rgba(26,143,92,0.2)]"  },
  competitor:  { label: "Competitor",  style: "bg-[rgba(255,75,110,0.08)]  text-[#FF4B6E] border-[rgba(255,75,110,0.2)]" },
  ugc:         { label: "UGC",         style: "bg-[rgba(245,158,11,0.08)]  text-[#F59E0B] border-[rgba(245,158,11,0.2)]" },
  editorial:   { label: "Editorial",   style: "bg-[rgba(0,180,216,0.08)]   text-[#0077A8] border-[rgba(0,180,216,0.2)]"  },
  marketplace: { label: "Marketplace", style: "bg-[rgba(123,94,167,0.08)]  text-[#7B5EA7] border-[rgba(123,94,167,0.2)]" },
  reference:   { label: "Reference",   style: "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]" },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseDomain(url: string): string {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "").split("/")[0];
  }
}

function fmtPct(n: number): string {
  if (n === 0) return "0%";
  if (n < 1) return "<1%";
  return `${Math.round(n)}%`;
}

function exportCsv(domains: DomainStat[], filename = "source-intelligence.csv") {
  const header = "Domain,Normalized Name,Source Type,Influences Answers %,Gets Credited %,Gap";
  const rows = domains
    .sort((a, b) => b.influencePct - a.influencePct)
    .map((d) => {
      const diff = d.influencePct - d.creditedPct;
      const gap =
        Math.abs(diff) <= 2
          ? "BALANCED"
          : diff > 2
            ? `-${Math.round(diff)}pp`
            : "OVERCREDITED";
      return [
        d.domain,
        d.normalizedName,
        d.sourceType,
        fmtPct(d.influencePct),
        fmtPct(d.creditedPct),
        gap,
      ].join(",");
    });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Chunk a large array of run_ids into batches to avoid query-string length limits
async function fetchRunSourcesInChunks(
  supabase: ReturnType<typeof createClient>,
  runIds: string[]
): Promise<RunSourceRow[]> {
  const CHUNK = 500;
  const results: RunSourceRow[] = [];
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const chunk = runIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("run_sources")
      .select("run_id, canonical_domain_id, is_attributed, is_cited")
      .in("run_id", chunk);
    if (data) results.push(...(data as RunSourceRow[]));
  }
  return results;
}

// ─── Core computation ─────────────────────────────────────────────────────────

function computeDomainStats(
  allRunSources: RunSourceRow[],
  runMap: Map<string, RunRow>,
  canonicalMap: Map<string, CanonicalRow>,
  modelTab: ModelTab,
  activeFactRunIds: Set<string> | null // non-null when claim filter is active
): DomainStat[] {
  // Build the active run_id set (model + optional claim filter)
  const activeRunIds = new Set<string>();
  for (const [id, run] of runMap) {
    if (modelTab !== "all" && run.model !== modelTab) continue;
    if (activeFactRunIds && !activeFactRunIds.has(id)) continue;
    activeRunIds.add(id);
  }

  const totalRuns = activeRunIds.size;
  if (totalRuns === 0) return [];

  // Aggregate per canonical_domain_id
  const aggMap = new Map<string, { attributed: number; cited: number }>();
  for (const rs of allRunSources) {
    if (!activeRunIds.has(rs.run_id)) continue;
    const ex = aggMap.get(rs.canonical_domain_id) ?? { attributed: 0, cited: 0 };
    if (rs.is_attributed) ex.attributed++;
    if (rs.is_cited) ex.cited++;
    aggMap.set(rs.canonical_domain_id, ex);
  }

  return Array.from(aggMap.entries())
    .map(([canonicalId, agg]) => {
      const canonical = canonicalMap.get(canonicalId);
      if (!canonical) return null;
      return {
        canonicalId,
        domain: canonical.domain,
        normalizedName: canonical.normalized_name || canonical.domain,
        sourceType: canonical.source_type,
        faviconUrl: canonical.favicon_url,
        attributedCount: agg.attributed,
        citedCount: agg.cited,
        totalRuns,
        influencePct: (agg.attributed / totalRuns) * 100,
        creditedPct: (agg.cited / totalRuns) * 100,
      } satisfies DomainStat;
    })
    .filter(Boolean) as DomainStat[];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FaviconImg({ domain, url }: { domain: string; url: string | null }) {
  const [errored, setErrored] = useState(false);
  const src = url ?? `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  if (errored) {
    return <Globe className="w-4 h-4 text-[#9CA3AF] shrink-0" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className="w-4 h-4 rounded-sm shrink-0"
      onError={() => setErrored(true)}
    />
  );
}

function GapCell({ influence, credited }: { influence: number; credited: number }) {
  const diff = influence - credited;
  if (Math.abs(diff) <= 2) {
    return (
      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]">
        BALANCED
      </span>
    );
  }
  if (diff > 2) {
    // Influence >> Credited: gap represents a PR opportunity — shown as a negative delta
    return (
      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(245,158,11,0.08)] text-[#B45309] border-[rgba(245,158,11,0.2)]">
        −{Math.round(diff)}pp
      </span>
    );
  }
  return (
    <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
      OVERCREDITED
    </span>
  );
}

function DomainTableRow({ d, compact = false }: { d: DomainStat; compact?: boolean }) {
  const srcConfig = SOURCE_TYPE_CONFIG[d.sourceType] ?? SOURCE_TYPE_CONFIG.reference;
  if (compact) {
    // Simplified row for the "Other Sources" accordion
    return (
      <tr className="border-b last:border-0">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <FaviconImg domain={d.domain} url={d.faviconUrl} />
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-[#0D0437] truncate max-w-[180px]">{d.normalizedName}</p>
              <p className="text-[10px] text-[#9CA3AF] truncate max-w-[180px]">{d.domain}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className="font-mono text-[12px] text-[#6B7280]">{fmtPct(d.influencePct)}</span>
        </td>
        <td className="px-4 py-2.5">
          <span className="font-mono text-[12px] text-[#9CA3AF]">{fmtPct(d.creditedPct)}</span>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <FaviconImg domain={d.domain} url={d.faviconUrl} />
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-[#0D0437] truncate max-w-[160px]">{d.normalizedName}</p>
            <p className="text-[10px] text-[#9CA3AF] truncate max-w-[160px]">{d.domain}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${srcConfig.style}`}>
          {srcConfig.label}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-bold text-[#0D0437] tabular-nums w-10 shrink-0">
            {fmtPct(d.influencePct)}
          </span>
          <div className="w-16 h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden hidden sm:block shrink-0">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(d.influencePct, 100)}%`,
                background: "linear-gradient(90deg, #FF6B6B, #00B4D8)",
              }}
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-[13px] text-[#6B7280] tabular-nums">{fmtPct(d.creditedPct)}</span>
      </td>
      <td className="px-4 py-3">
        <GapCell influence={d.influencePct} credited={d.creditedPct} />
      </td>
    </tr>
  );
}

// ─── Page inner ───────────────────────────────────────────────────────────────

function SourceIntelInner() {
  const searchParams = useSearchParams();
  const { activeClientId: clientIdParam } = useClientContext();
  const claimFactId  = searchParams.get("claim_fact_id");

  const [client,       setClient]       = useState<Client | null>(null);
  const [runMap,       setRunMap]       = useState<Map<string, RunRow>>(new Map());
  const [runSources,   setRunSources]   = useState<RunSourceRow[]>([]);
  const [canonicalMap, setCanonicalMap] = useState<Map<string, CanonicalRow>>(new Map());
  const [claimText,    setClaimText]    = useState<string | null>(null);
  const [factRunIds,   setFactRunIds]   = useState<Set<string> | null>(null);
  const [loading,      setLoading]      = useState(true);

  const [claimDismissed, setClaimDismissed] = useState(false);
  const [modelTab,       setModelTab]       = useState<ModelTab>("all");
  const [sourceFilter,   setSourceFilter]   = useState<SourceFilter>("all");
  const [otherExpanded,  setOtherExpanded]  = useState(false);

  useEffect(() => {
    setClaimDismissed(false);
    setOtherExpanded(!!claimFactId); // auto-expand when claim filter is active
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam, claimFactId]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    let q = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) q = q.eq("id", clientIdParam);
    const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);
    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (!activeClient) {
      setLoading(false);
      return;
    }

    // Fetch active version to scope runs to current portfolio
    const { data: versionRow } = await supabase
      .from("portfolio_versions")
      .select("id")
      .eq("client_id", activeClient.id)
      .eq("is_active", true)
      .limit(1)
      .single();
    const activeVersionId = (versionRow as { id?: string } | null)?.id ?? null;

    // Fetch tracking_runs for client (id + query_id + model needed for join + model filter)
    let runsQ = supabase
      .from("tracking_runs")
      .select("id, query_id, model")
      .eq("client_id", activeClient.id)
      .limit(10000);
    if (activeVersionId && !activeClient.show_all_versions) runsQ = runsQ.or(`version_id.eq.${activeVersionId},version_id.is.null`);
    const { data: runsData } = await runsQ;

    const runs = (runsData ?? []) as RunRow[];
    const newRunMap = new Map<string, RunRow>();
    runs.forEach((r) => newRunMap.set(r.id, r));
    setRunMap(newRunMap);

    const runIds = runs.map((r) => r.id);

    // Run_sources (chunked) and optional claim data in parallel
    const sourcesP = runIds.length > 0
      ? fetchRunSourcesInChunks(supabase, runIds)
      : Promise.resolve([] as RunSourceRow[]);

    // Wrap Supabase builders in async functions so they resolve as plain Promises
    const claimFactP = claimFactId
      ? (async () => supabase.from("brand_facts").select("claim").eq("id", claimFactId).limit(1))()
      : Promise.resolve(null as null);
    const claimQueriesP = claimFactId
      ? (async () => supabase.from("queries").select("id").eq("fact_id", claimFactId))()
      : Promise.resolve(null as null);

    const [sources, claimFactResult, claimQueriesResult] = await Promise.all([
      sourcesP,
      claimFactP,
      claimQueriesP,
    ]);

    setRunSources(sources);

    if (claimFactId) {
      const factData  = (claimFactResult as { data: { claim: string }[] | null } | null)?.data;
      const queryData = (claimQueriesResult as { data: { id: string }[] | null } | null)?.data ?? [];
      setClaimText(factData?.[0]?.claim ?? null);
      if (queryData.length > 0) {
        const factQIds = new Set(queryData.map((q) => q.id));
        const fRunIds = new Set<string>();
        for (const [runId, run] of newRunMap) {
          if (factQIds.has(run.query_id)) fRunIds.add(runId);
        }
        setFactRunIds(fRunIds);
      } else {
        setFactRunIds(new Set());
      }
    } else {
      setClaimText(null);
      setFactRunIds(null);
    }

    // Fetch canonical_domains for all canonical_domain_ids found in run_sources
    const canonicalIds = [...new Set(sources.map((s) => s.canonical_domain_id))];
    if (canonicalIds.length > 0) {
      const { data: canonicalsData } = await supabase
        .from("canonical_domains")
        .select("id, domain, normalized_name, source_type, favicon_url")
        .in("id", canonicalIds);

      const map = new Map<string, CanonicalRow>();
      (canonicalsData ?? []).forEach((c: CanonicalRow) => map.set(c.id, c));
      setCanonicalMap(map);
    }

    setLoading(false);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-6">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Source Intelligence</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg p-5 bg-white space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b last:border-0">
              <Skeleton className="h-4 w-4 rounded-sm shrink-0" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-4">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Source Intelligence</h1>
        <p className="text-sm text-[#6B7280]">No active client.</p>
      </div>
    );
  }

  if (runSources.length === 0) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-4">
        <h1 className="text-[28px] font-bold text-[#0D0437]">Source Intelligence</h1>
        <div className="border border-[#E2E8F0] rounded-lg p-10 text-center bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437]">Source intelligence is warming up</p>
          <p className="text-[12px] text-[#6B7280] mt-1.5 max-w-sm mx-auto leading-relaxed">
            Complete your first tracking run to reveal which domains shape AI answers about your brand.
          </p>
        </div>
      </div>
    );
  }

  // ── Compute stats ─────────────────────────────────────────────────────────
  // Claim filter is active when param present, fact resolved, and not dismissed
  const isClaimFilterActive = !!(claimFactId && !claimDismissed && factRunIds !== null);
  const activeFactRunIds = isClaimFilterActive ? factRunIds : null;

  const allDomainStats = computeDomainStats(runSources, runMap, canonicalMap, modelTab, activeFactRunIds);

  // Source type filter applied after computation
  const filteredStats =
    sourceFilter === "all"
      ? allDomainStats
      : allDomainStats.filter((d) => d.sourceType === sourceFilter);

  // Sort by influence % desc
  const sortedStats = [...filteredStats].sort((a, b) => b.influencePct - a.influencePct);

  // Thresholding — bypass when claim filter is active (show everything)
  const primaryDomains = isClaimFilterActive
    ? sortedStats
    : sortedStats.filter((d) => d.influencePct > 2);
  const otherDomains = isClaimFilterActive
    ? []
    : sortedStats.filter((d) => d.influencePct <= 2);

  // ── Hero card values ──────────────────────────────────────────────────────

  // Card 1: Official Site Citation Rate — parse hostname from clients.url and match
  // against canonical_domains; fall back to source_type=official if no hostname match
  const clientDomain = parseDomain(client.url ?? "");
  const officialCanonical =
    clientDomain
      ? Array.from(canonicalMap.values()).find(
          (c) =>
            c.domain === clientDomain ||
            c.domain.endsWith(`.${clientDomain}`) ||
            clientDomain.endsWith(c.domain)
        ) ?? null
      : null;
  const officialStat = officialCanonical
    ? allDomainStats.find((d) => d.canonicalId === officialCanonical.id) ?? null
    : null;

  // Card 2: Top Influencing Domain (highest influencePct)
  const topDomain =
    [...allDomainStats].sort((a, b) => b.influencePct - a.influencePct)[0] ?? null;

  // Card 3: Silent Influencers — domains with attributed > 0 but cited = 0
  const silentCount = allDomainStats.filter(
    (d) => d.attributedCount > 0 && d.citedCount === 0
  ).length;

  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? client.url;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight leading-tight">
            Source Intelligence
          </h1>
          {/* Info tooltip */}
          <div className="relative group mt-1">
            <Info className="h-4 w-4 text-[#9CA3AF] cursor-help" />
            <div className="absolute bottom-full left-0 mb-2.5 z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 w-72">
              <div className="bg-[#0D0437] text-white rounded-lg px-3 py-2.5 shadow-xl">
                <p className="text-[11px] leading-relaxed">
                  Source data is collected via post-query enrichment calls. Models self-report sources,
                  so coverage varies by model.
                </p>
              </div>
              <div className="w-2 h-2 bg-[#0D0437] rotate-45 mx-auto -mt-1" />
            </div>
          </div>
        </div>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          Who is feeding the AI these answers about {brandName}, and where should we focus digital PR?
        </p>
      </div>

      {/* Claim filter banner */}
      {isClaimFilterActive && claimText && (
        <div className="mb-5 flex items-start gap-3 bg-[#F9F7FF] border border-[#E4DBFF] rounded-lg px-4 py-3">
          <p className="text-[12px] text-[#6B7280] flex-1 leading-relaxed">
            <span className="font-bold text-[#0D0437]">Filtered:</span> Showing sources cited in queries testing:{" "}
            <span className="italic">&ldquo;{claimText}&rdquo;</span>
          </p>
          <button
            onClick={() => setClaimDismissed(true)}
            className="flex items-center gap-1 text-[11px] font-bold text-[#9CA3AF] hover:text-[#0D0437] transition-colors whitespace-nowrap shrink-0 mt-0.5"
          >
            Clear filter
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* At a Glance — 4 hero cards */}
      <div className="mt-8 mb-1">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[11px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
            At a Glance
          </span>
          <div className="flex-1 h-px bg-[#E2E8F0]" />
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        {/* Card 1: Official Site Citation Rate */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Official Site Citation Rate
          </p>
          {officialStat ? (
            <>
              <p className="text-[32px] font-bold text-[#0D0437] leading-none">
                {fmtPct(officialStat.creditedPct)}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-2">
                of runs cite {officialStat.normalizedName}
              </p>
            </>
          ) : (
            <>
              <p className="text-[32px] font-bold text-[#9CA3AF] leading-none">—</p>
              <p className="text-[11px] text-[#6B7280] mt-2">No official domain classified yet</p>
            </>
          )}
        </div>

        {/* Card 2: Top Influencing Domain */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Top Influencing Domain
          </p>
          {topDomain ? (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <FaviconImg domain={topDomain.domain} url={topDomain.faviconUrl} />
                <p className="text-[13px] font-bold text-[#0D0437] truncate leading-tight">
                  {topDomain.normalizedName}
                </p>
              </div>
              <p className="text-[28px] font-bold text-[#0D0437] leading-none mt-1">
                {fmtPct(topDomain.influencePct)}
              </p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">Influences answers</p>
            </>
          ) : (
            <>
              <p className="text-[32px] font-bold text-[#9CA3AF] leading-none">—</p>
              <p className="text-[11px] text-[#6B7280] mt-2">No domains tracked yet</p>
            </>
          )}
        </div>

        {/* Card 3: Silent Influencers */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Silent Influencers
          </p>
          <p
            className="text-[32px] font-bold leading-none"
            style={{ color: silentCount > 0 ? "#B45309" : "#1A8F5C" }}
          >
            {silentCount}
          </p>
          <p className="text-[11px] text-[#6B7280] mt-2">
            {silentCount === 0
              ? "No invisible influencers detected"
              : `domain${silentCount !== 1 ? "s" : ""} influencing answers without citation`}
          </p>
        </div>

        {/* Card 4: Stale Knowledge Rate — placeholder until content_age_estimate enrichment lands */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Stale Knowledge Rate
          </p>
          <p className="text-[32px] font-bold text-[#9CA3AF] leading-none">—</p>
          <p className="text-[11px] text-[#6B7280] mt-2">
            Awaiting age data from enrichment
          </p>
        </div>
      </div>

      {/* Domain Attribution section */}
      <div className="flex items-center gap-3 mt-10 mb-4">
        <span className="text-[11px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
          Domain Attribution
        </span>
        <div className="flex-1 h-px bg-[#E2E8F0]" />
        {/* Export CSV */}
        <button
          onClick={() => exportCsv(allDomainStats)}
          className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] transition-colors whitespace-nowrap"
        >
          <Download className="h-3 w-3" />
          Export CSV
        </button>
      </div>

      {/* Model filter tabs + source type dropdown */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {MODEL_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setModelTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
              modelTab === tab.id
                ? "bg-[#0D0437] text-white"
                : "bg-white border border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437]"
            }`}
          >
            {tab.label}
          </button>
        ))}

        {/* Source type filter — right-aligned */}
        <div className="ml-auto relative">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
            className="appearance-none text-[11px] font-bold text-[#6B7280] bg-white border border-[#E2E8F0] rounded-md pl-2.5 pr-7 py-1.5 hover:border-[#0D0437] focus:outline-none focus:ring-1 focus:ring-[#0D0437] cursor-pointer"
          >
            {SOURCE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[#9CA3AF]" />
        </div>
      </div>

      {/* Domain table */}
      {primaryDomains.length === 0 && otherDomains.length === 0 ? (
        <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437]">No domains match this filter</p>
          <p className="text-[12px] text-[#6B7280] mt-1">Try a different model tab or source type.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Primary table — Influences Answers % > 2% */}
          {primaryDomains.length > 0 && (
            <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto bg-white">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-[#F4F6F9]">
                    {["Domain", "Source Type", "Influences Answers %", "Gets Credited %", "GAP"].map((h) => (
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
                  {primaryDomains.map((d) => (
                    <DomainTableRow key={d.canonicalId} d={d} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Other Sources — first 6 always visible, "show more" for the rest */}
          {otherDomains.length > 0 && (
            <div className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#E2E8F0]">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
                  Other Sources ({otherDomains.length})
                </span>
              </div>

              <table className="w-full">
                <thead>
                  <tr className="border-b bg-[#FAFAFA]">
                    {["Domain", "Influences %", "Gets Credited %"].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-2 text-[8px] font-bold tracking-[2px] uppercase text-[#9CA3AF]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(otherExpanded ? otherDomains : otherDomains.slice(0, 6)).map((d) => (
                    <DomainTableRow key={d.canonicalId} d={d} compact />
                  ))}
                </tbody>
              </table>

              {otherDomains.length > 6 && (
                <button
                  onClick={() => setOtherExpanded((v) => !v)}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11px] font-bold text-[#6B7280] hover:text-[#0D0437] hover:bg-[#F4F6F9] transition-colors border-t border-[#E2E8F0]"
                >
                  {otherExpanded ? (
                    <><ChevronUp className="h-3 w-3" /> Show less</>
                  ) : (
                    <><ChevronDown className="h-3 w-3" /> Show {otherDomains.length - 6} more</>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SourceIntelligencePage() {
  return (
    <Suspense>
      <SourceIntelInner />
    </Suspense>
  );
}
