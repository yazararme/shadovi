"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import type { Recommendation, RecommendationType } from "@/types";

const PRIORITY_CONFIG: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: "bg-[rgba(0,180,216,0.1)]", text: "text-[#0077A8]", label: "P1" },
  2: { bg: "bg-[rgba(123,94,167,0.1)]", text: "text-[#7B5EA7]", label: "P2" },
  3: { bg: "bg-[#F4F6F9]", text: "text-[#6B7280]", label: "P3" },
};

function getPriorityConfig(priority: number) {
  return PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG[3];
}

const TYPE_CONFIG: Record<
  RecommendationType,
  { label: string; typeColor: string; actions: string[] }
> = {
  content_directive: {
    label: "Content Directive",
    typeColor: "bg-[rgba(0,180,216,0.08)] text-[#0077A8]",
    actions: [
      "Identify the specific page or article to create based on the task description.",
      "Research the top-ranking content for this topic to understand the bar.",
      "Publish the content and add internal links from related pages.",
      "Submit the URL to Google Search Console for indexing.",
    ],
  },
  entity_foundation: {
    label: "Entity Foundation",
    typeColor: "bg-[rgba(245,158,11,0.08)] text-[#B45309]",
    actions: [
      "Add or update structured data (JSON-LD schema) on the relevant page.",
      "Create or claim your brand entity on Wikidata and Wikipedia if applicable.",
      "Add entity-defining content (founding year, category, differentiators) to your About page.",
      "Build citations from high-authority domains that LLMs are known to cite.",
    ],
  },
  placement_strategy: {
    label: "Placement Strategy",
    typeColor: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C]",
    actions: [
      "Identify the specific platform or community mentioned in the task.",
      "Create an account or claim your existing presence on that platform.",
      "Contribute 3–5 substantive posts or answers that mention your brand naturally.",
      "Monitor whether the platform's content appears in future LLM responses.",
    ],
  },
};

const STATUS_TRANSITIONS: Record<
  string,
  { label: string; next: string } | null
