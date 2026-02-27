"use client";

import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import type { LLMModel, QueryIntent, CitedSource } from "@/types";

interface NarrativePathwayProps {
  queryText: string;
  model: LLMModel;
  intent: QueryIntent;
  citedSources: CitedSource[];
  competitorsMentioned: string[];
  clientId?: string;
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

export function NarrativePathway({
  queryText,
  model,
  intent,
  citedSources,
  competitorsMentioned,
}: NarrativePathwayProps) {
  const primarySource = citedSources[0];

  return (
    <div className="border rounded-xl p-4 space-y-3 bg-card">
      {/* Query */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground leading-snug">
          &ldquo;{queryText}&rdquo;
        </p>
        <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
          {INTENT_LABELS[intent]}
        </span>
      </div>

      {/* Chain */}
      <div className="flex flex-col gap-2 pl-3 border-l-2 border-[#ef4444]/30">
        {/* Model */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-24 shrink-0">via model</span>
          <span
            className={cn(
              "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium",
              MODEL_COLORS[model]
            )}
          >
            {MODEL_LABELS[model]}
          </span>
        </div>

        {/* Cited instead */}
        <div className="flex items-start gap-3">
          <span className="text-xs text-muted-foreground w-24 shrink-0 mt-0.5">
            cited instead
          </span>
          {primarySource ? (
            <div className="space-y-0.5">
              <a
                href={primarySource.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2"
              >
                {primarySource.domain}
                <ExternalLink className="h-3 w-3" />
              </a>
              {primarySource.snippet && (
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {primarySource.snippet}
                </p>
              )}
            </div>
          ) : competitorsMentioned.length > 0 ? (
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
            <span className="text-xs text-muted-foreground italic">
              No source captured
            </span>
          )}
        </div>

      </div>

      {/* TODO: wire up to a specific roadmap task ID before re-enabling this link */}
    </div>
  );
}
