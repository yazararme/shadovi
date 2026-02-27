"use client";

import { useEffect, useState, Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, ChevronDown } from "lucide-react";
import type { Client } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatRow {
  id: string;
  canonical_domain_id: string;
  client_id: string;
  model: string;
  time_bucket: string;
  runs_used_count: number;
  runs_cited_count: number;
  total_runs: number;
  model_weight: number;
  age_median: string | null;
  updated_at: string;
}

interface CanonicalRow {
  id: string;
  domain: string;
  normalized_name: string;
  source_type: string;
  favicon_url: string | null;
}

interface DomainStat {
  canonicalId: string;
  domain: string;
  normalizedName: string;
  sourceType: string;
  faviconUrl: string | null;
  usedCount: number;   // total attributed appearances
  citedCount: number;  // total cited appearances
  totalRuns: number;   // denominator
  usedPct: number;
  citedPct: number;
  ageMedian: string | null; // from most-recent time bucket
  N: number;           // = usedCount — displayed as sample size
}

type ModelTab = "all" | "gpt-4o" | "claude-sonnet-4-6" | "perplexity" | "gemini";
type SourceFilter = "all" | "official" | "competitor" | "ugc" | "editorial" | "marketplace" | "reference";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_TABS: { id: ModelTab; label: string; lowConfidence?: boolean }[] = [
  { id: "all",              label: "All (weighted)" },
  { id: "perplexity",       label: "Perplexity" },
  { id: "gpt-4o",           label: "GPT-4o" },
  { id: "claude-sonnet-4-6", label: "Claude", lowConfidence: true },
  { id: "gemini",           label: "Gemini" },
];

const SOURCE_FILTER_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all",         label: "All types" },
  { value: "official",    label: "Official" },
  { value: "competitor",  label: "Competitor" },
  { value: "ugc",         label: "UGC" },
  { value: "editorial",   label: "Editorial" },
  { value: "marketplace", label: "Marketplace" },
  { value: "reference",   label: "Reference" },
];

const SOURCE_TYPE_CONFIG: Record<string, { label: string; style: string }> = {
  official:    { label: "Official",    style: "bg-[rgba(26,143,92,0.08)]   text-[#1A8F5C] border-[rgba(26,143,92,0.2)]"  },
  competitor:  { label: "Competitor",  style: "bg-[rgba(255,75,110,0.08)]  text-[#FF4B6E] border-[rgba(255,75,110,0.2)]" },
  ugc:         { label: "UGC",         style: "bg-[rgba(245,158,11,0.08)]  text-[#F59E0B] border-[rgba(245,158,11,0.2)]" },
  editorial:   { label: "Editorial",   style: "bg-[rgba(0,180,216,0.08)]   text-[#0077A8] border-[rgba(0,180,216,0.2)]"  },
  marketplace: { label: "Marketplace", style: "bg-[rgba(123,94,167,0.08)]  text-[#7B5EA7] border-[rgba(123,94,167,0.2)]" },
  reference:   { label: "Reference",   style: "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]" },
};

