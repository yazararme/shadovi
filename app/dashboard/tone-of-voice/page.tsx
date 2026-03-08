"use client";

import { useEffect, useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useClientContext } from "@/context/ClientContext";
import { Skeleton } from "@/components/ui/skeleton";
import { ResponseDrawer, type RunOption } from "@/components/dashboard/ResponseDrawer";
import { MetricDetailDrawer } from "@/components/dashboard/MetricDetailDrawer";
import type { LLMModel } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

// ── Constants ──────────────────────────────────────────────────────────────────

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o":            "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity":        "Perplexity",
  "gemini":            "Gemini",
  "deepseek":          "DeepSeek",
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface SentimentCounts {
  positive: number;
  neutral:  number;
  negative: number;
  unclear:  number;
}

interface MentionRow {
  id:                string;
  brand_name:        string;
  is_tracked_brand:  boolean;
  mention_sentiment: string;
  model:             string;
  mention_context:   string | null;
  tracking_run_id:   string;
  query_intent:      string | null;
  query_text:        string;
  created_at:        string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tracking_runs:     any;
}

interface NegativeAlertRow {
  id:               string;
  mention_context:  string | null;
  model:            string;
  created_at:       string;
  tracking_run_id:  string;
  query_text:       string;
  raw_response:     string | null;
  competitors_mentioned: string[];
  source_attribution: unknown[] | null;
  cited_sources: string[] | null;
}

// brand_name → SentimentCounts
type BrandSentimentMap = Record<string, SentimentCounts & { isBrand: boolean }>;
// model → SentimentCounts (own brand only)
type ModelSentimentMap = Record<string, SentimentCounts>;

