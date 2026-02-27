"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, GripVertical, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Persona } from "@/types";

interface Props {
  persona: Persona;
  onDelete: (id: string) => void;
}

export function PersonaCard({ persona, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-[#E2E8F0] rounded-lg bg-white p-4 relative group">
      {/* Drag handle — visual only at this stage */}
      <div className="absolute left-3 top-4 text-[#CBD5E1] cursor-grab">
        <GripVertical className="h-4 w-4" />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-[#9CA3AF] hover:text-[#FF4B6E] hover:bg-transparent"
        onClick={() => onDelete(persona.id)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>

      {/* Header */}
      <div className="pl-6 pr-8">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-[#0D0437]">{persona.name}</span>
          <Badge variant="outline" className="text-xs font-normal border-[#E2E8F0] text-[#6B7280]">
            P{persona.priority}
          </Badge>
        </div>
        <p className="text-xs text-[#6B7280]">{persona.role}</p>
      </div>

      {/* Internal monologue preview */}
      <div className="pl-6 pr-4 mt-2">
        <p className="text-sm text-[#6B7280] italic line-clamp-2">
          &ldquo;{persona.internal_monologue}&rdquo;
        </p>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-[#9CA3AF] hover:text-[#0D0437] mt-2 transition-colors"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
          {expanded ? "Less" : "More detail"}
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-[#E2E8F0] pt-3">
            <div>
              <p className="text-xs font-medium text-[#0D0437] mb-1">Pain points</p>
              <ul className="space-y-0.5">
                {persona.pain_points.map((p, i) => (
                  <li key={i} className="text-xs text-[#6B7280] flex gap-2">
                    <span className="text-[#9CA3AF]">–</span><span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-[#0D0437] mb-1">Buying triggers</p>
              <ul className="space-y-0.5">
                {persona.buying_triggers.map((t, i) => (
                  <li key={i} className="text-xs text-[#6B7280] flex gap-2">
                    <span className="text-[#9CA3AF]">–</span><span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium text-[#0D0437] mb-1">Skepticisms</p>
              <ul className="space-y-0.5">
                {persona.skepticisms.map((s, i) => (
                  <li key={i} className="text-xs text-[#6B7280] flex gap-2">
                    <span className="text-[#9CA3AF]">–</span><span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
