"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown } from "lucide-react";
import type { LLMModel } from "@/types";

export interface RunOption {
  model: LLMModel;
  rawResponse: string | null;
  competitorsMentioned: string[];
}

export interface ResponseDrawerProps {
  queryText: string;
  runs: RunOption[];
  brandName: string;
  onClose: () => void;
  mentionSentiment?: "positive" | "neutral" | "negative" | "not_mentioned" | null;
  brandPositioning?: "budget" | "mid-market" | "premium" | "unclear" | null;
}

const DRAWER_SENTIMENT_BADGE: Record<string, string> = {
  positive: "bg-[rgba(26,143,92,0.08)] text-[#1A8F5C] border-[rgba(26,143,92,0.2)]",
  neutral:  "bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]",
  negative: "bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border-[rgba(255,75,110,0.2)]",
};

const MODEL_LABELS: Record<LLMModel, string> = {
  "gpt-4o": "GPT-4o",
  "claude-sonnet-4-6": "Claude",
  "perplexity": "Perplexity",
  "gemini": "Gemini",
  "deepseek": "DeepSeek",
};

const MODEL_BADGE: Record<LLMModel, string> = {
  "gpt-4o": "bg-[rgba(16,163,127,0.1)] text-[#10a37f] border-[rgba(16,163,127,0.2)]",
  "claude-sonnet-4-6": "bg-[rgba(212,162,126,0.1)] text-[#b5804a] border-[rgba(212,162,126,0.2)]",
  "perplexity": "bg-[rgba(31,182,255,0.1)] text-[#1580c0] border-[rgba(31,182,255,0.2)]",
  "gemini": "bg-[rgba(66,133,244,0.1)] text-[#4285f4] border-[rgba(66,133,244,0.2)]",
  "deepseek": "bg-[rgba(99,102,241,0.1)] text-[#6366f1] border-[rgba(99,102,241,0.2)]",
};

// Splits text into parts, wrapping brand-name occurrences in <mark> elements.
function HighlightedResponse({
  text,
  brandName,
}: {
  text: string;
  brandName: string;
}) {
  if (!brandName || !text) return <>{text}</>;

  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  const lowerBrand = brandName.toLowerCase();

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerBrand ? (
          <mark
            key={i}
            className="bg-amber-100 text-amber-900 rounded px-0.5 not-italic font-medium"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function ResponseDrawer({
  queryText,
  runs,
  brandName,
  onClose,
  mentionSentiment,
  brandPositioning,
}: ResponseDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<LLMModel>(runs[0]?.model);

  // Sync selected model if runs change (e.g. new drawer opened)
  useEffect(() => {
    setSelectedModel(runs[0]?.model);
  }, [runs]);

  // Drive the CSS transition: mount with panel off-screen, then slide in
  useEffect(() => {
    const t = setTimeout(() => setIsOpen(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    setIsOpen(false);
    setTimeout(onClose, 220);
  }

  const activeRun = runs.find((r) => r.model === selectedModel) ?? runs[0];
  const multiModel = runs.length > 1;

  return (
    <>
      {/* Dim backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black transition-opacity duration-200 ease-out ${isOpen ? "opacity-40" : "opacity-0"
          }`}
        onClick={handleClose}
        aria-hidden
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Query response"
        className={`fixed inset-y-0 right-0 z-50 flex flex-col w-[480px] max-w-[96vw] bg-white shadow-xl
          transition-transform duration-200 ease-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-center gap-2">
            {multiModel ? (
              /* Dropdown — shown when multiple models available */
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value as LLMModel)}
                  className={`appearance-none text-[9px] font-bold tracking-[1.5px] uppercase pl-2.5 pr-6 py-1 rounded border cursor-pointer focus:outline-none ${MODEL_BADGE[selectedModel]}`}
                >
                  {runs.map((r) => (
                    <option key={r.model} value={r.model}>
                      {MODEL_LABELS[r.model]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 opacity-60" />
              </div>
            ) : (
              /* Single badge — existing behaviour */
              <span
                className={`text-[9px] font-bold tracking-[1.5px] uppercase px-2.5 py-1 rounded border ${MODEL_BADGE[selectedModel]}`}
              >
                {MODEL_LABELS[selectedModel]}
              </span>
            )}
            <span className="font-mono text-[10px] text-[#6B7280]">LLM Response</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-[#F4F6F9] text-[#6B7280] hover:text-[#0D0437] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Query text */}
        <div className="px-6 py-4 bg-[#F4F6F9] border-b border-[#E2E8F0] shrink-0">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-1.5">
            Query
          </p>
          <p className="text-[14px] font-semibold text-[#0D0437] leading-snug italic">
            &ldquo;{queryText}&rdquo;
          </p>
          {/* Context badges — echo the sentiment/positioning visible in the activity list */}
          {((mentionSentiment && mentionSentiment !== "not_mentioned") ||
            (brandPositioning && brandPositioning !== "unclear")) && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {mentionSentiment && mentionSentiment !== "not_mentioned" && (
                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${DRAWER_SENTIMENT_BADGE[mentionSentiment] ?? ""}`}>
                  {mentionSentiment}
                </span>
              )}
              {brandPositioning && brandPositioning !== "unclear" && (
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-[#F4F6F9] text-[#6B7280] border-[#E2E8F0]">
                  {brandPositioning}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Raw response — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-3">
            Response
          </p>

          {activeRun?.rawResponse === null ? (
            <div className="space-y-2.5 animate-pulse">
              <div className="h-3 bg-[#E2E8F0] rounded w-full" />
              <div className="h-3 bg-[#E2E8F0] rounded w-5/6" />
              <div className="h-3 bg-[#E2E8F0] rounded w-full" />
              <div className="h-3 bg-[#E2E8F0] rounded w-4/5" />
              <div className="h-3 bg-[#E2E8F0] rounded w-full" />
              <div className="h-3 bg-[#E2E8F0] rounded w-3/4" />
            </div>
          ) : activeRun?.rawResponse?.trim() === "" ? (
            <p className="text-[13px] text-[#6B7280] italic">No response recorded for this run.</p>
          ) : (
            <p className="text-[13px] text-[#1A1A2E] leading-[1.85] whitespace-pre-wrap">
              <HighlightedResponse text={activeRun?.rawResponse ?? ""} brandName={brandName} />
            </p>
          )}
        </div>

        {/* Competitors mentioned footer */}
        {(activeRun?.competitorsMentioned ?? []).length > 0 && (
          <div className="px-6 py-4 border-t border-[#E2E8F0] bg-[#F4F6F9] shrink-0">
            <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-2">
              Competitors mentioned
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(activeRun?.competitorsMentioned ?? []).map((name) => (
                <span
                  key={name}
                  className="text-[9px] font-bold tracking-wide uppercase px-2 py-1 rounded bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] border border-[rgba(255,75,110,0.15)]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
