"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Minus, Plus, RefreshCw, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import type { Query, QueryIntent } from "@/types";

// ── Intent metadata ──────────────────────────────────────────────────────────

type IntentMeta = {
  key: QueryIntent;
  label: string;
  description: string;
  color: string;      // solid colour for dot, bar segment, number
  colorBg: string;    // light background for the slider row highlight
};

const INTENT_META: IntentMeta[] = [
  {
    key: "problem_aware",
    label: "Problem-Aware",
    description: "Early funnel — buyer has the pain, no brand awareness yet",
    color: "#1FB6FF",
    colorBg: "rgba(31,182,255,0.08)",
  },
  {
    key: "category",
    label: "Category",
    description: "Mid funnel — buyer is exploring solution categories",
    color: "#0D0437",
    colorBg: "rgba(13,4,55,0.06)",
  },
  {
    key: "comparative",
    label: "Comparative",
    description: "Mid-to-late funnel — named brand comparisons",
    color: "#7B5EA7",
    colorBg: "rgba(123,94,167,0.08)",
  },
  {
    key: "validation",
    label: "Validation",
    description: "Late funnel — buyer is evaluating fit and verifying claims",
    color: "#1A8F5C",
    colorBg: "rgba(26,143,92,0.08)",
  },
];

// ── Presets ───────────────────────────────────────────────────────────────────

type Counts = Record<QueryIntent, number>;

const PRESETS: { label: string; counts: Counts }[] = [
  { label: "Balanced",           counts: { problem_aware: 10, category: 10, comparative: 10, validation: 10 } },
  { label: "Competitive Focus",  counts: { problem_aware: 6,  category: 10, comparative: 18, validation: 6 } },
  { label: "Brand Defender",     counts: { problem_aware: 6,  category: 6,  comparative: 8,  validation: 20 } },
];

