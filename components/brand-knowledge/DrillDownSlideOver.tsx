"use client";

import React, { useEffect, useState } from "react";
import { X, ChevronDown, ChevronUp, Download } from "lucide-react";
import { useDrillDownData, type DrillDownRow, type DrillDownFilters } from "@/hooks/useDrillDownData";
import { exportRowsAsCSV } from "@/utils/exportCSV";
import type { BrandFactCategory, LLMModel } from "@/types";

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  perplexity: "Perplexity",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

const CATEGORY_LABELS: Record<BrandFactCategory, string> = {
  feature: "Features",
  market: "Markets",
  pricing: "Pricing",
  messaging: "Messaging",
};

const ACCURACY_STYLES: Record<string, string> = {
  correct: "bg-[rgba(26,143,92,0.1)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  incorrect: "bg-[rgba(255,75,110,0.1)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
  uncertain: "bg-[rgba(245,158,11,0.1)] text-[#F59E0B] border-[rgba(245,158,11,0.2)]",
};

interface DrillDownSlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  allRows: DrillDownRow[];
  // Base filter locked from the parent (category or model, not both)
  baseFilters: DrillDownFilters;
  brandName?: string;
}

export function DrillDownSlideOver({
  open,
  onClose,
  title,
  allRows,
  baseFilters,
  brandName,
}: DrillDownSlideOverProps) {
  // Secondary filter that the user can toggle inside the slide-over.
  // If base is category → secondary filter is model. Vice versa.
  const [secondaryModel, setSecondaryModel] = useState<LLMModel | undefined>(undefined);
  const [secondaryCategory, setSecondaryCategory] = useState<BrandFactCategory | undefined>(undefined);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Build merged filters combining base + secondary selection
  const activeFilters: DrillDownFilters = {
    category: baseFilters.category ?? secondaryCategory,
    model: baseFilters.model ?? secondaryModel,
  };

  const rows = useDrillDownData(allRows, activeFilters);

  // Derive available chips from allRows filtered by base only (so chips reflect real data)
  const baseOnlyRows = useDrillDownData(allRows, baseFilters);
  const availableModels = Array.from(new Set(baseOnlyRows.map((r) => r.model))) as LLMModel[];
  const availableCategories = Array.from(
    new Set(baseOnlyRows.map((r) => r.fact_category))
  ) as BrandFactCategory[];

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Reset secondary filter and expanded rows when reopened
  useEffect(() => {
    if (open) {
      setSecondaryModel(undefined);
      setSecondaryCategory(undefined);
      setExpandedIds(new Set());
    }
  }, [open, baseFilters]);

  function toggleRow(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleExport() {
    const safeName = (brandName ?? "brand").replace(/[^a-z0-9]/gi, "-").toLowerCase();
    const suffix = baseFilters.category
      ? `-${baseFilters.category}`
      : baseFilters.model
        ? `-${baseFilters.model}`
        : "";
    exportRowsAsCSV(rows, `${safeName}-knowledge${suffix}.csv`);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-3xl bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-[#E2E8F0] bg-[#F4F6F9]">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="font-serif text-[20px] font-semibold text-[#0D0437] leading-tight">
                {title}
              </h2>
              <p className="text-[11px] text-[#6B7280] mt-0.5">
                {rows.length} result{rows.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleExport}
                disabled={rows.length === 0}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 rounded border border-[#E2E8F0] bg-white text-[#6B7280] hover:bg-[#F4F6F9] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Download className="h-3 w-3" />
                Export CSV
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded hover:bg-[#E2E8F0] text-[#6B7280] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Secondary filter chips — only show when base is one dimension */}
          {!baseFilters.model && availableModels.length > 1 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                Model
              </span>
              {availableModels.map((m) => (
                <button
                  key={m}
                  onClick={() => setSecondaryModel((prev) => (prev === m ? undefined : m))}
                  className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border transition-colors ${secondaryModel === m
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : "bg-white text-[#6B7280] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                    }`}
                >
                  {MODEL_LABELS[m] ?? m}
                </button>
              ))}
            </div>
          )}

          {!baseFilters.category && availableCategories.length > 1 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                Category
              </span>
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() =>
                    setSecondaryCategory((prev) => (prev === cat ? undefined : cat))
                  }
                  className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border transition-colors ${secondaryCategory === cat
                    ? "bg-[#0D0437] text-white border-[#0D0437]"
                    : "bg-white text-[#6B7280] border-[#E2E8F0] hover:border-[#0D0437] hover:text-[#0D0437]"
                    }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body — scrollable table */}
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <p className="text-sm font-semibold text-[#0D0437]">No results</p>
              <p className="text-[12px] text-[#6B7280] mt-1">
                Try removing the secondary filter above.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-[#F4F6F9]">
                  {["Claim", "Model", "Query", "Accuracy", "Flags", ""].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-[8px] font-bold tracking-[2px] uppercase text-[#6B7280] whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = expandedIds.has(row.id);
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className="border-b hover:bg-[rgba(244,246,249,0.7)] cursor-pointer"
                        onClick={() => toggleRow(row.id)}
                      >
                        {/* Claim */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <p className="text-[11px] text-[#1A1A2E] line-clamp-2 leading-snug">
                            {row.fact_claim}
                          </p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <span className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF]">
                              {CATEGORY_LABELS[row.fact_category]}
                            </span>
                            {!row.fact_is_true && (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                bait
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Model */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F4F6F9] text-[#6B7280] border border-[#E2E8F0]">
                            {MODEL_LABELS[row.model] ?? row.model}
                          </span>
                        </td>

                        {/* Query */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <p className="text-[10px] text-[#6B7280] italic line-clamp-2 leading-snug">
                            {row.query_text ? `"${row.query_text}"` : "—"}
                          </p>
                        </td>

                        {/* Accuracy */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ACCURACY_STYLES[row.accuracy] ?? ""}`}
                          >
                            {row.accuracy}
                          </span>
                        </td>

                        {/* Flags */}
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {row.hallucination && (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]">
                                hallucination
                              </span>
                            )}
                            {row.bait_triggered && (
                              <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[rgba(123,94,167,0.08)] text-[#7B5EA7] border-[rgba(123,94,167,0.2)]">
                                bait
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Expand chevron */}
                        <td className="px-4 py-3 text-[#9CA3AF]">
                          {row.raw_response ? (
                            isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )
                          ) : null}
                        </td>
                      </tr>

                      {/* Expanded raw response */}
                      {isExpanded && row.raw_response && (
                        <tr className="border-b bg-[rgba(244,246,249,0.4)]">
                          <td colSpan={6} className="px-6 pb-4 pt-2">
                            <p className="text-[9px] font-bold uppercase tracking-wide text-[#9CA3AF] mb-1.5">
                              LLM Response
                            </p>
                            <div className="text-[11px] text-[#374151] leading-relaxed bg-white border border-[#E2E8F0] rounded p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                              {row.raw_response}
                            </div>
                            {row.notes && (
                              <p className="text-[10px] text-[#9CA3AF] mt-2 italic">
                                {row.notes}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
