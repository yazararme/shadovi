"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useClientContext } from "@/context/ClientContext";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, X, Play, Check } from "lucide-react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface BatchGroup {
  batchId: string | null;
  recs: Recommendation[];
  generatedAt: string | null;
  mentionRate: number | null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBatchDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
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

// ─── Rec card ─────────────────────────────────────────────────────────────────

function RecCard({
  rec,
  clientIdParam,
  queryClusterMap,
  isFading,
  isPulsed,
  pulseFading,
  cardRef,
  onCopy,
  onDismiss,
  onStart,
  onMarkDone,
}: {
  rec: Recommendation;
  clientIdParam: string | null;
  queryClusterMap: Map<string, string>;
  isFading: boolean;
  isPulsed: boolean;
  pulseFading: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  onCopy: () => void;
  onDismiss: () => void;
  onStart: () => void;
  onMarkDone: () => void;
}) {
  const cardBg        = isPulsed && !pulseFading ? "rgba(252,211,77,0.4)" : "white";
  const cardTransition = isPulsed && pulseFading
    ? "background-color 500ms ease, opacity 300ms ease"
    : "opacity 300ms ease";

  // Cluster label: prefer the column backfilled during generation, fall back to
  // the live queryClusterMap built from the latest run's gap_cluster_queries join.
  const clusterLabel = rec.source_cluster_name
    ?? (rec.query_id ? queryClusterMap.get(rec.query_id) : undefined);

  return (
    <div
      ref={cardRef}
      style={{
        backgroundColor: cardBg,
        transition:       cardTransition,
        opacity:          isFading ? 0 : 1,
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
        {rec.status === "in_progress" ? (
          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(0,180,216,0.08)] text-[#0077A8] border-[rgba(0,180,216,0.2)]">
            In Progress
          </span>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]">
            Open
          </span>
        )}
        {clusterLabel && (
          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border bg-[rgba(13,4,55,0.06)] text-[#0D0437] border-[rgba(13,4,55,0.15)]">
            {clusterLabel}
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

      {/* Rationale inset */}
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
          onClick={onCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#6B7280] bg-white hover:bg-[#F4F6F9] hover:text-[#0D0437] hover:border-[#0D0437] transition-colors"
        >
          <Copy className="h-3 w-3" />
          Copy as Content Brief
        </button>

        {rec.status === "in_progress" ? (
          <button
            onClick={onMarkDone}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#9CA3AF] bg-white hover:bg-[rgba(26,143,92,0.08)] hover:text-[#1A8F5C] hover:border-[rgba(26,143,92,0.3)] transition-colors"
          >
            <Check className="h-3 w-3" />
            Mark Done
          </button>
        ) : (
          <>
            <button
              onClick={onStart}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#9CA3AF] bg-white hover:bg-[rgba(0,180,216,0.08)] hover:text-[#0077A8] hover:border-[rgba(0,180,216,0.3)] transition-colors"
            >
              <Play className="h-3 w-3" />
              Start
            </button>
            <button
              onClick={onDismiss}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold border border-[#E2E8F0] text-[#9CA3AF] bg-white hover:bg-[#FFF1F2] hover:text-[#FF4B6E] hover:border-[rgba(255,75,110,0.3)] transition-colors"
            >
              <X className="h-3 w-3" />
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  generatedAt,
  mentionRate,
}: {
  label: string;
  count: number;
  generatedAt?: string | null;
  mentionRate?: number | null;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF]">
        {label}
      </span>
      <span className="text-[10px] text-[#C4C9D4]">
        {count} action{count !== 1 ? "s" : ""}
      </span>
      {generatedAt && (
        <span className="text-[10px] text-[#C4C9D4]">· {formatBatchDate(generatedAt)}</span>
      )}
      {mentionRate !== null && mentionRate !== undefined && (
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">
          {mentionRate}% mention rate at generation
        </span>
      )}
      <div className="flex-1 h-px bg-[#F0F1F4]" />
    </div>
  );
}

// ─── Page inner ───────────────────────────────────────────────────────────────

function RoadmapInner() {
  const searchParams = useSearchParams();
  const { activeClientId: clientIdParam } = useClientContext();
  const highlightId = searchParams.get("highlight");

  const [client,  setClient]  = useState<Client | null>(null);
  const [recs,    setRecs]    = useState<Recommendation[]>([]);
  const [queryClusterMap, setQueryClusterMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const [fadingIds,   setFadingIds]   = useState<Set<string>>(new Set());
  const [pulsedId,    setPulsedId]    = useState<string | null>(null);
  const [pulseFading, setPulseFading] = useState(false);

  const cardRefs       = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightFired = useRef(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  useEffect(() => {
    if (loading || !highlightId || highlightFired.current) return;
    if (!cardRefs.current.has(highlightId)) return;
    highlightFired.current = true;

    setTimeout(() => {
      cardRefs.current.get(highlightId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPulsedId(highlightId);
      setPulseFading(false);
      setTimeout(() => {
        setPulseFading(true);
        setTimeout(() => { setPulsedId(null); setPulseFading(false); }, 500);
      }, 2000);
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
        // Fetch open + in_progress recs; dismissed and done are excluded
        supabase
          .from("recommendations")
          .select("*")
          .eq("client_id", activeClient.id)
          .in("status", ["open", "in_progress"])
          .order("created_at", { ascending: false }),
        supabase
          .from("gap_clusters")
          .select("id, cluster_name, run_date")
          .eq("client_id", activeClient.id)
          .order("run_date", { ascending: false })
          .limit(20),
      ]);

      setRecs((recData ?? []) as Recommendation[]);

      // Build query_id → cluster_name fallback for legacy recs without source_cluster_name
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

  // ── Rec actions ────────────────────────────────────────────────────────────

  async function dismissRec(id: string) {
    setFadingIds((prev) => new Set([...prev, id]));
    createClient().from("recommendations").update({ status: "dismissed" }).eq("id", id);
    setTimeout(() => {
      setRecs((prev) => prev.filter((r) => r.id !== id));
      setFadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, 300);
  }

  async function startRec(id: string) {
    createClient().from("recommendations").update({ status: "in_progress" }).eq("id", id);
    setRecs((prev) => prev.map((r) => r.id === id ? { ...r, status: "in_progress" } : r));
  }

  async function markDoneRec(id: string) {
    setFadingIds((prev) => new Set([...prev, id]));
    createClient().from("recommendations").update({ status: "done" }).eq("id", id);
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

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto space-y-6">
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
      <div className="p-8 max-w-[1000px] mx-auto">
        <h1 className="text-[28px] font-bold text-[#0D0437]">AEO Roadmap</h1>
        <p className="text-sm text-[#6B7280] mt-2">No active client.</p>
      </div>
    );
  }

  // ── Derive sections ────────────────────────────────────────────────────────

  const inProgressRecs = recs.filter((r) => r.status === "in_progress");
  const openRecs       = recs.filter((r) => r.status === "open");

  // Group open recs by batch_id, then sort batches most-recent-first
  const batchMap = new Map<string | null, Recommendation[]>();
  for (const r of openRecs) {
    const bid = r.batch_id ?? null;
    if (!batchMap.has(bid)) batchMap.set(bid, []);
    batchMap.get(bid)!.push(r);
  }

  const batches: BatchGroup[] = Array.from(batchMap.entries())
    .map(([batchId, batchRecs]) => ({
      batchId,
      recs: [...batchRecs].sort((a, b) => a.priority - b.priority),
      // generated_from_run_at is the canonical batch timestamp; fall back to created_at
      generatedAt: batchRecs[0]?.generated_from_run_at ?? batchRecs[0]?.created_at ?? null,
      mentionRate: batchRecs[0]?.mention_rate_at_generation ?? null,
    }))
    .sort((a, b) => {
      const at = a.generatedAt ? new Date(a.generatedAt).getTime() : 0;
      const bt = b.generatedAt ? new Date(b.generatedAt).getTime() : 0;
      return bt - at;
    });

  const currentBatch    = batches[0] ?? null;
  const previousBatches = batches.slice(1);

  const mostRecentMs = recs.reduce(
    (max, r) => Math.max(max, new Date(r.created_at).getTime()),
    0
  );
  const freqDays = daysUntilNext(mostRecentMs, client.tracking_frequency);

  const totalVisible = inProgressRecs.length + openRecs.length;

  // ── Empty state ────────────────────────────────────────────────────────────
  if (totalVisible === 0) {
    return (
      <div className="p-8 max-w-[1000px] mx-auto">
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

  // ── Main render ────────────────────────────────────────────────────────────

  function renderCard(rec: Recommendation) {
    return (
      <RecCard
        key={rec.id}
        rec={rec}
        clientIdParam={clientIdParam}
        queryClusterMap={queryClusterMap}
        isFading={fadingIds.has(rec.id)}
        isPulsed={pulsedId === rec.id}
        pulseFading={pulseFading}
        cardRef={(el) => {
          if (el) cardRefs.current.set(rec.id, el);
          else cardRefs.current.delete(rec.id);
        }}
        onCopy={() => copyBrief(rec)}
        onDismiss={() => dismissRec(rec.id)}
        onStart={() => startRec(rec.id)}
        onMarkDone={() => markDoneRec(rec.id)}
      />
    );
  }

  return (
    <div className="p-8 max-w-[1000px] mx-auto">
      {/* Header */}
      <div className="mb-0.5">
        <h1 className="text-[28px] font-bold text-[#0D0437] tracking-tight leading-tight">
          AEO Roadmap
        </h1>
        <p className="text-[12px] text-[#9CA3AF] font-mono mt-0.5">
          {totalVisible} action{totalVisible !== 1 ? "s" : ""} — prioritised by visibility impact
        </p>
      </div>

      {mostRecentMs > 0 && (
        <p className="text-[11px] text-[#9CA3AF] mb-8">
          Last updated: {formatBatchDate(new Date(mostRecentMs).toISOString())}
          {freqDays > 0 && (
            <span className="ml-1">
              · Next update in {freqDays} day{freqDays !== 1 ? "s" : ""}
            </span>
          )}
        </p>
      )}

      <div className="space-y-10">

        {/* ── Section 1: In Progress ──────────────────────────────────────── */}
        {inProgressRecs.length > 0 && (
          <section>
            <SectionHeader label="In Progress" count={inProgressRecs.length} />
            <div className="space-y-4">{inProgressRecs.map(renderCard)}</div>
          </section>
        )}

        {/* ── Section 2: Current batch ────────────────────────────────────── */}
        {currentBatch && (
          <section>
            <SectionHeader
              label="Current"
              count={currentBatch.recs.length}
              generatedAt={currentBatch.generatedAt}
              mentionRate={currentBatch.mentionRate}
            />
            <div className="space-y-4">{currentBatch.recs.map(renderCard)}</div>
          </section>
        )}

        {/* ── Section 3: Previous batches ─────────────────────────────────── */}
        {previousBatches.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[#9CA3AF]">
                Previous Batches
              </span>
              <div className="flex-1 h-px bg-[#F0F1F4]" />
            </div>
            <div className="space-y-8">
              {previousBatches.map((batch, idx) => (
                <div key={batch.batchId ?? `legacy-${idx}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[10px] text-[#9CA3AF]">
                      {formatBatchDate(batch.generatedAt)}
                    </span>
                    {batch.mentionRate !== null && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#9CA3AF] border border-[#E2E8F0]">
                        {batch.mentionRate}% mention rate
                      </span>
                    )}
                    <span className="text-[9px] text-[#C4C9D4]">
                      {batch.recs.length} action{batch.recs.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="space-y-4 opacity-75">
                    {batch.recs.map(renderCard)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
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
