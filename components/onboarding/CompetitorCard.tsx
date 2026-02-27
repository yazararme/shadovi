"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";
import type { Competitor } from "@/types";
import { getRecognitionStatus } from "@/types";

interface Props {
  competitor: Competitor;
  onDelete: (id: string) => void;
  onContextInjectionChange: (id: string, value: string) => void;
}

const badgeConfig = {
  green: {
    variant: "success" as const,
    label: "Recognized",
    desc: "Both GPT-4o and Perplexity know this brand",
  },
  yellow: {
    variant: "warning" as const,
    label: "Partially recognized",
    desc: "Only one model knows this brand",
  },
  red: {
    variant: "danger" as const,
    label: "Not recognized",
    desc: "AI models don't know this brand — add context below",
  },
};

export function CompetitorCard({ competitor, onDelete, onContextInjectionChange }: Props) {
  const status = getRecognitionStatus(competitor.recognition_detail);
  const config = badgeConfig[status];
  const [contextDraft, setContextDraft] = useState(competitor.context_injection ?? "");

  const detail = competitor.recognition_detail;

  return (
    <div className="border border-[#E2E8F0] rounded-lg bg-white p-4 relative group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-[#0D0437]">{competitor.name}</span>
            <Badge variant={config.variant} className="text-xs">
              {config.label}
            </Badge>
          </div>

          {/* Per-model breakdown */}
          {detail && (
            <div className="flex items-center gap-3 mt-1.5">
              <ModelIndicator label="Gemini" recognized={detail.gemini} />
              <ModelIndicator label="Perplexity" recognized={detail.perplexity} />
            </div>
          )}

          {/* Context injection for yellow/red */}
          {(status === "yellow" || status === "red") && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-[#6B7280]">
                {status === "red"
                  ? `AI models don't recognize "${competitor.name}". Add a brief description so comparative queries reflect real competitive tension.`
                  : `Some models don't recognize "${competitor.name}". Adding context improves query accuracy.`}
              </p>
              <Textarea
                value={contextDraft}
                onChange={(e) => setContextDraft(e.target.value)}
                onBlur={() => onContextInjectionChange(competitor.id, contextDraft)}
                placeholder={`e.g. "${competitor.name} is a [category] tool used by [persona] to [use case]"`}
                className="text-xs min-h-[60px] resize-none border-[#E2E8F0] focus-visible:ring-[#0D0437]/20"
              />
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[#9CA3AF] hover:text-[#FF4B6E] hover:bg-transparent"
          onClick={() => onDelete(competitor.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ModelIndicator({ label, recognized }: { label: string; recognized: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div
        className={`h-1.5 w-1.5 rounded-full ${recognized ? "bg-[#1A8F5C]" : "bg-[#FF4B6E]"}`}
      />
      <span className="text-xs text-[#6B7280]">{label}</span>
    </div>
  );
}
