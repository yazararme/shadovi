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
}

const intentConfig: Record<QueryIntent, { label: string; color: string }> = {
  problem_aware: { label: "Problem-Aware", color: "bg-blue-100 text-blue-800 border-blue-200" },
  category: { label: "Category", color: "bg-purple-100 text-purple-800 border-purple-200" },
  comparative: { label: "Comparative", color: "bg-orange-100 text-orange-800 border-orange-200" },
  validation: { label: "Validation", color: "bg-green-100 text-green-800 border-green-200" },
};

export function QueryCard({ query, onRemove, onTextChange }: Props) {
  const [editingText, setEditingText] = useState(false);
  const [draft, setDraft] = useState(query.text);
  const [expanded, setExpanded] = useState(false);
  const config = intentConfig[query.intent];

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
              <Textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={handleTextBlur}
                className="text-sm min-h-[60px] resize-none"
              />
            ) : (
              <p
                onClick={() => setEditingText(true)}
                className="text-sm cursor-text hover:bg-muted/50 rounded px-1 py-0.5 -mx-1"
              >
                {query.text}
              </p>
            )}

            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${config.color}`}
              >
                {config.label}
              </span>
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