// Gap classification config — tooltips shown on hover over the pill
const GAP_CONFIG: Record<string, { style: string; tooltip: string | null }> = {
  "Silent Influencer": {
    style: "bg-[rgba(245,158,11,0.1)] text-[#B45309] border-[rgba(245,158,11,0.25)]",
    tooltip: "Shapes AI answers far more often than it is explicitly credited. Likely influencing the narrative invisibly.",
  },
  "Over-credited": {
    style: "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
    tooltip: "Cited more often than it appears to influence answers. May reflect model citation habits rather than real influence.",
  },
  "Balanced": {
    style: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
    tooltip: "Citation and influence levels are broadly in line.",
  },
  "Insufficient Data": {
    style: "bg-[#F4F6F9] text-[#9CA3AF] border-[#E2E8F0]",
    tooltip: null,
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function getGapLabel(usedPct: number, citedPct: number, N: number): string {
  if (N < 10) return "Insufficient Data";
  if (usedPct > 3 * citedPct) return "Silent Influencer";
  if (citedPct > 2 * usedPct) return "Over-credited";
  return "Balanced";
}

function getVintage(ageMedian: string | null): { label: string; style: string } {
  const base = "px-1.5 py-0.5 rounded text-[10px] font-bold";
  if (!ageMedian) {
    return { label: "Recent", style: `${base} text-[#0077A8] bg-[rgba(0,180,216,0.08)]` };
  }
  const year = parseInt(ageMedian, 10);
  if (isNaN(year) || year >= 2024) {
    return { label: "Recent", style: `${base} text-[#0077A8] bg-[rgba(0,180,216,0.08)]` };
  }
  if (year >= 2022) {
    return { label: `~${year} (aging)`, style: `${base} text-[#B45309] bg-[rgba(245,158,11,0.08)]` };
  }
  return { label: "Old knowledge", style: `${base} text-[#FF4B6E] bg-[rgba(255,75,110,0.08)]` };
}

function fmtPct(n: number): string {
  if (n === 0) return "0%";
  if (n < 1) return "<1%";
  return `${Math.round(n)}%`;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function computeDomainStats(
  stats: StatRow[],
  canonicalMap: Map<string, CanonicalRow>,
  modelTab: ModelTab
): DomainStat[] {
  const filtered = modelTab === "all" ? stats : stats.filter((s) => s.model === modelTab);

  // Accumulate counts across time buckets (and models, for "all")
  const aggMap = new Map<string, {
    used: number; cited: number; total: number;
    latestBucket: string; ageMedian: string | null;
  }>();

  for (const s of filtered) {
    const ex = aggMap.get(s.canonical_domain_id);
    if (ex) {
      ex.used  += s.runs_used_count;
      ex.cited += s.runs_cited_count;
      ex.total += s.total_runs;
      if (s.time_bucket > ex.latestBucket) {
        ex.latestBucket = s.time_bucket;
        ex.ageMedian    = s.age_median;
      }
    } else {
      aggMap.set(s.canonical_domain_id, {
        used:          s.runs_used_count,
        cited:         s.runs_cited_count,
        total:         s.total_runs,
        latestBucket:  s.time_bucket,
        ageMedian:     s.age_median,
      });
    }
  }

  return Array.from(aggMap.entries())
    .map(([canonicalId, agg]) => {
      const canonical = canonicalMap.get(canonicalId);
      if (!canonical) return null;
      const usedPct  = agg.total > 0 ? (agg.used  / agg.total) * 100 : 0;
      const citedPct = agg.total > 0 ? (agg.cited / agg.total) * 100 : 0;
      return {
        canonicalId,
        domain:         canonical.domain,
        normalizedName: canonical.normalized_name || canonical.domain,
        sourceType:     canonical.source_type,
        faviconUrl:     canonical.favicon_url,
        usedCount:      agg.used,
        citedCount:     agg.cited,
        totalRuns:      agg.total,
        usedPct,
        citedPct,
        ageMedian:      agg.ageMedian,
        N:              agg.used,
      } satisfies DomainStat;
    })
    .filter(Boolean) as DomainStat[];
}

// N < 10 rows always sink to the bottom; within each band, sort by usedPct desc
function sortDomains(domains: DomainStat[]): DomainStat[] {
  return [...domains].sort((a, b) => {
    const aInsuf = a.N < 10;
    const bInsuf = b.N < 10;
    if (aInsuf && !bInsuf) return 1;
    if (!aInsuf && bInsuf) return -1;
    return b.usedPct - a.usedPct;
  });
}

// Compare top domain's Influences Answers % between the two most recent time buckets
function computeTopDomainDelta(
  stats: StatRow[],
  canonicalId: string,
  modelTab: ModelTab
): number | null {
  const relevant = (modelTab === "all" ? stats : stats.filter((s) => s.model === modelTab))
    .filter((s) => s.canonical_domain_id === canonicalId);

  const buckets = [...new Set(relevant.map((s) => s.time_bucket))].sort((a, b) =>
    b.localeCompare(a)
  );
  if (buckets.length < 2) return null;

  function pctForBucket(bucket: string): number {
    const rows  = relevant.filter((s) => s.time_bucket === bucket);
    const used  = rows.reduce((sum, s) => sum + s.runs_used_count, 0);
    const total = rows.reduce((sum, s) => sum + s.total_runs, 0);
    return total > 0 ? (used / total) * 100 : 0;
  }

  return pctForBucket(buckets[0]) - pctForBucket(buckets[1]);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SubLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-10 mb-3">
      <span className="text-[11px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

// Favicon with Google fallback and initial-letter last resort
function FaviconImg({ domain, url }: { domain: string; url: string | null }) {
  const [errored, setErrored] = useState(false);
  const src = url ?? `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;

  if (errored) {
    return (
      <div className="w-4 h-4 rounded-sm bg-[#E2E8F0] flex items-center justify-center shrink-0">
        <span className="text-[8px] font-bold text-[#6B7280] uppercase">{domain[0]}</span>
      </div>
    );
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

function GapPill({ usedPct, citedPct, N }: { usedPct: number; citedPct: number; N: number }) {
  const label   = getGapLabel(usedPct, citedPct, N);
  const config  = GAP_CONFIG[label];
  return (
    <div className="relative group inline-block">
      <span
        className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border cursor-default whitespace-nowrap ${config.style}`}
      >
        {label}
      </span>
      {config.tooltip && (
        // Tooltip appears below the pill so it is never clipped by the table's
        // overflow-hidden container (which would cut off an above-pill tooltip
        // on the first row).
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 w-52">
          <div className="w-2 h-2 bg-[#0D0437] rotate-45 mx-auto -mb-1" />
          <div className="bg-[#0D0437] text-white rounded-lg px-3 py-2 shadow-xl">
            <p className="text-[11px] leading-relaxed">{config.tooltip}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page inner ───────────────────────────────────────────────────────────────

function SourcesInner() {
  const searchParams   = useSearchParams();
  const clientIdParam  = searchParams.get("client");

  const [client,       setClient]       = useState<Client | null>(null);
  const [stats,        setStats]        = useState<StatRow[]>([]);
  const [canonicalMap, setCanonicalMap] = useState<Map<string, CanonicalRow>>(new Map());
  const [loading,      setLoading]      = useState(true);
  const [modelTab,     setModelTab]     = useState<ModelTab>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    let q = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) q = q.eq("id", clientIdParam);
    const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);
    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (activeClient) {
      const { data: statsData } = await supabase
        .from("domain_run_stats")
        .select("id, canonical_domain_id, client_id, model, time_bucket, runs_used_count, runs_cited_count, total_runs, model_weight, age_median, updated_at")
        .eq("client_id", activeClient.id)
        .order("time_bucket", { ascending: false });

      const allStats = (statsData ?? []) as StatRow[];
      setStats(allStats);

      const ids = [...new Set(allStats.map((s) => s.canonical_domain_id))];
      if (ids.length > 0) {
        const { data: canonicalsData } = await supabase
          .from("canonical_domains")
          .select("id, domain, normalized_name, source_type, favicon_url")
          .in("id", ids);

        const map = new Map<string, CanonicalRow>();
        (canonicalsData ?? []).forEach((c: CanonicalRow) => map.set(c.id, c));
        setCanonicalMap(map);
      }
    }

    setLoading(false);
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Source Intelligence
        </h1>
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
          <div className="px-4 py-3 border-b bg-[#F4F6F9] flex gap-4">
            {[80, 64, 56, 64, 48].map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: w }} />
            ))}
          </div>
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

  // ── No client ─────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">
          Source Intelligence
        </h1>
        <p className="text-sm text-[#6B7280]">No active client.</p>
      </div>
    );
  }

  // ── Empty state — no stats yet ────────────────────────────────────────────
  if (stats.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Source Intelligence
          </h1>
        </div>
        <div className="border border-[#E2E8F0] rounded-lg p-10 text-center bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437]">Source intelligence is warming up</p>
          <p className="text-[12px] text-[#6B7280] mt-1.5 max-w-sm mx-auto leading-relaxed">
            Complete your first tracking run to reveal which domains shape AI answers about your brand.
          </p>
        </div>
      </div>
    );
  }

  // ── Compute domain stats for current model tab ────────────────────────────
  const allDomainStats = computeDomainStats(stats, canonicalMap, modelTab);
  const filteredDomainStats =
    sourceFilter === "all"
      ? allDomainStats
      : allDomainStats.filter((d) => d.sourceType === sourceFilter);
  const sortedDomainStats = sortDomains(filteredDomainStats);

  // ── Summary card values ───────────────────────────────────────────────────

  // Card 1: Official Site Citation Rate — first domain with source_type = 'official'
  const officialSite = allDomainStats.find((d) => d.sourceType === "official") ?? null;

  // Card 2: Top Influencing Domain (N ≥ 10, highest usedPct)
  const topDomain =
    [...allDomainStats].filter((d) => d.N >= 10).sort((a, b) => b.usedPct - a.usedPct)[0] ?? null;
  const topDomainDelta = topDomain
    ? computeTopDomainDelta(stats, topDomain.canonicalId, modelTab)
    : null;

  // Card 3: Silent Influencers count
  const silentCount = allDomainStats.filter(
    (d) => d.N >= 10 && d.usedPct > 3 * d.citedPct
  ).length;

  // Card 4: Stale Knowledge Rate — % of domains (N ≥ 10, age known) with age_median ≤ 2022
  const domainsWithAge = allDomainStats.filter((d) => d.N >= 10 && d.ageMedian !== null);
  const staleCount = domainsWithAge.filter((d) => {
    const y = parseInt(d.ageMedian!, 10);
    return !isNaN(y) && y <= 2022;
  }).length;
  const staleRate =
    domainsWithAge.length > 0
      ? Math.round((staleCount / domainsWithAge.length) * 100)
      : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Source Intelligence
          </h1>
          {/* Reliability tooltip */}
          <div className="relative group mt-1">
            <Info className="h-4 w-4 text-[#9CA3AF] cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 w-72">
              <div className="bg-[#0D0437] text-white rounded-lg px-3 py-2.5 shadow-xl">
                <p className="text-[11px] leading-relaxed">
                  Source Intelligence reveals which domains influence AI answers about your brand,
                  even when they are never cited. Data is model-reported — treat domain-level
                  patterns as directional signals, not forensic evidence.
                </p>
              </div>
              <div className="w-2 h-2 bg-[#0D0437] rotate-45 mx-auto -mt-1" />
            </div>
          </div>
        </div>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          Which sources shape AI responses about {client.brand_name ?? client.url}
        </p>
      </div>

      {/* ── Summary cards ── */}
      <SubLabel>At a Glance</SubLabel>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        {/* Card 1: Official Site Citation Rate */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Official Site Citation Rate
          </p>
          {officialSite ? (
            <>
              <p className="text-[32px] font-bold text-[#0D0437] leading-none">
                {fmtPct(officialSite.citedPct)}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-2">
                of runs cite {officialSite.normalizedName}
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
                {fmtPct(topDomain.usedPct)}
              </p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">Influences answers</p>
              {topDomainDelta !== null && (
                <p
                  className={`text-[10px] font-bold mt-1.5 ${
                    topDomainDelta > 0
                      ? "text-[#1A8F5C]"
                      : topDomainDelta < 0
                        ? "text-[#FF4B6E]"
                        : "text-[#9CA3AF]"
                  }`}
                >
                  {topDomainDelta > 0 ? "↗ +" : topDomainDelta < 0 ? "↘ " : "→ "}
                  {Math.round(Math.abs(topDomainDelta))}% vs last week
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[32px] font-bold text-[#9CA3AF] leading-none">—</p>
              <p className="text-[11px] text-[#6B7280] mt-2">Need N ≥ 10 to surface</p>
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

        {/* Card 4: Stale Knowledge Rate */}
        <div className="border border-[#E2E8F0] rounded-lg p-5 bg-white">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
            Stale Knowledge Rate
          </p>
          {staleRate !== null ? (
            <>
              <p
                className="text-[32px] font-bold leading-none"
                style={{
                  color: staleRate >= 50 ? "#FF4B6E" : staleRate >= 25 ? "#F59E0B" : "#1A8F5C",
                }}
              >
                {staleRate}%
              </p>
              <p className="text-[11px] text-[#6B7280] mt-2">
                of tracked domains have 2022 or older knowledge
              </p>
            </>
          ) : (
            <>
              <p className="text-[32px] font-bold text-[#9CA3AF] leading-none">—</p>
              <p className="text-[11px] text-[#6B7280] mt-2">
                Awaiting age data from enrichment
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Model tabs + source filter ── */}
      <SubLabel>Domain Attribution</SubLabel>
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {MODEL_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setModelTab(tab.id)}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
              modelTab === tab.id
                ? "bg-[#0D0437] text-white"
                : "bg-white border border-[#E2E8F0] text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437]"
            }`}
          >
            {tab.label}
            {/* Low-confidence indicator on Claude tab */}
            {tab.lowConfidence && (
              <div className="relative group/lc">
                <span
                  className={`text-[8px] font-bold px-1 py-0.5 rounded leading-none ${
                    modelTab === tab.id
                      ? "bg-white/20 text-white/70"
                      : "bg-[rgba(245,158,11,0.12)] text-[#B45309]"
                  }`}
                >
                  ~
                </span>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 pointer-events-none opacity-0 group-hover/lc:opacity-100 transition-opacity duration-150 w-52">
                  <div className="bg-[#0D0437] text-white rounded-lg px-3 py-2 shadow-xl">
                    <p className="text-[10px] leading-relaxed">
                      Claude reports fewer explicit sources than other models by design.
                      Data may be sparser here.
                    </p>
                  </div>
                  <div className="w-2 h-2 bg-[#0D0437] rotate-45 mx-auto -mt-1" />
                </div>
              </div>
            )}
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

      {/* ── Domain table ── */}
      {sortedDomainStats.length === 0 ? (
        <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-[#F4F6F9]">
          <p className="text-sm font-semibold text-[#0D0437]">No domains match this filter</p>
          <p className="text-[12px] text-[#6B7280] mt-1">
            Try a different model tab or source type.
          </p>
        </div>
      ) : (
        <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-[#F4F6F9]">
                {[
                  "Domain",
                  "Source Type",
                  "Influences Answers",
                  "Gets Credited",
                  "Gap",
                  "N",
                  "Knowledge Vintage",
                ].map((h) => (
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
              {sortedDomainStats.map((d) => {
                const isInsufficient = d.N < 10;
                const srcConfig      = SOURCE_TYPE_CONFIG[d.sourceType] ?? SOURCE_TYPE_CONFIG.reference;
                const vintage        = getVintage(d.ageMedian);

                return (
                  <tr
                    key={d.canonicalId}
                    className={`border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)] transition-colors ${
                      isInsufficient ? "opacity-40" : ""
                    }`}
                  >
                    {/* Domain */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FaviconImg domain={d.domain} url={d.faviconUrl} />
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold text-[#0D0437] truncate max-w-[160px]">
                            {d.normalizedName}
                          </p>
                          <p className="text-[10px] text-[#9CA3AF] truncate max-w-[160px]">
                            {d.domain}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Source type pill */}
                    <td className="px-4 py-3">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${srcConfig.style}`}
                      >
                        {srcConfig.label}
                      </span>
                    </td>

                    {/* Influences Answers % with mini bar */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-bold text-[#0D0437] tabular-nums w-10 shrink-0">
                          {fmtPct(d.usedPct)}
                        </span>
                        <div className="w-16 h-1.5 bg-[#E2E8F0] rounded-full overflow-hidden hidden sm:block shrink-0">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(d.usedPct, 100)}%`,
                              // coral-to-cyan gradient matching the brand accent palette
                              background: "linear-gradient(90deg, #FF6B6B, #00B4D8)",
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Gets Credited % */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-[13px] text-[#6B7280] tabular-nums">
                        {fmtPct(d.citedPct)}
                      </span>
                    </td>

                    {/* Gap pill with hover tooltip */}
                    <td className="px-4 py-3">
                      <GapPill usedPct={d.usedPct} citedPct={d.citedPct} N={d.N} />
                    </td>

                    {/* N */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-[12px] text-[#9CA3AF]">{d.N}</span>
                    </td>

                    {/* Knowledge Vintage */}
                    <td className="px-4 py-3">
                      <span className={vintage.style}>{vintage.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SourcesPage() {
  return (
    <Suspense>
      <SourcesInner />
    </Suspense>
  );
}
