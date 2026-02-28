"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LLMModel, QueryIntent, CitedSource } from "@/types";

interface NarrativePathwayProps {
  queryText: string;
  models: LLMModel[];
  intent: QueryIntent;
  citedSources: CitedSource[];
  competitorsMentioned: string[];
  clientId?: string;
  /** When provided, renders a "View response →" button at bottom-right of the card */
  onViewResponse?: () => void;
}

const MODEL_COLORS: Record<LLMModel, string> = {
  "gpt-4o": "bg-[#10a37f]/10 text-[#10a37f] border-[#10a37f]/30",
  "claude-sonnet-4-6": "bg-[#d4a27e]/10 text-[#d4a27e] border-[#d4a27e]/30",
  "perplexity": "bg-[#1fb6ff]/10 text-[#1fb6ff] border-[#1fb6ff]/30",
  "gemini": "bg-[#4285f4]/10 text-[#4285f4] border-[#4285f4]/30",
  "deepseek": "bg-[#6366f1]/10 text-[#6366f1] border-[#6366f1]/30",
};

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "deepseek": "DeepSeek",
};

const INTENT_LABELS: Record<QueryIntent, string> = {
  problem_aware: "Problem Discovery",
  category: "Category Search",
  comparative: "Comparative",
  validation: "Validation",
};

import { ChevronRight } from "lucide-react";

// Favicon with Google S2 fallback and initial-letter last resort
function FaviconImg({ domain }: { domain: string }) {
  const [errored, setErrored] = useState(false);
  const src = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
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
      alt={domain}
      width={16}
      height={16}
      className="w-4 h-4 rounded-sm shrink-0"
      onError={() => setErrored(true)}
    />
  );
}

export function NarrativePathway({
  queryText,
  models,
  intent,
  citedSources,
  competitorsMentioned,
  onViewResponse,
}: NarrativePathwayProps) {

  return (
    <div
      className={`border border-[#E2E8F0] rounded-lg p-3 space-y-2 bg-white transition-colors${onViewResponse ? " cursor-pointer hover:bg-[rgba(244,246,249,0.7)] hover:border-[#C7CEE0]" : ""}`}
      onClick={onViewResponse}
    >
      {/* Query */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-normal text-[#374151] leading-snug">
          &ldquo;{queryText}&rdquo;
        </p>
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
          {INTENT_LABELS[intent]}
        </span>
      </div>

      {/* Chain */}
      <div className="flex flex-col gap-2 pl-3 border-l-2 border-[#ef4444]/30">
        {/* Model(s) */}
        <div className="flex items-start gap-3">
          <span className="text-xs text-muted-foreground w-24 shrink-0 mt-0.5">model</span>
          <div className="flex gap-1 flex-wrap">
            {models.map((m) => (
              <span
                key={m}
                className={cn(
                  "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium",
                  MODEL_COLORS[m]
                )}
              >
                {MODEL_LABELS[m]}
              </span>
            ))}
          </div>
        </div>

        {/* Mentioned — competitors that appeared in place of the brand */}
        <div className="flex items-start gap-3">
          <span className="text-xs text-muted-foreground w-24 shrink-0 mt-0.5">mentioned</span>
          {competitorsMentioned.length > 0 ? (
            <div className="flex gap-1 flex-wrap">
              {competitorsMentioned.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded border border-[#ef4444]/30 bg-[#ef4444]/10 text-[#ef4444] px-2 py-0.5 text-xs font-medium"
                >
                  {c}
                </span>
              ))}
            </div>
          ) : (
            <span className="inline-flex items-center rounded border border-[#D1D5DB] bg-[#F4F6F9] text-[#9CA3AF] px-2 py-0.5 text-xs font-medium">
              None
            </span>
          )}
        </div>

        {/* Source — favicon icons for each cited source, lined up horizontally */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-24 shrink-0">source</span>
          {citedSources.length > 0 ? (
            <div className="flex items-center gap-1.5">
              {citedSources.map((s, idx) => (
                <div key={`${s.url ?? "unknown"}-${idx}`} title={s.domain} className="shrink-0">
                  <FaviconImg domain={s.domain} />
                </div>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground italic">not available</span>
          )}
        </div>


        {/* View response link — bottom-right, only when callback provided */}
        {onViewResponse && (
          <div className="flex justify-end">
            <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] whitespace-nowrap">
              View response
              <ChevronRight className="h-3 w-3" />
            </span>
          </div>
        )}
      </div>

      {/* TODO: wire up to a specific roadmap task ID before re-enabling this link */}
    </div>
  );
}
