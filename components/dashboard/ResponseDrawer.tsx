"use client";

import React, { useEffect, useState } from "react";
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

// ─── Markdown renderer ────────────────────────────────────────────────────────

/**
 * Renders inline markdown within a single line:
 *   - Strips citation refs like [1][2][3]
 *   - **bold** → <strong>
 *   - Brand name occurrences → amber <mark>
 */
function renderInline(text: string, brandName: string, competitorNames: string[] = []): React.ReactNode {
  // Strip footnote-style citations [1], [1][2], etc.
  const clean = text.replace(/(\[\d+\])+/g, "");

  // Split on **bold** markers
  const segments = clean.split(/\*\*(.*?)\*\*/g);

  const escaped = brandName ? brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
  const lowerBrand = brandName?.toLowerCase();

  // Build competitor lookup for case-insensitive matching
  const competitorPatterns = competitorNames
    .filter(Boolean)
    .map((c) => ({
      escaped: c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      lower: c.toLowerCase(),
    }));

  // Combined regex: brand + all competitors in one pass to avoid nested splits
  const allPatterns = [
    ...(escaped ? [escaped] : []),
    ...competitorPatterns.map((c) => c.escaped),
  ];

  function highlightNames(str: string, outerKey: number): React.ReactNode {
    if (allPatterns.length === 0 || !str) return <React.Fragment key={outerKey}>{str}</React.Fragment>;
    const regex = new RegExp(`(${allPatterns.join("|")})`, "gi");
    const parts = str.split(regex);
    return (
      <React.Fragment key={outerKey}>
        {parts.map((p, j) => {
          const lower = p.toLowerCase();
          if (escaped && lower === lowerBrand) {
            return (
              <mark key={j} className="bg-amber-100 text-amber-900 rounded px-0.5 not-italic font-medium">
                {p}
              </mark>
            );
          }
          if (competitorPatterns.some((c) => lower === c.lower)) {
            return (
              <mark key={j} className="bg-[rgba(255,75,110,0.08)] text-[#FF4B6E] rounded px-0.5 not-italic font-medium">
                {p}
              </mark>
            );
          }
          return <React.Fragment key={j}>{p}</React.Fragment>;
        })}
      </React.Fragment>
    );
  }

  return (
    <>
      {segments.map((seg, i) =>
        i % 2 === 1 ? (
          // Bold segment
          <strong key={i} className="font-semibold text-[#0D0437]">
            {highlightNames(seg.replace(/(\[\d+\])+/g, ""), i)}
          </strong>
        ) : (
          highlightNames(seg, i)
        )
      )}
    </>
  );
}

/**
 * Full markdown-to-React renderer. Handles:
 *   - ### / ## / # headings
 *   - - and * bullet lists (including indented sub-bullets)
 *   - **bold** inline, brand highlighting, citation stripping
 *   - Plain paragraphs
 */
function MarkdownBody({ text, brandName, competitorNames = [] }: { text: string; brandName: string; competitorNames?: string[] }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: { content: string; indent: number }[] = [];
  let key = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul key={`ul-${key++}`} className="space-y-1 my-0">
        {listBuffer.map((item, j) => (
          <li
            key={j}
            className="flex gap-2 text-[13px] text-[#374151] leading-[1.75]"
            style={item.indent > 0 ? { paddingLeft: `${item.indent * 14}px` } : undefined}
          >
            <span className="text-[#9CA3AF] shrink-0 select-none mt-[3px] text-[10px]">•</span>
            <span>{renderInline(item.content, brandName, competitorNames)}</span>
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Blank line — flush pending list, skip
    if (!trimmed) {
      flushList();
      continue;
    }

    // Heading: #, ##, ###
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const cls =
        level === 1
          ? "text-[14px] font-bold text-[#0D0437] tracking-tight"
          : level === 2
          ? "text-[13px] font-bold text-[#0D0437]"
          : "text-[12px] font-semibold text-[#0D0437]";
      elements.push(
        <p key={`h-${key++}`} className={cls}>
          {renderInline(headingMatch[2], brandName, competitorNames)}
        </p>
      );
      continue;
    }

    // Bullet: optional leading whitespace then - or *
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (bulletMatch) {
      listBuffer.push({
        content: bulletMatch[2],
        indent: Math.floor(bulletMatch[1].length / 2),
      });
      continue;
    }

    // Paragraph
    flushList();
    elements.push(
      <p key={`p-${key++}`} className="text-[13px] text-[#374151] leading-[1.85]">
        {renderInline(trimmed, brandName, competitorNames)}
      </p>
    );
  }

  flushList();

  return <div className="space-y-2.5">{elements}</div>;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

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
        className={`fixed inset-0 z-40 bg-black transition-opacity duration-200 ease-out ${
          isOpen ? "opacity-40" : "opacity-0"
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
              /* Single badge */
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
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-1.5">Query</p>
          <p className="text-[14px] font-semibold text-[#0D0437] leading-snug italic">
            &ldquo;{queryText}&rdquo;
          </p>
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

        {/* Response — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          <p className="text-[9px] font-bold tracking-[2px] uppercase text-[#6B7280] mb-4">Response</p>

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
            <MarkdownBody text={activeRun?.rawResponse ?? ""} brandName={brandName} competitorNames={activeRun?.competitorsMentioned ?? []} />
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