interface DrawerState {
  queryText: string;
  runs: RunOption[];
  sentiment: "negative";
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Strips diacritics and lowercases — used to match competitor names across
// the `competitors` table (user-entered) and `response_brand_mentions.brand_name`
// (LLM-extracted + normalised), where accents may differ (e.g. "L'Oréal" vs "L'Oreal").
function normalizeForMatch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function computeNss(c: SentimentCounts): number {
  const denom = c.positive + c.neutral + c.negative;
  return denom > 0 ? Math.round(((c.positive - c.negative) / denom) * 100) : 0;
}
function nssLabel(n: number): string { return n >= 0 ? `+${n}` : `${n}`; }
function nssColor(n: number): string {
  return n > 0 ? "#1A8F5C" : n < 0 ? "#FF4B6E" : "#9CA3AF";
}
function barPcts(c: SentimentCounts): { pos: number; neu: number; neg: number } {
  const denom = c.positive + c.neutral + c.negative;
  if (denom === 0) return { pos: 0, neu: 0, neg: 0 };
  return {
    pos: Math.round((c.positive / denom) * 100),
    neu: Math.round((c.neutral  / denom) * 100),
    neg: Math.round((c.negative / denom) * 100),
  };
}
function formatAlertDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Merge cited_sources (string[]) and source_attribution (object[]/string[]) into
 *  a deduplicated list of { url, domain }, max 5. Dedup by hostname. */
function mergeSourceUrls(citedSources?: string[] | null, sourceAttribution?: unknown[] | null): { url: string; domain: string }[] {
  const seen = new Map<string, string>();
  for (const url of citedSources ?? []) {
    if (!url) continue;
    try { const d = new URL(url).hostname.replace("www.", ""); if (!seen.has(d)) seen.set(d, url); }
    catch { if (!seen.has(url)) seen.set(url, url); }
  }
  for (const src of sourceAttribution ?? []) {
    const raw = typeof src === "string" ? src : (src as Record<string, unknown>)?.url;
    if (!raw || typeof raw !== "string") continue;
    try { const d = new URL(raw).hostname.replace("www.", ""); if (!seen.has(d)) seen.set(d, raw); }
    catch { if (!seen.has(raw)) seen.set(raw, raw); }
  }
  return Array.from(seen.entries()).slice(0, 5).map(([domain, url]) => ({ url, domain }));
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

function PlaceholderCard() {
  return (
    <div className="border border-dashed border-[#E2E8F0] rounded-xl bg-white p-8 text-center">
      <p className="text-[13px] text-[#9CA3AF]">Coming soon</p>
    </div>
  );
}

// ── Reputation Snapshot ────────────────────────────────────────────────────────

function ReputationSnapshot({
  counts,
  loading,
  onSegmentClick,
}: {
  counts: SentimentCounts | null;
  loading: boolean;
  onSegmentClick?: (segment: "positive" | "neutral" | "negative" | "all") => void;
}) {
  if (loading) return <Skeleton className="h-36 w-full rounded-xl" />;

  const total = counts ? counts.positive + counts.neutral + counts.negative + counts.unclear : 0;
  if (!counts || total < 10) {
    return (
      <div className="border border-dashed border-[#E2E8F0] rounded-xl bg-white p-8 text-center">
        <p className="text-[13px] text-[#9CA3AF]">
          Not enough comparative data yet — sentiment scores will appear after your first full tracking run.
        </p>
      </div>
    );
  }

  const { positive, neutral, negative } = counts;
  const denom = positive + neutral + negative;
  const nss  = denom > 0 ? Math.round(((positive - negative) / denom) * 100) : 0;
  const label = nss >= 0 ? `+${nss}` : `${nss}`;
  const color = nss > 0 ? "text-[#1A8F5C]" : nss < 0 ? "text-[#FF4B6E]" : "text-[#6B7280]";

  return (
    <div className="border border-[#E2E8F0] rounded-xl bg-white p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        <div className="flex items-center gap-3">
          <div
            className={`flex flex-col items-center gap-1 px-3 py-2 -mx-3 -my-2${onSegmentClick ? " cursor-pointer hover:bg-[#F4F6F9] rounded-lg transition-colors" : ""}`}
            onClick={() => onSegmentClick?.("positive")}
          >
            <span className="text-[22px] font-bold text-[#1A8F5C] leading-none">{positive}</span>
            <span className="text-[10px] font-bold uppercase tracking-[1.5px] px-2.5 py-0.5 rounded-full bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border border-[rgba(26,143,92,0.2)]">Positive</span>
            {onSegmentClick && (
              <button type="button" className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-1.5 transition-colors w-fit">
                View mentions →
              </button>
            )}
          </div>
          <div className="h-8 w-px bg-[#E2E8F0] shrink-0" />
          <div
            className={`flex flex-col items-center gap-1 px-3 py-2 -mx-3 -my-2${onSegmentClick ? " cursor-pointer hover:bg-[#F4F6F9] rounded-lg transition-colors" : ""}`}
            onClick={() => onSegmentClick?.("neutral")}
          >
            <span className="text-[22px] font-bold text-[#6B7280] leading-none">{neutral}</span>
            <span className="text-[10px] font-bold uppercase tracking-[1.5px] px-2.5 py-0.5 rounded-full bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">Neutral</span>
            {onSegmentClick && (
              <button type="button" className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-1.5 transition-colors w-fit">
                View mentions →
              </button>
            )}
          </div>
          <div className="h-8 w-px bg-[#E2E8F0] shrink-0" />
          <div
            className={`flex flex-col items-center gap-1 px-3 py-2 -mx-3 -my-2${onSegmentClick ? " cursor-pointer hover:bg-[#F4F6F9] rounded-lg transition-colors" : ""}`}
            onClick={() => onSegmentClick?.("negative")}
          >
            <span className="text-[22px] font-bold text-[#FF4B6E] leading-none">{negative}</span>
            <span className="text-[10px] font-bold uppercase tracking-[1.5px] px-2.5 py-0.5 rounded-full bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border border-[rgba(255,75,110,0.2)]">Negative</span>
            {onSegmentClick && (
              <button type="button" className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-1.5 transition-colors w-fit">
                View mentions →
              </button>
            )}
          </div>
        </div>
        <div className="hidden sm:block h-16 w-px bg-[#E2E8F0] shrink-0" />
        <div
          className={`flex flex-col items-start justify-center gap-1 px-3 py-2 -mx-3 -my-2${onSegmentClick ? " cursor-pointer hover:bg-[#F4F6F9] rounded-lg transition-colors" : ""}`}
          onClick={() => onSegmentClick?.("all")}
        >
          <span className={`text-[42px] font-bold leading-none ${color}`}>{label}</span>
          <span className="text-[12px] font-bold text-[#0D0437]">Net Sentiment Score</span>
          {onSegmentClick && (
            <button type="button" className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-1.5 transition-colors w-fit">
              View mentions →
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-[#9CA3AF] mt-5 pt-4 border-t border-[#F4F6F9]">
        Each mention is scored by AI, which reads the full response and classifies your brand&apos;s portrayal as positive, neutral, or negative in context. NSS = (positive − negative) ÷ total scored mentions × 100.
      </p>
    </div>
  );
}

// ── Competitive Favorability ───────────────────────────────────────────────────

function FavorabilityTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: Record<string, number> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-lg px-3 py-2.5 shadow-sm text-[11px]">
      <p className="font-bold text-[#0D0437] mb-1.5">{label}</p>
      <div className="flex flex-col gap-1">
        <span className="text-[#1A8F5C]">Positive {d.posCount} ({d.pos}%)</span>
        <span className="text-[#6B7280]">Neutral {d.neuCount} ({d.neu}%)</span>
        <span className="text-[#FF4B6E]">Negative {d.negCount} ({d.neg}%)</span>
      </div>
    </div>
  );
}

function CompetitiveFavorability({
  brandMap, ownBrandName, loading,
}: {
  brandMap: BrandSentimentMap | null;
  ownBrandName: string | null;
  loading: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  if (loading) return <Skeleton className="h-56 w-full rounded-xl" />;

  if (!brandMap || !ownBrandName) {
    return (
      <div className="border border-dashed border-[#E2E8F0] rounded-xl bg-white p-8 text-center">
        <p className="text-[13px] text-[#9CA3AF]">
          Competitor sentiment will appear once competitors are detected in comparative tracking runs.
        </p>
      </div>
    );
  }

  const ownEntry = brandMap[ownBrandName];
  const competitors = Object.entries(brandMap)
    .filter(([name]) => name !== ownBrandName)
    .sort((a, b) => {
      const totalA = a[1].positive + a[1].neutral + a[1].negative + a[1].unclear;
      const totalB = b[1].positive + b[1].neutral + b[1].negative + b[1].unclear;
      return totalB - totalA;
    });

  const scoredBrands = (ownEntry ? 1 : 0) +
    competitors.filter(([, c]) => (c.positive + c.neutral + c.negative) > 0).length;
  if (scoredBrands < 2) {
    return (
      <div className="border border-dashed border-[#E2E8F0] rounded-xl bg-white p-8 text-center">
        <p className="text-[13px] text-[#9CA3AF]">
          Competitor sentiment will appear once competitors are detected in comparative tracking runs.
        </p>
      </div>
    );
  }

  const TOP_N = 3;
  const visibleCompetitors = showAll ? competitors : competitors.slice(0, TOP_N);
  const rows = [
    ...(ownEntry ? [{ name: ownBrandName, counts: ownEntry }] : []),
    ...visibleCompetitors.map(([name, counts]) => ({ name, counts })),
  ];

  const chartData = rows.map(({ name, counts }) => {
    const pcts = barPcts(counts);
    return { name, pos: pcts.pos, neu: pcts.neu, neg: pcts.neg,
             posCount: counts.positive, neuCount: counts.neutral, negCount: counts.negative };
  });

  const chartHeight = rows.length * 36 + 24;

  return (
    <div className="border border-[#E2E8F0] rounded-xl bg-white p-6">
      {/* Toggle lives at the top-right so it's always reachable without scrolling */}
      {competitors.length > TOP_N && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] font-bold text-[#9CA3AF] hover:text-[#0D0437] transition-colors flex items-center gap-1"
          >
            {showAll ? `↑ Show top ${TOP_N} only` : `Show all ${competitors.length} →`}
          </button>
        </div>
      )}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart layout="vertical" data={chartData}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barSize={18}>
          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 10, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={140}
            tick={({ x, y, payload }) => (
              <text x={x - 4} y={y} dy={4} textAnchor="end" fontSize={12}
                fontWeight={payload.value === ownBrandName ? 700 : 400}
                fill={payload.value === ownBrandName ? "#0D0437" : "#6B7280"}>
                {payload.value}
              </text>
            )}
          />
          <Tooltip content={<FavorabilityTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
          <Bar dataKey="pos" stackId="s" fill="#1A8F5C" isAnimationActive={false}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.name === ownBrandName ? "#1A8F5C" : "#34d399"} />
            ))}
          </Bar>
          <Bar dataKey="neu" stackId="s" fill="#D1D5DB" isAnimationActive={false} />
          <Bar dataKey="neg" stackId="s" fill="#FF4B6E" radius={[0, 2, 2, 0]} isAnimationActive={false}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.name === ownBrandName ? "#FF4B6E" : "#fca5a5"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-3">
        {[{ color: "#1A8F5C", label: "Positive" }, { color: "#D1D5DB", label: "Neutral" },
          { color: "#FF4B6E", label: "Negative" }].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
            <span className="inline-block h-2 w-2 rounded-sm shrink-0" style={{ background: color }} />
            {label}
          </span>
        ))}
        <span className="text-[11px] text-[#9CA3AF] ml-auto">% of scored mentions (excl. unclear)</span>
      </div>
    </div>
  );
}