> = {
  open: { label: "Start Fix", next: "in_progress" },
  in_progress: { label: "Mark Done", next: "done" },
  done: null,
  dismissed: null,
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-[#F4F6F9] text-[#6B7280]",
  in_progress: "bg-[rgba(245,158,11,0.1)] text-[#B45309]",
  done: "bg-[rgba(26,143,92,0.1)] text-[#1A8F5C]",
  dismissed: "bg-[#F4F6F9] text-[#9CA3AF]",
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

function BlueprintInner() {
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelTask, setPanelTask] = useState<Recommendation | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientIdParam]);

  async function loadData() {
    const supabase = createClient();

    let query = supabase.from("clients").select("id").eq("status", "active");
    if (clientIdParam) query = query.eq("id", clientIdParam);
    const { data: clients } = await query
      .order("created_at", { ascending: false })
      .limit(1);

    const id = clients?.[0]?.id ?? null;

    if (id) {
      const { data } = await supabase
        .from("recommendations")
        .select("*")
        .eq("client_id", id)
        .order("priority");
      setRecommendations(data ?? []);
    }

    setLoading(false);
  }

  const updateStatus = useCallback(
    async (recId: string, newStatus: string) => {
      const supabase = createClient();
      await supabase
        .from("recommendations")
        .update({ status: newStatus })
        .eq("id", recId);
      setRecommendations((prev) =>
        prev.map((r) => (r.id === recId ? { ...r, status: newStatus as Recommendation["status"] } : r))
      );
      if (panelTask?.id === recId) {
        setPanelTask((p) => p ? { ...p, status: newStatus as Recommendation["status"] } : null);
      }
    },
    [panelTask]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Roadmap</h1>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-[#E2E8F0] rounded-lg p-5 space-y-3 bg-white">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-12 rounded" />
                <Skeleton className="h-5 w-24 rounded" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Roadmap</h1>
        <div className="border border-[#E2E8F0] rounded-lg p-8 text-center bg-white">
          <p className="text-sm font-bold text-[#0D0437]">No recommendations yet</p>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Run a tracking audit from the Overview tab — recommendations are generated automatically after each run.
          </p>
        </div>
      </div>
    );
  }

  // Group by type for section display
  const grouped: Partial<Record<RecommendationType, Recommendation[]>> = {};
  recommendations.forEach((r) => {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type]!.push(r);
  });

  const typeOrder: RecommendationType[] = [
    "content_directive",
    "entity_foundation",
    "placement_strategy",
  ];

  return (
    <>
      <div className="space-y-2">
        <div className="mb-2">
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            AEO Roadmap
          </h1>
          <p className="font-mono text-[11px] text-[#6B7280] mt-1">
            {recommendations.filter((r) => r.status === "open").length} open actions — prioritised by visibility impact
          </p>
        </div>

        {typeOrder.map((type) => {
          const tasks = grouped[type];
          if (!tasks || tasks.length === 0) return null;
          const config = TYPE_CONFIG[type];

          return (
            <div key={type}>
              <SubLabel>{config.label}</SubLabel>
              <div className="space-y-3">
                {tasks.map((task) => {
                  const transition = STATUS_TRANSITIONS[task.status];
                  const isExpanded = expandedCards.has(task.id);
                  const priConfig = getPriorityConfig(task.priority);
                  const isDone = task.status === "done" || task.status === "dismissed";

                  return (
                    <div
                      key={task.id}
                      className={`border border-[#E2E8F0] rounded-lg bg-white transition-opacity ${
                        isDone ? "opacity-40" : ""
                      }`}
                      tabIndex={0}
                      role="article"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") toggleExpand(task.id);
                      }}
                    >
                      {/* Card body */}
                      <div className="p-5">
                        {/* Header: priority badge + type badge + status + expand toggle */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Priority badge */}
                            <span
                              className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${priConfig.bg} ${priConfig.text}`}
                            >
                              {priConfig.label}
                            </span>
                            {/* Type badge */}
                            <span
                              className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${config.typeColor}`}
                            >
                              {config.label}
                            </span>
                            {/* Status badge */}
                            <span
                              className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${STATUS_BADGE[task.status]}`}
                            >
                              {task.status.replace("_", " ")}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleExpand(task.id)}
                            className="text-[#6B7280] hover:text-[#0D0437] transition-colors shrink-0"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </div>

                        {/* Title */}
                        <p className="text-[15px] font-bold text-[#0D0437] leading-snug mb-2">
                          {task.title}
                        </p>

                        {/* Description — always visible */}
                        <p className="text-[13px] text-[#374151] leading-[1.75]">
                          {task.description}
                        </p>
                      </div>

                      {/* Expanded: rationale + step-by-step */}
                      {isExpanded && (
                        <div className="border-t border-[#E2E8F0] px-5 py-4 space-y-4 bg-[#F4F6F9] rounded-b-lg">
                          {/* Why */}
                          <div>
                            <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-1.5">
                              Why this matters
                            </p>
                            <p className="text-[12px] text-[#6B7280] leading-[1.7]">
                              {task.rationale}
                            </p>
                          </div>

                          {/* How to execute */}
                          <div>
                            <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
                              How to execute
                            </p>
                            <ol className="space-y-2">
                              {config.actions.map((step, i) => (
                                <li key={i} className="flex gap-3">
                                  <span className="h-5 w-5 rounded-full bg-white text-[#0D0437] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 border border-[#E2E8F0]">
                                    {i + 1}
                                  </span>
                                  <span className="text-[12px] text-[#374151] leading-[1.7]">{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        </div>
                      )}

                      {/* Action buttons row */}
                      {!isDone && (
                        <div className="flex gap-2 px-5 pb-4 pt-1">
                          {transition && (
                            <button
                              type="button"
                              onClick={() => setPanelTask(task)}
                              className="text-[11px] font-bold px-3 py-1.5 rounded bg-[#0D0437] text-white hover:bg-[#1a1150] transition-colors"
                            >
                              {transition.label}
                            </button>
                          )}
                          {task.status === "open" && (
                            <button
                              type="button"
                              onClick={() => updateStatus(task.id, "dismissed")}
                              className="text-[11px] font-bold px-3 py-1.5 rounded border border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437] transition-colors"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Side panel ──────────────────────────────────────────────────────── */}
      {panelTask && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setPanelTask(null)}
          />
          {/* Panel */}
          <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white border-l border-[#E2E8F0] shadow-2xl z-50 overflow-y-auto">
            <div className="p-6 space-y-6">
              {/* Panel header */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${getPriorityConfig(panelTask.priority).bg} ${getPriorityConfig(panelTask.priority).text}`}
                    >
                      {getPriorityConfig(panelTask.priority).label}
                    </span>
                    <span
                      className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2 py-0.5 rounded ${TYPE_CONFIG[panelTask.type].typeColor}`}
                    >
                      {TYPE_CONFIG[panelTask.type].label}
                    </span>
                  </div>
                  <h2 className="text-[16px] font-bold text-[#0D0437] leading-snug">
                    {panelTask.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelTask(null)}
                  className="text-[#6B7280] hover:text-[#0D0437] shrink-0 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-[2px] text-[#6B7280]">
                  What to do
                </p>
                <p className="text-[13px] text-[#374151] leading-[1.75]">{panelTask.description}</p>
              </div>

              {/* Rationale */}
              <div className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-[2px] text-[#6B7280]">
                  Why this matters
                </p>
                <p className="text-[12px] text-[#6B7280] leading-[1.7]">
                  {panelTask.rationale}
                </p>
              </div>

              {/* Step-by-step */}
              <div className="space-y-2">
                <p className="text-[9px] font-bold uppercase tracking-[2px] text-[#6B7280]">
                  How to execute
                </p>
                <ol className="space-y-3">
                  {TYPE_CONFIG[panelTask.type].actions.map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="h-5 w-5 rounded-full bg-[#F4F6F9] text-[#0D0437] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5 border border-[#E2E8F0]">
                        {i + 1}
                      </span>
                      <span className="text-[13px] text-[#374151] leading-[1.7]">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Status controls */}
              {STATUS_TRANSITIONS[panelTask.status] && (
                <div className="flex gap-2 pt-4 border-t border-[#E2E8F0]">
                  <button
                    type="button"
                    className="flex-1 text-[12px] font-bold py-2.5 rounded bg-[#0D0437] text-white hover:bg-[#1a1150] transition-colors"
                    onClick={() => {
                      const next = STATUS_TRANSITIONS[panelTask.status]!.next;
                      updateStatus(panelTask.id, next);
                    }}
                  >
                    {STATUS_TRANSITIONS[panelTask.status]!.label}
                  </button>
                  {panelTask.status === "open" && (
                    <button
                      type="button"
                      className="text-[12px] font-bold px-4 py-2.5 rounded border border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437] transition-colors"
                      onClick={() => {
                        updateStatus(panelTask.id, "dismissed");
                        setPanelTask(null);
                      }}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default function BlueprintPage() {
  return (
    <Suspense>
      <BlueprintInner />
    </Suspense>
  );
}
