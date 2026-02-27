"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ModelIntentHeatmap,
  type HeatmapRow,
} from "@/components/dashboard/ModelIntentHeatmap";
import { Skeleton } from "@/components/ui/skeleton";
import type { Client, TrackingRun, Competitor, LLMModel, QueryIntent } from "@/types";

type EnrichedRun = TrackingRun & {
  query_text: string;
  query_intent: QueryIntent;
};

// Unaided visibility covers only unprompted discovery intents.
// Comparative and validation data is still fetched in enrichedRuns — reserved for future sections.
const UNAIDED_INTENTS: QueryIntent[] = ["problem_aware", "category"];

const INTENT_OPTIONS: { value: QueryIntent | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "problem_aware", label: "Problem Discovery" },
  { value: "category", label: "Category Search" },
];

const INTENT_DESCRIPTIONS: Partial<Record<QueryIntent, string>> = {
  problem_aware:
    "Problem Discovery: Tracks whether your brand appears when buyers describe a challenge without naming a solution category.",
  category:
    "Category Search: Tracks whether your brand appears when buyers search for a type of product or service.",
};

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "deepseek": "DeepSeek",
};

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mt-10 mb-3">
      <span className="text-[11px] font-bold tracking-[2.5px] uppercase text-[#0D0437] whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-[#E2E8F0]" />
    </div>
  );
}

