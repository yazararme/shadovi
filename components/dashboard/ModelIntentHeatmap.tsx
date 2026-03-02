"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Crown } from "lucide-react";
import type { LLMModel } from "@/types";

export interface HeatmapCell {
  mentionRate: number; // 0–100
  isPrimary: boolean;  // crown = highest mention rate in this column
  topQueries: string[]; // shown on hover
}

export interface HeatmapRow {
  name: string;
  isBrand: boolean;
  /** True for meta-rows like "No Brand Visible" — excluded from crown, use gray coloring */
  isSpecialRow?: boolean;
  byModel: Partial<Record<LLMModel, HeatmapCell>>;
}

interface ModelIntentHeatmapProps {
  rows: HeatmapRow[];
  models: LLMModel[];
}

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "deepseek": "DeepSeek",
};

function cellColor(rate: number): string {
  // Neutral blue gradient — intensity encodes magnitude, no editorial signal.
  const alpha = rate === 0 ? 0.04 : 0.08 + (rate / 100) * 0.82;
  return `rgba(59,130,246,${alpha.toFixed(2)})`;
}

// Gray gradient for special rows (e.g. "No Brand Visible") — visually distinct, not part of color distribution.
function specialCellColor(rate: number): string {
  const alpha = rate === 0 ? 0.03 : 0.05 + (rate / 100) * 0.18;
  return `rgba(156,163,175,${alpha.toFixed(2)})`;
}

function cellTextColor(rate: number): string {
  return rate > 50 ? "text-foreground" : "text-muted-foreground";
}

export function ModelIntentHeatmap({ rows, models }: ModelIntentHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{
    rowIdx: number;
    model: LLMModel;
  } | null>(null);

  if (rows.length === 0 || models.length === 0) {
    return (
      <div className="border rounded-xl p-8 text-center text-sm text-muted-foreground">
        No tracking data yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[500px] text-sm">
        <thead>
          <tr className="border-b bg-muted/30">
            {/* Sticky competitor name column */}
            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider sticky left-0 bg-muted/30 min-w-[140px]">
              Entity
            </th>
            {models.map((m) => (
              <th
                key={m}
                className="text-center px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[100px]"
              >
                {MODEL_LABELS[m]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr
              key={row.name}
              className={cn(
                "border-b last:border-0",
                row.isBrand && "font-medium",
                row.isSpecialRow && "border-t-2 border-t-[#D1D5DB]"
              )}
            >
              {/* Entity name — sticky. Brand row gets coral left border; special rows are italic/muted. */}
              <td
                className="py-3 sticky left-0 bg-card text-sm truncate max-w-[140px]"
                style={row.isBrand
                  ? { paddingLeft: "12px", borderLeft: "3px solid #FF6B6B" }
                  : { paddingLeft: "16px", borderLeft: "3px solid transparent" }
                }
              >
                <span className={cn("truncate", row.isSpecialRow && "italic text-muted-foreground")}>
                  {row.name}
                </span>
              </td>

              {/* One cell per model */}
              {models.map((model) => {
                const cell = row.byModel[model];
                const rate = cell?.mentionRate ?? 0;
                const isHovered =
                  hoveredCell?.rowIdx === rowIdx &&
                  hoveredCell?.model === model;

                return (
                  <td
                    key={model}
                    className="px-4 py-3 text-center relative"
                    style={{
                      backgroundColor: row.isSpecialRow ? specialCellColor(rate) : cellColor(rate),
                    }}
                    onMouseEnter={() =>
                      setHoveredCell({ rowIdx, model })
                    }
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center gap-1 text-xs font-medium",
                        row.isSpecialRow ? "text-muted-foreground" : cellTextColor(rate)
                      )}
                    >
                      {rate > 0 && cell?.isPrimary && (
                        <Crown className="h-3 w-3 text-[#eab308]" />
                      )}
                      <span>{rate}%</span>
                    </div>

                    {/* Hover tooltip — flip below for first two rows to avoid clipping */}
                    {isHovered && cell && cell.topQueries.length > 0 && (
                      <div className={cn(
                        "absolute z-50 left-1/2 -translate-x-1/2 w-64 bg-popover border rounded-lg shadow-lg p-3 text-left pointer-events-none",
                        rowIdx < 2 ? "top-full mt-2" : "bottom-full mb-2"
                      )}>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">
                          Top queries
                        </p>
                        {cell.topQueries.map((q, i) => (
                          <p
                            key={i}
                            className="text-xs text-foreground line-clamp-2 mb-1 last:mb-0"
                          >
                            &ldquo;{q}&rdquo;
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