// ── Model Sentiment Breakdown ──────────────────────────────────────────────────

function ModelCard({ model, counts, onClick }: { model: string; counts: SentimentCounts; onClick?: () => void }) {
  const total = counts.positive + counts.neutral + counts.negative;
  const insufficient = (total + counts.unclear) < 5;
  const nss  = computeNss(counts);
  const pcts = barPcts(counts);

  return (
    <div
      className={`border border-[#E2E8F0] rounded-xl bg-white p-4 flex flex-col gap-3${onClick ? " cursor-pointer hover:border-[#0D0437]/20 hover:shadow-sm transition-all" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-bold text-[#0D0437]">{MODEL_LABELS[model] ?? model}</span>
        {!insufficient && (
          <span className="text-[15px] font-bold leading-none shrink-0" style={{ color: nssColor(nss) }}>
            {nssLabel(nss)}
          </span>
        )}
      </div>
      {insufficient ? (
        <p className="text-[11px] text-[#9CA3AF]">Insufficient data</p>
      ) : (
        <>
          <div className="h-2 w-full rounded-full overflow-hidden flex">
            <div className="h-full bg-[#1A8F5C]" style={{ width: `${pcts.pos}%` }} />
            <div className="h-full bg-[#D1D5DB]" style={{ width: `${pcts.neu}%` }} />
            <div className="h-full bg-[#FF4B6E]" style={{ width: `${pcts.neg}%` }} />
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-[#1A8F5C] font-bold">{counts.positive} pos</span>
            <span className="text-[#6B7280]">{counts.neutral} neu</span>
            <span className="text-[#FF4B6E] font-bold">{counts.negative} neg</span>
          </div>
          {onClick && (
            <button
              type="button"
              className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#0D0437] mt-1 transition-colors w-fit"
            >
              View queries →
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ModelSentimentBreakdown({
  modelMap,
  loading,
  onCardClick,
}: {
  modelMap: ModelSentimentMap | null;
  loading: boolean;
  onCardClick?: (model: string) => void;
}) {
  if (loading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!modelMap || Object.keys(modelMap).length === 0) {
    return (
      <div className="border border-dashed border-[#E2E8F0] rounded-xl bg-white p-8 text-center">
        <p className="text-[13px] text-[#9CA3AF]">
          Not enough comparative data yet — model breakdown will appear after your first full tracking run.
        </p>
      </div>
    );
  }
  const sorted = Object.entries(modelMap).sort(([, a], [, b]) => computeNss(b) - computeNss(a));
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {sorted.map(([model, counts]) => (
        <ModelCard
          key={model}
          model={model}
          counts={counts}
          onClick={onCardClick ? () => onCardClick(model) : undefined}
        />
      ))}
    </div>
  );
}

// ── Negative Alerts ────────────────────────────────────────────────────────────

function NegativeAlerts({ clientId, brandName }: { clientId: string | null; brandName: string }) {
  const [alerts,  setAlerts ] = useState<NegativeAlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer,  setDrawer ] = useState<DrawerState | null>(null);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      const supabase = createClient();

      const { data, error } = await supabase
        .from("response_brand_mentions")
        .select(`
          id,
          mention_context,
          model,
          created_at,
          tracking_run_id,
          queries(text),
          tracking_runs(raw_response, competitors_mentioned, source_attribution, cited_sources)
        `)
        .eq("client_id", clientId)
        .eq("is_tracked_brand", true)
        .eq("query_intent", "comparative")
        .eq("mention_sentiment", "negative")
        .order("created_at", { ascending: false })
        .limit(20);

      if (cancelled) return;
      if (error) {
        console.error("[tone-of-voice] negative alerts fetch error:", error.message);
        setLoading(false);
        return;
      }

      const rows: NegativeAlertRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
        id:                   r.id as string,
        mention_context:      r.mention_context as string | null,
        model:                r.model as string,
        created_at:           r.created_at as string,
        tracking_run_id:      r.tracking_run_id as string,
        query_text:           (r.queries as { text: string } | null)?.text ?? "",
        raw_response:         (r.tracking_runs as { raw_response: string | null } | null)?.raw_response ?? null,
        competitors_mentioned:(r.tracking_runs as { competitors_mentioned: string[] | null } | null)?.competitors_mentioned ?? [],
        source_attribution:   (r.tracking_runs as { source_attribution: unknown[] | null } | null)?.source_attribution ?? null,
        cited_sources:        (r.tracking_runs as { raw_response: string | null; competitors_mentioned: string[] | null; cited_sources: string[] | null } | null)?.cited_sources ?? null,
      }));

      setAlerts(rows);
      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) return <Skeleton className="h-48 w-full rounded-xl" />;

  if (alerts.length === 0) {
    return (
      <div className="border border-[rgba(26,143,92,0.2)] rounded-xl bg-[rgba(26,143,92,0.04)] p-6 text-center">
        <p className="text-[13px] text-[#1A8F5C] font-medium">
          No negative mentions detected in comparative queries.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="border border-[#E2E8F0] rounded-xl bg-white overflow-hidden">
        <ul className="divide-y divide-[#F4F6F9]">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <button
                type="button"
                onClick={() => setDrawer({
                  queryText: alert.query_text,
                  runs: [{
                    model: alert.model as LLMModel,
                    rawResponse: alert.raw_response,
                    competitorsMentioned: alert.competitors_mentioned,
                  }],
                  sentiment: "negative",
                })}
                className="w-full text-left px-5 py-4 hover:bg-[rgba(244,246,249,0.6)] transition-colors group"
              >
                {/* Query text */}
                <p className="text-[13px] text-[#0D0437] font-medium leading-snug line-clamp-2 group-hover:text-[#0D0437]">
                  &ldquo;{alert.query_text}&rdquo;
                </p>
                {/* Context snippet */}
                {alert.mention_context && (
                  <p className="text-[11px] text-[#6B7280] mt-1 leading-relaxed line-clamp-2">
                    {alert.mention_context}
                  </p>
                )}
                {/* Meta row */}
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#FF4B6E] bg-[rgba(255,75,110,0.08)] border border-[rgba(255,75,110,0.2)] px-2 py-0.5 rounded">
                    {MODEL_LABELS[alert.model] ?? alert.model}
                  </span>
                  <span className="text-[11px] text-[#9CA3AF]">
                    {formatAlertDate(alert.created_at)}
                  </span>
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] group-hover:text-[#0D0437] transition-colors">
                    View Response →
                  </span>
                </div>
                {(() => {
                  const sources = mergeSourceUrls(alert.cited_sources, alert.source_attribution);
                  if (sources.length === 0) return null;
                  return (
                    <div className="mt-3">
                      <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mt-4 mb-1.5">Sources</p>
                      <div className="flex flex-col gap-0.5">
                        {sources.map((s, i) => (
                          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#00B4D8] hover:underline truncate block">
                            {s.domain}
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {drawer && (
        <ResponseDrawer
          queryText={drawer.queryText}
          runs={drawer.runs}
          brandName={brandName}
          mentionSentiment={drawer.sentiment}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}

// ── Page inner ─────────────────────────────────────────────────────────────────

function ToneOfVoiceInner() {
  const { activeClientId: clientId, loading: contextLoading } = useClientContext();

  const [snapshotCounts, setSnapshotCounts] = useState<SentimentCounts | null>(null);
  const [brandMap,       setBrandMap      ] = useState<BrandSentimentMap | null>(null);
  const [modelMap,       setModelMap      ] = useState<ModelSentimentMap | null>(null);
  const [ownBrandName,   setOwnBrandName  ] = useState<string | null>(null);
  const [negativeCount,  setNegativeCount ] = useState<number | undefined>(undefined);
  const [ownMentions,    setOwnMentions   ] = useState<MentionRow[]>([]);
  const [loading,        setLoading       ] = useState(true);
  const [sentimentDrawerModel, setSentimentDrawerModel] = useState<string | null>(null);
  // null | "positive" | "neutral" | "negative" | "all"
  const [snapshotDrawer, setSnapshotDrawer] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      const supabase = createClient();

      const [mentionsResult, competitorsResult] = await Promise.all([
        supabase
          .from("response_brand_mentions")
          .select("id, brand_name, is_tracked_brand, mention_sentiment, model, mention_context, tracking_run_id, query_intent, created_at, tracking_runs(raw_response, query_id, competitors_mentioned, source_attribution, cited_sources, queries(text))")
          .eq("client_id", clientId)
          .eq("query_intent", "comparative")
          .not("mention_sentiment", "is", null),
        supabase
          .from("competitors")
          .select("name")
          .eq("client_id", clientId),
      ]);

      if (cancelled) return;
      if (mentionsResult.error) {
        console.error("[tone-of-voice] fetch error:", mentionsResult.error.message);
        setLoading(false);
        return;
      }

      const rows = (mentionsResult.data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        query_text: ((r.tracking_runs as { queries?: { text: string } | null } | null)?.queries?.text) ?? "",
      })) as MentionRow[];
      // Build a normalised set of user-selected competitor names for chart filtering
      const competitorNameSet = new Set(
        (competitorsResult.data ?? []).map((c: { name: string }) =>
          normalizeForMatch(c.name)
        )
      );

      // Snapshot (own brand only)
      const snap: SentimentCounts = { positive: 0, neutral: 0, negative: 0, unclear: 0 };
      for (const r of rows) {
        if (!r.is_tracked_brand) continue;
        const s = r.mention_sentiment as keyof SentimentCounts;
        if (s in snap) snap[s]++;
      }
      setSnapshotCounts(snap);
      setNegativeCount(snap.negative);

      const ownRow = rows.find((r) => r.is_tracked_brand);
      setOwnBrandName(ownRow?.brand_name ?? null);

      // Brand map (all brands)
      const bMap: BrandSentimentMap = {};
      for (const r of rows) {
        if (!bMap[r.brand_name]) {
          bMap[r.brand_name] = { positive: 0, neutral: 0, negative: 0, unclear: 0, isBrand: r.is_tracked_brand };
        }
        const s = r.mention_sentiment as keyof SentimentCounts;
        if (s in snap) bMap[r.brand_name][s]++;
      }
      // Only keep own brand + brands the user selected as competitors during onboarding
      const filteredBMap = Object.fromEntries(
        Object.entries(bMap).filter(([name, data]) =>
          data.isBrand || competitorNameSet.has(normalizeForMatch(name))
        )
      );
      setBrandMap(Object.keys(filteredBMap).length > 0 ? filteredBMap : null);

      // Model map (own brand only)
      const mMap: ModelSentimentMap = {};
      for (const r of rows) {
        if (!r.is_tracked_brand) continue;
        if (!mMap[r.model]) mMap[r.model] = { positive: 0, neutral: 0, negative: 0, unclear: 0 };
        const s = r.mention_sentiment as keyof SentimentCounts;
        if (s in snap) mMap[r.model][s]++;
      }
      setModelMap(Object.keys(mMap).length > 0 ? mMap : null);

      // Preserve individual own-brand mentions for the drill-down drawer
      setOwnMentions(rows.filter((r) => r.is_tracked_brand));

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [clientId, contextLoading]);

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="mb-2">
        <h1 className="text-[28px] font-bold text-[#0D0437] leading-tight">AI Tone of Voice</h1>
        <p className="text-[13px] text-[#6B7280] mt-1">
          How AI models characterise your brand in direct comparisons
        </p>
        <p className="text-[12px] text-[#9CA3AF] mt-1 leading-relaxed">
          Based on comparative queries only — the only intent where LLMs are forced to evaluate
          and differentiate between brands.
        </p>
      </div>

      {/* ── Section 1: Reputation Snapshot ────────────────────────────────────── */}
      <SectionLabel>Reputation Snapshot</SectionLabel>
      <ReputationSnapshot
        counts={snapshotCounts}
        loading={loading}
        onSegmentClick={(segment) => {
          setSentimentDrawerModel(null);
          setSnapshotDrawer(segment);
        }}
      />

      {/* ── Section 2: Competitive Favorability ───────────────────────────────── */}
      <SectionLabel>Competitive Favorability</SectionLabel>
      <CompetitiveFavorability brandMap={brandMap} ownBrandName={ownBrandName} loading={loading} />

      {/* ── Section 3: Model Sentiment Breakdown ──────────────────────────────── */}
      <SectionLabel>Model Sentiment Breakdown</SectionLabel>
      <ModelSentimentBreakdown
        modelMap={modelMap}
        loading={loading}
        onCardClick={(model) => {
          setSnapshotDrawer(null);
          setSentimentDrawerModel(model);
        }}
      />

      {/* ── Section 4: Negative Alerts ────────────────────────────────────────── */}
      <SectionLabel count={negativeCount}>Negative Mentions</SectionLabel>
      <p className="text-[12px] text-[#9CA3AF] mb-4 -mt-2 leading-relaxed">
        Instances where AI characterised your brand unfavourably in a direct comparison
      </p>
      <NegativeAlerts clientId={clientId} brandName={ownBrandName ?? "Your Brand"} />

      {/* ── Snapshot drill-down drawer ────────────────────────────────────── */}
      {snapshotDrawer && (() => {
        const filtered = snapshotDrawer === "all"
          ? ownMentions
          : ownMentions.filter((m) => m.mention_sentiment === snapshotDrawer);

        const label = snapshotDrawer === "all" ? "All Mentions" : `${snapshotDrawer.charAt(0).toUpperCase() + snapshotDrawer.slice(1)} Mentions`;

        const value = snapshotDrawer === "all"
          ? (() => {
              const p = ownMentions.filter(m => m.mention_sentiment === "positive").length;
              const n = ownMentions.filter(m => m.mention_sentiment === "negative").length;
              const d = p + ownMentions.filter(m => m.mention_sentiment === "neutral").length + n;
              const nssVal = d > 0 ? Math.round(((p - n) / d) * 100) : 0;
              return `${nssVal >= 0 ? "+" : ""}${nssVal}`;
            })()
          : `${filtered.length}`;

        const metricColor = snapshotDrawer === "positive" ? "#1A8F5C"
          : snapshotDrawer === "negative" ? "#FF4B6E"
          : snapshotDrawer === "neutral" ? "#6B7280"
          : "#0D0437";

        const drawerRuns = filtered.map((m) => ({
          id: m.id,
          queryText: m.query_text || "(no query text)",
          queryIntent: m.query_intent ?? "comparative",
          model: m.model,
          mentionSentiment: m.mention_sentiment,
          ranAt: m.created_at,
          rawResponse: (m.tracking_runs as { raw_response?: string | null } | null)?.raw_response ?? undefined,
          isBait: false,
          baitTriggered: false,
          competitorsMentioned: ((m.tracking_runs as { competitors_mentioned?: string[] | null } | null)?.competitors_mentioned ?? []),
          mentionContext: m.mention_context,
          sourceAttribution: (m.tracking_runs as { source_attribution?: unknown[] | null } | null)?.source_attribution ?? null,
          citedSources: (m.tracking_runs as { cited_sources?: string[] | null } | null)?.cited_sources ?? null,
        }));

        return (
          <MetricDetailDrawer
            title={label}
            metricValue={value}
            metricColor={metricColor}
            subtitle={`${filtered.length} mention${filtered.length !== 1 ? "s" : ""} across all models`}
            runs={drawerRuns}
            brandName={ownBrandName ?? ""}
            csvFilenamePrefix={`${ownBrandName ?? "brand"}_${snapshotDrawer}_mentions`}
            onClose={() => setSnapshotDrawer(null)}
          />
        );
      })()}

      {/* ── Sentiment drill-down drawer ──────────────────────────────────── */}
      {sentimentDrawerModel && (() => {
        const filteredMentions = ownMentions.filter((m) => m.model === sentimentDrawerModel);
        const posCt = filteredMentions.filter((m) => m.mention_sentiment === "positive").length;
        const neuCt = filteredMentions.filter((m) => m.mention_sentiment === "neutral").length;
        const negCt = filteredMentions.filter((m) => m.mention_sentiment === "negative").length;
        const nss = (posCt + neuCt + negCt) > 0
          ? Math.round(((posCt - negCt) / (posCt + neuCt + negCt)) * 100)
          : 0;
        const sign = nss >= 0 ? "+" : "";
        const displayName = MODEL_LABELS[sentimentDrawerModel] ?? sentimentDrawerModel;

        const drawerRuns = filteredMentions.map((m) => ({
          id: m.id,
          queryText: m.query_text || "(no query text)",
          queryIntent: m.query_intent ?? "comparative",
          model: m.model,
          mentionSentiment: m.mention_sentiment,
          ranAt: m.created_at,
          rawResponse: (m.tracking_runs as { raw_response?: string | null } | null)?.raw_response ?? undefined,
          isBait: false,
          baitTriggered: false,
          competitorsMentioned: ((m.tracking_runs as { competitors_mentioned?: string[] | null } | null)?.competitors_mentioned ?? []),
          mentionContext: m.mention_context,
          sourceAttribution: (m.tracking_runs as { source_attribution?: unknown[] | null } | null)?.source_attribution ?? null,
          citedSources: (m.tracking_runs as { cited_sources?: string[] | null } | null)?.cited_sources ?? null,
        }));

        return (
          <MetricDetailDrawer
            title={`${displayName} Sentiment`}
            metricValue={`${sign}${nss}`}
            metricColor={nss > 0 ? "#1A8F5C" : nss < 0 ? "#FF4B6E" : "#6B7280"}
            subtitle={`${posCt} positive · ${neuCt} neutral · ${negCt} negative`}
            runs={drawerRuns}
            brandName={ownBrandName ?? ""}
            csvFilenamePrefix={`${ownBrandName ?? "brand"}_${sentimentDrawerModel}_sentiment`}
            onClose={() => setSentimentDrawerModel(null)}
          />
        );
      })()}
    </div>
  );
}

export default function ToneOfVoicePage() {
  return (
    <Suspense>
      <ToneOfVoiceInner />
    </Suspense>
  );
}