function CompetitiveInner() {
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client");
  const [client, setClient] = useState<Client | null>(null);
  const [enrichedRuns, setEnrichedRuns] = useState<EnrichedRun[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [intentFilter, setIntentFilter] = useState<QueryIntent | "all">("all");
  const [loading, setLoading] = useState(true);

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
      const [{ data: runs }, { data: queries }, { data: comps }] = await Promise.all([
        supabase.from("tracking_runs").select("*").eq("client_id", activeClient.id).limit(10000),
        supabase.from("queries").select("id, text, intent").eq("client_id", activeClient.id).limit(2000),
        supabase.from("competitors").select("*").eq("client_id", activeClient.id).order("name"),
      ]);

      const queryMap = Object.fromEntries((queries ?? []).map((q) => [q.id, q]));
      const enriched = (runs ?? []).map((r) => ({
        ...r,
        query_text: queryMap[r.query_id]?.text ?? "",
        query_intent: (queryMap[r.query_id]?.intent ?? "problem_aware") as QueryIntent,
      }));
      setEnrichedRuns(enriched);
      setCompetitors(comps ?? []);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Unaided Visibility</h1>
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!client || enrichedRuns.length < 10) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight">Unaided Visibility</h1>
        <p className="text-sm text-[#6B7280]">
          {enrichedRuns.length === 0
            ? "Run your first audit from the Overview tab to see visibility data."
            : "Need 10+ tracking runs to surface visibility patterns."}
        </p>
      </div>
    );
  }

  const trackedModels = (client.selected_models ?? []) as LLMModel[];
  const brandName = client.brand_dna?.brand_name ?? client.brand_name ?? "Your Brand";

  // Scope to unaided intents only; comparative + validation data stays in enrichedRuns for future sections
  const unaidedRuns = enrichedRuns.filter((r) => UNAIDED_INTENTS.includes(r.query_intent));
  const filteredRuns =
    intentFilter === "all" ? unaidedRuns : unaidedRuns.filter((r) => r.query_intent === intentFilter);

  // Build heatmap rows
  const heatmapRows: HeatmapRow[] = [
    { name: brandName, isBrand: true, byModel: {} },
    ...competitors.map((c) => ({ name: c.name, isBrand: false, byModel: {} })),
  ];

  for (const model of trackedModels) {
    const modelRuns = filteredRuns.filter((r) => r.model === model);
    const total = modelRuns.length;
    if (total === 0) continue;

    const brandMentioned = modelRuns.filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative").length;
    heatmapRows[0].byModel[model] = {
      mentionRate: Math.round((brandMentioned / total) * 100),
      isPrimary: false,
      topQueries: modelRuns
        .filter((r) => r.brand_mentioned && r.mention_sentiment !== "negative")
        .slice(0, 2)
        .map((r) => r.query_text),
    };

    competitors.forEach((comp, idx) => {
      const compRuns = modelRuns.filter((r) => (r.competitors_mentioned ?? []).includes(comp.name));
      heatmapRows[idx + 1].byModel[model] = {
        mentionRate: Math.round((compRuns.length / total) * 100),
        isPrimary: false,
        topQueries: compRuns.slice(0, 2).map((r) => r.query_text),
      };
    });

    let maxRate = 0;
    let primaryIdx = 0;
    heatmapRows.forEach((row, i) => {
      const rate = row.byModel[model]?.mentionRate ?? 0;
      if (rate > maxRate) { maxRate = rate; primaryIdx = i; }
    });
    if (maxRate > 0) heatmapRows[primaryIdx].byModel[model]!.isPrimary = true;
  }

  // Competitor gaps
  type CompetitorGap = { name: string; winCount: number; queryTexts: string[]; models: string[] };
  const compGaps: Record<string, CompetitorGap> = {};
  filteredRuns.forEach((r) => {
    if (r.brand_mentioned) return;
    (r.competitors_mentioned ?? []).forEach((comp) => {
      if (!compGaps[comp]) compGaps[comp] = { name: comp, winCount: 0, queryTexts: [], models: [] };
      compGaps[comp].winCount++;
      if (!compGaps[comp].queryTexts.includes(r.query_text)) compGaps[comp].queryTexts.push(r.query_text);
      if (!compGaps[comp].models.includes(r.model)) compGaps[comp].models.push(r.model);
    });
  });
  const compGapList = Object.values(compGaps).sort((a, b) => b.winCount - a.winCount);

  return (
    <div>
      <div className="mb-2">
        <h1 className="font-serif text-[32px] font-semibold text-[#0D0437] tracking-tight leading-tight">
          Unaided Visibility
        </h1>
        <p className="font-mono text-[11px] text-[#6B7280] mt-1">
          LLM mention rates for unprompted discovery queries — your brand vs. competitors. Crown = primary citation per model.
        </p>
      </div>

      {/* Intent filter pills */}
      <div className="pt-2 space-y-2">
        <div className="flex gap-2 flex-wrap">
          {INTENT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setIntentFilter(value)}
              className={`rounded-full border px-4 py-1.5 text-[11px] font-bold transition-colors ${intentFilter === value
                  ? "bg-[#0D0437] text-white border-[#0D0437]"
                  : "border-[#E2E8F0] text-[#6B7280] hover:border-[#0D0437] hover:text-[#0D0437]"
                }`}
            >
              {label}
            </button>
          ))}
        </div>
        {intentFilter !== "all" && INTENT_DESCRIPTIONS[intentFilter as QueryIntent] && (
          <p className="text-[12px] text-[#6B7280] leading-[1.65]">
            {INTENT_DESCRIPTIONS[intentFilter as QueryIntent]}
          </p>
        )}
      </div>

      {/* Heatmap */}
      <SubLabel>Share of Model Heatmap</SubLabel>
      <div className="mb-6"><ModelIntentHeatmap rows={heatmapRows} models={trackedModels} /></div>

      {/* Competitor displacement table */}
      {compGapList.length > 0 && (
        <>
          <SubLabel>Competitor Displacement</SubLabel>
          <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-[#F4F6F9]">
                  {["Competitor", "Displacement Count", "Models", "Sample Query"].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280]"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compGapList.map((comp) => (
                  <tr key={comp.name} className="border-b last:border-0 hover:bg-[rgba(244,246,249,0.7)]">
                    <td className="px-4 py-3 font-bold text-[14px] text-[#0D0437]">{comp.name}</td>
                    <td className="px-4 py-3">
                      {/* Circular gap-count badge */}
                      <div className="w-8 h-8 rounded-full bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] font-bold text-[12px] flex items-center justify-center">
                        {comp.winCount}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {comp.models.map((m) => (
                          <span
                            key={m}
                            className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#0D0437] border border-[#E2E8F0]"
                          >
                            {MODEL_LABELS[m as LLMModel] ?? m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-[11px] text-[#6B7280] italic whitespace-normal break-words">
                        &ldquo;{comp.queryTexts[0]}&rdquo;
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function CompetitivePage() {
  return (
    <Suspense>
      <CompetitiveInner />
    </Suspense>
  );
}
