"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { X, ChevronDown } from "lucide-react";
import type { Query, QueryIntent } from "@/types";

interface Props {
  query: Query;
  onRemove: (id: string) => void;
  onTextChange: (id: string, text: string) => void;
  // autoEdit: true opens the textarea immediately (used for newly added queries)
  autoEdit?: boolean;
}

const intentConfig: Record<QueryIntent, { label: string; color: string }> = {
  problem_aware: { label: "Problem-Aware", color: "bg-blue-100 text-blue-800 border-blue-200" },
  category: { label: "Category", color: "bg-purple-100 text-purple-800 border-purple-200" },
  comparative: { label: "Comparative", color: "bg-orange-100 text-orange-800 border-orange-200" },
  validation: { label: "Validation", color: "bg-green-100 text-green-800 border-green-200" },
};

// Attribution badge label logic:
// - source_persona present → show persona name
// - source_persona null + validation intent → "Brand Fact"
// - source_persona null + comparative intent → nothing
// - source_persona null + other → nothing
function getAttributionLabel(query: Query): string | null {
  if (query.source_persona) return query.source_persona;
  if (query.intent === "validation") return "Brand Fact";
  return null;
}

export function QueryCard({ query, onRemove, onTextChange, autoEdit = false }: Props) {
  const [editingText, setEditingText] = useState(autoEdit);
  const [draft, setDraft] = useState(query.text);
  const [expanded, setExpanded] = useState(false);
  const config = intentConfig[query.intent];
  const attributionLabel = getAttributionLabel(query);

  function handleTextBlur() {
    setEditingText(false);
    if (draft !== query.text) {
      onTextChange(query.id, draft);
    }
  }

  return (
    <Card className="relative group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2">
            {/* Query text */}
            {editingText ? (
              <div className="space-y-1.5">
                <Textarea
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Query text"
                  aria-multiline="true"
                  className="text-sm min-h-[60px] resize-none"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleTextBlur}
                    className="text-xs font-semibold text-white bg-[#0D0437] hover:bg-[#1a1150] px-3 py-1.5 rounded-md transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p
                role="button"
                tabIndex={0}
                aria-label="Click to edit query text"
                onClick={() => setEditingText(true)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingText(true); } }}
                className="text-sm cursor-text hover:bg-muted/50 rounded px-1 py-0.5 -mx-1"
              >
                {query.text || <span className="text-[#9CA3AF] italic">Click to add query text…</span>}
              </p>
            )}

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${config.color}`}
              >
                {config.label}
              </span>

              {/* Source persona / Brand Fact attribution badge */}
              {attributionLabel && (
                <span className="inline-flex items-center rounded-md border border-[#E2E8F0] bg-white px-2 py-0.5 text-xs text-[#6B7280]">
                  {attributionLabel}
                </span>
              )}

              {/* Bait indicator — hallucination detection query */}
              {query.is_bait && (
                <span className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                  Bait
                </span>
              )}

              <Badge variant="outline" className="text-xs font-normal capitalize">
                {query.phrasing_style}
              </Badge>
              {query.funnel_stage && (
                <Badge variant="outline" className="text-xs font-normal capitalize">
                  {query.funnel_stage}
                </Badge>
              )}
              {query.relevance_score !== null && (
                <span className="text-xs text-muted-foreground">
                  Score: {query.relevance_score}/10
                </span>
              )}
            </div>

            {/* Expand rationale */}
            {(query.rationale || query.strategic_goal) && (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                  {expanded ? "Hide rationale" : "Why this query?"}
                </button>

                {expanded && (
                  <div className="space-y-2 border-t pt-2 mt-1">
                    {query.rationale && (
                      <div>
                        <p className="text-xs font-medium mb-0.5">Rationale</p>
                        <p className="text-xs text-muted-foreground">{query.rationale}</p>
                      </div>
                    )}
                    {query.strategic_goal && (
                      <div>
                        <p className="text-xs font-medium mb-0.5">Strategic goal</p>
                        <p className="text-xs text-muted-foreground">{query.strategic_goal}</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Remove button */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove query: ${query.text.slice(0, 50)}`}
            className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
            onClick={() => onRemove(query.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
