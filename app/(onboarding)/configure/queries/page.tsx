"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { QueryCard } from "@/components/onboarding/QueryCard";
import { QueryCalibrationChat } from "@/components/onboarding/QueryCalibrationChat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { BrandDNA, LLMModel, Query, QueryIntent } from "@/types";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

const MODEL_COST: Record<string, number> = {
  "gpt-4o": 0.08,
  perplexity: 0.05,
  "claude-sonnet-4-6": 0.09,
  gemini: 0.06,
};

const INTENT_ORDER: QueryIntent[] = ["problem_aware", "category", "comparative", "validation"];
const INTENT_LABELS: Record<QueryIntent, string> = {
  problem_aware: "Problem-Aware",
  category: "Category",
  comparative: "Comparative",
  validation: "Validation",
};

// How long (ms) the "AI added" highlight ring stays visible
const NEW_QUERY_HIGHLIGHT_MS = 4000;

function QueriesPageInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client");
  const router = useRouter();

  const [queries, setQueries] = useState<Query[]>([]);
  const [brandDNA, setBrandDNA] = useState<BrandDNA | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activating, setActivating] = useState(false);

  // Active tab — controlled so the chat panel can read it
  const [activeIntent, setActiveIntent] = useState<QueryIntent>("problem_aware");

  // IDs of queries just added by the AI; cleared after highlight duration
  const [newQueryIds, setNewQueryIds] = useState<Set<string>>(new Set());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load selected models + frequency for cost estimate
  const [selectedModels, setSelectedModels] = useState<LLMModel[]>([]);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");

  useEffect(() => {
    if (!clientId) { router.push("/discover"); return; }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => { if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current); };
  }, []);

  async function loadAll() {
    setLoading(true);
    const supabase = createClient();

    const { data: client } = await supabase
      .from("clients")
      .select("selected_models, tracking_frequency, brand_dna")
      .eq("id", clientId)
      .single();
    if (client?.selected_models?.length) setSelectedModels(client.selected_models);
    if (client?.tracking_frequency) setFrequency(client.tracking_frequency);
    if (client?.brand_dna) setBrandDNA(client.brand_dna as BrandDNA);

    const { data: existing } = await supabase
      .from("queries")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["pending_approval", "active"])
      .order("intent")
      .order("relevance_score", { ascending: false });

    if (existing && existing.length > 0) {
      setQueries(existing);
      setLoading(false);
    } else {
      setLoading(false);
      await generateQueries();
    }
  }

  async function generateQueries() {
    setGenerating(true);
    try {
      const res = await fetch("/api/queries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json();
      if (res.ok) {
        setQueries(data.queries ?? []);
      } else {
        toast.error("Query generation failed: " + data.error);
      }
    } catch {
      toast.error("Network error during query generation");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRemoveQuery(queryId: string) {
    const supabase = createClient();
    await supabase.from("queries").update({ status: "removed" }).eq("id", queryId);
    setQueries((prev) => prev.filter((q) => q.id !== queryId));
  }

  async function handleTextChange(queryId: string, text: string) {
    const supabase = createClient();
    await supabase.from("queries").update({ text }).eq("id", queryId);
    setQueries((prev) => prev.map((q) => (q.id === queryId ? { ...q, text } : q)));
  }

  // AI added new queries — merge into state and trigger highlight
  function handleAIAdd(added: Query[]) {
    setQueries((prev) => {
      // De-duplicate in case of double-fire
      const existingIds = new Set(prev.map((q) => q.id));
      const fresh = added.filter((q) => !existingIds.has(q.id));
      return [...prev, ...fresh];
    });

    // Highlight the new IDs, then fade after timeout
    const ids = new Set(added.map((q) => q.id));
    setNewQueryIds((prev) => new Set([...prev, ...ids]));

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setNewQueryIds(new Set());
    }, NEW_QUERY_HIGHLIGHT_MS);

    // Switch to the tab of the first added query so the user sees the change
    if (added[0]?.intent) setActiveIntent(added[0].intent);
  }

  // AI removed queries — drop them from state
  function handleAIRemove(ids: string[]) {
    const removed = new Set(ids);
    setQueries((prev) => prev.filter((q) => !removed.has(q.id)));
  }

  async function handleActivate() {
    const activeQueries = queries.filter(
      (q) => q.status === "pending_approval" || q.status === "active"
    );
    if (activeQueries.length === 0) {
      toast.error("At least one query is required");
      return;
    }

    setActivating(true);

    // Creates portfolio version 1, stamps query version_ids, and activates client.
    // Version creation must complete before the tracking run fires so the runner
    // can read version_id from queries and stamp it on tracking_runs.
    const activateRes = await fetch("/api/versioning/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });

    setActivating(false);

    if (!activateRes.ok) {
      const body = await activateRes.json();
      toast.error("Failed to activate: " + (body.error ?? activateRes.statusText));
      return;
    }

    // Don't await — first tracking run happens async in the background
    fetch("/api/tracking/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    router.push("/overview");
  }

  const activeCount = queries.filter((q) => q.status !== "removed").length;
  const runsPerMonth = frequency === "daily" ? 30 : frequency === "weekly" ? 4 : 1;
  const estimatedCost = selectedModels.reduce((total, modelId) => {
    return total + (MODEL_COST[modelId] ?? 0) * activeCount * runsPerMonth;
  }, 0);

  const queriesByIntent = INTENT_ORDER.reduce<Record<QueryIntent, Query[]>>(
    (acc, intent) => {
      acc[intent] = queries.filter((q) => q.intent === intent && q.status !== "removed");
      return acc;
    },
    {} as Record<QueryIntent, Query[]>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="text-[13px] text-[#6B7280]">Loading…</div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    );
  }

  if (generating) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-[13px] text-[#6B7280]">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Generating your query portfolio… this takes 1–2 minutes.
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border border-[#E2E8F0] rounded-lg bg-white p-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header — full width */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
            Query Portfolio
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-1">
            Remove queries that aren&apos;t relevant. Use the AI panel to calibrate — it updates the list live.
          </p>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => router.push(`/configure/facts?client=${clientId}`)}
            className="text-[13px] text-[#6B7280] hover:text-[#0D0437] transition-colors"
          >
            ← Go Back
          </button>
          <Button
            onClick={handleActivate}
            disabled={activating}
            className="bg-[#0D0437] hover:bg-[#1a1150] text-white"
          >
            {activating ? "Activating…" : "Activate Tracking →"}
          </Button>
        </div>
      </div>

      {/* Stats + regenerate — full width */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={generateQueries}
          disabled={generating}
          className="border-[#E2E8F0] text-[#0D0437] hover:border-[#0D0437]/40"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
          Regenerate All
        </Button>
        <div className="text-right">
          <p className="text-[11px] text-[#6B7280]">
            {activeCount} queries · {selectedModels.length} models · {runsPerMonth}×/month
          </p>
          <p className="text-sm font-semibold text-[#0D0437]">~${estimatedCost.toFixed(2)}/month</p>
        </div>
      </div>

      {/* 2-column: query list (left) + AI calibration panel (right) */}
      <div className="grid grid-cols-[1fr_360px] gap-6 items-start">
        {/* Left: tabs + query cards */}
        <div>
          <Tabs
            value={activeIntent}
            onValueChange={(v) => setActiveIntent(v as QueryIntent)}
          >
            <TabsList className="w-full bg-[#F4F6F9] border border-[#E2E8F0]">
              {INTENT_ORDER.map((intent) => (
                <TabsTrigger
                  key={intent}
                  value={intent}
                  className="flex-1 data-[state=active]:bg-white data-[state=active]:text-[#0D0437] data-[state=active]:shadow-none text-[#6B7280]"
                >
                  {INTENT_LABELS[intent]}
                  <Badge
                    variant="secondary"
                    className="ml-1.5 text-xs bg-[#E2E8F0] text-[#6B7280]"
                  >
                    {queriesByIntent[intent].length}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>

            {INTENT_ORDER.map((intent) => (
              <TabsContent key={intent} value={intent} className="space-y-3 mt-4">
                {queriesByIntent[intent].length === 0 ? (
                  <div className="border border-dashed border-[#E2E8F0] rounded-lg p-6 text-center">
                    <p className="text-[13px] text-[#9CA3AF]">
                      No {INTENT_LABELS[intent]} queries.
                    </p>
                    <p className="text-[11px] text-[#9CA3AF] mt-1">
                      Ask the AI panel to add some →
                    </p>
                  </div>
                ) : (
                  queriesByIntent[intent].map((q) => (
                    // Highlight ring for AI-added queries — fades after NEW_QUERY_HIGHLIGHT_MS
                    <div
                      key={q.id}
                      className={
                        newQueryIds.has(q.id)
                          ? "rounded-lg ring-2 ring-[#7B5EA7] ring-offset-1 transition-all duration-300"
                          : "rounded-lg transition-all duration-300"
                      }
                    >
                      <QueryCard
                        query={q}
                        onRemove={handleRemoveQuery}
                        onTextChange={handleTextChange}
                      />
                    </div>
                  ))
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>

        {/* Right: sticky AI calibration chat */}
        <div className="sticky top-6 h-[calc(100vh-220px)] min-h-[520px]">
          <QueryCalibrationChat
            clientId={clientId!}
            brandDNA={brandDNA}
            currentQueries={queries}
            activeIntent={activeIntent}
            onAdd={handleAIAdd}
            onRemove={handleAIRemove}
          />
        </div>
      </div>
    </div>
  );
}

export default function QueriesPage() {
  return (
    <Suspense>
      <QueriesPageInner />
    </Suspense>
  );
}