function matchesPreset(counts: Counts): string | null {
  for (const p of PRESETS) {
    if (
      p.counts.problem_aware === counts.problem_aware &&
      p.counts.category === counts.category &&
      p.counts.comparative === counts.comparative &&
      p.counts.validation === counts.validation
    ) {
      return p.label;
    }
  }
  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

interface QueryVolumeModalProps {
  open: boolean;
  onClose: () => void;
  currentCounts: Counts;
  clientId: string;
  onRegenerated: (queries: Query[]) => void;
}

export function QueryVolumeModal({
  open,
  onClose,
  currentCounts,
  clientId,
  onRegenerated,
}: QueryVolumeModalProps) {
  const [counts, setCounts] = useState<Counts>({ ...currentCounts });
  const [generating, setGenerating] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync internal state when modal opens with fresh currentCounts
  useEffect(() => {
    if (open) setCounts({ ...currentCounts });
  }, [open, currentCounts]);

  // ESC key dismissal
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !generating) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, generating, onClose]);

  const setCount = useCallback((intent: QueryIntent, value: number) => {
    setCounts((prev) => ({ ...prev, [intent]: Math.max(2, Math.min(20, value)) }));
  }, []);

  const total = counts.problem_aware + counts.category + counts.comparative + counts.validation;
  const originalTotal = currentCounts.problem_aware + currentCounts.category + currentCounts.comparative + currentCounts.validation;
  const delta = total - originalTotal;

  const hasChanges =
    counts.problem_aware !== currentCounts.problem_aware ||
    counts.category !== currentCounts.category ||
    counts.comparative !== currentCounts.comparative ||
    counts.validation !== currentCounts.validation;

  const activePreset = matchesPreset(counts);

  async function handleRegenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/queries/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, countsPerIntent: counts }),
      });
      const body = await res.json();
      if (body.error) {
        toast.error("Failed to regenerate queries");
        return;
      }
      // Fetch fresh queries to get the full rows with IDs
      const supabase = createClient();
      const { data: freshQueries } = await supabase
        .from("queries")
        .select("*")
        .eq("client_id", clientId)
        .neq("status", "removed")
        .neq("status", "inactive")
        .order("created_at");
      onRegenerated(freshQueries ?? body.queries ?? []);
      onClose();
    } catch {
      toast.error("Failed to regenerate queries — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current && !generating) onClose();
      }}
    >
      <div
        className="relative w-full max-w-lg mx-4 bg-white rounded-2xl border border-[#E2E8F0] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Adjust Query Volume"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#E2E8F0]">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-exo2 font-bold text-lg text-[#0D0437]">
                Adjust Query Volume
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Set how many queries per intent. AI auto-fills any new ones from your Brand DNA.
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={generating}
              className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#0D0437] hover:bg-[#F4F6F9] transition-colors disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Preset chips */}
          <div className="flex flex-wrap gap-2 mt-4">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setCounts({ ...p.counts })}
                disabled={generating}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  activePreset === p.label
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : "bg-white text-[#6B7280] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                } disabled:opacity-40`}
              >
                {p.label}
              </button>
            ))}
            {activePreset === null && (
              <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#F4F6F9] text-[#0D0437] border border-[#E2E8F0]">
                Custom
              </span>
            )}
          </div>
        </div>

        {/* Distribution bar */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex h-3 rounded-full overflow-hidden bg-[#F4F6F9]">
            {INTENT_META.map((meta) => {
              const pct = total > 0 ? (counts[meta.key] / total) * 100 : 25;
              return (
                <div
                  key={meta.key}
                  className="transition-all duration-300 ease-out first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${pct}%`, backgroundColor: meta.color }}
                  title={`${meta.label}: ${counts[meta.key]}`}
                />
              );
            })}
          </div>
        </div>

        {/* Sliders */}
        <div className="px-6 py-3 space-y-1">
          {INTENT_META.map((meta) => (
            <div
              key={meta.key}
              className="flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors"
              style={{ backgroundColor: meta.colorBg }}
            >
              {/* Colour dot */}
              <span
                className="shrink-0 h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: meta.color }}
              />

              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#0D0437] leading-tight">
                  {meta.label}
                </p>
                <p className="text-[11px] text-muted-foreground leading-tight truncate">
                  {meta.description}
                </p>
              </div>

              {/* ± controls + slider */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setCount(meta.key, counts[meta.key] - 1)}
                  disabled={counts[meta.key] <= 2 || generating}
                  className="h-6 w-6 flex items-center justify-center rounded-md border border-[#E2E8F0] bg-white text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437] transition-colors disabled:opacity-30 disabled:hover:text-[#6B7280] disabled:hover:border-[#E2E8F0]"
                  aria-label={`Decrease ${meta.label}`}
                >
                  <Minus className="h-3 w-3" />
                </button>

                <input
                  type="range"
                  min={2}
                  max={20}
                  value={counts[meta.key]}
                  onChange={(e) => setCount(meta.key, Number(e.target.value))}
                  disabled={generating}
                  className="w-20 h-1.5 appearance-none rounded-full bg-[#E2E8F0] accent-[#0D0437] cursor-pointer disabled:opacity-40 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-sm"
                  style={{ accentColor: meta.color }}
                  aria-label={`${meta.label} count`}
                />

                <button
                  onClick={() => setCount(meta.key, counts[meta.key] + 1)}
                  disabled={counts[meta.key] >= 20 || generating}
                  className="h-6 w-6 flex items-center justify-center rounded-md border border-[#E2E8F0] bg-white text-[#6B7280] hover:text-[#0D0437] hover:border-[#0D0437] transition-colors disabled:opacity-30 disabled:hover:text-[#6B7280] disabled:hover:border-[#E2E8F0]"
                  aria-label={`Increase ${meta.label}`}
                >
                  <Plus className="h-3 w-3" />
                </button>

                {/* Count display in intent colour */}
                <span
                  className="w-7 text-center text-sm font-semibold tabular-nums"
                  style={{ color: meta.color }}
                >
                  {counts[meta.key]}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2">
          {/* Delta + total row */}
          <div className="flex items-center justify-between mb-3 text-xs">
            <span className="text-muted-foreground">
              {!hasChanges
                ? "No changes from current portfolio"
                : delta > 0
                  ? `+${delta} queries — AI will generate the difference`
                  : delta < 0
                    ? `${delta} queries — lowest-scored will be trimmed`
                    : "Redistribution only — same total, different mix"}
            </span>
            <span className="font-medium text-[#0D0437] tabular-nums">
              {total} total
            </span>
          </div>

          {/* CTA button */}
          <button
            onClick={handleRegenerate}
            disabled={!hasChanges || generating}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              hasChanges && !generating
                ? "bg-gradient-to-r from-[#0D0437] to-[#7B5EA7] text-white shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                : "bg-[#F4F6F9] text-[#9CA3AF] cursor-not-allowed"
            }`}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating {total} queries…
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate with {total} queries
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
