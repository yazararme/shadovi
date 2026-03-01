"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useClientContext } from "@/context/ClientContext";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";
import type { Client, Recommendation, RecommendationType } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<number, string> = {
  1: "bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
  2: "bg-[rgba(245,158,11,0.1)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]",
};
const PRIORITY_BADGE_DEFAULT = "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]";

const TYPE_LABELS: Record<RecommendationType, string> = {
  content_directive:  "CONTENT DIRECTIVE",
  entity_foundation:  "ENTITY FOUNDATION",
  placement_strategy: "PLACEMENT STRATEGY",
};

const TYPE_BADGE: Record<RecommendationType, string> = {
  content_directive:  "bg-[rgba(13,4,55,0.06)] text-[#0D0437] border-[rgba(13,4,55,0.15)]",
  entity_foundation:  "bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]",
  placement_strategy: "bg-[rgba(0,180,216,0.08)] text-[#0077A8] border-[rgba(0,180,216,0.2)]",
};

const FREQ_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatFreshnessDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) {
    return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function daysUntilNext(latestMs: number, freq: string): number {
  if (!latestMs) return 0;
  const freqDays = FREQ_DAYS[freq] ?? 7;
  return Math.max(0, Math.ceil((latestMs + freqDays * 86_400_000 - Date.now()) / 86_400_000));
}

// ─── Page inner ───────────────────────────────────────────────────────────────

function RoadmapInner() {
  const searchParams = useSearchParams();
  const { activeClientId: clientIdParam } = useClientContext();
  const highlightId  = searchParams.get("highlight");

  const [client,  setClient]  = useState<Client | null>(null);
  const [recs,    setRecs]    = useState<Recommendation[]>([]);
  // Maps query_id → cluster_name for contextual labels on rec cards
  const [queryClusterMap, setQueryClusterMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  // Dismiss animation: cards fade out before being removed from state
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());

  // 2-second amber pulse on highlighted card, then CSS transition back to white
  const [pulsedId,    setPulsedId]    = useState<string | null>(null);
  const [pulseFading, setPulseFading] = useState(false);

  const cardRefs         = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightFired   = useRef(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  // Scroll + pulse after data loads — fires once per page load
  useEffect(() => {
    if (loading || !highlightId || highlightFired.current) return;
    if (!cardRefs.current.has(highlightId)) return;
    highlightFired.current = true;

    setTimeout(() => {
      cardRefs.current.get(highlightId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPulsedId(highlightId);
      setPulseFading(false);

      setTimeout(() => {
        setPulseFading(true);            // start CSS transition to white
        setTimeout(() => {
          setPulsedId(null);
          setPulseFading(false);
        }, 500);                          // clear after transition completes
      }, 2000);                          // hold amber for 2 seconds
    }, 150);
  }, [loading, highlightId]);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();
    let q = supabase.from("clients").select("*").eq("status", "active");
    if (clientIdParam) q = q.eq("id", clientIdParam);
    const { data: clients } = await q.order("created_at", { ascending: false }).limit(1);
    const activeClient = clients?.[0] ?? null;
    setClient(activeClient);

    if (activeClient) {
      const [{ data: recData }, { data: clusterData }] = await Promise.all([
        supabase.from("recommendations").select("*").eq("client_id", activeClient.id)
          .eq("status", "open").order("priority", { ascending: true }),
        supabase.from("gap_clusters").select("id, cluster_name, run_date")
          .eq("client_id", activeClient.id).order("run_date", { ascending: false }).limit(20),
      ]);
      setRecs((recData ?? []) as Recommendation[]);

      // Build query_id → cluster_name map from the latest run's clusters
      if (clusterData && clusterData.length > 0) {
        const latestDate = (clusterData as { id: string; cluster_name: string; run_date: string }[])[0].run_date;
        const latest = (clusterData as { id: string; cluster_name: string; run_date: string }[]).filter((c) => c.run_date === latestDate);
        const { data: joinRows } = await supabase
          .from("gap_cluster_queries").select("cluster_id, query_id")
          .in("cluster_id", latest.map((c) => c.id)).limit(2000);
        const map = new Map<string, string>();
        for (const row of (joinRows ?? []) as { cluster_id: string; query_id: string }[]) {
          const name = latest.find((c) => c.id === row.cluster_id)?.cluster_name ?? "";
          if (name) map.set(row.query_id, name);
        }
        setQueryClusterMap(map);
      }
    }
    setLoading(false);
  }

  async function dismissRec(id: string) {
    setFadingIds((prev) => new Set([...prev, id]));
    // Fire-and-forget DB update — dismiss is low-stakes, UX comes first
    createClient().from("recommendations").update({ status: "dismissed" }).eq("id", id);
    setTimeout(() => {
      setRecs((prev) => prev.filter((r) => r.id !== id));
      setFadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, 300);
  }

  async function copyBrief(rec: Recommendation) {
    const text = `# ${rec.title}\n\n${rec.description}\n\n## Rationale\n${rec.rationale}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Content brief copied to clipboard");
    } catch {
      toast.error("Clipboard access denied — please copy manually");
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="border border-[#E2E8F0] rounded-lg p-6 bg-white space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        ))}
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <h1 className="text-[28px] font-bold text-[#0D0437]">AEO Roadmap</h1>
        <p className="text-sm text-[#6B7280] mt-2">No active client.</p>
      </div>
    );
  }

  const mostRecentMs = recs.reduce(
    (max, r) => Math.max(max, new Date(r.created_at).getTime()),
    0
  );
  const freqDays = daysUntilNext(mostRecentMs, client.tracking_frequency);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (recs.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight leading-tight">
            AEO Roadmap
          </h1>
          <p className="text-[12px] text-[#9CA3AF] font-mono mt-0.5">0 open actions</p>
        </div>
        <div className="border border-[#E2E8F0] rounded-lg p-12 text-center bg-white">
          <p className="text-[15px] font-semibold text-[#0D0437] mb-2">
            Your first Roadmap is being generated — check back in ~4 hours.
          </p>
          <p className="text-[13px] text-[#6B7280] max-w-md mx-auto leading-relaxed">
            We&apos;re analysing your brand across all models.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-0.5">
        <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight leading-tight">
          AEO Roadmap
        </h1>
        <p className="text-[12px] text-[#9CA3AF] font-mono mt-0.5">
          {recs.length} open action{recs.length !== 1 ? "s" : ""} — prioritised by visibility impact
        </p>
      </div>

      {/* Freshness indicator */}
      {mostRecentMs > 0 && (
        <p className="text-[11px] text-[#9CA3AF] mb-8">
          Last updated: {formatFreshnessDate(mostRecentMs)}
          {freqDays > 0 && (
            <span className="ml-1">
              · Next update in {freqDays} day{freqDays !== 1 ? "s" : ""}
            </span>
          )}
        </p>
      )}

      {/* Recommendation cards */}
      <div className="space-y-4">
        {recs.map((rec) => {
          const isPulsed = pulsedId === rec.id;
          // Amber during active pulse, white during fade-out (CSS transition handles the change)
          const cardBg        = isPulsed && !pulseFading ? "rgba(252,211,77,0.4)" : "white";
          const cardTransition = isPulsed && pulseFading
            ? "background-color 500ms ease, opacity 300ms ease"
            : "opacity 300ms ease";

          return (
            <div
              key={rec.id}
              ref={(el) => {
                if (el) cardRefs.current.set(rec.id, el);
                else cardRefs.current.delete(rec.id);
              }}
              style={{
                backgroundColor: cardBg,
                transition:       cardTransition,
                opacity:          fadingIds.has(rec.id) ? 0 : 1,
              }}
              className="border border-[#E2E8F0] rounded-lg p-6 overflow-hidden"
            >
              {/* Badge row */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${
                    PRIORITY_BADGE[rec.priority] ?? PRIORITY_BADGE_DEFAULT
                  }`}
                >
                  P{rec.priority}
                </span>
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${
                    TYPE_BADGE[rec.type] ?? TYPE_BADGE.content_directive
                  }`}
                >
                  {TYPE_LABELS[rec.type] ?? rec.type}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]">
                  Open
                </span>
                {rec.query_id && queryClusterMap.has(rec.query_id) && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(13,4,55,0.06)] text-[#0D0437] border-[rgba(13,4,55,0.15)]">
                    {queryClusterMap.get(rec.query_id)}
                  </span>
                )}
              </div>

              {/* Title */}
              <h2 className="text-[16px] font-bold text-[#0D0437] leading-snug mb-2">
                {rec.title}
              </h2>

              {/* Description */}
              <p className="text-[13px] text-[#374151] leading-relaxed mb-3">
                {rec.description}
              </p>

              {/* Rationale inset — entire block links to gap clusters */}
              <Link
                href={`/dashboard/share-of-voice${clientIdParam ? `?client=${clientIdParam}` : ""}#gap-clusters`}
                className="block bg-[#F4F6F9] border border-[#E2E8F0] rounded-md px-4 py-3 mb-4 hover:bg-[#EDEEF2] hover:border-[#C7CBD6] transition-colors group"
              >
                <p className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF] mb-1">
                  The Threat
                </p>
                <p className="text-[12px] text-[#6B7280] leading-relaxed">{rec.rationale}</p>
                <span className="inline-block mt-1.5 text-[11px] text-[#9CA3AF] group-hover:text-[#0D0437] transition-colors">
                  See more details →
                </span>
              </Link>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyBrief(rec)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#6B7280] bg-white hover:bg-[#F4F6F9] hover:text-[#0D0437] hover:border-[#0D0437] transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  Copy as Content Brief
                </button>
                <button
                  onClick={() => dismissRec(rec.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#9CA3AF] bg-white hover:bg-[#FFF1F2] hover:text-[#FF4B6E] hover:border-[rgba(255,75,110,0.3)] transition-colors"
                >
                  <X className="h-3 w-3" />
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RoadmapPage() {
  return (
    <Suspense>
      <RoadmapInner />
    </Suspense>
  );
}
